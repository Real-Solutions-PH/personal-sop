"""AI provider use cases: credentials, verification, model lists, assignments
and usage (ADR-0012).

Credentials are server-only state and are deliberately NOT part of the sync
engine (there is no ``sync.py`` for this module): a sync pull ships rows to
the device, and the device has no use for a sealed key it cannot open, while
an assignment pointing at a credential the device cannot see would be a
dangling reference. The device reads and writes these through REST only.

Every use case ends with ``ctx.commit()``. The key is unsealed only right
before the outbound call and never leaves this module except as the
``Authorization`` header to the credential's own base URL.
"""

import uuid
from datetime import date
from typing import Any

from sqlalchemy import select as sa_select
from sqlmodel import col, func

from app.modules.ai_providers import cache, catalog, provider_http, public
from app.modules.ai_providers import schema as S
from app.modules.ai_providers.models import (
    AIModelAssignment,
    AIProviderCredential,
    AIUsage,
)
from app.modules.ai_providers.public import (
    PRESET_BASE_URLS,
    Purpose,
    budget,
    month_window,
)
from app.modules.ai_providers.rules import (
    PRESETS,
    BaseUrlRejected,
    ModelInfo,
    VerifyCode,
    validate_base_url,
    vision_allowed,
)
from app.shared import crypto, owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict, domain_error, invalid, not_found

_BASE_URL_MESSAGES = {
    "base_url_invalid": "That base URL is not valid.",
    "base_url_scheme": "Use an https URL (plain http only for localhost).",
    "base_url_userinfo": "Put the API key in the key field, not in the URL.",
    "base_url_private": "Use a public https URL; local and private addresses are not reachable from the server.",
}


def _base_url(provider: str, raw: str | None) -> str:
    if provider != "custom":
        if raw is not None:
            raise invalid(
                "base_url_not_allowed", "Only the custom provider takes a base URL."
            )
        return PRESET_BASE_URLS[provider]
    if raw is None:
        raise invalid("base_url_required", "The custom provider needs a base URL.")
    try:
        return validate_base_url(raw)
    except BaseUrlRejected as exc:
        raise invalid(exc.code, _BASE_URL_MESSAGES[exc.code]) from None


def _seal_onto(ctx: Ctx, cred: AIProviderCredential, key: str) -> None:
    try:
        sealed = crypto.seal(key, owner_id=ctx.user_id)
    except crypto.SecretUnavailable:
        raise domain_error(
            503, "ai_credentials_unavailable", "Saving API keys is not available."
        ) from None
    cred.key_ciphertext = sealed.ciphertext
    cred.key_nonce = sealed.nonce
    cred.key_version = sealed.key_version
    cred.key_last4 = crypto.last4(key)
    cred.verified_at = None
    cred.last_error_code = None


def _require(ctx: Ctx, credential_id: uuid.UUID) -> AIProviderCredential:
    return owned_repo.require(
        ctx, AIProviderCredential, credential_id, what="credential"
    )


# ---------------------------------------------------------------------------
# Presets and credentials
# ---------------------------------------------------------------------------


def presets() -> S.PresetsOut:
    rows = [
        S.PresetOut(
            name=p.name,  # type: ignore[arg-type]
            label=p.label,
            default_base_url=p.default_base_url,
            custom_base_url=p.custom_base_url,
            vision_models=list(p.vision_models),
            models=[
                S.CatalogModelOut(**vars(m))
                for m in (catalog.NEBIUS if p.name == "nebius" else ())
            ],
        )
        for p in PRESETS
    ]
    summary = public.server_default_summary()
    return S.PresetsOut(
        data=rows,
        count=len(rows),
        server_default=S.ServerDefaultOut(**summary) if summary else None,
    )


def list_credentials(ctx: Ctx, *, skip: int, limit: int) -> dict[str, Any]:
    rows = owned_repo.list_rows(
        ctx,
        AIProviderCredential,
        order_by=(col(AIProviderCredential.created_at), col(AIProviderCredential.id)),
        skip=skip,
        limit=limit,
    )
    return {"data": rows, "count": owned_repo.count_rows(ctx, AIProviderCredential)}


def get_credential(ctx: Ctx, *, credential_id: uuid.UUID) -> AIProviderCredential:
    return _require(ctx, credential_id)


def create_credential(ctx: Ctx, *, data: S.CredentialCreate) -> AIProviderCredential:
    base_url = _base_url(data.provider, data.base_url)
    if data.id is not None:
        existing = owned_repo.get(
            ctx, AIProviderCredential, data.id, include_deleted=True
        )
        if existing is not None:
            raise conflict("credential_exists", "A credential with that id exists.")
    cred = AIProviderCredential(
        **ctx.owned(),
        **({"id": data.id} if data.id else {}),
        provider=data.provider,
        label=data.label or next(p.label for p in PRESETS if p.name == data.provider),
        base_url=base_url,
        key_ciphertext=b"",
        key_nonce=b"",
    )
    _seal_onto(ctx, cred, data.api_key.get_secret_value())
    ctx.session.add(cred)
    ctx.session.flush()
    ctx.commit()
    ctx.session.refresh(cred)
    return cred


