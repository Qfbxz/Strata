"""P1-9: repair the engine-upgrade -> config-invalidation chain.

An engine upgrade swaps ~/.local/share/strata/components/<family>/<x.y.z>-… and every run
config that pinned the old version dies at next start - quietly (the vision.exe dead link was
live on this machine: configs pointed at 0.1.55 while only 0.1.57 existed). repair_install
re-points every versioned component path at the ACTIVE version (highest semver) and persists
through the shared atomic writer (strata_control/atomic.py). Idempotent by construction.

CLI:  python3 strata_control/config_repair.py [COMPONENTS_DIR] [INSTALL_DIR]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    from .atomic import guarded_write
except ImportError:   # loaded standalone (the test loader, or run as a script)
    import importlib.util as _ilu
    _atomic_spec = _ilu.spec_from_file_location("strata_atomic", Path(__file__).resolve().parent / "atomic.py")
    _atomic = _ilu.module_from_spec(_atomic_spec)
    _atomic_spec.loader.exec_module(_atomic)
    guarded_write = _atomic.guarded_write

COMPONENT_VERSION = re.compile(r"([\\/]components[\\/][A-Za-z0-9_-]+[\\/])(\d+\.\d+\.\d+[^\\/\"]*)([\\/\"]|$)")
VERSION_PREFIX = re.compile(r"^(\d+)\.(\d+)\.(\d+)")


def _version_key(name: str):
    m = VERSION_PREFIX.match(name)
    return tuple(int(x) for x in m.groups()) if m else (-1, -1, -1)


def active_version(family_dir: Path) -> str | None:
    """The active version folder of one component family: the highest semver. Lexical sort
    would pick 0.1.9 over 0.1.10."""
    if not family_dir.is_dir():
        return None
    versions = [d.name for d in family_dir.iterdir() if d.is_dir() and VERSION_PREFIX.match(d.name)]
    if not versions:
        return None
    return max(versions, key=_version_key)


def repair_config(cfg_path: Path, components_dir: Path, dry_run: bool = False) -> dict:
    """Re-point every versioned component path in one run config at the active version.
    Strings outside components/<family>/<version> are never touched. The write goes through
    guarded_write (the shared lock protocol, P0-5): the running app edits these very files.
    dry_run reports what WOULD change without touching the file."""
    cfg_path = Path(cfg_path)
    fixes: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        if isinstance(node, str) and re.search(r"[\\/]components[\\/]", node):
            def sub(m):
                family_dir = m.group(1).strip("/")
                family = family_dir.split("/")[-1]
                version, tail = m.group(2), m.group(3)
                active = active_version(Path(components_dir) / family)
                if active and active != version:
                    fixes.append(f"{version} -> {active} ({family})")
                    return f"{m.group(1)}{active}{tail}"
                return m.group(0)
            return COMPONENT_VERSION.sub(sub, node)
        return node

    def mutate(current: dict) -> dict:
        fixes.clear()
        return walk(current)

    if dry_run:
        try:
            walk(json.loads(cfg_path.read_text()))
        except (OSError, ValueError):
            pass
        return {"config": cfg_path.name, "changed": bool(fixes), "fixes": fixes}
    # a pre-read to skip the lock entirely when there is nothing to fix (the common case)
    try:
        if not "/components/" in cfg_path.read_text():
            return {"config": cfg_path.name, "changed": False, "fixes": []}
    except (OSError, ValueError) as e:
        return {"config": cfg_path.name, "changed": False, "fixes": [], "error": str(e)}
    try:
        written = guarded_write(cfg_path, mutate, required_keys=("exe",))
    except Exception as e:
        return {"config": cfg_path.name, "changed": False, "fixes": [], "error": str(e)}
    # walk() ran inside mutate under the lock against the CURRENT file; the candidate it built
    # is what was written (guarded_write writes atomically and rotates the backups)
    return {"config": cfg_path.name, "changed": bool(fixes) and bool(written), "fixes": fixes}


def repair_install(install_dir, components_dir, dry_run: bool = False) -> list[dict]:
    """Walk every strata-*.json run config in the install dir. One unreadable config is a row
    with an error - it never stops the rest of the walk."""
    install_dir = Path(install_dir)
    rows = []
    for cfg in sorted(install_dir.glob("strata-*.json")):
        try:
            rows.append(repair_config(cfg, Path(components_dir), dry_run=dry_run))
        except json.JSONDecodeError as e:
            rows.append({"config": cfg.name, "changed": False, "fixes": [], "error": f"unreadable JSON: {e}"})
    return rows


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    dry = "--dry-run" in sys.argv[1:]
    components = Path(args[0]) if args else Path.home() / ".local/share/strata/components"
    install = Path(args[1]) if len(args) > 1 else Path.home() / ".local/share/strata/install"
    if not components.is_dir():
        print(f"config-repair: no components dir at {components}", file=sys.stderr)
        return 1
    rows = repair_install(install, components, dry_run=dry)
    if dry:
        print("config-repair: DRY RUN - nothing was written")
    changed = 0
    for r in rows:
        if r["changed"]:
            changed += 1
            print(f"FIXED {r['config']}: {'; '.join(r['fixes'])}")
        else:
            print(f"OK    {r['config']}")
    print(f"config-repair: {changed} config(s) re-pointed at the active components")
    return 0


if __name__ == "__main__":
    sys.exit(main())
