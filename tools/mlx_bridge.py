#!/usr/bin/env python3
"""mlx-bridge: the Mac's MLX models as ordinary Strata models.

One control plane (default :8759) that owns ONE worker (mlx_lm.server) at a time on a port
from its own pool, answers /v1/models from the REGISTRY (so the app offers every model, not
just the loaded one), and proxies chat traffic to the worker - swapping models when a request
names one that is not loaded (stop, start, wait for the first answer; the load is the warmup).

The wired-limit cap (MLX_WIRED_CAP_MB / --wired-cap-mb) keeps the worker from pinning the
whole memory pool: Strata's Metal engine and MLX share one RAM, and mlx_lm.server would
otherwise take the maximum (mlx_lm/server.py sets the full working set at request time).

Stdlib only. Run:  python3 tools/mlx_bridge.py [--port 8759] [--roots DIR:DIR] [--python PY]
                   [--wired-cap-mb N]        then `curl :8759/status`.
Register in the app: python3 tools/mlx_register.py   (POSTs the connection to the host).
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BRIDGE_PORT_DEFAULT = 8759
WORKER_PORTS = list(range(8755, 8764))                       # the pool: 8755-8763
RESERVED_PORTS = {8080, 8095, 8765, 8766, 8791, *range(18500, 18521)}   # Strata's own: design mode, dflash hub/gate, host UI, native engines
DEFAULT_CTX = 32768
DEFAULT_ROOTS = [str(Path.home() / ".lmstudio/models"), str(Path.home() / "gguf")]
DEFAULT_PYTHON = str(Path.home() / ".venvs/dflash/bin/python")
DEFAULT_CONFIGS_DIR = str(Path.home() / "strata-setup/mlx-configs")
READY_TIMEOUT_S = 600                                        # a 120B model takes minutes to map; 10 minutes is the ceiling
SWAP_LOCK = threading.Lock()


def default_wired_cap_mb() -> int:
    """The pool MLX may pin when nothing else is configured: 55% of what Metal recommends
    (max_recommended_working_set_size is about 75% of RAM; MLX shares that pool with the
    Strata engine, so it never gets all of it). 128 GB of RAM -> about 52 GB."""
    try:
        ram = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True,
                                 timeout=5).stdout.strip() or 0)
    except Exception:
        return 32768
    if ram <= 0:
        return 32768
    return int(ram / 1e6 * 0.75 * 0.55)


def load_profiles(configs_dir: str) -> dict:
    """Per-model launch profiles (mlx-configs/<id>.json from the bench campaign): the knobs
    that turn a plain mlx_lm.server into the tuned one - prompt cache bytes (the cross-request
    KV prefix reuse), prefill step size, speculative decoding (draft model + tokens), worker
    concurrency, and a per-model wired cap."""
    profiles = {}
    d = Path(configs_dir).expanduser()
    if not d.exists():
        return profiles
    for f in sorted(d.glob("*.json")):
        try:
            p = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        profiles[f.stem] = p
    return profiles


PROFILE_KEYS = ("prompt_cache_bytes", "prefill_step_size", "draft_model", "num_draft_tokens",
                "decode_concurrency", "prompt_concurrency", "pipeline", "wired_cap_mb")
PROFILE_FLAGS = {"prompt_cache_bytes": "--prompt-cache-bytes", "prefill_step_size": "--prefill-step-size",
                 "draft_model": "--draft-model", "num_draft_tokens": "--num-draft-tokens",
                 "decode_concurrency": "--decode-concurrency", "prompt_concurrency": "--prompt-concurrency"}


def profile_args(profile: dict) -> list[str]:
    """A profile becomes server flags, in a fixed order (unknown keys are ignored: forward compatible)."""
    args: list[str] = []
    for key in PROFILE_KEYS:
        value = profile.get(key)
        if value in (None, "", 0) or key == "wired_cap_mb":
            continue   # the wired cap travels as env (the wrapper reads it), not as a flag
        flag = PROFILE_FLAGS.get(key)
        if flag:
            args += [flag, str(value)]
        elif key == "pipeline" and value:
            args += ["--pipeline"]
    return args


# ---- registry -----------------------------------------------------------------------------------------------

def scan_registry(roots: list[str]) -> list[dict]:
    """Every MLX model under the roots: config.json + at least one .safetensors and no .gguf.
    One or two levels below each root (publisher/model or just model). Draft models (DFlash2
    & co., architectures says Draft) are not servable and stay out. id = folder name; ctx =
    max_position_embeddings (else the working default); gb = sum of the safetensors shards,
    in GB (decimal, like the download sizes the app shows)."""
    out = []
    for root in roots:
        root = Path(root).expanduser()
        if not root.exists():
            continue
        for cfg in [*root.glob("*/*/config.json"), *root.glob("*/config.json")]:
            d = cfg.parent
            try:
                meta = json.loads(cfg.read_text())
            except (OSError, ValueError):
                continue
            if any("Draft" in str(a) for a in meta.get("architectures") or []):
                continue   # a drafter (DFlash2DraftModel ...) drafts for another model; it is not served
            shards = sorted(d.glob("*.safetensors"))
            if not shards or list(d.glob("*.gguf")):
                continue
            gb = round(sum(s.stat().st_size for s in shards) / 1e9, 1)
            ctx = meta.get("max_position_embeddings")
            out.append({"id": d.name, "name": d.name.replace("-", " "), "path": str(d),
                        "ctx": int(ctx) if isinstance(ctx, int) and ctx > 0 else DEFAULT_CTX,
                        "gb": gb, "root": str(root)})
    # two roots holding the same folder name would collide into one id (the profiles and the
    # worker logs would cross): keep the first, say the other out loud
    seen: dict[str, dict] = {}
    for row in out:
        first = seen.get(row["id"])
        if first:
            print(f"mlx-bridge: model id {row['id']!r} exists under two roots; keeping {first['path']}, skipping {row['path']}", flush=True)
            continue
        seen[row["id"]] = row
    return sorted(seen.values(), key=lambda r: r["id"])


def models_payload(registry: list[dict]) -> dict:
    """The /v1/models face: every registry model, so the app's discovery lists them all."""
    return {"object": "list", "data": [{"id": r["id"], "object": "model", "owned_by": "mlx-bridge",
                                        "context_length": r["ctx"], "context_max": r["ctx"], "gb": r["gb"]} for r in registry]}


