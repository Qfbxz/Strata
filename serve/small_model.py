"""serve/small_model.py - the E3 small model: a resident llama-server sidecar.

Two jobs (docs/E3_SMALL_MODEL.md):
  - short tasks (session titles, short summaries) routed with `"model": "small"` so they do not
    spend the main model's context window;
  - the vision-text gateway: when the main model has no picture tower, a multimodal small model
    looks at the picture first and the description travels to the main model as text.

The sidecar is llama-server built from this checkout's own llama.cpp (Metal): one process on
127.0.0.1, an OpenAI-shaped POST /v1/chat/completions.  It is opt-in through the run config's
"small_model" section; without it the server behaves exactly as before.
"""
from __future__ import annotations

import json
import subprocess
import threading
import time
import urllib.error
import urllib.request

HOST = "127.0.0.1"

# The names a client asks for to reach the sidecar (the model fields of a request).
SMALL_NAMES = ("small", "small-model")

DEFAULT_CTX = 8192            # titles and summaries are short; the picture gateway stays under it
DEFAULT_NGL = 99              # every layer on the GPU (Metal)
DEFAULT_IDLE_UNLOAD_S = 300   # 5 idle minutes stop the process (its VRAM goes back)
DESCRIBE_MAX_TOKENS = 1024    # the description's own ceiling, before the main model ever sees it
HEALTH_TIMEOUT_S = 120.0      # the model load (a few GB) has to finish inside this
REQUEST_TIMEOUT_S = 180.0     # a sidecar answer (title, description) is short; this is generous

# The gateway describes the picture for another model; it is not shown to the user and the
# caller's own text never joins it.
DESCRIBE_PROMPT = (
    "Describe this picture for another AI model that cannot see it: everything readable in it "
    "(text, numbers, names), what is shown (charts, UI, objects, people, scene), layout, and "
    "colors where they matter.  Plain prose, no preamble."
)


def _post(url: str, req: urllib.request.Request, timeout: float | None = None):
    """The one HTTP call the sidecar gets (a seam the tests replace)."""
    return urllib.request.urlopen(req, timeout=timeout)


