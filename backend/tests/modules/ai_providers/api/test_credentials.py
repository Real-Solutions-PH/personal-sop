"""Presets, credential CRUD, the write-only key, verify and the model list."""

import base64
import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.db import engine
from app.modules.ai_providers import cache
from app.modules.ai_providers.models import AIModelAssignment, AIProviderCredential
from app.modules.ai_providers.routes import router
from tests.modules.ai_providers.api.helpers import AI, Provider, provider
from tests.utils.mobile import signed_in

__all__ = ["provider"]

KEY = "sk-live-SECRET-9f8e7d6c5b4a"


def _ai(client: TestClient, db: Session) -> AI:
    _, headers = signed_in(db)
    return AI(client, headers)


def _row(cred_id: str) -> AIProviderCredential:
    with Session(engine) as s:
        row = s.get(AIProviderCredential, uuid.UUID(cred_id))
        assert row is not None
        s.expunge(row)
        return row


def _secrets_in(texts: list[str], key: str, row: AIProviderCredential) -> list[str]:
    needles = [key, key[:-4]]
    if row.key_ciphertext:
        needles += [
            base64.b64encode(row.key_ciphertext).decode(),
            row.key_ciphertext.hex(),
        ]
    return [t for t in texts for n in needles if n in t]


def test_presets(client: TestClient, db: Session) -> None:
    ai = _ai(client, db)
    out = ai.get("/providers/presets")
    by_name = {p["name"]: p for p in out["data"]}
    assert out["count"] == 8 == len(by_name)
    assert by_name["openrouter"]["default_base_url"] == "https://openrouter.ai/api/v1"
    assert by_name["openrouter"]["custom_base_url"] is False
    assert by_name["custom"] == {
        **by_name["custom"],
        "default_base_url": None,
        "custom_base_url": True,
    }
    assert all(p["vision_models"] for p in out["data"])


def test_crud_happy_path(client: TestClient, db: Session) -> None:
    ai = _ai(client, db)
    cid = str(uuid.uuid4())
    created = ai.credential("openrouter", KEY, id=cid, label="Mine")
    assert created["id"] == cid
    assert created["provider"] == "openrouter"
    assert created["base_url"] == "https://openrouter.ai/api/v1"
    assert created["key_last4"] == "5b4a"
    assert created["verified_at"] is None and created["last_error_code"] is None

    custom = ai.credential(
        "custom", "ollama-key", base_url="http://localhost:11434/v1/"
    )
    assert custom["base_url"] == "http://localhost:11434/v1"
    assert custom["label"] == "Custom (OpenAI-compatible)"

    listed = ai.get("/providers")
    assert listed["count"] == 2
    assert [c["id"] for c in listed["data"]] == [cid, custom["id"]]
    assert ai.get("/providers", limit=1)["data"][0]["id"] == cid
    assert ai.get("/providers", skip=1, limit=1)["data"][0]["id"] == custom["id"]
    ai.get("/providers", status=422, limit=101)
    ai.get("/providers", status=422, skip=-1)

    renamed = ai.patch(f"/providers/{cid}", {"label": "Work"})
    assert renamed["label"] == "Work" and renamed["key_last4"] == "5b4a"
    assert ai.get(f"/providers/{cid}")["label"] == "Work"

    ai.delete(f"/providers/{cid}")
    ai.get(f"/providers/{cid}", status=404)
    assert ai.get("/providers")["count"] == 1
    # The tombstone keeps no key material.
    row = _row(cid)
    assert row.deleted_at is not None
    assert row.key_ciphertext == b"" and row.key_last4 == ""


def test_create_validation(client: TestClient, db: Session) -> None:
    ai = _ai(client, db)
    ai.post("/providers", {"provider": "openai"}, status=422)
    ai.post("/providers", {"provider": "nope", "api_key": KEY}, status=422)
    ai.post("/providers", {"provider": "openai", "api_key": "has space"}, status=422)
    ai.post("/providers", {"provider": "openai", "api_key": KEY, "x": 1}, status=422)
    err = ai.post(
        "/providers",
        {"provider": "openai", "api_key": KEY, "base_url": "https://x.test"},
        status=422,
    )
    assert err["code"] == "base_url_not_allowed"
    assert (
        ai.post("/providers", {"provider": "custom", "api_key": KEY}, status=422)[
            "code"
        ]
        == "base_url_required"
    )
    for url, code in [
        ("http://api.example.com/v1", "base_url_scheme"),
        ("https://u:p@api.example.com/v1", "base_url_userinfo"),
        ("https://api.example.com/v1?k=1", "base_url_invalid"),
    ]:
        body = {"provider": "custom", "api_key": KEY, "base_url": url}
        err = ai.post("/providers", body, status=422)
        assert err["code"] == code
        assert url not in str(err)
    cid = ai.credential(key=KEY)["id"]
    assert (
        ai.post(
            "/providers", {"id": cid, "provider": "openai", "api_key": KEY}, status=409
        )["code"]
        == "credential_exists"
    )