# ---- lifecycle ----------------------------------------------------------------------------------------------

def choose_port(used: set[int]) -> int:
    """The first pool port that is neither reserved, already used, nor held by another
    program - a port that cannot be bound would kill every worker start on it."""
    import socket
    for port in WORKER_PORTS:
        if port in used or port in RESERVED_PORTS:
            continue
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            probe.bind(("127.0.0.1", port))
            return port
        except OSError:
            continue   # someone else holds it: on to the next
        finally:
            probe.close()
    raise RuntimeError(f"the worker port pool {WORKER_PORTS[0]}-{WORKER_PORTS[-1]} is exhausted")


def build_worker_args(python: str, model_path: str, port: int, wired_cap_mb: int | None = None) -> list[str]:
    """The worker command: with a wired cap it goes through the wrapper module (tools/mlx_wired_server.py,
    which bounds set_wired_limit from the MLX_WIRED_CAP_MB env); without one, plain mlx_lm.server."""
    module = "mlx_wired_server" if wired_cap_mb else "mlx_lm.server"
    return [python, "-m", module, "--model", model_path, "--port", str(port)]


def worker_env(wired_cap_mb: int | None) -> dict:
    return {"MLX_WIRED_CAP_MB": str(int(wired_cap_mb))} if wired_cap_mb else {}


def cap_wired_mb(requested: int, cap: int) -> int:
    if not cap or cap <= 0:
        return 0
    return min(int(requested), int(cap))


def budget_tier_mb(ram_gb: float, gguf_resident_gb: float) -> int:
    """The MLX tier of the unified pool (the design's §3.3): what the recommended working set
    (about 75% of RAM) still holds after the Metal engine's resident pack and 8 GB of headroom
    for the system. 0 when nothing is left."""
    pool = ram_gb * 1024 * 0.75
    return max(0, int(pool - gguf_resident_gb * 1024 - 8192))


def coexistence_ok(worker_gb: float, gguf_resident_gb: float, ram_gb: float) -> tuple[bool, str]:
    """The coexistence rule: GGUF first, MLX after; the pool is one. A resident engine of the
    UD-Q4 class (the wired pack fills the pool) and a worker of the 4-bit-27B class (10 GB and
    up) cannot both fit - loading one while the other holds the pool is the fight that pages
    both. Small workers (drafters, distills) stay allowed beside a resident engine, and a big
    worker is fine with an IQ3_S-sized resident."""
    if gguf_resident_gb >= 60 and worker_gb >= 10:
        return False, (f"a resident engine of {gguf_resident_gb:.0f} GB holds the pool; a {worker_gb:.1f} GB MLX "
                       f"worker cannot coexist with it on {ram_gb:.0f} GB of RAM - unload the local model first")
    return True, ""


