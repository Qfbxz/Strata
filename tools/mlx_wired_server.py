#!/usr/bin/env python3
"""mlx_lm.server with a wired-limit cap.

mlx_lm.server raises the wired limit to the whole recommended working set at request time
(mlx_lm/server.py:1890). On a machine where Strata's Metal engine maps its weights from the
same unified RAM, the two fight for one pool and both sides end up paging. This wrapper keeps
MLX honest: MLX_WIRED_CAP_MB (megabytes) bounds every set_wired_limit call for the server's
lifetime. Without the env (or 0) it is exactly mlx_lm.server.

set_wired_limit takes BYTES; the cap is configured in MB - make_capped does the conversion
(kimi acceptance 2026-11-06 caught the missing one).

Run:  MLX_WIRED_CAP_MB=36864 python -m mlx_wired_server --model <path> --port <port>
"""

import os
import sys

CAP_MB = int(os.environ.get("MLX_WIRED_CAP_MB", "0") or 0)


def make_capped(original, cap_mb: int):
    """A set_wired_limit replacement that never pins more than cap_mb (given in MB, the
    engine API speaks BYTES). Real calls through it are tested in
    tests/terminal/test_mlx_wired_server.py."""
    cap_bytes = int(cap_mb) * 1024 * 1024

    def capped(limit):
        return original(min(int(limit), cap_bytes))

    return capped


def install(cap_mb: int = CAP_MB) -> bool:
    if cap_mb <= 0:
        return False
    try:
        import mlx.core as mx
        mx.metal.set_wired_limit = make_capped(mx.metal.set_wired_limit, cap_mb)
        print(f"mlx-wired-server: set_wired_limit capped at {cap_mb} MB", flush=True)
        return True
    except Exception as e:   # no mlx here: let the plain server speak for itself
        print(f"mlx-wired-server: cap ignored ({e})", flush=True)
        return False


if __name__ == "__main__":
    install(CAP_MB)
    from mlx_lm.server import main

    sys.argv[0] = "mlx_lm.server"
    main()