def test_key_never_appears_in_any_response_or_error(
    client: TestClient, db: Session, provider: Provider
) -> None:
    ai = _ai(client, db)
    cred = ai.credential("custom", KEY, base_url="https://llm.example.com/v1")
    cid = cred["id"]
    ai.get("/providers")
    ai.get(f"/providers/{cid}")
    ai.patch(f"/providers/{cid}", {"label": "x"})
    # Error paths that carry the key in the request body.
    ai.post("/providers", {"provider": "openai", "api_key": KEY + " x"}, status=422)
    ai.post("/providers", {"provider": "bad", "api_key": KEY}, status=422)
    ai.patch(f"/providers/{cid}", {"api_key": KEY, "zzz": KEY}, status=422)
    ai.patch(f"/providers/{uuid.uuid4()}", {"api_key": KEY}, status=404)
    ai.patch(
        f"/providers/{cid}", {"base_url": "https://other.example.com/v1"}, status=422
    )
    # Provider answers that echo the key.
    for status in (200, 401, 404, 429, 500):
        provider.respond = lambda r, s=status: httpx.Response(
            s, json={"error": {"message": f"Incorrect API key provided: {KEY}"}}
        )
        ai.post(f"/providers/{cid}/verify")
        cache.invalidate(uuid.UUID(cid))
        ai.get(
            f"/providers/{cid}/models",
            status={200: 502, 401: 424, 404: 424, 429: 429, 500: 502}[status],
        )
    provider.respond = lambda r: httpx.Response(200, json={"data": [{"id": "m"}]})
    ai.post(f"/providers/{cid}/verify")
    ai.get(f"/providers/{cid}/models")
    ai.put("/assignments/chat", {"credential_id": cid, "model": "m"})
    ai.get("/assignments")
    ai.get("/usage")
    ai.patch(f"/providers/{cid}", {"api_key": KEY + "2"})
    ai.delete(f"/providers/{cid}")

    # The provider did receive the key (so the needle is real) ...
    assert any(r.headers.get("authorization") == f"Bearer {KEY}" for r in provider.seen)
    # ... and no response, success or error, ever carried it or the ciphertext.
    assert len(ai.texts) > 20
    row = _row(cid)
    leaks = _secrets_in(ai.texts, KEY, row)
    assert leaks == []
    for text in ai.texts:
        assert "ciphertext" not in text and "key_nonce" not in text
        # A validation error may NAME the field in its loc; no body ever
        # carries an api_key value.
        assert '"api_key":' not in text


def _fields(model: type[BaseModel], seen: set[type[BaseModel]]) -> set[str]:
    if model in seen:
        return set()
    seen.add(model)
    names: set[str] = set()
    for name, field in model.model_fields.items():
        names.add(name)
        ann: Any = field.annotation
        for arg in (ann, *getattr(ann, "__args__", ())):
            for inner in (arg, *getattr(arg, "__args__", ())):
                if isinstance(inner, type) and issubclass(inner, BaseModel):
                    names |= _fields(inner, seen)
    return names


def test_no_response_schema_declares_a_key_field() -> None:
    routes = [r for r in router.routes if getattr(r, "response_model", None)]
    assert len(routes) == 10
    for r in routes:
        names = _fields(r.response_model, set())  # type: ignore[attr-defined]
        assert names, r.path  # type: ignore[attr-defined]
        assert not {n for n in names if "cipher" in n or "nonce" in n or n == "api_key"}


