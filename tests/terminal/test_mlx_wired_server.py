"""mlx_wired_server (tools/mlx_wired_server.py): the wired-limit cap, with a real call through
the capped function - kimi's acceptance caught a unit bug (MB cap compared against BYTES) that
an argv-shaped test could never see, so this test calls the real thing."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("mlx_wired_server", ROOT / "tools" / "mlx_wired_server.py")
mlx_wired_server = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mlx_wired_server)


class WiredCapTests(unittest.TestCase):
    def test_cap_is_in_bytes_not_mb(self):
        calls = []
        capped = mlx_wired_server.make_capped(calls.append, cap_mb=36864)
        # what mlx_lm.server actually asks for on this machine (bytes, ~115 GB of working set)
        capped(115_448_725_504)
        self.assertEqual(calls, [36864 * 1024 * 1024], "36864 MB must bound to 36 GB of BYTES, not 36 KB")

    def test_smaller_requests_pass_through(self):
        calls = []
        capped = mlx_wired_server.make_capped(calls.append, cap_mb=36864)
        capped(8 * 1024 * 1024 * 1024)
        self.assertEqual(calls, [8 * 1024 * 1024 * 1024], "a request under the cap is untouched")

    def test_zero_or_negative_cap_installs_nothing(self):
        self.assertFalse(mlx_wired_server.install(0), "no cap configured: the plain server")
        self.assertFalse(mlx_wired_server.install(-5))


if __name__ == "__main__":
    unittest.main()
