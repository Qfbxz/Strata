"""Register the Mac's MLX models into Strata as one keyless connection.

Idempotent: a connection named like NAME is updated in place (its id is reused), never
duplicated. The models come from the bridge's registry (all of them, not just the loaded
one), each with its own context window from the model's config.

Run:  python3 tools/mlx_register.py [--bridge URL] [--host URL]
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

BRIDGE_DEFAULT = "http://127.0.0.1:8759"
HOST_DEFAULT = "http://127.0.0.1:8791"
NAME = "MLX on this Mac"
PROTOCOL = "openai-chat"
MAX_MODELS = 100          # the host's connection editor accepts at most 100 models per connection


def pretty(name: str) -> str:
    """Qwen3.8-27B-MLX-4bit -> Qwen3.8 27B MLX·4bit: the dash between MLX and its quant becomes a ·."""
    return name.replace("-MLX-", " MLX·").replace("-", " ")


def connection_payload(models: list[dict], existing_id: str | None = None, bridge_url: str = BRIDGE_DEFAULT) -> dict:
    """The POST /api/model-providers body. models rows: {id, context_max} from the bridge registry.
    The connection points at THE BRIDGE THIS PROCESS TALKED TO (bridge_url) - a bridge on a non-default
    port must not register a connection that leads to :8759."""
    if len(models) > MAX_MODELS:
        raise ValueError(f"{len(models)} models exceed the connection limit of {MAX_MODELS}")
    rows = [{"id": m["id"], "name": m.get("name") or pretty(m["id"]),
             "contextMax": m.get("context_max"), "maxOutput": None, "vision": None, "reasoning": None}
            for m in models]
    payload = {"kind": "custom", "provider": None, "name": NAME,
               "baseUrl": f"{bridge_url.rstrip('/')}/v1", "protocol": PROTOCOL, "apiKey": "", "models": rows}
    if existing_id:
        payload["id"] = existing_id
    return payload


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read())


def post_json(url: str, payload: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def register(bridge: str = BRIDGE_DEFAULT, host: str = HOST_DEFAULT) -> dict:
    models = get_json(f"{bridge.rstrip('/')}/v1/models").get("data", [])
    if not models:
        raise RuntimeError("the bridge registry is empty - nothing to register")
    try:
        connections = get_json(f"{host.rstrip('/')}/api/model-providers").get("connections", [])
    except (urllib.error.URLError, OSError):
        raise RuntimeError(f"the Strata host at {host} is not reachable - start the app first")
    bridge_url = bridge.rstrip('/')
    # idempotent by name; a connection the person renamed is still ours when its baseUrl is the bridge
    existing = next((c for c in connections if c.get("name") == NAME or c.get("baseUrl") == f"{bridge_url}/v1"), None)
    result = post_json(f"{host.rstrip('/')}/api/model-providers",
                       connection_payload(models, existing.get("id") if existing else None, bridge_url))
    saved = result.get("connections") or []
    mine = next((c for c in saved if c.get("id") == (existing or {}).get("id") or c.get("name") == NAME), result if "id" in result else (saved[0] if saved else result))
    return {"updated": existing is not None, "models": len(models), "connection": mine}


def main() -> int:
    ap = argparse.ArgumentParser(description="register the mlx-bridge models as a Strata connection")
    ap.add_argument("--bridge", default=BRIDGE_DEFAULT)
    ap.add_argument("--host", default=HOST_DEFAULT)
    ap.add_argument("--check", action="store_true", help="print the payload and exit")
    a = ap.parse_args()
    if a.check:
        print(json.dumps(connection_payload([{"id": "Demo-MLX-4bit", "context_max": 32768}], None), indent=1))
        return 0
    try:
        out = register(a.bridge, a.host)
    except RuntimeError as e:
        print(f"mlx-register: {e}", file=sys.stderr)
        return 1
    print(f"mlx-register: {'updated' if out['updated'] else 'created'} connection with {out['models']} models: "
          f"{out['connection'].get('name')} ({len(out['connection'].get('models', []))} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