def test_other_users_credential_is_404(
    client: TestClient, db: Session, provider: Provider
) -> None:
    a, b = _ai(client, db), _ai(client, db)
    cid = a.credential(key=KEY)["id"]
    b.get(f"/providers/{cid}", status=404)
    b.patch(f"/providers/{cid}", {"label": "mine"}, status=404)
    b.patch(f"/providers/{cid}", {"api_key": "sk-other-key-1234"}, status=404)
    b.delete(f"/providers/{cid}", status=404)
    b.post(f"/providers/{cid}/verify", status=404)
    b.get(f"/providers/{cid}/models", status=404)
    b.put("/assignments/chat", {"credential_id": cid, "model": "m"}, status=404)
    assert b.get("/providers")["count"] == 0
    assert provider.seen == []
    assert a.get(f"/providers/{cid}")["label"] == "OpenAI"
    # A's id cannot be reused by B either.
    b.post("/providers", {"id": cid, "provider": "openai", "api_key": KEY}, status=409)


def test_verify_maps_every_outcome(
    client: TestClient, db: Session, provider: Provider
) -> None:
    ai = _ai(client, db)
    cid = ai.credential("groq", KEY)["id"]
    cases: list[tuple[Any, str]] = [
        (lambda r: httpx.Response(401), "unauthorized"),
        (lambda r: httpx.Response(404), "not_found"),
        (lambda r: httpx.Response(429), "rate_limited"),
        (lambda r: httpx.Response(200, content=b"<html>"), "bad_response"),
        (lambda r: httpx.Response(503), "bad_response"),
    ]

    def down(_r: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    cases.append((down, "unreachable"))
    for respond, code in cases:
        provider.respond = respond
        out = ai.post(f"/providers/{cid}/verify")
        assert (out["code"], out["ok"]) == (code, False)
        assert out["credential"]["last_error_code"] == code
        assert out["credential"]["verified_at"] is None
    provider.respond = lambda r: httpx.Response(200, json={"data": []})
    out = ai.post(f"/providers/{cid}/verify")
    assert out["code"] == "ok" and out["ok"] is True
    assert out["credential"]["verified_at"] is not None
    assert out["credential"]["last_error_code"] is None
    req = provider.seen[-1]
    assert str(req.url) == "https://api.groq.com/openai/v1/models"
    assert req.headers["authorization"] == f"Bearer {KEY}"


def test_models_cached_and_invalidated_on_key_change(
    client: TestClient, db: Session, provider: Provider
) -> None:
    ai = _ai(client, db)
    cid = ai.credential("openrouter", KEY)["id"]
    provider.respond = lambda r: httpx.Response(
        200,
        json={
            "data": [
                {
                    "id": "openai/gpt-4o-mini",
                    "name": "GPT-4o mini",
                    "architecture": {"input_modalities": ["text", "image"]},
                },
                {"id": "z/text", "architecture": {"input_modalities": ["text"]}},
            ]
        },
    )
    first = ai.get(f"/providers/{cid}/models")
    assert first["cached"] is False and first["count"] == 2
    assert first["data"] == [
        {"id": "openai/gpt-4o-mini", "name": "GPT-4o mini", "supports_vision": True},
        {"id": "z/text", "name": "z/text", "supports_vision": False},
    ]
    second = ai.get(f"/providers/{cid}/models")
    assert second["cached"] is True and second["data"] == first["data"]
    assert len(provider.seen) == 1
    # A label change keeps the cache; a key change drops it.
    ai.patch(f"/providers/{cid}", {"label": "renamed"})
    assert ai.get(f"/providers/{cid}/models")["cached"] is True
    ai.patch(f"/providers/{cid}", {"api_key": "sk-new-key-11112222"})
    provider.respond = lambda r: httpx.Response(200, json={"data": [{"id": "only"}]})
    third = ai.get(f"/providers/{cid}/models")
    assert third["cached"] is False and [m["id"] for m in third["data"]] == ["only"]
    assert provider.seen[-1].headers["authorization"] == "Bearer sk-new-key-11112222"
    assert len(provider.seen) == 2


@pytest.mark.usefixtures("provider")
def test_key_replacement_resets_verification(client: TestClient, db: Session) -> None:
    ai = _ai(client, db)
    cid = ai.credential("custom", KEY, base_url="https://llm.example.com/v1")["id"]
    assert ai.post(f"/providers/{cid}/verify")["ok"] is True
    before = _row(cid)
    out = ai.patch(f"/providers/{cid}", {"api_key": "sk-replaced-key-7777"})
    assert out["key_last4"] == "7777" and out["verified_at"] is None
    after = _row(cid)
    assert after.key_ciphertext != before.key_ciphertext
    assert after.key_nonce != before.key_nonce
    # Moving the key to a new host needs the key re-entered in the same call.
    err = ai.patch(
        f"/providers/{cid}", {"base_url": "https://evil.example.com/v1"}, status=422
    )
    assert err["code"] == "api_key_required"
    assert _row(cid).base_url == "https://llm.example.com/v1"
    moved = ai.patch(
        f"/providers/{cid}",
        {"base_url": "https://new.example.com/v1", "api_key": "sk-for-new-host-1"},
    )
    assert moved["base_url"] == "https://new.example.com/v1"
    # A preset's URL is fixed.
    pid = ai.credential("openai", KEY)["id"]
    assert (
        ai.patch(
            f"/providers/{pid}",
            {"base_url": "https://x.example.com", "api_key": KEY},
            status=422,
        )["code"]
        == "base_url_not_allowed"
    )


@pytest.mark.usefixtures("provider")
def test_delete_cascades_assignments(client: TestClient, db: Session) -> None:
    ai = _ai(client, db)
    keep = ai.credential("openai", KEY)["id"]
    drop = ai.credential("groq", KEY)["id"]
    ai.put("/assignments/chat", {"credential_id": drop, "model": "llama"})
    ai.put(
        "/assignments/vision",
        {"credential_id": drop, "model": "llava", "supports_vision": True},
    )
    ai.put("/assignments/advisor", {"credential_id": keep, "model": "gpt-4o"})
    assert ai.get("/assignments")["count"] == 3
    ai.delete(f"/providers/{drop}")
    left = ai.get("/assignments")
    assert [(a["purpose"], a["credential_id"]) for a in left["data"]] == [
        ("advisor", keep)
    ]
    with Session(engine) as s:
        dead = s.exec(
            select(AIModelAssignment).where(
                AIModelAssignment.credential_id == uuid.UUID(drop)
            )
        ).all()
        assert len(dead) == 2 and all(a.deleted_at is not None for a in dead)
    # The purpose can be assigned again (the tombstone is revived).
    again = ai.put("/assignments/chat", {"credential_id": keep, "model": "gpt-4o"})
    assert again["id"] in {str(a.id) for a in dead}


@pytest.mark.parametrize("purpose", ["chat", "capture", "transcription", "advisor"])
def test_non_vision_purposes_accept_any_model(
    client: TestClient, db: Session, purpose: str
) -> None:
    ai = _ai(client, db)
    cid = ai.credential()["id"]
    out = ai.put(f"/assignments/{purpose}", {"credential_id": cid, "model": "m"})
    assert out["purpose"] == purpose and out["supports_vision"] is False


def test_assignments_and_the_vision_rule(
    client: TestClient, db: Session, provider: Provider
) -> None:
    ai = _ai(client, db)
    cid = ai.credential("openrouter", KEY)["id"]
    err = ai.put(
        "/assignments/vision", {"credential_id": cid, "model": "llava"}, status=422
    )
    assert err["code"] == "model_lacks_vision"
    ai.put("/assignments/bogus", {"credential_id": cid, "model": "m"}, status=422)
    ai.put(
        "/assignments/chat",
        {"credential_id": str(uuid.uuid4()), "model": "m"},
        status=404,
    )
    ok = ai.put(
        "/assignments/vision",
        {"credential_id": cid, "model": "openai/gpt-4o", "supports_vision": True},
    )
    assert ok["purpose"] == "vision" and ok["supports_vision"] is True
    # When the provider's own list says the model takes no images, the claim
    # is refused.
    provider.respond = lambda r: httpx.Response(
        200,
        json={
            "data": [{"id": "z/text", "architecture": {"input_modalities": ["text"]}}]
        },
    )
    ai.get(f"/providers/{cid}/models")
    err = ai.put(
        "/assignments/vision",
        {"credential_id": cid, "model": "z/text", "supports_vision": True},
        status=422,
    )
    assert err["code"] == "model_lacks_vision"
    # PUT replaces in place (one row per purpose).
    upd = ai.put(
        "/assignments/vision",
        {
            "credential_id": cid,
            "model": "google/gemini-2.5-flash",
            "supports_vision": True,
        },
    )
    assert upd["id"] == ok["id"] and upd["model"] == "google/gemini-2.5-flash"
    ai.delete("/assignments/vision")
    ai.delete("/assignments/vision", status=404)
    assert ai.get("/assignments")["count"] == 0