class SmallModel:
    """The sidecar process and its one HTTP face.  Start is lazy: the first small request (or the
    first picture of a tower-less main model) starts it, the idle window stops it again."""

    class ServingError(RuntimeError):
        """The sidecar answered with an error, or never became healthy."""

    DEFAULT_CTX = DEFAULT_CTX
    DEFAULT_NGL = DEFAULT_NGL
    DESCRIBE_MAX_TOKENS = DESCRIBE_MAX_TOKENS

    def __init__(self, cfg: dict, log=None, env: dict | None = None, lazy: bool = True):
        self.cfg = dict(cfg)
        self.model_name = str(cfg.get("name") or "small")
        self.idle_unload_s = float(cfg.get("idle_unload_s", DEFAULT_IDLE_UNLOAD_S))
        self.port = int(cfg.get("port") or 0)
        self.spawn = (self.server_args(self.cfg), log, env)
        self.proc = None
        self.stopped = True
        self.lock = threading.Lock()
        self._last_used = 0.0
        if not lazy:
            self._start()

    @staticmethod
    def server_args(cfg: dict) -> list:
        """llama-server's command line: loopback only, one model, the picture projector with it."""
        absolute = lambda p: __import__("os").path.abspath(str(p))    # noqa: E731
        args = [absolute(cfg["exe"]),
                "--host", HOST, "--port", str(int(cfg.get("port") or 0)),
                "-m", absolute(cfg["model"]),
                "-c", str(int(cfg.get("ctx") or DEFAULT_CTX))]
        if cfg.get("mmproj"):
            args += ["--mmproj", absolute(cfg["mmproj"])]
        args += ["-ngl", str(int(cfg.get("ngl", DEFAULT_NGL)))]       # an explicit 0 stays 0 (all CPU)
        if cfg.get("threads"):
            args += ["--threads", str(cfg["threads"])]
        return args

    @property
    def url(self) -> str:
        return f"http://{HOST}:{self.port}"

    def _start(self):
        """Start llama-server and wait for /health.  The port a config left at 0 is picked here
        (a free one), so two serves never collide."""
        args, log, env = self.spawn
        if self.port == 0:
            import socket
            with socket.socket() as s:
                s.bind((HOST, 0))
                self.port = s.getsockname()[1]
            args = list(args)
            args[args.index("--port") + 1] = str(self.port)
            self.spawn = (args, log, env)
        self.proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=log or subprocess.DEVNULL,
                                     stderr=subprocess.STDOUT, env=env)
        deadline = time.monotonic() + HEALTH_TIMEOUT_S
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                raise self.ServingError(f"the small model exited with code {self.proc.returncode} before it was ready")
            try:
                with _post(self.url + "/health", urllib.request.Request(self.url + "/health",
                          headers={"User-Agent": "strata"}), timeout=2) as r:
                    if r.status == 200:
                        self.stopped = False
                        return
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(0.3)
        self.unload()
        raise self.ServingError(f"the small model never became healthy within {HEALTH_TIMEOUT_S:.0f} s")

    def alive(self) -> bool:
        return self.proc is not None and not self.stopped and self.proc.poll() is None

    def unload(self):
        """Stop the sidecar; its VRAM goes back.  Safe to call when it never started."""
        proc, self.proc = self.proc, None
        self.stopped = True
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    proc.kill()
                except OSError:
                    pass

    def touch(self, now: float | None = None):
        """A request (or a picture) came in: the idle clock restarts."""
        self._last_used = time.time() if now is None else now

    def idle_tick(self, now: float | None = None):
        """Stop the sidecar once no request touched it for its idle window."""
        if not self.alive() or not self._last_used:
            return
        t = time.time() if now is None else now
        if t - self._last_used >= self.idle_unload_s:
            self.unload()

    def _ensure(self):
        if not self.alive():
            with self.lock:
                if not self.alive():
                    self._start()

    def chat(self, messages: list, **fields) -> str:
        """One completion from the sidecar: -> the assistant text.  Extra OpenAI fields pass
        through; a None field is dropped (it means "the sidecar's own default").  The small-task
        routes (titles, summaries, picture descriptions) run with thinking off by default - a
        thinking model would spend the token cap inside <think> and return no content at all
        (Qwen3-VL measured); an explicit chat_template_kwargs wins."""
        self._ensure()
        self.touch()
        fields.setdefault('chat_template_kwargs', {'enable_thinking': False})
        body = {k: v for k, v in {"messages": messages, **fields}.items() if v is not None}
        req = urllib.request.Request(self.url + "/v1/chat/completions",
                                     data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "User-Agent": "strata"})
        try:
            with _post(self.url + "/v1/chat/completions", req, timeout=REQUEST_TIMEOUT_S) as r:
                out = json.loads(r.read())
        except urllib.error.HTTPError as e:
            with e:
                detail = e.read().decode(errors="replace")[:300]
            raise self.ServingError(f"the small model refused the request ({e.code}): {detail}") from None
        except (OSError, ValueError) as e:
            raise self.ServingError(f"the small model did not answer: {e}") from None
        try:
            return out["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            raise self.ServingError(f"the small model's answer has no text: {json.dumps(out)[:300]}") from None

    def describe_image(self, src: str, prompt: str | None = None, max_tokens: int = DESCRIBE_MAX_TOKENS) -> str:
        """The vision-text gateway: -> what is in the picture, as text.  `src` is a data: URL or
        raw base64; the caller's prompt, when given, rides along after the description ask."""
        if src.startswith("data:"):
            url = src
        else:
            url = f"data:image/png;base64,{src}"
        content = [{"type": "image_url", "image_url": {"url": url}},
                   {"type": "text", "text": prompt or DESCRIBE_PROMPT}]
        return self.chat([{"role": "user", "content": content}], max_tokens=max_tokens)
