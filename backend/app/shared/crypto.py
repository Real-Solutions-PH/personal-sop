"""Envelope encryption for secrets users hand us (AI provider API keys).

AES-256-GCM under a server key-encryption key (``AI_CREDENTIALS_KEK``, 32 bytes,
base64) that lives in the secret manager, never in the database. The owning
user's id is bound as associated data, so a ciphertext copied onto another
user's row fails to decrypt. ``key_version`` lets the KEK rotate: rows record
which version sealed them.
"""

import base64
import os
import uuid
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings

NONCE_BYTES = 12


class SecretUnavailable(Exception):
    """The KEK is missing or the ciphertext does not open with it."""


@dataclass(frozen=True)
class Sealed:
    ciphertext: bytes
    nonce: bytes
    key_version: int


def _kek() -> bytes:
    raw = settings.AI_CREDENTIALS_KEK
    if not raw:
        raise SecretUnavailable("AI_CREDENTIALS_KEK is not configured")
    key = base64.b64decode(raw.get_secret_value())
    if len(key) != 32:
        raise SecretUnavailable("AI_CREDENTIALS_KEK must decode to 32 bytes")
    return key


def seal(plaintext: str, *, owner_id: uuid.UUID) -> Sealed:
    nonce = os.urandom(NONCE_BYTES)
    ct = AESGCM(_kek()).encrypt(nonce, plaintext.encode(), owner_id.bytes)
    return Sealed(
        ciphertext=ct, nonce=nonce, key_version=settings.AI_CREDENTIALS_KEK_VERSION
    )


def unseal(sealed: Sealed, *, owner_id: uuid.UUID) -> str:
    if sealed.key_version != settings.AI_CREDENTIALS_KEK_VERSION:
        raise SecretUnavailable("sealed under a retired key version")
    try:
        return (
            AESGCM(_kek())
            .decrypt(sealed.nonce, sealed.ciphertext, owner_id.bytes)
            .decode()
        )
    except InvalidTag as exc:
        raise SecretUnavailable("ciphertext does not open") from exc


def last4(secret: str) -> str:
    """The only part of a key the API ever returns."""
    return secret[-4:] if len(secret) >= 8 else ""
