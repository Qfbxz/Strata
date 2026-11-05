"""Deletion-safety contract for tools/strata_mcp.py (P0-1/2/3/4/4b, plan STRATA-IMPROVEMENT-PLAN.md).

The 2026-11-05 incident: a generic "Delete model" click freed 430 GB inside the person's own
folder (~/gguf) without any indication that bytes outside Strata's own folders were going with it.
The contract these tests pin:

1. the person's own files (no .done / conversions.json marks) are NEVER deleted, wherever they are
   (#3716 semantics);
2. Strata-made files that live in folders the person chose (outside Strata's own roots) stay
   deletable (#3716) but are flagged `outside` in the plan, and freeing them needs an explicit
   `confirm_outside=true` — or a surgical `also_remove` naming exactly those files;
3. parents of deleted .gguf files are only collected when they are inside Strata's own folders —
   a user folder like `~/gguf/metal` survives as a directory;
4. a confirmed removal leaves a forensic record at <root>/.strata-mcp/last-removal.json;
5. identity never guesses: no model → refuse, ambiguous identity → refuse.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

from tools import strata_mcp  # noqa: E402


def write_json(p: Path, data) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


def fake_shard(folder: Path, name: str, size: int = 64, mark: bool = True) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    f = folder / name
    f.write_bytes(b"\x00" * size)
    if mark:
        f.with_name(f.name + ".done").write_text("sha256 test\n")
    return f


def fake_pack(folder: Path, name: str) -> Path:
    p = folder / name
    p.mkdir(parents=True, exist_ok=True)
    (p / "conversions.json").write_text("{}", encoding="utf-8")
    (p / "dense.bin").write_bytes(b"\x00" * 32)
    return p


def config_for(root: Path, tag: str, model_name: str, pack: Path, shard1: Path, shard2: Path) -> Path:
    return write_json(root / f"strata-{tag}.json", {
        "exe": "component:strata-engine",
        "args": ["--pack", str(pack), "--native", str(shard1), "--ple-gguf", str(shard2)],
        "model_name": model_name,
    })


class OutsideConfirmTests(unittest.TestCase):
    """P0-1: Strata-made files in the person's chosen folders need confirm_outside."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.root = self.base / "install"
        self.root.mkdir()
        self.user = self.base / "user-gguf"          # the person's own folder, outside every allowed root
        self.s = strata_mcp.Strata(self.root, ROOT)
        self.t = strata_mcp.Tools(self.s)
        s1 = fake_shard(self.user / "unsloth-UD-Q4_K_XL", "m-00001-of-00004.gguf")
        s2 = fake_shard(self.user / "unsloth-UD-Q4_K_XL", "m-00002-of-00004.gguf")
        pack = fake_pack(self.user / "packs", "unsloth-ud-q4_k_xl")
        self.s1, self.s2, self.pack = s1, s2, pack
        self.cfg = config_for(self.root, "ud-q4", "qwen-m", pack, s1, s2)

    def test_plan_flags_outside_bytes(self):
        plan = self.s.removal_plan(self.cfg)
        self.assertGreater(plan["outside_bytes"], 0)
        self.assertIn(str(self.s1), plan["outside_paths"])
        outside_items = [x for x in plan["remove"] if x.get("outside")]
        self.assertTrue(outside_items)

    def test_persons_own_file_without_marks_is_kept(self):
        own = fake_shard(self.user / "own", "own-model.gguf", mark=False)
        own_cfg = write_json(self.root / "strata-own.json", {
            "exe": "component:strata-engine",
            "args": ["--native", str(own)],
            "model_name": "own",
        })
        plan = self.s.removal_plan(own_cfg)
        self.assertIn(str(own), [k["path"] for k in plan["keep"]])
        self.assertNotIn(str(own), [r["path"] for r in plan["remove"]])

    def test_confirm_without_outside_flag_refuses_and_deletes_nothing(self):
        out = self.t.strata_remove("ud-q4")                          # plan only: names confirm_outside
        self.assertIn("confirm_outside", out["summary"] + json.dumps(out["plan"]))
        with self.assertRaises(strata_mcp.ToolError):
            self.t.strata_remove("ud-q4", confirm=True)
        self.assertTrue(self.s1.exists() and self.s2.exists() and self.pack.exists())
        self.assertTrue(self.cfg.exists())

    def test_confirm_outside_frees_everything_but_parent_dirs_survive(self):
        out = self.t.strata_remove("ud-q4", confirm=True, confirm_outside=True)
        self.assertEqual(out["failed"], [])
        self.assertFalse(self.s1.exists() and self.s2.exists())
        self.assertFalse(self.pack.exists())             # the pack is a plan item: freed too
        # P0-2: parent directories that are NOT plan items survive as directories
        self.assertTrue(self.user.exists())
        self.assertTrue((self.user / "unsloth-UD-Q4_K_XL").exists())

    def test_also_remove_frees_only_named_files_without_outside_flag(self):
        self.t.strata_remove("ud-q4", confirm=True, also_remove=[str(self.s1)])
        self.assertFalse(self.s1.exists(), "the named file is freed")
        self.assertTrue(self.s2.exists(), "unnamed outside files are kept")
        self.assertTrue(self.pack.exists())
        self.assertFalse(self.cfg.exists())

    def test_also_remove_refuses_paths_that_are_not_in_the_plan(self):
        outside = self.base / "innocent.txt"
        outside.write_text("x")
        with self.assertRaises(strata_mcp.ToolError):
            self.t.strata_remove("ud-q4", confirm=True, also_remove=[str(outside)])
        self.assertTrue(outside.exists())
        self.assertTrue(self.s1.exists())


