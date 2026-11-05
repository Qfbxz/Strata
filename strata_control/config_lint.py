"""P1-5: the config lint layer - the four silent traps, made loud.

`--expert-cache 64gb` atoi-parses to 64; `--mtp` without `--spec >= 2` is dropped without a
word; a window above the rope's 256K quietly degrades long answers; a versioned component
path dies on the next engine upgrade (the vision.exe dead link on this machine). lint_args
reads an args ARRAY (the run-config format), lint_install walks an install directory.

CLI:  python3 strata_control/config_lint.py [INSTALL_DIR]      (default: the real install)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

VERSIONED_PATH = re.compile(r"/components/[A-Za-z0-9_-]+/\d+\.\d+\.\d+[^/]*")
KNOWN_ROPE_FLAGS = ("--rope-scaling", "--rope-scale")


def lint_args(args: list[str]) -> list[dict]:
    """Every issue found in one args array: {level: 'error'|'warn', rule, message}."""
    issues: list[dict] = []

    def value_of(flag: str):
        return args[args.index(flag) + 1] if flag in args and args.index(flag) + 1 < len(args) else None

    # -- expert-cache: the engine atoi-parses the value (generate.cpp:3435), so a unit suffix
    #    silently changes the meaning ("64gb" is 64 slots). A bare number or `auto` only.
    cache = value_of("--expert-cache")
    if cache and cache != "auto" and not cache.isdigit():
        issues.append({"level": "error", "rule": "expert-cache-unit",
                       "message": f"--expert-cache {cache!r}: the engine reads this with atoi, so a unit "
                                  f"suffix silently changes the meaning - give a bare number (MiB) or 'auto'"})

    # -- mtp needs a window: the engine drops the draft layer without --spec >= 2, without a word
    spec_raw = value_of("--spec")
    spec = None
    if spec_raw is not None:
        try:
            spec = int(spec_raw)
        except ValueError:
            spec = None
        if spec is None or not (1 <= spec <= 16):
            issues.append({"level": "error", "rule": "spec-range",
                           "message": f"--spec {spec_raw!r}: the window is an integer 1..16"})
    if "--mtp" in args:
        if spec is None or spec < 2:
            issues.append({"level": "error", "rule": "mtp-needs-spec",
                           "message": "--mtp without --spec >= 2: the engine silently drops the draft layer, "
                                      "so the model runs with no speculation at all"})
    minp = value_of("--spec-min-p")
    if minp is not None:
        try:
            p = float(minp)
        except ValueError:
            p = -1
        if not (0.0 <= p <= 1.0):
            issues.append({"level": "error", "rule": "spec-min-p-range",
                           "message": f"--spec-min-p {minp!r}: a probability belongs in [0, 1]"})

    # -- window vs rope: above 262144 the positions leave the trained rope unless scaling is set.
    #    A warn, not an error: a 512K window needle-tested clean on this machine (2026-11-03) while
    #    the mechanism is still unconfirmed (plan P1-7 / NO-4), so the flag asks for the explicit
    #    rope setting or a fresh needle run - it does not block the config.
    ctx_raw = value_of("--max-context")
    if ctx_raw is not None:
        try:
            ctx = int(ctx_raw)
        except ValueError:
            ctx = None
        if ctx and ctx > 262144 and not any(f in args for f in KNOWN_ROPE_FLAGS):
            issues.append({"level": "warn", "rule": "rope",
                           "message": f"--max-context {ctx} above 262144 without a rope-scaling flag: the positions "
                                      f"may leave the trained rope (a 512K needle passed 2026-11-03 but the "
                                      f"mechanism is unconfirmed, plan P1-7) - set --rope-scaling or re-run the needle"})

    # -- versioned component paths: dead after the next engine upgrade (the vision.exe trap)
    for i, a in enumerate(args):
        candidates = []
        if a.startswith("--") and i + 1 < len(args) and not args[i + 1].startswith("--"):
            candidates.append((a, args[i + 1]))
        elif "=" in a and a.startswith("--"):
            flag, _, value = a.partition("=")
            candidates.append((flag, value))
        for flag, value in candidates:
            if VERSIONED_PATH.search(value):
                issues.append({"level": "warn", "rule": "versioned-path",
                               "message": f"{flag} {value}: the path pins a component version - the next "
                                          f"engine upgrade breaks it (the vision.exe dead link)"})
    return issues


def lint_install(install_dir) -> list[dict]:
    """Lint every strata-*.json run config in an install dir: one row per config."""
    rows = []
    for cfg in sorted(Path(install_dir).glob("strata-*.json")):
        try:
            data = json.loads(cfg.read_text())
        except (OSError, ValueError) as e:
            rows.append({"config": cfg.name, "errors": 1, "warns": 0,
                         "issues": [{"level": "error", "rule": "unreadable", "message": str(e)}]})
            continue
        issues = lint_args(data.get("args", []))
        rows.append({"config": cfg.name,
                     "errors": sum(1 for i in issues if i["level"] == "error"),
                     "warns": sum(1 for i in issues if i["level"] == "warn"),
                     "issues": issues})
    return rows


def main() -> int:
    install = sys.argv[1] if len(sys.argv) > 1 else str(Path.home() / ".local/share/strata/install")
    rows = lint_install(install)
    bad = 0
    for r in rows:
        mark = "OK  " if not r["issues"] else "WARN" if r["errors"] == 0 else "FAIL"
        print(f"{mark} {r['config']}: {r['errors']} error(s), {r['warns']} warn(s)")
        for i in r["issues"]:
            print(f"    [{i['level']}] {i['rule']}: {i['message']}")
        bad += r["errors"]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
