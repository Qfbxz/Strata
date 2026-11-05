"""P0-6 contract: discovery.resolve_data_root — the single entry point for "where the data lives".

The 2026-11-05 audit found four independent data_dir resolutions in the product, and the shared
key was rewritten in silence (weights landed in ~/gguf while the app pointed at Documents/Strata).
These tests pin the precedence and the drift notice:

1. both files name a folder → the one changed last wins, the other file is brought up to date,
   and `on_change` fires for the rewrite (the drift is visible);
2. an app folder that is not on disk is never adopted (a disconnected drive keeps the Terminal's
   folder);
3. the person's own settings win over the app's when they are the newer ones;
4. no file names a folder → the caller's default, marked as "default".
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from strata_control import discovery


def make_env():
    home = Path(tempfile.mkdtemp())
    env = {"HOME": str(home), "USERPROFILE": str(home)}
    return home, env


def own_file(home, env):
    return discovery.own_settings_file(environ=env, windows=False, home=home)


def app_file(home, env):
    return discovery.app_settings_file(environ=env, windows=False, home=home)


class ResolveDataRootTests(unittest.TestCase):
    def setUp(self):
        self.home, self.env = make_env()

    def test_app_newer_and_existing_wins_and_drift_is_visible(self):
        mine, app = self.home / "gguf", self.home / "Documents" / "Strata"
        app.mkdir(parents=True)
        discovery._write_data_dir(own_file(self.home, self.env), str(mine), 100.0)
        discovery._write_data_dir(app_file(self.home, self.env), str(app), 200.0)
        flips = []
        resolved, source = discovery.resolve_data_root(
            self.home / "fallback", environ=self.env, windows=False, home=self.home,
            on_change=lambda what, where: flips.append((what, where)))
        self.assertEqual((resolved, source), (app, "settings"), "after the merge the settings file carries the winner")
        synced = json_load(own_file(self.home, self.env))["data_dir"]
        self.assertEqual(synced, str(app), "the losing file is brought up to date")
        self.assertTrue(any(w == str(app) for w, _ in flips), flips)

    def test_app_newer_but_not_on_disk_is_never_adopted(self):
        mine = self.home / "gguf"
        app = self.home / "Documents" / "Strata"            # named but never created
        discovery._write_data_dir(own_file(self.home, self.env), str(mine), 100.0)
        discovery._write_data_dir(app_file(self.home, self.env), str(app), 200.0)
        resolved, source = discovery.resolve_data_root(
            self.home / "fallback", environ=self.env, windows=False, home=self.home)
        self.assertEqual((resolved, source), (mine, "settings"))

    def test_own_settings_newer_wins(self):
        mine, app = self.home / "gguf", self.home / "Documents" / "Strata"
        discovery._write_data_dir(app_file(self.home, self.env), str(app), 100.0)
        discovery._write_data_dir(own_file(self.home, self.env), str(mine), 200.0)
        resolved, source = discovery.resolve_data_root(
            self.home / "fallback", environ=self.env, windows=False, home=self.home)
        self.assertEqual((resolved, source), (mine, "settings"))

    def test_no_file_names_one_uses_the_default_marked_as_default(self):
        resolved, source = discovery.resolve_data_root(
            self.home / "fallback", environ=self.env, windows=False, home=self.home)
        self.assertEqual((resolved, source), (self.home / "fallback", "default"))


def json_load(p: Path):
    import json
    return json.loads(p.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