def needs_swap(active: str | None, requested: str) -> bool:
    return active != requested


def status_payload(registry: list[dict], active: str | None, worker_port: int | None,
                   worker_ready: bool, wired_cap_mb: int | None, swapping: bool) -> dict:
    return {"ok": True, "ready": bool(worker_ready and not swapping), "active": active,
            "worker_port": worker_port, "swapping": swapping,
            "models": [r["id"] for r in registry],
            "budget": {"wired_cap_mb": wired_cap_mb} if wired_cap_mb else {"wired_cap_mb": None}}


# ---- the bridge service -------------------------------------------------------------------------------------

class Bridge:
    def __init__(self, roots: list[str], python: str, wired_cap_mb: int | None, configs_dir: str = DEFAULT_CONFIGS_DIR, log=print):
        self.python = python
        self.wired_cap_mb = wired_cap_mb if wired_cap_mb else default_wired_cap_mb()
        self.profiles = load_profiles(configs_dir)
        self.log = log
        self.registry = scan_registry(roots)
        self.by_id = {r["id"]: r for r in self.registry}
        self.active: str | None = None
        self.worker_port: int | None = None
        self.worker: subprocess.Popen | None = None
        self.worker_ready = False
        self.swapping = False
        self.last_metrics: dict | None = None

    # -- worker lifecycle --
    def stop_worker(self):
        if self.worker is None:
            return
        try:
            self.worker.terminate()
            self.worker.wait(timeout=15)
        except Exception:
            try:
                self.worker.kill()
                self.worker.wait(timeout=5)
            except Exception:
                pass
        self.worker = None
        self.worker_ready = False
        self.active = None
        self.worker_port = None

    def start_worker(self, model_id: str) -> None:
        row = self.by_id[model_id]
        port = choose_port({self.worker_port} if self.worker_port else set())
        cap = cap_wired_mb(self.wired_cap_mb, (self.profiles.get(model_id) or {}).get("wired_cap_mb") or self.wired_cap_mb)
        env = dict(os.environ)
        env.update(worker_env(cap))
        args = build_worker_args(self.python, row["path"], port, cap) + profile_args(self.profiles.get(model_id) or {})
        tune = [k for k in PROFILE_KEYS if (self.profiles.get(model_id) or {}).get(k) not in (None, "", 0)]
        self.log(f"mlx-bridge: starting {model_id} on :{port} ({row['gb']} GB, wired cap {cap} MB"
                 + (f", tuned: {','.join(tune)}" if tune else "") + ")")
        self.worker = subprocess.Popen(
            args, env=env, cwd=str(Path(__file__).resolve().parent),
            stdout=open(f"/tmp/mlx-bridge-worker-{model_id}.log", "w"), stderr=subprocess.STDOUT)
        self.worker_port = port
        self.active = model_id

    def ensure_worker(self, model_id: str) -> tuple[str, int]:
        """The active worker for this model, loading it first if needed (the load is the warmup).
        Returns the (model path, worker port) SNAPSHOT to proxy against: the lock stays held only
        through here, and a swap that starts afterwards must not re-route this request to another
        model's worker (the race that silently answered with the wrong model). The fast path
        re-checks the worker is alive: a worker that loaded and then crashed must not keep
        'ready' forever (the self-healing the 502-forever review finding asked for)."""
        if model_id not in self.by_id:
            raise KeyError(f"unknown model {model_id!r}: not in the registry")
        with SWAP_LOCK:
            if self.worker is not None and self.worker.poll() is not None:
                self.log(f"mlx-bridge: worker for {self.active} is gone (exit {self.worker.returncode}); reloading")
                self.worker_ready = False
            if not needs_swap(self.active, model_id) and self.worker_ready:
                return self.by_id[model_id]["path"], self.worker_port
            self.swapping = True
            try:
                self.stop_worker()
                self.start_worker(model_id)
                deadline = time.time() + READY_TIMEOUT_S
                while time.time() < deadline:
                    if self.worker.poll() is not None:
                        raise RuntimeError(f"worker for {model_id} exited with {self.worker.returncode} (see /tmp/mlx-bridge-worker-{model_id}.log)")
                    if self._first_answer():
                        self.worker_ready = True
                        self.log(f"mlx-bridge: {model_id} ready on :{self.worker_port}")
                        return self.by_id[model_id]["path"], self.worker_port
                    time.sleep(2)
                raise RuntimeError(f"worker for {model_id} did not answer within {READY_TIMEOUT_S}s")
            finally:
                self.swapping = False

    def _first_answer(self) -> bool:
        """mlx_lm.server lazy-loads: /v1/models answering 200 is not ready. The first real
        completion is (and it doubles as the warm-up prefill). The model field carries the
        PATH: this server checks request model ids against HF repo ids (0.31.3) and a bare
        folder name fails that check."""
        try:
            conn = http.client.HTTPConnection("127.0.0.1", self.worker_port, timeout=10)
            body = json.dumps({"model": self.by_id[self.active]["path"],
                               "messages": [{"role": "user", "content": "hi"}],
                               "max_tokens": 1, "temperature": 0.0, "stream": False})
            conn.request("POST", "/v1/chat/completions", body, {"Content-Type": "application/json"})
            resp = conn.getresponse()
            resp.read()
            conn.close()
            return resp.status == 200
        except Exception:
            return False

    def status(self) -> dict:
        st = status_payload(self.registry, self.active, self.worker_port, self.worker_ready, self.wired_cap_mb, self.swapping)
        st["profiles"] = {k: [key for key in PROFILE_KEYS if self.profiles.get(k, {}).get(key) not in (None, "", 0)]
                          for k in self.profiles}
        if self.last_metrics:
            st["last_request"] = self.last_metrics
        return st


