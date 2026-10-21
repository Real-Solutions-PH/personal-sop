"""Dictation for the chat box (ADR-0015): a recording in, its words out.

Speech to text is substituted only at ``seams.transcribe`` (G-C-026)."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine as db_engine
from app.modules.ai_providers import public as ai_public
from app.modules.ai_providers.models import AIUsage
from app.modules.capture import seams
from app.modules.capture.models import Capture
from tests.modules.capture.api.helpers import Api, user

# The first bytes of real files: an iPhone m4a (ISO base media) and a WAV.
M4A = b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00M4A mp42isom" + b"\x00" * 200
WAV = b"RIFF\x24\x08\x00\x00WAVEfmt " + b"\x00" * 200


def dictate(api: Api, client: TestClient, audio: bytes, **form: Any) -> Any:
    return client.post(
        "/api/v1/capture/dictate",
        headers=api.h,
        files={"file": ("rec.m4a", audio, "application/octet-stream")},
        data={k: str(v) for k, v in form.items()},
    )


@pytest.fixture
def deepgram(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """The server's Deepgram key, and a transcribe seam that records what it
    was resolved to."""
    monkeypatch.setattr(settings, "AI_SERVER_FALLBACK", True)
    monkeypatch.setattr(settings, "DEEPGRAM_API_KEY", "dg-test-key")
    seen: list[Any] = []

    def fake(resolved: Any, audio: bytes, **kw: Any) -> str:
        del audio
        seen.append((resolved, kw))
        return "add a task to buy milk tomorrow"

    monkeypatch.setattr(seams, "transcribe", fake)
    return seen


def test_dictation_returns_the_words_through_deepgram(
    client: TestClient, db: Session, deepgram: list[Any]
) -> None:
    api = user(client, db, accounts=False)
    r = dictate(api, client, M4A, duration_sec=4)
    assert r.status_code == 200, r.text
    assert r.json() == {"text": "add a task to buy milk tomorrow"}
    resolved, kw = deepgram[0]
    assert (resolved.provider, resolved.model) == ("deepgram", "nova-3")
    assert kw["mime"] == "audio/mp4"  # sniffed, not the declared type
    with Session(db_engine) as s:
        rows = s.exec(
            select(AIUsage).where(AIUsage.owner_id == api.user.id)  # type: ignore[attr-defined]
        ).all()
        caps = s.exec(
            select(Capture).where(Capture.owner_id == api.user.id)  # type: ignore[attr-defined]
        ).all()
    assert [(u.purpose, u.ok) for u in rows] == [("transcription", True)]
    assert caps == []  # dictation stores nothing but its usage
    assert "dg-test-key" not in r.text


def test_the_users_own_transcription_credential_comes_first(
    client: TestClient, db: Session, deepgram: list[Any]
) -> None:
    api = user(client, db, accounts=False)
    api.assign("transcription")
    assert dictate(api, client, WAV).status_code == 200
    assert deepgram[0][0].provider != "deepgram"


def test_without_any_speech_to_text_it_says_so(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "DEEPGRAM_API_KEY", None)
    api = user(client, db, accounts=False)
    r = dictate(api, client, M4A)
    assert r.status_code == 503
    assert r.json()["code"] == "speech_unavailable"


def test_bytes_that_are_not_audio_are_refused_before_any_call(
    client: TestClient, db: Session, deepgram: list[Any]
) -> None:
    api = user(client, db, accounts=False)
    r = dictate(api, client, b"%PDF-1.7 not a recording" + b"\x00" * 64)
    assert r.status_code == 422 and r.json()["code"] == "audio_unrecognised"
    r = dictate(api, client, M4A, duration_sec=600)
    assert r.status_code == 413 and r.json()["code"] == "audio_too_long"
    assert deepgram == []


@pytest.mark.usefixtures("deepgram")
def test_silence_is_an_error_not_an_empty_message(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(seams, "transcribe", lambda *a, **k: "")
    api = user(client, db, accounts=False)
    r = dictate(api, client, M4A)
    assert r.status_code == 422 and r.json()["code"] == "transcript_empty"


@pytest.mark.usefixtures("deepgram")
def test_a_provider_failure_is_a_stable_code(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(*_: Any, **__: Any) -> str:
        raise seams.SeamError("transcription_unreachable")

    monkeypatch.setattr(seams, "transcribe", boom)
    api = user(client, db, accounts=False)
    r = dictate(api, client, M4A)
    assert r.status_code == 502
    assert r.json()["code"] == "transcription_unreachable"


def test_deepgram_is_the_servers_transcription_default_only_with_its_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "DEEPGRAM_API_KEY", None)
    monkeypatch.setattr(settings, "DEFAULT_LLM_PROVIDER", "nebius")
    monkeypatch.setattr(settings, "NEBIUS_API_KEY", "nb")
    assert ai_public._server_default("transcription") is None
    monkeypatch.setattr(settings, "DEEPGRAM_API_KEY", "dg")
    got = ai_public._server_default("transcription")
    assert got is not None and got.provider == "deepgram"
    chat = ai_public._server_default("chat")
    assert chat is not None and chat.provider == "nebius"
