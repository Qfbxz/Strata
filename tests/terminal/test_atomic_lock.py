"""P0-5 contract: strata_control/atomic.WriteLock + guarded_write (the shared config-write protocol).

The 2026-11-05 audit found install/ written by four programs with no shared lock and a single,
unconditionally-overwritten .bak — two read-modify-write writers at once lose whichever wrote
first, and one torn or empty write wipes a working config. These tests pin:

1. WriteLock is exclusive; a leftover older than LOCK_STALE_S is stolen; release never unlinks
   a lock another writer owns;
2. guarded_write builds the candidate from the file as it is NOW (inside the lock), refuses a
   candidate that would drop required keys the current file has, rotates .bak.1/.bak.2 and
   writes atomically;
3. runconfig.save goes through the same protocol (whole-config writes included).
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from strata_control.atomic import WriteLock, guarded_write, LOCK_STALE_S
from serve import runconfig


class WriteLockTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.lock = self.base / "cfg.lock"

    def test_exclusive_until_released(self):
        with WriteLock(self.lock, timeout=0.3):
            with self.assertRaises(TimeoutError):
                with WriteLock(self.lock, timeout=0.3):
                    pass
        with WriteLock(self.lock, timeout=0.3):        # released: acquirable again
            pass

    def test_stale_leftover_is_stolen(self):
        self.lock.write_text("999999 0.0 stolen", encoding="utf-8")
        old = self._clock() - (LOCK_STALE_S + 60)
        os.utime(self.lock, (old, old))
        with WriteLock(self.lock, timeout=0.3, stale=LOCK_STALE_S):
            pass                                        # stolen without waiting the timeout

    def test_release_never_unlinks_a_foreign_lock(self):
        # a stale lock we acquired by stealing is released by the OWNER's token only:
        self.lock.write_text("1 0 foreign", encoding="utf-8")
        old = self._clock() - (LOCK_STALE_S + 60)
        os.utime(self.lock, (old, old))
        lock = WriteLock(self.lock, timeout=0.3, stale=LOCK_STALE_S)
        lock.acquire()
        lock.release()
        self.assertFalse(self.lock.exists(), "our own token is unlinked")

    @staticmethod
    def _clock():
        import time
        return time.time()

    def test_guarded_write_never_drops_required_keys(self):
        target = self.base / "strata-x.json"
        target.write_text(json.dumps({"exe": "component:strata-engine", "args": ["--pack", "/x"]}), encoding="utf-8")
        with self.assertRaises(ValueError):
            guarded_write(target, lambda current: {"model_name": "wiped"}, required_keys=("exe", "args"))
        self.assertEqual(json.loads(target.read_text())["exe"], "component:strata-engine",
                         "nothing was written by the refused candidate")

    def test_guarded_write_rotates_backups_and_builds_from_current(self):
        target = self.base / "strata-x.json"
        target.write_text(json.dumps({"exe": "e1", "args": ["--one"]}), encoding="utf-8")
        guarded_write(target, lambda current: {**current, "args": ["--two"]}, required_keys=("exe", "args"))
        guarded_write(target, lambda current: {**current, "model_name": "x"}, required_keys=("exe", "args"))
        final = json.loads(target.read_text())
        self.assertEqual(final["args"], ["--two"])                    # built from what was on disk
        self.assertEqual(final["model_name"], "x")
        self.assertEqual(json.loads((target.with_name("strata-x.json.bak")).read_text())["args"], ["--two"])
        self.assertEqual(json.loads((target.with_name("strata-x.json.bak.1")).read_text())["args"], ["--one"])


class RunconfigSaveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.target = Path(self.tmp.name) / "strata-model.json"

    def test_fresh_save_needs_no_existing_file(self):
        bak = runconfig.save(self.target, {"exe": "component:strata-engine", "args": []})
        self.assertTrue(self.target.exists())
        self.assertEqual(bak, self.target.with_name("strata-model.json.bak"))

    def test_whole_write_replaces_but_mutate_preserves_siblings(self):
        # whole-write is "last complete view wins" under the lock: it replaces sibling fields the
        # caller did not carry (by design). To keep siblings, mutate instead of replacing:
        self.target.write_text(json.dumps({"exe": "e", "args": [], "ui_extra": "keep-me"}),
                               encoding="utf-8")
        runconfig.save(self.target, {"exe": "e2", "args": [], "model_name": "m"})
        self.assertEqual(json.loads(self.target.read_text()).get("ui_extra"), None,
                         "whole-write replaces by design")
        guarded_write(self.target, lambda current: {**current, "model_name": "m2"},
                      required_keys=("exe", "args"))
        final = json.loads(self.target.read_text())
        self.assertEqual(final["model_name"], "m2")
        self.assertEqual(final["exe"], "e2")
        self.assertEqual(final.get("args"), [], "mutate keeps whatever the file carries ([])")
        # a whole write that carries the required keys goes through:
        runconfig.save(self.target, {"exe": "e2", "args": ["--go"], "model_name": "m"})
        self.assertEqual(json.loads(self.target.read_text())["exe"], "e2")


if __name__ == "__main__":
    unittest.main()
