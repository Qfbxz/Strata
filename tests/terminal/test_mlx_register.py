"""mlx-register (tools/mlx_register.py): the connection payload it builds for the host.

The payload must satisfy the host's model-providers draft() contract (apps/host/server/
model-providers.mjs): a custom connection needs no key, every model needs a unique id,
and a re-register reuses the existing connection id (update, never duplicate).
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("mlx_register", ROOT / "tools" / "mlx_register.py")
mlx_register = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mlx_register)


class ConnectionPayloadTests(unittest.TestCase):
    def test_payload_satisfies_the_draft_contract(self):
        p = mlx_register.connection_payload([{"id": "Qwen2.5-0.5B-MLX-4bit", "context_max": 32768},
                                             {"id": "Qwen3.8-27B-MLX-4bit", "context_max": 40960}])
        self.assertEqual(p["kind"], "custom")
        self.assertIsNone(p["provider"])
        self.assertEqual(p["protocol"], "openai-chat")
        self.assertEqual(p["apiKey"], "", "a keyless local server")
        self.assertTrue(p["baseUrl"].endswith("/v1"))
        ids = [m["id"] for m in p["models"]]
        self.assertEqual(len(ids), len(set(ids)), "unique model ids")
        self.assertIn("id", " ".join(p["models"][0].keys()) or p["models"][0])

    def test_existing_id_is_reused_not_duplicated(self):
        p = mlx_register.connection_payload([{"id": "A", "context_max": 8192}], existing_id="abc-123")
        self.assertEqual(p["id"], "abc-123", "update in place")
        p2 = mlx_register.connection_payload([{"id": "A", "context_max": 8192}])
        self.assertNotIn("id", p2, "fresh register leaves the id to the host")

    def test_over_the_connection_limit_is_an_error(self):
        many = [{"id": f"m{i}", "context_max": 8192} for i in range(101)]
        with self.assertRaises(ValueError):
            mlx_register.connection_payload(many)

    def test_pretty_names(self):
        self.assertEqual(mlx_register.pretty("Qwen3.8-27B-MLX-4bit"), "Qwen3.8 27B MLX·4bit")


if __name__ == "__main__":
    unittest.main()
