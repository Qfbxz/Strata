"""Replace a file that another program may be reading, on Windows as well as everywhere else.

A job record (a Time-skip `run.json`, a tuning `job.json`) is rewritten at every phase and READ by the app's host every couple of seconds.
On Windows, `os.replace` onto a file that is open in another process fails with PermissionError ("Access is denied") for as long as the
reader holds it. That is a split second, but a job saves many times, so a Time-skip or a tune died at random with that error. The fix is
to wait that split second and try again; any other error, and a PermissionError that does not go away, is raised as before.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Union

PathLike = Union[str, "os.PathLike[str]"]

#: how long a held file is waited for, in total (seconds) and between tries
PATIENCE_S = 5.0
STEP_S = 0.02


def replace(src: PathLike, dst: PathLike, *, patience: float = PATIENCE_S, sleep=time.sleep, clock=time.monotonic) -> None:
    deadline = clock() + patience
    step = STEP_S
    while True:
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if os.name != "nt" or clock() >= deadline:
                raise
            sleep(step)
            step = min(step * 1.5, 0.25)


def write_text(path: PathLike, text: str, *, encoding: str = "utf-8") -> None:
    """Write `text` to `path` through a neighbouring temporary file, so a reader never sees half a record."""
    target = Path(path)
    tmp = target.with_suffix(target.suffix + ".tmp") if target.suffix else target.with_name(target.name + ".tmp")
    tmp.write_text(text, encoding=encoding)
    replace(tmp, target)


# ---- P0-5: a cross-process write lock for files more than one program writes -----------------
#
# The install folder's run configs are written by the app's host (native-control), the Terminal's
# setup, serve's config editor and the person's own editor. Each of them reads the file, changes it
# and writes the whole thing back, so two of them running at once lose whichever wrote first. The
# fix is one lock protocol every writer shares: a lock FILE created with O_CREAT|O_EXCL holding
# the writer's pid and a timestamp, stolen only after LOCK_STALE_S (a crashed writer's leftover),
# released by unlinking only when the content still matches our own token (so a stolen lock is
# never unlinked by the writer that lost it). The host's Node side implements the same protocol
# (apps/host/server/native-control.mjs writeModelConfig) — keep both sides in step.

LOCK_STALE_S = 300.0    # a lock older than this is a crashed writer's leftover and is stolen
LOCK_TIMEOUT_S = 10.0   # how long a well-behaved second writer waits for the first


def _lock_token() -> str:
    import random
    return f"{os.getpid()} {time.time():.6f} {random.randrange(1 << 30)}"


class WriteLock:
    """`with WriteLock(path):` — one writer at a time for the guarded write that follows."""

    def __init__(self, lock_path: PathLike, *, timeout: float = LOCK_TIMEOUT_S, stale: float = LOCK_STALE_S,
                 sleep=time.sleep, clock=time.monotonic):
        self.path = Path(lock_path)
        self.timeout, self.stale = timeout, stale
        self._sleep, self._clock = sleep, clock
        self._token = _lock_token()
        self._held = False

    def acquire(self) -> None:
        import time as _time
        lock, deadline = self.path, self._clock() + self.timeout
        lock.parent.mkdir(parents=True, exist_ok=True)
        while True:
            try:
                fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, self._token.encode("utf-8"))
                os.close(fd)
                self._held = True
                return
            except FileExistsError:
                try:
                    # staleness compares wall-clock mtimes; the injected clock is only for the timeout
                    if _time.time() - lock.stat().st_mtime > self.stale:
                        lock.unlink(missing_ok=True)      # a crashed writer's leftover: steal it
                        continue
                except OSError:
                    continue
                if self._clock() >= deadline:
                    raise TimeoutError(f"another writer holds {lock}")
                self._sleep(0.05)

    def release(self) -> None:
        if not self._held:
            return
        self._held = False
        try:
            if self.path.read_text(encoding="utf-8", errors="replace").strip() == self._token:
                self.path.unlink(missing_ok=True)         # never unlink a lock we do not own
        except OSError:
            pass

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self.release()


def guarded_write(path: PathLike, mutate, *, required_keys=("exe", "args"), lock: PathLike | None = None,
                  json_kwargs: dict | None = None) -> dict:
    """P0-5: the safe way to change a file other programs read-modify-write (a run config).

    Locks `path.lock`, reads what is on disk now, lets `mutate(current: dict) -> dict` build the
    candidate from THAT (never from a stale copy the caller held), refuses a candidate that would
    drop any of `required_keys` the current file has (the degrade guard: a half-built or empty
    write must never wipe a working config — kept as .bak instead), rotates the backups and
    writes atomically. Returns the candidate that was written.
    """
    import json
    import shutil
    target = Path(path)
    lock_path = Path(lock) if lock else target.with_name(target.name + ".lock")
    with WriteLock(lock_path):
        current: dict = {}
        if target.exists():
            try:
                loaded = json.loads(target.read_text(encoding="utf-8-sig"))
                if isinstance(loaded, dict):
                    current = loaded
            except (OSError, ValueError):
                current = {}                               # torn file: treat as empty, the guard still runs
        candidate = mutate(dict(current))
        if not isinstance(candidate, dict):
            raise ValueError(f"{target.name}: the candidate is not a JSON object")
        lost = [k for k in required_keys if current.get(k) and not candidate.get(k)]
        if lost:
            raise ValueError(f"refusing to write {target.name}: it would drop {', '.join(lost)} "
                             f"that the current file has (nothing was written)")
        for old, new in ((target.with_name(target.name + ".bak.1"), target.with_name(target.name + ".bak.2")),
                         (target.with_name(target.name + ".bak"), target.with_name(target.name + ".bak.1"))):
            if old.exists():
                shutil.copyfile(old, new)
        if target.exists():
            shutil.copyfile(target, target.with_name(target.name + ".bak"))
        text = json.dumps(candidate, indent=1, **(json_kwargs or {}))
        write_text(target, text)
        return candidate
