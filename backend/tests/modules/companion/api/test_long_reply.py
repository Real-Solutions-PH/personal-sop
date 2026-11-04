"""A reply longer than companion_message.text holds (varchar 8000) is cut to
fit, on a word boundary with a visible "…", and the turn still completes.

Seen in a model comparison: one model wrote a reply over 8,000 characters,
the insert raised, and the whole turn failed."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.modules.companion.models import CompanionMessage
from app.modules.companion.services import fit_message_text
from tests.modules.capture.api.helpers import install, parse_agui, say, user

# 9,000+ characters of whole words: "word0001 word0002 …".
LONG = " ".join(f"word{i:04d}" for i in range(1, 1001))


def test_a_reply_over_8000_characters_is_stored_cut_on_a_word(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert len(LONG) > 8000
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say(LONG))
    r = client.post(
        "/api/v1/companion/ask/stream", headers=api.h, json={"text": "tell me all"}
    )
    assert r.status_code == 200
    events = parse_agui(r.text)
    assert events[-1].get("type") != "RUN_ERROR", events[-1]
    result: dict[str, Any] = events[-1]["result"]
    text = result["messages"][1]["text"]

    assert len(text) <= 8000
    assert text.endswith("…")
    kept = text[: -len("…")]
    # Cut between words: what is kept is a prefix of the reply made of
    # whole words, and the next character of the original is a space.
    assert LONG.startswith(kept)
    assert LONG[len(kept)] == " "
    assert kept.split()[-1].startswith("word")
    assert len(kept.split()[-1]) == len("word0001")
    # Most of the reply survives (not cut to a stub).
    assert len(text) > 7900

    db.expire_all()
    stored = db.exec(
        select(CompanionMessage).where(
            col(CompanionMessage.id) == result["messages"][1]["id"]
        )
    ).one()
    assert stored.text == text


def test_fit_message_text_leaves_a_reply_that_fits_alone() -> None:
    exact = "a" * 8000
    assert fit_message_text(exact) == exact
    assert fit_message_text(None) is None
    assert fit_message_text("") == ""


def test_fit_message_text_cuts_a_run_with_no_spaces_mid_word() -> None:
    out = fit_message_text("x" * 9000)
    assert out is not None
    assert len(out) == 8000 and out.endswith("…")
