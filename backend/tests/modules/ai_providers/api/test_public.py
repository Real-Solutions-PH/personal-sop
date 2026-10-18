"""The cross-module seam: resolve_model, sealing per user, check_budget, and
the usage report."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.modules.ai_providers import public
from app.modules.ai_providers.models import AIProviderCredential
from app.modules.capture.models import AISettings
from app.modules.iam.users.models import User
from app.shared import owned_repo
from tests.modules.ai_providers.api.helpers import AI, Provider, provider
from tests.utils.mobile import ctx_for, signed_in

__all__ = ["provider"]

KEY = "sk-user-a-SECRET-55667788"


def _user(client: TestClient, db: Session) -> tuple[User, AI]:
    user, headers = signed_in(db)
    return user, AI(client, headers)


def _settings(user: User, **values: object) -> None:
    with ctx_for(user) as ctx:
        row = owned_repo.find_one(ctx, AISettings)
        if row is None:
            owned_repo.insert(ctx, AISettings, dict(values))
        else:
            owned_repo.apply(row, dict(values))
            ctx.session.add(row)
        ctx.session.commit()


def _spend(user: User, cost: int, at: datetime | None = None, **kw: object) -> None:
    with ctx_for(user, now=at) as ctx:
        resolved = public.ResolvedModel(
            purpose=kw.get("purpose", "chat"),  # type: ignore[arg-type]
            provider="openai",
            model=str(kw.get("model", "gpt-4o")),
            base_url="https://api.openai.com/v1",
            api_key=public.SecretStr("unused"),
            credential_id=None,
            supports_vision=False,
            source="user",
        )
        public.record_usage(
            ctx,
            resolved,
            input_tokens=int(kw.get("inp", 10)),  # type: ignore[call-overload]
            output_tokens=int(kw.get("out", 5)),  # type: ignore[call-overload]
            cost_minor=cost,
            ok=bool(kw.get("ok", True)),
        )
        ctx.session.commit()


def test_resolve_model_picks_the_users_assignment(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AI_SERVER_FALLBACK", False)
    user, ai = _user(client, db)
    cid = ai.credential("custom", KEY, base_url="https://llm.example.com/v1")["id"]
    ai.put(
        "/assignments/vision",
        {"credential_id": cid, "model": "llava", "supports_vision": True},
    )
    with ctx_for(user) as ctx:
        got = public.resolve_model(ctx, "vision")
        assert got is not None
        assert (got.provider, got.model, got.base_url, got.source) == (
            "custom",
            "llava",
            "https://llm.example.com/v1",
            "user",
        )
        assert got.api_key.get_secret_value() == KEY
        assert got.credential_id == uuid.UUID(cid)
        assert got.supports_vision is True
        # No assignment for chat and fallback off -> None (the rules engine).
        assert public.resolve_model(ctx, "chat") is None
    # Deleting the credential removes the resolution too.
    ai.delete(f"/providers/{cid}")
    with ctx_for(user) as ctx:
        assert public.resolve_model(ctx, "vision") is None


def test_server_fallback_only_when_switched_on(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user, _ = _user(client, db)
    monkeypatch.setattr(settings, "DEFAULT_LLM_PROVIDER", "openrouter")
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "server-key")
    monkeypatch.setattr(settings, "AI_SERVER_FALLBACK", False)
    with ctx_for(user) as ctx:
        assert public.resolve_model(ctx, "chat") is None
    monkeypatch.setattr(settings, "AI_SERVER_FALLBACK", True)
    with ctx_for(user) as ctx:
        got = public.resolve_model(ctx, "chat")
        assert got is not None and got.source == "server"
        assert got.credential_id is None


def test_a_key_sealed_for_a_does_not_open_as_b(
    client: TestClient,
    db: Session,
    provider: Provider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "AI_SERVER_FALLBACK", False)
    user_a, a = _user(client, db)
    user_b, b = _user(client, db)
    a_cred = a.credential("openai", KEY)["id"]
    b_cred = b.credential("openai", "sk-user-b-own-key-0000")["id"]
    b.put("/assignments/chat", {"credential_id": b_cred, "model": "gpt-4o"})
    # Copy A's sealed key bytes onto B's row (a row-swap attack in the DB).
    with Session(engine) as s:
        a_row = s.get(AIProviderCredential, uuid.UUID(a_cred))
        b_row = s.get(AIProviderCredential, uuid.UUID(b_cred))
        assert a_row is not None and b_row is not None
        b_row.key_ciphertext = a_row.key_ciphertext
        b_row.key_nonce = a_row.key_nonce
        s.add(b_row)
        s.commit()
    with ctx_for(user_b) as ctx:
        assert public.resolve_model(ctx, "chat") is None
    err = b.post(f"/providers/{b_cred}/verify", status=409)
    assert err["code"] == "credential_key_unavailable"
    assert provider.seen == []
    # A's own key still opens for A.
    with ctx_for(user_a) as ctx:
        row = owned_repo.require(
            ctx, AIProviderCredential, uuid.UUID(a_cred), what="credential"
        )
        sealed = public.crypto.Sealed(
            row.key_ciphertext, row.key_nonce, row.key_version
        )
        assert public.crypto.unseal(sealed, owner_id=user_a.id) == KEY
        with pytest.raises(public.crypto.SecretUnavailable):
            public.crypto.unseal(sealed, owner_id=user_b.id)


def test_check_budget_refuses_over_the_cap_and_when_disabled(
    client: TestClient, db: Session
) -> None:
    user, _ = _user(client, db)
    # No settings row: defaults (enabled, cap 50_000) and no spend -> allowed.
    with ctx_for(user) as ctx:
        public.check_budget(ctx)
    _settings(user, spend_cap_minor=1_000)
    _spend(user, 600)
    with ctx_for(user) as ctx:
        public.check_budget(ctx)
    _spend(user, 399)
    with ctx_for(user) as ctx:
        public.check_budget(ctx)  # 999 < 1000
    _spend(user, 1)
    with ctx_for(user) as ctx, pytest.raises(HTTPException) as exc:
        public.check_budget(ctx)
    assert exc.value.status_code == 402
    assert exc.value.detail["code"] == "ai_spend_cap_reached"  # type: ignore[index]
    # Raising the cap lifts the refusal.
    _settings(user, spend_cap_minor=1_001)
    with ctx_for(user) as ctx:
        public.check_budget(ctx)
    # Switching AI off refuses with 403 whatever the spend.
    _settings(user, ai_enabled=False)
    with ctx_for(user) as ctx, pytest.raises(HTTPException) as exc:
        public.check_budget(ctx)
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "ai_disabled"  # type: ignore[index]


def test_last_months_spend_does_not_count(client: TestClient, db: Session) -> None:
    user, _ = _user(client, db)
    _settings(user, spend_cap_minor=100)
    with ctx_for(user) as ctx:
        start, _ = public.month_window(ctx, ctx.today)
    _spend(user, 500, at=start - timedelta(seconds=1))
    with ctx_for(user) as ctx:
        public.check_budget(ctx)
    _spend(user, 100, at=start)
    with ctx_for(user) as ctx, pytest.raises(HTTPException):
        public.check_budget(ctx)


def test_usage_report(client: TestClient, db: Session) -> None:
    user, ai = _user(client, db)
    _settings(user, spend_cap_minor=10_000)
    # 2026-03 in Asia/Manila (the default zone, day start hour from DayClock).
    with ctx_for(user) as ctx:
        from datetime import date

        start, end = public.month_window(ctx, date(2026, 3, 1))
    _spend(user, 100, at=start, purpose="chat", model="a", inp=10, out=1)
    _spend(user, 50, at=start + timedelta(days=3), purpose="chat", model="a", ok=False)
    _spend(user, 70, at=end - timedelta(seconds=1), purpose="vision", model="v")
    _spend(user, 999, at=end, purpose="chat", model="a")  # April
    _spend(user, 999, at=start - timedelta(seconds=1), purpose="chat", model="a")
    out = ai.get("/usage", month="2026-03")
    assert out["month"] == "2026-03"
    assert out["data"] == [
        {
            "purpose": "chat",
            "model": "a",
            "calls": 2,
            "failed_calls": 1,
            "input_tokens": 20,
            "output_tokens": 6,
            "cost_minor": 150,
        },
        {
            "purpose": "vision",
            "model": "v",
            "calls": 1,
            "failed_calls": 0,
            "input_tokens": 10,
            "output_tokens": 5,
            "cost_minor": 70,
        },
    ]
    assert (out["count"], out["calls"], out["spend_minor"]) == (2, 3, 220)
    assert (out["spend_cap_minor"], out["remaining_minor"]) == (10_000, 9_780)
    assert out["cap_reached"] is False and out["ai_enabled"] is True
    # Default month is the current one; nothing spent there.
    now = ai.get("/usage")
    with ctx_for(user) as ctx:
        assert now["month"] == ctx.today.strftime("%Y-%m")
    assert now["data"] == [] and now["spend_minor"] == 0
    ai.get("/usage", status=422, month="2026-13")
    ai.get("/usage", status=422, month="2026-3")
    ai.get("/usage", status=422, month="march")


def test_usage_is_per_user(client: TestClient, db: Session) -> None:
    user_a, a = _user(client, db)
    _, b = _user(client, db)
    _spend(user_a, 123, at=datetime.now(timezone.utc))
    assert a.get("/usage")["spend_minor"] == 123
    assert b.get("/usage")["spend_minor"] == 0


def test_requires_a_session(client: TestClient) -> None:
    for method, path in [
        ("GET", "/providers"),
        ("POST", "/providers"),
        ("GET", "/providers/presets"),
        ("PUT", "/assignments/chat"),
        ("GET", "/usage"),
    ]:
        r = client.request(method, f"{settings.API_V1_STR}/ai{path}")
        assert r.status_code == 401, (method, path)
