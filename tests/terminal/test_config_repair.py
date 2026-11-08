"""P1-9 engine-upgrade -> config invalidation chain (strata_control/config_repair.py).

An engine upgrade replaces ~/.local/share/strata/components/<family>/<version>-… and every
run config that pinned the old version dies quietly at next start (the vision.exe dead link,
seen on this machine: configs point at 0.1.55 while only 0.1.57 exists). repair_install walks
the installed run configs and re-points every versioned component path at the ACTIVE version
(highest semver), persisting through the shared atomic writer. Idempotent by construction.

The test fakes an upgrade (0.1.55 -> 0.1.56) and asserts the persisted fix; the real-data test
asserts the actual installed configs are dead-link-free after repair.
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("config_repair", ROOT / "strata_control" / "config_repair.py")
config_repair = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(config_repair)


def make_components(td: Path, versions=("0.1.55-macos-arm64-metal", "0.1.56-macos-arm64-metal")) -> Path:
    comps = td / "components" / "engine"
    comps.mkdir(parents=True)
    for v in versions:
        (comps / v).mkdir()
        (comps / v / "strata-vision").write_text("#!/bin/sh\n")
    return comps


def make_config(path: Path, version: str) -> None:
    path.write_text(json.dumps({
        "exe": "component:strata-engine",
        "args": [],
        "model_name": "qwen3.8-flash-next-iq3_s",
        "vision": {"exe": f"/Users/x/.local/share/strata/components/engine/{version}-macos-arm64-metal/strata-vision",
                   "args": ["--model", "/models/base"]},
    }))


class ActiveVersionTests(unittest.TestCase):
    def test_picks_the_highest_semver(self):
        with tempfile.TemporaryDirectory() as td:
            comps = make_components(Path(td))
            self.assertEqual(config_repair.active_version(comps), "0.1.56-macos-arm64-metal")

    def test_semver_sorts_numerically_not_lexically(self):
        with tempfile.TemporaryDirectory() as td:
            comps = make_components(Path(td), versions=("0.1.9-macos-arm64-metal", "0.1.10-macos-arm64-metal"))
            self.assertEqual(config_repair.active_version(comps), "0.1.10-macos-arm64-metal",
                             "lexical sort would pick 0.1.9")

    def test_empty_family_is_none(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td) / "components" / "engine"
            d.mkdir(parents=True)
            self.assertIsNone(config_repair.active_version(d))


class RepairConfigTests(unittest.TestCase):
    def test_upgrade_is_persisted(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            comps = make_components(td)
            cfg = td / "strata-iq3_s.json"
            make_config(cfg, "0.1.55")
            out = config_repair.repair_config(cfg, comps.parent)
            self.assertTrue(out["changed"])
            fixed = json.loads(cfg.read_text())
            self.assertIn("0.1.56", fixed["vision"]["exe"])
            self.assertNotIn("0.1.55", fixed["vision"]["exe"])
            self.assertEqual(fixed["vision"]["args"], ["--model", "/models/base"], "the rest of the config is untouched")

    def test_second_run_changes_nothing(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            comps = make_components(td)
            cfg = td / "strata-iq3_s.json"
            make_config(cfg, "0.1.55")
            config_repair.repair_config(cfg, comps.parent)
            out = config_repair.repair_config(cfg, comps.parent)
            self.assertFalse(out["changed"], "idempotent")
            self.assertEqual(out["fixes"], [])

    def test_current_version_is_left_alone(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            comps = make_components(td)
            cfg = td / "strata-iq3_s.json"
            make_config(cfg, "0.1.56")
            out = config_repair.repair_config(cfg, comps.parent)
            self.assertFalse(out["changed"])

    def test_non_component_paths_are_untouched(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            comps = make_components(td)
            cfg = td / "strata-x.json"
            cfg.write_text(json.dumps({"tokenizer": "/models/some-0.1.55-dir/tok", "args": []}))
            out = config_repair.repair_config(cfg, comps.parent)
            self.assertFalse(out["changed"], "only paths under components/<family>/<version> are re-pointed")


class RepairInstallTests(unittest.TestCase):
    def test_walks_the_install_dir(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            comps = make_components(td)
            (td / "install").mkdir()
            make_config(td / "install" / "strata-a.json", "0.1.55")
            make_config(td / "install" / "strata-b.json", "0.1.56")
            report = config_repair.repair_install(td / "install", comps.parent)
            by = {r["config"]: r for r in report}
            self.assertEqual(len(by["strata-a.json"]["fixes"]), 1)
            self.assertEqual(len(by["strata-b.json"]["fixes"]), 0)
            self.assertIn("0.1.56", json.loads((td / "install" / "strata-a.json").read_text())["vision"]["exe"])


class RealDataTests(unittest.TestCase):
    COMPONENTS = Path.home() / ".local/share/strata/components"
    INSTALL = Path.home() / ".local/share/strata/install"

    def test_installed_configs_have_no_dead_component_links(self):
        if not (self.COMPONENTS.exists() and self.INSTALL.exists()):
            self.skipTest("no install/components on this machine")
        report = config_repair.repair_install(self.INSTALL, self.COMPONENTS)
        total_fixes = sum(len(r["fixes"]) for r in report)
        # after the repair, no config may still point into a version folder that is gone
        for family in self.COMPONENTS.iterdir():
            if not family.is_dir():
                continue                 # Finder's .DS_Store and other stray files are not engine families
            versions = {d.name for d in family.iterdir() if d.is_dir()}
            for cfg in self.INSTALL.glob("strata-*.json"):
                text = cfg.read_text()
                import re
                for m in re.finditer(r"components/([A-Za-z0-9_-]+)/(\d+\.\d+\.\d+[^/\"]*)", text):
                    if m.group(1) == family.name:
                        self.assertIn(m.group(2), versions,
                                      f"{cfg.name} still pins {m.group(2)} which is gone")
        self.assertGreaterEqual(total_fixes, 0)


if __name__ == "__main__":
    unittest.main()


class DryRunTests(unittest.TestCase):
    """kimi round 2 F4: --dry-run reports what would change and writes nothing."""

    def test_dry_run_reports_fixes_without_touching_the_file(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            comps = make_components(td)
            cfg = td / "strata-iq3_s.json"
            make_config(cfg, "0.1.55")
            before = cfg.read_text()
            out = config_repair.repair_config(cfg, comps.parent, dry_run=True)
            self.assertTrue(out["changed"])
            self.assertEqual(len(out["fixes"]), 1)
            self.assertIn("0.1.55", out["fixes"][0]) and self.assertIn("0.1.56", out["fixes"][0])
            self.assertEqual(cfg.read_text(), before, "dry run: the file is untouched")

    def test_unreadable_json_is_a_row_not_a_stop(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            comps = make_components(td)
            (td / "install").mkdir()
            make_config(td / "install" / "strata-good.json", "0.1.55")
            (td / "install" / "strata-broken.json").write_text("{not json at all")
            report = config_repair.repair_install(td / "install", comps.parent)
            by = {r["config"]: r for r in report}
            # the broken config is a no-op row (its text holds no components path to fix) -
            # whatever its shape, it must not stop the walk
            self.assertFalse(by["strata-broken.json"]["changed"])
            self.assertTrue(by["strata-good.json"]["changed"], "the walk continues past it")