def update_credential(
    ctx: Ctx, *, credential_id: uuid.UUID, data: S.CredentialUpdate
) -> AIProviderCredential:
    cred = _require(ctx, credential_id)
    fields = data.model_fields_set
    if "label" in fields and data.label is not None:
        cred.label = data.label
    if "base_url" in fields and data.base_url is not None:
        new_url = _base_url(cred.provider, data.base_url)
        if new_url != cred.base_url:
            # Pointing a stored key at a new host would let anyone holding a
            # session send the key there with /verify; a new URL needs the
            # key re-entered in the same request.
            if data.api_key is None:
                raise invalid(
                    "api_key_required",
                    "Re-enter the API key when changing the base URL.",
                )
            cred.base_url = new_url
            cred.verified_at = None
            cred.last_error_code = None
    if data.api_key is not None:
        _seal_onto(ctx, cred, data.api_key.get_secret_value())
    cred.updated_at = ctx.now
    ctx.session.add(cred)
    ctx.session.flush()
    ctx.commit()
    if data.api_key is not None:
        cache.invalidate(cred.id)
    ctx.session.refresh(cred)
    return cred


def delete_credential(ctx: Ctx, *, credential_id: uuid.UUID) -> None:
    """Tombstone the credential, wipe its sealed key and drop every
    assignment that used it (the FK cascade only fires on a hard delete)."""
    cred = _require(ctx, credential_id)
    for a in owned_repo.list_rows(
        ctx, AIModelAssignment, col(AIModelAssignment.credential_id) == cred.id
    ):
        owned_repo.soft_delete(ctx, a)
    cred.key_ciphertext = b""
    cred.key_nonce = b""
    cred.key_last4 = ""
    owned_repo.soft_delete(ctx, cred)
    ctx.commit()
    cache.invalidate(credential_id)


# ---------------------------------------------------------------------------
# Verify and model list (the outbound calls)
# ---------------------------------------------------------------------------


def _open_key(ctx: Ctx, cred: AIProviderCredential) -> str:
    try:
        return crypto.unseal(
            crypto.Sealed(cred.key_ciphertext, cred.key_nonce, cred.key_version),
            owner_id=ctx.user_id,
        )
    except crypto.SecretUnavailable:
        raise conflict(
            "credential_key_unavailable",
            "This key can no longer be read. Enter it again.",
        ) from None


def _call_provider(ctx: Ctx, credential_id: uuid.UUID) -> provider_http.ListOutcome:
    cred = _require(ctx, credential_id)
    provider, base_url, key = cred.provider, cred.base_url, _open_key(ctx, cred)
    # End the read transaction so no pooled connection is held across the
    # outbound call (up to the HTTP timeout).
    ctx.session.commit()
    return provider_http.list_models(provider=provider, base_url=base_url, api_key=key)


def _models_payload(models: list[ModelInfo], truncated: bool) -> dict[str, Any]:
    return {
        "data": [
            {"id": m.id, "name": m.name, "supports_vision": m.supports_vision}
            for m in models
        ],
        "truncated": truncated,
    }


def _record_outcome(
    ctx: Ctx, credential_id: uuid.UUID, code: VerifyCode
) -> AIProviderCredential:
    cred = _require(ctx, credential_id)
    if code == "ok":
        cred.verified_at = ctx.now
        cred.last_error_code = None
    else:
        cred.last_error_code = code
    ctx.session.add(cred)
    ctx.session.flush()
    ctx.commit()
    ctx.session.refresh(cred)
    return cred


def verify_credential(ctx: Ctx, *, credential_id: uuid.UUID) -> dict[str, Any]:
    outcome = _call_provider(ctx, credential_id)
    if outcome.code == "ok":
        cache.put(credential_id, _models_payload(outcome.models, outcome.truncated))
    cred = _record_outcome(ctx, credential_id, outcome.code)
    return {"code": outcome.code, "ok": outcome.code == "ok", "credential": cred}


_UPSTREAM_STATUS: dict[str, int] = {
    "unauthorized": 424,
    "not_found": 424,
    "rate_limited": 429,
    "unreachable": 502,
    "bad_response": 502,
}


