"""Stand-ins for GoTrue's JWKS and the model provider, for load tests.

- ``GET /auth/v1/.well-known/jwks.json``: the public half of an ES256 key
  this process generates; the private half is written to ``$KEY_DIR/key.pem``
  so the load generator can sign access tokens the API accepts.
- ``POST /v1/chat/completions``: an OpenAI-compatible model that streams a
  fixed-length reply at a set pace (``STUB_REPLY_TOKENS`` over
  ``STUB_REPLY_SECONDS``), so the API holds a Fern turn open as long as a real
  provider would, without the cost or the provider's variance. Every call's
  prompt size is recorded (``GET /_calls``): an estimate of what one Fern
  turn sends to the provider.
- ``POST /v1/embeddings``: zero vectors of the requested width.
- ``GET /auth/v1/admin/users/{id}``: every user exists (the API checks before
  it provisions a user on first sight).

Run inside the backend image: ``python scripts/load_test/stub.py``.
"""

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any

import jwt
import uvicorn
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

KID = "load-test"
REPLY_TOKENS = int(os.environ.get("STUB_REPLY_TOKENS", "150"))
REPLY_SECONDS = float(os.environ.get("STUB_REPLY_SECONDS", "6"))
FIRST_TOKEN_SECONDS = float(os.environ.get("STUB_FIRST_TOKEN_SECONDS", "0.8"))

key_file = Path(os.environ.get("KEY_DIR", "/keys")) / "key.pem"
if key_file.exists():
    # A restarted stub keeps its key: the API caches the JWKS for 5 minutes.
    _key = serialization.load_pem_private_key(key_file.read_bytes(), None)
    assert isinstance(_key, ec.EllipticCurvePrivateKey)
else:
    _key = ec.generate_private_key(ec.SECP256R1())
    key_file.parent.mkdir(parents=True, exist_ok=True)
    key_file.write_bytes(
        _key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
_jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(_key.public_key()))
_jwk.update({"kid": KID, "alg": "ES256", "use": "sig"})

calls: list[dict[str, Any]] = []


async def jwks(_: Request) -> Response:
    return JSONResponse({"keys": [_jwk]})


async def admin_user(request: Request) -> Response:
    return JSONResponse({"id": request.path_params["uid"]})


def _tokens(text: str) -> int:
    # ~4 characters per token for English prose and JSON alike.
    return max(1, len(text) // 4)


async def completions(request: Request) -> Response:
    body = await request.json()
    prompt = json.dumps(body.get("messages", [])) + json.dumps(body.get("tools", []))
    record = {
        "at": time.time(),
        "model": body.get("model"),
        "stream": bool(body.get("stream")),
        "input_tokens": _tokens(prompt),
        "tools": len(body.get("tools", []) or []),
        "messages": len(body.get("messages", [])),
    }
    calls.append(record)
    words = ["ok"] * REPLY_TOKENS
    usage = {
        "prompt_tokens": record["input_tokens"],
        "completion_tokens": REPLY_TOKENS,
        "total_tokens": record["input_tokens"] + REPLY_TOKENS,
    }
    base = {"id": "stub", "object": "chat.completion.chunk", "model": body["model"]}
    if not body.get("stream"):
        await asyncio.sleep(FIRST_TOKEN_SECONDS + REPLY_SECONDS)
        return JSONResponse(
            {
                "id": "stub",
                "object": "chat.completion",
                "model": body["model"],
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": " ".join(words)},
                        "finish_reason": "stop",
                    }
                ],
                "usage": usage,
            }
        )

    async def frames() -> Any:
        await asyncio.sleep(FIRST_TOKEN_SECONDS)
        pause = REPLY_SECONDS / REPLY_TOKENS
        for i, w in enumerate(words):
            delta = {"content": (" " if i else "") + w}
            if i == 0:
                delta["role"] = "assistant"
            chunk = {**base, "choices": [{"index": 0, "delta": delta}]}
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(pause)
        end = {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
        yield f"data: {json.dumps(end)}\n\n"
        yield f"data: {json.dumps({**base, 'choices': [], 'usage': usage})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(frames(), media_type="text/event-stream")


async def embeddings(request: Request) -> Response:
    body = await request.json()
    inputs = body.get("input", [])
    if isinstance(inputs, str):
        inputs = [inputs]
    width = int(body.get("dimensions") or 1024)
    return JSONResponse(
        {
            "object": "list",
            "data": [
                {"object": "embedding", "index": i, "embedding": [0.0] * width}
                for i in range(len(inputs))
            ],
            "model": body.get("model"),
            "usage": {"prompt_tokens": 1, "total_tokens": 1},
        }
    )


async def models(_: Request) -> Response:
    return JSONResponse({"object": "list", "data": [{"id": "stub", "object": "model"}]})


async def recorded(_: Request) -> Response:
    return JSONResponse(calls)


app = Starlette(
    routes=[
        Route("/auth/v1/.well-known/jwks.json", jwks),
        Route("/auth/v1/admin/users/{uid}", admin_user),
        Route("/v1/chat/completions", completions, methods=["POST"]),
        Route("/v1/embeddings", embeddings, methods=["POST"]),
        Route("/v1/models", models),
        Route("/_calls", recorded),
    ]
)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=9000, log_level="warning")
