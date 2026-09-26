"""Supabase Auth integration.

Two concerns live here:

* **Token verification** — validate Supabase-issued access tokens against
  the project's JWKS (same path for the local CLI stack and hosted
  projects). The JWK client caches keys at module scope.
* **GoTrue admin helpers** — create/look-up auth users with the
  service-role key. Used by the FIRST_SUPERUSER bootstrap, the local-only
  ``/private/users`` route, superuser user creation, and test fixtures.
"""

import uuid
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient

from app.core.config import settings

AUDIENCE = "authenticated"

# Module-scope JWKS client: caches signing keys across requests.
_jwk_client: PyJWKClient | None = None


def _get_jwk_client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(
            settings.supabase_jwks_url, cache_keys=True, lifespan=300
        )
    return _jwk_client


def verify_token(token: str) -> dict[str, Any]:
    """Validate a Supabase access token and return its claims.

    Checks signature (via JWKS), ``exp``, ``aud`` ("authenticated") and
    ``iss`` (the Supabase auth endpoint). Raises ``jwt.PyJWTError`` (or a
    subclass) on any failure — including JWKS fetch/key-lookup errors.
    """
    # Note: keys are cached for 300s, so a JWKS rotation can take up to
    # 5 minutes to propagate here — tokens signed with a brand-new key may
    # fail key lookup until the cache expires.
    signing_key = _get_jwk_client().get_signing_key_from_jwt(token)
    claims: dict[str, Any] = jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256", "RS256"],
        audience=AUDIENCE,
        issuer=settings.supabase_issuer,
        # Small clock-skew allowance between GoTrue and this host.
        leeway=10,
        options={"require": ["exp", "sub", "aud", "iss"]},
    )
    return claims


# --------------------------------------------------------------------------
# GoTrue admin API (service-role key; backend-only)
# --------------------------------------------------------------------------


def _admin_headers() -> dict[str, str]:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    return {"Authorization": f"Bearer {key}", "apikey": key}


def _auth_url(path: str) -> str:
    return f"{settings.SUPABASE_URL}/auth/v1{path}"


# Admin user listing: page size and a defensive cap on how many pages we
# walk when resolving an email. ``filter=`` narrows server-side (substring
# match on email/phone in the pinned local GoTrue), so in practice the
# match is on page 1; the cap only guards against a pathological number of
# substring collisions.
_ADMIN_LIST_PER_PAGE = 50
_ADMIN_LIST_MAX_PAGES = 20


def admin_get_user_id_by_email(email: str) -> uuid.UUID | None:
    """Return the auth UID for an existing GoTrue user, or None.

    Uses the admin list endpoint (``GET /admin/users``) with the ``filter``
    query param — probed live against the pinned local stack: the response
    shape is ``{"users": [...], "aud": ...}`` and ``filter`` substring-matches
    email/phone. The exact-match check happens client-side; pagination is
    walked defensively up to ``_ADMIN_LIST_MAX_PAGES``.
    """
    wanted = email.lower()
    for page in range(1, _ADMIN_LIST_MAX_PAGES + 1):
        r = httpx.get(
            _auth_url("/admin/users"),
            headers=_admin_headers(),
            params={"page": page, "per_page": _ADMIN_LIST_PER_PAGE, "filter": email},
            timeout=10,
        )
        r.raise_for_status()
        users: list[dict[str, Any]] = r.json().get("users", [])
        for user in users:
            if str(user.get("email", "")).lower() == wanted:
                return uuid.UUID(user["id"])
        if len(users) < _ADMIN_LIST_PER_PAGE:
            return None
    return None


def admin_user_exists(auth_uid: uuid.UUID) -> bool:
    """True if the GoTrue user with this auth UID still exists."""
    r = httpx.get(
        _auth_url(f"/admin/users/{auth_uid}"), headers=_admin_headers(), timeout=10
    )
    if r.status_code == 404:
        return False
    r.raise_for_status()
    return True


def admin_delete_user(auth_uid: uuid.UUID) -> None:
    """Delete the GoTrue user with this auth UID; tolerates already-gone."""
    r = httpx.delete(
        _auth_url(f"/admin/users/{auth_uid}"), headers=_admin_headers(), timeout=10
    )
    if r.status_code == 404:
        return
    r.raise_for_status()


def admin_update_email(auth_uid: uuid.UUID, email: str) -> None:
    """Change a GoTrue user's email (marked confirmed). Raises
    ``httpx.HTTPStatusError`` on failure — callers must not commit a local
    email change unless this succeeded."""
    httpx.put(
        _auth_url(f"/admin/users/{auth_uid}"),
        headers=_admin_headers(),
        json={"email": email, "email_confirm": True},
        timeout=10,
    ).raise_for_status()


class EmailExistsError(Exception):
    """The email is already registered with the auth provider and the
    caller opted out of adopting the existing identity."""


def admin_get_or_create_user(
    email: str, password: str | None = None, *, adopt_existing: bool = True
) -> uuid.UUID:
    """Idempotently ensure a GoTrue user exists; return its auth UID.

    If the user already exists and ``adopt_existing`` is True, the existing
    identity is adopted — and if ``password`` is given it is reset so
    callers (bootstrap, test fixtures) end in a known state. Caveat for the
    FIRST_SUPERUSER bootstrap: the reset invalidates the old password, but
    any access token already issued to the previous holder stays
    signature-valid until ``exp`` (≤ jwt_expiry) — don't point the
    bootstrap at an email you don't control.

    With ``adopt_existing=False`` an already-registered email raises
    :class:`EmailExistsError` instead, so privileged flows (superuser user
    creation) can't silently grant app access to an unverified pre-existing
    auth identity.
    """
    body: dict[str, Any] = {"email": email, "email_confirm": True}
    if password is not None:
        body["password"] = password
    r = httpx.post(
        _auth_url("/admin/users"), headers=_admin_headers(), json=body, timeout=10
    )
    if r.status_code == 200:
        return uuid.UUID(r.json()["id"])
    if r.status_code == 422 and r.json().get("error_code") == "email_exists":
        if not adopt_existing:
            raise EmailExistsError(email)
        user_id = admin_get_user_id_by_email(email)
        if user_id is None:  # pragma: no cover - create/lookup race
            raise RuntimeError(f"GoTrue reports {email} exists but lookup failed")
        if password is not None:
            httpx.put(
                _auth_url(f"/admin/users/{user_id}"),
                headers=_admin_headers(),
                json={"password": password},
                timeout=10,
            ).raise_for_status()
        return user_id
    r.raise_for_status()
    raise RuntimeError("unreachable")  # pragma: no cover
