#!/usr/bin/env python3
"""stage-control's target check: the staged control must be FOR the machine that builds with it.

The 2026-11-06 04:00 case: a darwin-x86_64 stage left over from a cross build passed the old
files-exist check on an arm64 Mac (Rosetta runs the interpreter), the build skipped re-staging,
and the finished app identified itself as macos-x86_64 and could not find its engine. The
check now reads BUNDLE.json's target and the bundled interpreter's Mach-O slice.

Run:  python3 tools/test_stage_control_target.py
"""

from __future__ import annotations

import importlib.util
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("stage_control", ROOT / "apps" / "desktop" / "scripts" / "stage-control.py")
sc = importlib.util.module_from_spec(spec)
sys.modules["stage_control"] = sc
spec.loader.exec_module(sc)


def macho(path: Path, cpu: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack("<II", 0xFEEDFACF, cpu) + b"\0" * 56)
    return path


class TargetCheckTests(unittest.TestCase):
    def make_stage(self, td: Path, target: str, cpu: int) -> Path:
        (td / "BUNDLE.json").write_text(json.dumps({"target": target}))
        return macho(td / "python" / "bin" / "python3.12", cpu)

    def test_x86_stage_on_arm64_build_is_caught(self):
        with tempfile.TemporaryDirectory() as td:
            self.make_stage(Path(td), "darwin-x86_64", 7)
            problems = sc.target_problems(Path(td), "darwin-arm64")
            joined = "\n".join(problems)
            self.assertIn("darwin-x86_64", joined, "the manifest target mismatch is named")
            self.assertIn("x86_64 binary", joined, "the interpreter slice mismatch is named")

    def test_matching_arm64_stage_is_clean(self):
        with tempfile.TemporaryDirectory() as td:
            self.make_stage(Path(td), "darwin-arm64", 0x0100000C)
            self.assertEqual(sc.target_problems(Path(td), "darwin-arm64"), [])

    def test_fat_interpreter_is_accepted(self):
        with tempfile.TemporaryDirectory() as td:
            p = self.make_stage(Path(td), "darwin-arm64", 0x0100000C)
            p.write_bytes(struct.pack("<II", 0xCAFEBABE, 0) + b"\0" * 56)   # fat header
            self.assertEqual(sc.target_problems(Path(td), "darwin-arm64"), [])

    def test_missing_manifest_is_a_problem(self):
        with tempfile.TemporaryDirectory() as td:
            (Path(td) / "python" / "bin").mkdir(parents=True)
            problems = sc.target_problems(Path(td), "darwin-arm64")
            self.assertTrue(any("BUNDLE.json" in p for p in problems))

    def test_macho_cpu_reads_both_slices(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(sc.macho_cpu(macho(Path(td) / "a", 0x0100000C)), "arm64")
            self.assertEqual(sc.macho_cpu(macho(Path(td) / "b", 7)), "x86_64")
            self.assertEqual(sc.macho_cpu(Path(td) / "nope"), "unknown")

    def test_the_real_staging_on_this_machine_is_for_this_machine(self):
        staged = ROOT / "apps" / "desktop" / "src-tauri" / "resources" / "control"
        if not (staged / "BUNDLE.json").exists():
            self.skipTest("nothing staged right now")
        host = importlib.import_module if False else None
        sys.path.insert(0, str(ROOT / "packaging"))
        try:
            import package_terminal as pt
            self.assertEqual(sc.target_problems(staged, pt.host_target()), [],
                             "the staging the next build would reuse must be for this machine")
        finally:
            sys.path.pop(0)


if __name__ == "__main__":
    unittest.main(verbosity=1)
