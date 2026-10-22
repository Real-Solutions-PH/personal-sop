"""Fern's replies read aloud: only a stored reply of the caller's, through
the one speech seam, metered."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine as db_engine
from app.modules.ai_providers.models import AIUsage
from app.modules.capture import seams
from app.modules.companion.models import CompanionMessage
from tests.modules.capture.api.helpers import user
from tests.utils.mobile import ctx_for

API = "/api/v1/companion/messages"


def _reply(api: object, text: str | None, role: str = "sol") -> uuid.UUID:
    from app.shared import owned_repo

    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        row = owned_repo.insert(
            ctx, CompanionMessage, {"role": role, "text": text, "blocks": []}
        )
        ctx.commit()
        return row.id


def test_a_reply_is_read_aloud_and_metered(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    monkeypatch.setattr(settings, "DEEPGRAM_API_KEY", "dg-test")
    said: list[str] = []

    def fake(_resolved: object, text: str) -> bytes:
        said.append(text)
        return b"ID3mp3-bytes"

    monkeypatch.setattr(seams, "speak", fake)
    mid = _reply(api, "Logged ₱285 at Jollibee.")
    r = client.post(f"{API}/{mid}/speech", headers=api.h)
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.content == b"ID3mp3-bytes"
    assert said == ["Logged ₱285 at Jollibee."]
    with Session(db_engine) as s:
        rows = s.exec(
            select(AIUsage).where(AIUsage.owner_id == api.user.id)  # type: ignore[attr-defined]
        ).all()
    assert [(u.model, u.input_tokens, u.ok) for u in rows] == [
        (settings.DEEPGRAM_TTS_MODEL, len("Logged ₱285 at Jollibee."), True)
    ]
    assert rows[0].cost_minor >= 1


def test_only_fern_replies_with_text_can_be_spoken(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    monkeypatch.setattr(settings, "DEEPGRAM_API_KEY", "dg-test")
    monkeypatch.setattr(seams, "speak", lambda *a: b"x")
    mine = _reply(api, "my own words", role="me")
    assert client.post(f"{API}/{mine}/speech", headers=api.h).status_code == 404
    empty = _reply(api, None)
    assert client.post(f"{API}/{empty}/speech", headers=api.h).status_code == 422
    other = user(client, db)
    theirs = _reply(other, "not yours")
    assert client.post(f"{API}/{theirs}/speech", headers=api.h).status_code == 404


def test_no_voice_set_up_says_so(client: TestClient, db: Session) -> None:
    api = user(client, db)
    mid = _reply(api, "Hello")
    r = client.post(f"{API}/{mid}/speech", headers=api.h)
    assert r.status_code == 503 and r.json()["code"] == "speech_unavailable"


def test_long_replies_are_spoken_in_pieces_under_the_limit() -> None:
    text = ("This is one sentence of a long reply. " * 120).strip()
    pieces = seams._chunks(text)
    assert len(pieces) > 1
    assert all(len(p) <= seams.SPEAK_CHUNK for p in pieces)
    assert " ".join(pieces) == text