def list_models(ctx: Ctx, *, credential_id: uuid.UUID) -> dict[str, Any]:
    _require(ctx, credential_id)
    hit = cache.get(credential_id)
    if hit is not None and isinstance(hit.get("data"), list):
        data = hit["data"]
        return {
            "data": data,
            "count": len(data),
            "truncated": bool(hit.get("truncated")),
            "cached": True,
        }
    outcome = _call_provider(ctx, credential_id)
    if outcome.code != "ok":
        _record_outcome(ctx, credential_id, outcome.code)
        raise domain_error(
            _UPSTREAM_STATUS[outcome.code],
            f"provider_{outcome.code}",
            "The provider did not return its model list.",
            {"code": outcome.code},
        )
    payload = _models_payload(outcome.models, outcome.truncated)
    cache.put(credential_id, payload)
    return {**payload, "count": len(outcome.models), "cached": False}


def _listed_vision(credential_id: uuid.UUID, model: str) -> bool | None:
    hit = cache.get(credential_id)
    if not hit or not isinstance(hit.get("data"), list):
        return None
    for m in hit["data"]:
        if isinstance(m, dict) and m.get("id") == model:
            v = m.get("supports_vision")
            return v if isinstance(v, bool) else None
    return None


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


def list_assignments(ctx: Ctx) -> dict[str, Any]:
    rows = owned_repo.list_rows(
        ctx, AIModelAssignment, order_by=(col(AIModelAssignment.purpose),)
    )
    return {"data": rows, "count": len(rows)}


def put_assignment(
    ctx: Ctx, *, purpose: Purpose, data: S.AssignmentIn
) -> AIModelAssignment:
    _require(ctx, data.credential_id)
    if not vision_allowed(
        purpose,
        claimed=data.supports_vision,
        listed=_listed_vision(data.credential_id, data.model),
    ):
        raise invalid(
            "model_lacks_vision", "The vision purpose needs a model that reads images."
        )
    values = {
        "purpose": purpose,
        "credential_id": data.credential_id,
        "model": data.model,
        "supports_vision": data.supports_vision,
        "updated_at": ctx.now,
    }
    existing = owned_repo.find_one(
        ctx,
        AIModelAssignment,
        col(AIModelAssignment.purpose) == purpose,
        include_deleted=True,
    )
    if existing is None:
        row = owned_repo.insert(ctx, AIModelAssignment, values)
    else:
        # One row per purpose (unique): a tombstoned one is revived.
        row = owned_repo.apply(existing, values)
        row.deleted_at = None
        ctx.session.add(row)
        ctx.session.flush()
    ctx.commit()
    ctx.session.refresh(row)
    return row


def delete_assignment(ctx: Ctx, *, purpose: Purpose) -> None:
    row = owned_repo.find_one(
        ctx, AIModelAssignment, col(AIModelAssignment.purpose) == purpose
    )
    if row is None:
        raise not_found("assignment")
    owned_repo.soft_delete(ctx, row)
    ctx.commit()


# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------


def usage(ctx: Ctx, *, month: str | None) -> dict[str, Any]:
    if month is None:
        first = ctx.today.replace(day=1)
    else:
        first = _parse_month(month)
    start, end = month_window(ctx, first)
    rows = ctx.session.execute(
        sa_select(
            col(AIUsage.purpose),
            col(AIUsage.model),
            func.count(),
            func.count().filter(col(AIUsage.ok).is_(False)),
            func.coalesce(func.sum(AIUsage.input_tokens), 0),
            func.coalesce(func.sum(AIUsage.output_tokens), 0),
            func.coalesce(func.sum(AIUsage.cost_minor), 0),
        )
        .where(
            col(AIUsage.owner_id) == ctx.user_id,
            col(AIUsage.tenant_id) == ctx.tenant_id,
            col(AIUsage.deleted_at).is_(None),
            col(AIUsage.at) >= start,
            col(AIUsage.at) < end,
        )
        .group_by(col(AIUsage.purpose), col(AIUsage.model))
        .order_by(col(AIUsage.purpose), col(AIUsage.model))
    ).all()
    data = [
        {
            "purpose": p,
            "model": m,
            "calls": int(n),
            "failed_calls": int(f),
            "input_tokens": int(i),
            "output_tokens": int(o),
            "cost_minor": int(c),
        }
        for p, m, n, f, i, o, c in rows
    ]
    b = budget(ctx, first)
    return {
        "month": f"{first.year:04d}-{first.month:02d}",
        "data": data,
        "count": len(data),
        "calls": b.calls,
        "spend_minor": b.spend_minor,
        "spend_cap_minor": b.spend_cap_minor,
        "remaining_minor": max(0, b.spend_cap_minor - b.spend_minor),
        "cap_reached": b.cap_reached,
        "ai_enabled": b.ai_enabled,
    }


def _parse_month(month: str) -> date:
    try:
        year, mon = month.split("-")
        if len(year) != 4 or len(mon) != 2:
            raise ValueError
        return date(int(year), int(mon), 1)
    except ValueError:
        raise invalid("month_invalid", "Month must be YYYY-MM.") from None
