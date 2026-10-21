"""Deterministic ids for rows the server derives.

When a domain action creates a row as a side effect — the next occurrence of a
recurring task, the record a settled bill creates, the habit log a finished
workout ticks — the device creates the same row optimistically while offline.
Both sides mint its id with UUID v5 over ``(kind, parent id, key)`` so the
replayed action and the optimistic copy are one row, never a duplicate. The
mobile client reproduces this with ``uuid.v5`` and the same namespace.
"""

import uuid

# Fixed forever: changing it would fork every derived id already on devices.
DERIVED_NAMESPACE = uuid.UUID("6f1d7c2a-4b8e-5a3c-9d10-2e7f40b1c9a5")


def derived_id(kind: str, parent: uuid.UUID, key: str) -> uuid.UUID:
    """``uuid5(namespace, "kind:parent:key")``."""
    if not kind or ":" in kind:
        raise ValueError("kind must be a non-empty token without ':'")
    return uuid.uuid5(DERIVED_NAMESPACE, f"{kind}:{parent}:{key}")
