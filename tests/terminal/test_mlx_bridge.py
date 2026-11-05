"""mlx-bridge (tools/mlx_bridge.py): the control plane that puts the Mac's MLX models into
Strata as ordinary connection models. P0 contract:

- registry: scan the model roots and list every MLX model (config.json + safetensors, no
  *.gguf) with its id, path, context window and size on disk. GGUF folders and folders
  without a config are not models.
- lifecycle: one worker (mlx_lm.server) at a time on a port from the pool; ports the rest of
  Strata owns are never handed out; swapping means stop, start, wait for the first answer.
- budget: a wired-limit cap (MB) clamps what the worker may pin, so the Metal engine and MLX
  do not fight over one memory pool.
- surface: /v1/models answers from the REGISTRY (so the app sees all models, not just the
  loaded one); /status is the machine-readable face of the bridge.
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("mlx_bridge", ROOT / "tools" / "mlx_bridge.py")
mlx_bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mlx_bridge)


def make_mlx_dir(root: Path, name: str, ctx: int | None, gb_files=(1.0,)) -> Path:
    d = root / "publisher" / name
    d.mkdir(parents=True)
    cfg = {"model_type": "qwen3", "quantization": {"group_size": 64, "bits": 4}}
    if ctx is not None:
        cfg["max_position_embeddings"] = ctx
    (d / "config.json").write_text(json.dumps(cfg))
    for i, gb in enumerate(gb_files, 1):
        f = d / f"model-{i:05d}-of-{len(gb_files):05d}.safetensors"
        with open(f, "wb") as fh:            # sparse: st_size says GB, the disk keeps a few bytes
            fh.write(b"\0")
            fh.truncate(int(gb * 1e9))
    return d


def make_gguf_dir(root: Path, name: str) -> Path:
    d = root / "other" / name
    d.mkdir(parents=True)
    (d / "config.json").write_text(json.dumps({"model_type": "qwen3"}))
    (d / "model-00001-of-000002.gguf").write_bytes(b"\0" * 1000)
    return d


class RegistryTests(unittest.TestCase):
    def test_scan_finds_mlx_models_and_skips_the_rest(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            make_mlx_dir(root, "Qwen2.5-0.5B-MLX-4bit", ctx=32768, gb_files=(0.5,))
            make_mlx_dir(root, "Qwen3.8-27B-MLX-4bit", ctx=40960, gb_files=(8.0, 8.1))
            make_gguf_dir(root, "some-gguf-model")
            bare = root / "publisher" / "no-config-here"
            bare.mkdir(parents=True)
            (bare / "model.safetensors").write_bytes(b"\0")
            rows = mlx_bridge.scan_registry([str(root)])
            by_id = {r["id"]: r for r in rows}
            self.assertEqual(set(by_id), {"Qwen2.5-0.5B-MLX-4bit", "Qwen3.8-27B-MLX-4bit"})
            big = by_id["Qwen3.8-27B-MLX-4bit"]
            self.assertEqual(big["ctx"], 40960)
            self.assertAlmostEqual(big["gb"], 16.1, delta=0.2)
            self.assertTrue(big["path"].endswith("Qwen3.8-27B-MLX-4bit"))
            small = by_id["Qwen2.5-0.5B-MLX-4bit"]
            self.assertEqual(small["ctx"], 32768)

    def test_scan_falls_back_to_a_default_window(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            make_mlx_dir(root, "Mystery-Model", ctx=None)
            rows = mlx_bridge.scan_registry([str(root)])
            self.assertEqual(rows[0]["ctx"], 32768, "no max_position_embeddings: the working default window")

    def test_models_endpoint_lists_the_registry_not_the_worker(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            make_mlx_dir(root, "A-Model", ctx=8192)
            make_mlx_dir(root, "B-Model", ctx=8192)
            payload = mlx_bridge.models_payload(mlx_bridge.scan_registry([str(root)]))
            self.assertEqual(payload["object"], "list")
            ids = [m["id"] for m in payload["data"]]
            self.assertEqual(set(ids), {"A-Model", "B-Model"}, "all registry models, loaded or not")


class LifecycleTests(unittest.TestCase):
    def test_choose_port_never_hands_out_a_reserved_port(self):
        pool = mlx_bridge.WORKER_PORTS
        reserved = mlx_bridge.RESERVED_PORTS
        self.assertFalse(set(pool) & reserved, "the pool itself must not contain reserved ports")
        used = set(pool)
        with self.assertRaises(RuntimeError):
            mlx_bridge.choose_port(used)          # pool exhausted: say so, do not grab a reserved port
        used.discard(pool[2])
        self.assertEqual(mlx_bridge.choose_port(used), pool[2])

    def test_worker_args_carry_model_port_and_the_wired_cap(self):
        args = mlx_bridge.build_worker_args("/py", "/models/m", 8755)
        self.assertEqual(args[:3], ["/py", "-m", "mlx_lm.server"], "no cap: the plain server")
        self.assertIn("/models/m", args)
        self.assertIn("8755", args)
        wrapped = mlx_bridge.build_worker_args("/py", "/models/m", 8755, wired_cap_mb=36864)
        self.assertEqual(wrapped[:3], ["/py", "-m", "mlx_wired_server"], "a cap goes through the wrapper module")
        env = mlx_bridge.worker_env(wired_cap_mb=36864)
        self.assertEqual(env["MLX_WIRED_CAP_MB"], "36864")
        self.assertEqual(mlx_bridge.worker_env(wired_cap_mb=None), {}, "no cap: the worker runs plain")

    def test_cap_wired_mb_clamps_to_the_floor_and_cap(self):
        self.assertEqual(mlx_bridge.cap_wired_mb(99999, 36864), 36864)
        self.assertEqual(mlx_bridge.cap_wired_mb(4096, 36864), 4096)
        self.assertEqual(mlx_bridge.cap_wired_mb(0, 36864), 0, "0 = no cap configured")

    def test_needs_swap(self):
        self.assertTrue(mlx_bridge.needs_swap(None, "A"))
        self.assertFalse(mlx_bridge.needs_swap("A", "A"))
        self.assertTrue(mlx_bridge.needs_swap("A", "B"))


class PerformanceLayerTests(unittest.TestCase):
    """The bridge is a performance launcher, not a list: per-model launch profiles turn the
    plain server into the tuned one (prompt cache = the cross-request KV prefix reuse,
    draft model = speculative decoding), and a model id never reaches the worker."""

    def test_profile_becomes_flags_in_fixed_order(self):
        args = mlx_bridge.profile_args({"prefill_step_size": 4096, "prompt_cache_bytes": 8e9,
                                        "num_draft_tokens": 8, "draft_model": "/d", "pipeline": True,
                                        "unknown_future_key": 1})
        self.assertEqual(args, ["--prompt-cache-bytes", "8000000000.0", "--prefill-step-size", "4096",
                                "--draft-model", "/d", "--num-draft-tokens", "8", "--pipeline"])

    def test_wired_cap_travels_as_env_never_as_flag(self):
        args = mlx_bridge.profile_args({"wired_cap_mb": 36864})
        self.assertEqual(args, [], "the cap is the wrapper's env, not a server flag")

    def test_default_budget_is_a_share_of_ram_not_the_whole_pool(self):
        cap = mlx_bridge.default_wired_cap_mb()
        self.assertGreater(cap, 8192)
        self.assertLess(cap, 131072, "on this 128 GB Mac the cap stays under the whole pool")
        # 128 GB: 75% recommended x 55% share = ~53 GB
        self.assertLess(cap, 65536)

    def test_load_profiles_reads_the_configs_dir(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / "Qwen3.8-27B-MLX-4bit.json").write_text('{"prompt_cache_bytes": 8000000000, "num_draft_tokens": 8}')
            (d / "broken.json").write_text("{not json")
            (d / "ignored.txt").write_text("{}")
            profiles = mlx_bridge.load_profiles(td)
            self.assertEqual(set(profiles), {"Qwen3.8-27B-MLX-4bit"})
            self.assertEqual(profiles["Qwen3.8-27B-MLX-4bit"]["num_draft_tokens"], 8)


class StatusContractTests(unittest.TestCase):
    def test_status_payload_shape(self):
        st = mlx_bridge.status_payload(
            registry=[{"id": "A"}, {"id": "B"}], active="A", worker_port=8755,
            worker_ready=True, wired_cap_mb=36864, swapping=False)
        for key in ("ok", "ready", "active", "worker_port", "swapping", "models", "budget"):
            self.assertIn(key, st)
        self.assertEqual(st["ok"], True)
        self.assertEqual(st["active"], "A")
        self.assertEqual(st["models"], ["A", "B"])
        self.assertEqual(st["budget"], {"wired_cap_mb": 36864})
        self.assertEqual(st["ready"], True)

    def test_status_reports_not_ready_while_swapping(self):
        st = mlx_bridge.status_payload(
            registry=[{"id": "A"}], active=None, worker_port=None,
            worker_ready=False, wired_cap_mb=None, swapping=True)
        self.assertEqual(st["ready"], False)
        self.assertEqual(st["swapping"], True)


if __name__ == "__main__":
    unittest.main()
