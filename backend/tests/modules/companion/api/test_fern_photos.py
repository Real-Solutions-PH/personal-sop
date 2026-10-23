"""Photos sent with a Fern message: read into text by the vision model,
then acted on by Fern's usual tools in the same turn."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.finance.models import FinRecord
from tests.modules.capture.api.helpers import (
    FakeStorage,
    call,
    install,
    media,
    parse_agui,
    say,
    storage,
    user,
)
from tests.modules.media.test_sniff import JPEG

__all__ = ["storage"]


def ask(client: TestClient, api: Any, body: dict[str, Any]) -> list[dict[str, Any]]:
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json=body)
    assert r.status_code == 200, r.text
    return parse_agui(r.text)


def test_photos_with_a_message_are_read_then_recorded(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    api = user(client, db)
    api.assign("chat")
    api.assign("vision", vision=True)
    model = install(
        monkeypatch,
        say("1. Receipt: Jollibee, PHP 285.00, 2026-10-22."),
        say("", call("log_expense", amount=285, payee="Jollibee", category="dining")),
        say("Logged ₱285 at Jollibee."),
    )
    ids = [
        media(api, storage, kind="image", mime="image/jpeg", data=JPEG)  # type: ignore[arg-type]
        for _ in range(2)
    ]
    events = ask(client, api, {"text": "log this", "media_ids": ids})
    # One request to the vision model carried both photos.
    reader = model.seen[0][-1].content
    assert [p["type"] for p in reader[1:]] == ["image_url", "image_url"]
    # Fern saw what the photos show, next to what the person typed.
    fern_in = str(model.seen[1][-1].content)
    assert "log this" in fern_in and "Jollibee, PHP 285" in fern_in
    with Session(db_engine) as s:
        rows = s.exec(
            select(FinRecord).where(FinRecord.owner_id == api.user.id)  # type: ignore[attr-defined]
        ).all()
    assert [r.amount_minor for r in rows] == [28500]
    me = next(
        e["value"]
        for e in events
        if e.get("type") == "CUSTOM" and e.get("name") == "message"
    )
    [block] = me["blocks"]
    assert block["t"] == "photos" and len(block["urls"]) == 2
    steps = [e for e in events if e.get("type") == "TOOL_CALL_START"]
    assert steps[0]["toolCallName"] == "read_photos"


def test_photos_alone_are_a_message(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    api = user(client, db)
    api.assign("chat")
    api.assign("vision", vision=True)
    install(monkeypatch, say("A gym whiteboard: 5x5 squat."), say("Nice board."))
    mid = media(api, storage, kind="image", mime="image/jpeg", data=JPEG)  # type: ignore[arg-type]
    ask(client, api, {"text": "", "media_ids": [mid]})


def test_an_empty_message_is_refused(client: TestClient, db: Session) -> None:
    api = user(client, db)
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": "  "})
    assert r.status_code == 422


def test_a_photo_can_be_read_again_and_its_reading_stays_in_the_chat(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    """Seen live: asked to re-check a label, Fern could neither see the
    photo again nor what it had shown, and searched the web instead."""
    from uuid import uuid4

    from app.modules.capture.public import CAREFUL

    api = user(client, db)
    api.assign("chat")
    api.assign("vision", vision=True)
    thread = str(uuid4())
    install(
        monkeypatch,
        say("Nutrition facts: 6 kcal per 240 mL serving."),
        say("Noted the drink."),
    )
    ids = [media(api, storage, kind="image", mime="image/jpeg", data=JPEG)]  # type: ignore[arg-type]
    ask(client, api, {"text": "what's in this?", "media_ids": ids, "thread_id": thread})

    model = install(
        monkeypatch,
        say("", call("reread_photos")),
        say("Nutrition facts: 10 kcal per 355 mL can."),
        say("On a closer read it's 10 kcal per can."),
    )
    events = ask(
        client, api, {"text": "re-check that label please", "thread_id": thread}
    )
    # The chat still holds what the photo showed the first time.
    first = [str(m.content) for m in model.seen[0]]
    assert any("6 kcal per 240 mL" in c for c in first)
    # The photo was read again, carefully.
    assert str(model.seen[1][0].content).endswith(CAREFUL)
    steps = events[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert steps[0]["summary"] == "Read 1 photo again"
