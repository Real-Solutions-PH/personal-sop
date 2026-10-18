"""Standard Webhooks verification (what Supabase signs hooks with).

Headers ``webhook-id``, ``webhook-timestamp`` (unix seconds) and
``webhook-signature`` (space-separated ``v1,<base64 HMAC-SHA256>``). The signed
content is ``"{id}.{timestamp}.{raw body}"`` and the key is the base64 part of
the ``v1,whsec_<base64>`` secret. Verification uses the RAW bytes, never a
re-serialised body, and a constant-time compare.
"""

import base64
import hashlib
import hmac
import time

TOLERANCE_SECONDS = 300


class InvalidSignature(Exception):
    pass


def _key(secret: str) -> bytes:
    raw = secret.split(",", 1)[1] if secret.startswith("v1,") else secret
    raw = raw.removeprefix("whsec_")
    try:
        return base64.b64decode(raw, validate=True)
    except ValueError as exc:
        raise InvalidSignature("bad secret") from exc


def sign(secret: str, msg_id: str, timestamp: int, body: bytes) -> str:
    content = f"{msg_id}.{timestamp}.".encode() + body
    digest = hmac.new(_key(secret), content, hashlib.sha256).digest()
    return "v1," + base64.b64encode(digest).decode()


def verify(
    secret: str,
    *,
    msg_id: str | None,
    timestamp: str | None,
    signature: str | None,
    body: bytes,
    now: float | None = None,
) -> None:
    if not msg_id or not timestamp or not signature:
        raise InvalidSignature("missing headers")
    if not timestamp.isdigit():
        raise InvalidSignature("bad timestamp")
    ts = int(timestamp)
    if abs((now if now is not None else time.time()) - ts) > TOLERANCE_SECONDS:
        raise InvalidSignature("timestamp outside tolerance")
    expected = sign(secret, msg_id, ts, body).split(",", 1)[1]
    for candidate in signature.split(" "):
        version, _, value = candidate.partition(",")
        if version == "v1" and hmac.compare_digest(value, expected):
            return
    raise InvalidSignature("no matching signature")
