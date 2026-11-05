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
    from .atomic import write_text
except ImportError:   # loaded standalone (the test loader, or run as a script)
    import importlib.util as _ilu
    _atomic_spec = _ilu.spec_from_file_location("strata_atomic", Path(__file__).resolve().parent / "atomic.py")
    _atomic = _ilu.module_from_spec(_atomic_spec)
    _atomic_spec.loader.exec_module(_atomic)
    write_text = _atomic.write_text

COMPONENT_VERSION = re.compile(r"(components/[A-Za-z0-9_-]+/)(\d+\.\d+\.\d+[^/\"]*)([/\"]|$)")
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


def repair_config(cfg_path: Path, components_dir: Path) -> dict:
    """Re-point every versioned component path in one run config at the active version.
    Strings outside components/<family>/<version> are never touched."""
    cfg_path = Path(cfg_path)
    data = json.loads(cfg_path.read_text())
    fixes: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        if isinstance(node, str) and "/components/" in node:
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

    fixed = walk(data)
    if fixes:
        write_text(cfg_path, json.dumps(fixed, ensure_ascii=False, indent=2))
    return {"config": cfg_path.name, "changed": bool(fixes), "fixes": fixes}


def repair_install(install_dir, components_dir) -> list[dict]:
    """Walk every strata-*.json run config in the install dir."""
    install_dir = Path(install_dir)
    return [repair_config(cfg, Path(components_dir))
            for cfg in sorted(install_dir.glob("strata-*.json"))]


def main() -> int:
    components = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / ".local/share/strata/components"
    install = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / ".local/share/strata/install"
    if not components.is_dir():
        print(f"config-repair: no components dir at {components}", file=sys.stderr)
        return 1
    rows = repair_install(install, components)
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