class StrataLayoutTests(unittest.TestCase):
    """P0-1 sanity: inside Strata's own folders everything still deletes normally."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "install"
        (self.root / "models" / "iq3_s").mkdir(parents=True)
        self.s = strata_mcp.Strata(self.root, ROOT)
        self.t = strata_mcp.Tools(self.s)
        d = self.root / "models" / "iq3_s"
        self.s1 = fake_shard(d, "m-00001-of-00002.gguf")
        self.s2 = fake_shard(d, "m-00002-of-00002.gguf")
        self.cfg = config_for(self.root, "iq3_s", "qwen-m", d, self.s1, self.s2)

    def test_inside_layout_removes_normally(self):
        plan = self.s.removal_plan(self.cfg)
        self.assertEqual(plan["outside_bytes"], 0)
        self.assertIn(self.s1.name, {Path(r["path"]).name for r in plan["remove"]})
        out = self.t.strata_remove("iq3_s", confirm=True)
        self.assertEqual(out["failed"], [])
        self.assertFalse(self.s1.exists())

    def test_forensic_record_written_on_confirm(self):
        self.t.strata_remove("iq3_s", confirm=True)
        rec = self.root / ".strata-mcp" / "last-removal.json"
        self.assertTrue(rec.exists(), "a confirmed removal must leave a forensic record")
        data = json.loads(rec.read_text(encoding="utf-8"))
        self.assertEqual(data["model"], "iq3_s")
        self.assertIn("remove", data)


class IdentityTests(unittest.TestCase):
    """P0-4: removal identity never guesses."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "install"
        self.root.mkdir()
        self.s = strata_mcp.Strata(self.root, ROOT)
        self.t = strata_mcp.Tools(self.s)
        for tag in ("alpha", "beta"):
            d = self.root / "models" / tag
            s1 = fake_shard(d, f"{tag}-00001-of-00002.gguf")
            s2 = fake_shard(d, f"{tag}-00002-of-00002.gguf")
            config_for(self.root, tag, "same-name", d, s1, s2)

    def test_find_config_without_model_raises(self):
        with self.assertRaises(strata_mcp.ToolError):
            self.s.find_config(None)

    def test_remove_with_ambiguous_model_name_raises(self):
        with self.assertRaises(strata_mcp.ToolError):
            self.t.strata_remove("same-name")

    def test_remove_by_exact_stem_removes_only_that_one(self):
        out = self.t.strata_remove("alpha", confirm=True)
        self.assertEqual(out["plan"]["model"], "alpha")
        self.assertFalse((self.root / "strata-alpha.json").exists())
        self.assertTrue((self.root / "strata-beta.json").exists())


if __name__ == "__main__":
    unittest.main()
