"""P1-5 config lint (strata_control/config_lint.py): the four silent traps, made loud.

The traps this layer exists for (each bit someone for real):
- `--expert-cache 64gb` parsed by atoi = 64, or a unit-suffixed value silently changing meaning
  (generate.cpp:3435);
- `--mtp` without `--spec >= 2` is silently dropped by the engine (no draft runs at all);
- a window beyond the model's rope (max-context above 262144) without an explicit rope-scaling
  setting quietly degrades long answers (NO-4: nothing above 256K is a default until the
  262145-position needle says otherwise);
- a run config that points into a VERSIONED component path (…/components/<name>/<x.y.z>-…)
  dies on the next engine upgrade (the vision.exe dead link, seen on this machine).

lint_args(args) -> [Issue]: pure, level in {"error", "warn"}; lint_install(dir) walks the real
run configs. The real-data test lints whatever is actually installed on this machine.
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("config_lint", ROOT / "strata_control" / "config_lint.py")
config_lint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(config_lint)

lint_args = config_lint.lint_args


def msgs(args, level=None):
    out = lint_args(args)
    if level:
        out = [i for i in out if i["level"] == level]
    return [i["message"] for i in out]


class ExpertCacheUnitTests(unittest.TestCase):
    def test_unit_suffix_is_an_error(self):
        self.assertTrue(any("expert-cache" in m for m in msgs(["--expert-cache", "64gb"], "error")),
                        "'64gb' atoi-parses to 64 - the unit silently vanished")

    def test_plain_number_is_clean(self):
        self.assertEqual(msgs(["--expert-cache", "64"]), [])

    def test_auto_is_clean(self):
        self.assertEqual(msgs(["--expert-cache", "auto"]), [])


class MtpSpecTests(unittest.TestCase):
    def test_mtp_without_spec_at_least_two_is_an_error(self):
        self.assertTrue(any("--mtp" in m for m in msgs(["--mtp", "/rt", "--spec", "1"], "error")),
                          "the engine silently drops --mtp when spec < 2")
        self.assertTrue(any("--mtp" in m for m in msgs(["--mtp", "/rt"], "error")),
                        "no --spec at all: the mtp layer never runs")

    def test_spec_two_with_mtp_is_clean(self):
        self.assertEqual(msgs(["--mtp", "/rt", "--spec", "2"]), [])

    def test_spec_out_of_range(self):
        self.assertTrue(any("spec" in m for m in msgs(["--spec", "0"], "error")))
        self.assertTrue(any("spec" in m for m in msgs(["--spec", "99"], "error")))

    def test_spec_min_p_range(self):
        self.assertTrue(any("spec-min-p" in m for m in msgs(["--spec-min-p", "1.5"], "error")))
        self.assertEqual(msgs(["--spec-min-p", "0.5"]), [])


class RopeContextTests(unittest.TestCase):
    def test_context_over_256k_without_rope_warns(self):
        out = [i for i in lint_args(["--max-context", "512000"]) if i["rule"] == "rope"]
        self.assertTrue(out, "512K without rope scaling must at least warn (P1-7: needle passed, mechanism unconfirmed)")
        self.assertEqual(out[0]["level"], "warn", "a warn, not an error: the 512K needle passed, the verdict is pending")

    def test_rope_scaling_present_is_clean(self):
        self.assertEqual([i for i in lint_args(["--max-context", "512000", "--rope-scaling", "yarn"]) if i["rule"] == "rope"], [])

    def test_256k_and_below_is_clean(self):
        self.assertEqual([i for i in lint_args(["--max-context", "262144"]) if i["rule"] == "rope"], [])


class VersionedPathTests(unittest.TestCase):
    def test_versioned_component_path_warns(self):
        path = "/Users/x/.local/share/strata/components/engine/0.1.55-macos-arm64-metal/strata-vision"
        out = [i for i in lint_args(["--vision-exe", path]) if i["rule"] == "versioned-path"]
        self.assertTrue(out, "a versioned component path dies on the next engine upgrade")
        self.assertEqual(out[0]["level"], "warn")

    def test_unversioned_paths_are_clean(self):
        self.assertEqual([i for i in lint_args(["--mtp", "/Users/x/gguf/mtp/rt"]) if i["rule"] == "versioned-path"], [])


class RealDataTests(unittest.TestCase):
    """The lint layer against what this machine actually runs: the installed run configs must
    have no error-level issues, and the known ones lint clean of errors."""

    INSTALL = Path.home() / ".local/share/strata/install"

    def test_installed_configs_have_no_errors(self):
        if not self.INSTALL.exists():
            self.skipTest("no install dir on this machine")
        checked = 0
        for cfg in sorted(self.INSTALL.glob("strata-*.json")):
            with self.subTest(config=cfg.name):
                data = json.loads(cfg.read_text())
                errors = [i for i in lint_args(data.get("args", [])) if i["level"] == "error"]
                self.assertEqual(errors, [], f"{cfg.name}: {errors}")
            checked += 1
        self.assertGreater(checked, 0)

    def test_iq3s_spec_block_lints_clean(self):
        cfg = self.INSTALL / "strata-iq3_s.json"
        if not cfg.exists():
            self.skipTest("no iq3_s config")
        args = json.loads(cfg.read_text())["args"]
        self.assertIn("--spec", args)
        self.assertIn("3", args)
        self.assertEqual([i for i in lint_args(args) if i["level"] == "error"], [],
                         "the spec 3 upgrade config must be lint-clean")


class LintInstallTests(unittest.TestCase):
    def test_lint_install_walks_a_dir(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / "strata-good.json").write_text(json.dumps({"args": ["--spec", "3"], "model_name": "good"}))
            (d / "strata-bad.json").write_text(json.dumps({"args": ["--expert-cache", "64gb"], "model_name": "bad"}))
            report = config_lint.lint_install(td)
            by_config = {r["config"]: r for r in report}
            self.assertEqual(by_config["strata-good.json"]["errors"], 0)
            self.assertEqual(by_config["strata-bad.json"]["errors"], 1)


if __name__ == "__main__":
    unittest.main()