# ---- HTTP surface -------------------------------------------------------------------------------------------

def make_handler(bridge: Bridge):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):   # one line, our words
            bridge.log(f"mlx-bridge: {fmt % args}" if args else f"mlx-bridge: {fmt}")

        def _send_json(self, code, payload):
            data = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path.rstrip("/") in ("/v1/models", "/v1/models/"):
                return self._send_json(200, models_payload(bridge.registry))
            if self.path.rstrip("/") in ("/status", "/health"):
                return self._send_json(200, bridge.status())
            self._send_json(404, {"error": f"no route {self.path}"})

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            if self.path.rstrip("/") == "/load":
                try:
                    model_id = json.loads(raw or b"{}").get("model")
                except ValueError:
                    return self._send_json(400, {"error": "body must be JSON with a model id"})
                try:
                    bridge.ensure_worker(model_id)
                except (KeyError, RuntimeError) as e:
                    return self._send_json(409, {"error": str(e)})
                return self._send_json(200, bridge.status())
            if self.path.rstrip("/") in ("/v1/chat/completions", "/chat/completions"):
                try:
                    req = json.loads(raw or b"{}")
                except ValueError:
                    return self._send_json(400, {"error": "body must be JSON"})
                wanted = req.get("model")
                if not wanted:
                    wanted = bridge.active
                try:
                    wanted = wanted if wanted else bridge.active
                    worker_path, worker_port = bridge.ensure_worker(wanted)
                except KeyError as e:
                    return self._send_json(404, {"error": str(e)})
                except RuntimeError as e:
                    return self._send_json(503, {"error": str(e)})
                if not bridge.worker_ready:
                    return self._send_json(503, {"error": "no worker is loaded; POST /load first"})
                # the worker speaks in paths, the app speaks in ids (see _first_answer); proxy
                # against the SNAPSHOT - a swap that starts now serves the NEXT request, not this one
                req["model"] = worker_path
                if req.get("stream") and not req.get("stream_options"):
                    # mlx_lm ends the stream with a real usage frame when asked; the host books
                    # reported usage from it (without it a stream reports no tokens at all)
                    req["stream_options"] = {"include_usage": True}
                return self._proxy(json.dumps(req).encode(), wanted, worker_port)
            self._send_json(404, {"error": f"no route {self.path}"})

        def _proxy(self, raw: bytes, wanted_model: str | None = None, worker_port: int | None = None):
            """Bytes through to the worker SNAPSHOT: status, headers, and a streamed body stay a
            stream. A non-stream reply's usage is timed into the bridge's metrics (tokens per
            second, so /status can show what the model actually delivers); a failed worker reply
            writes no metrics (the last_request line stays the last GOOD request)."""
            worker_port = worker_port or bridge.worker_port
            t0 = time.time()
            try:
                conn = http.client.HTTPConnection("127.0.0.1", worker_port, timeout=1800)
                headers = {k: v for k, v in self.headers.items() if k.lower() in ("content-type", "authorization")}
                conn.request("POST", "/v1/chat/completions", raw, headers)
                resp = conn.getresponse()
                ctype = resp.getheader("Content-Type", "")
                if "text/event-stream" in ctype:
                    self._relay_stream(resp)
                else:
                    body = resp.read()
                    try:
                        usage = json.loads(body).get("usage") or {}
                        if resp.status != 200:
                            raise ValueError("not an ok reply")
                        bridge.last_metrics = {"model": wanted_model, "wall_s": round(time.time() - t0, 2),
                                               "prompt_tokens": usage.get("prompt_tokens"),
                                               "completion_tokens": usage.get("completion_tokens")}
                        if bridge.last_metrics["completion_tokens"] and bridge.last_metrics["wall_s"]:
                            bridge.last_metrics["gen_tok_s"] = round(usage["completion_tokens"] / bridge.last_metrics["wall_s"], 1)
                    except ValueError:
                        pass
                    self.send_response(resp.status)
                    self.send_header("Content-Type", ctype or "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                conn.close()
            except Exception as e:
                bridge.log(f"mlx-bridge: proxy failed: {e}")
                try:
                    self._send_json(502, {"error": f"worker relay failed: {e}"})
                except Exception:
                    pass

        def _relay_stream(self, resp):
            """SSE through, line by line; the worker may answer chunked or length-delimited.
            The tail may carry a usage frame (include_usage) - it passes through like any other."""
            self.send_response(resp.status)
            self.send_header("Content-Type", resp.getheader("Content-Type") or "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()

            def emit(payload: bytes):
                self.wfile.write(f"{len(payload):x}\r\n".encode() + payload + b"\r\n")
                self.wfile.flush()

            if resp.chunked:
                while True:
                    line = resp.fp.readline()
                    if not line:
                        break
                    data = line.strip()
                    if data[:1].isdigit():
                        size = int(data.split(b";")[0], 16)
                        if size == 0:
                            break
                        payload = resp.fp.read(size)
                        resp.fp.read(2)             # the chunk's trailing CRLF
                        emit(payload)
                    else:
                        emit(line)
            else:
                while True:
                    line = resp.fp.readline()
                    if not line:
                        break
                    emit(line)
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()

    return Handler


def main() -> int:
    ap = argparse.ArgumentParser(description="mlx-bridge: MLX models as Strata models")
    ap.add_argument("--port", type=int, default=int(os.environ.get("MLX_BRIDGE_PORT", BRIDGE_PORT_DEFAULT)))
    ap.add_argument("--roots", default=os.environ.get("MLX_BRIDGE_ROOTS", ":".join(DEFAULT_ROOTS)),
                    help="model roots, colon separated")
    ap.add_argument("--python", default=os.environ.get("MLX_BRIDGE_PY", DEFAULT_PYTHON),
                    help="the interpreter that has mlx_lm (starts the workers)")
    ap.add_argument("--wired-cap-mb", type=int, default=int(os.environ.get("MLX_WIRED_CAP_MB", "0") or 0) or None,
                    help="cap (MB) a worker may pin; absent = the RAM-derived default")
    ap.add_argument("--configs-dir", default=os.environ.get("MLX_BRIDGE_CONFIGS", DEFAULT_CONFIGS_DIR),
                    help="per-model launch profiles (mlx-configs/<id>.json)")
    ap.add_argument("--check", action="store_true", help="print the plan and exit")
    a = ap.parse_args()

    roots = [r for r in a.roots.split(":") if r]
    bridge = Bridge(roots, a.python, a.wired_cap_mb, configs_dir=a.configs_dir)
    if a.check:
        print(json.dumps(bridge.status(), ensure_ascii=False, indent=1))
        return 0

    server = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(bridge))
    bridge.log(f"mlx-bridge: {len(bridge.registry)} models, control plane on 127.0.0.1:{a.port}, "
               f"workers via {a.python}, wired cap {bridge.wired_cap_mb} MB, "
               f"{len(bridge.profiles)} launch profiles")
    print("READY", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        bridge.stop_worker()
    return 0


if __name__ == "__main__":
    sys.exit(main())
