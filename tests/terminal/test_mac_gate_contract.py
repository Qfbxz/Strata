"""P0 contract: the Mac picker and the installer's gate draw their sizes from ONE source
(strata_control/mac_fit.app_sizes / app_families), so what the app shows is exactly what can
be installed. The 2026-11-05 drift (picker offered unsloth, the gate refused it, three install
attempts failed) cannot come back while this test passes."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

from strata_control import mac_fit


def load_mcp():
    spec = importlib.util.spec_from_file_location("strata_mcp_contract", ROOT / "tools" / "strata_mcp.py")
    mcp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mcp)
    return mcp


class MacGateContractTests(unittest.TestCase):
    def test_app_sizes_cover_all_tested_entries(self):
        sizes = mac_fit.app_sizes()
        for wanted in ("IQ3_S", "UD-Q4_K_XL", "UD-Q5_K_XL", "UD-Q6_K_XL", "Gyro-S"):
            self.assertIn(wanted, sizes, f"{wanted} is tested in MAC_MODELS and must be offered")
        for entry, d in mac_fit.MAC_MODELS.items():
            if d.get("tested"):
                self.assertIn(entry, sizes)

    def test_app_families_single_source(self):
        self.assertEqual(mac_fit.app_families()[0], "qwen", "qwen stays the default/recommended family")
        self.assertIn("unsloth", mac_fit.app_families())

    def test_picker_and_gate_draw_the_same_set(self):
        home = Path(tempfile.mkdtemp())
        env = {"HOME": str(home), "USERPROFILE": str(home)}
        spec = importlib.util.spec_from_file_location("strata_mcp_gate", ROOT / "tools" / "strata_mcp.py")
        mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mcp)
        s = mcp.Strata(ROOT / "tools", ROOT)
        models, families, _ctx, _src = s.tables()
        for family in mac_fit.app_families():
            picker = set(s._mac_sizes(models, family))
            gate = set(mac_fit.app_sizes(family))
            self.assertEqual(picker, gate, f"family {family}: the picker and the installer must offer the same sizes")
        # the setup.py gate itself reads the same helper (source canary — the drift we hit came
        # from a hand-typed family tuple in exactly two places):
        setup_src = (ROOT / "setup.py").read_text(encoding="utf-8")
        self.assertIn("MF.app_sizes()", setup_src, "setup.py must use the single-source helper")
        self.assertNotIn('("qwen", "gyro")', setup_src, "the hand-typed family tuple is gone from the gate")
        mcp_src = (ROOT / "tools" / "strata_mcp.py").read_text(encoding="utf-8")
        self.assertIn("app_families()", mcp_src, "the picker must use the single-source helper")
        self.assertNotIn('("qwen", "unsloth", "gyro")', mcp_src, "no hand-typed family tuple in the picker either")


if __name__ == "__main__":
    unittest.main()
