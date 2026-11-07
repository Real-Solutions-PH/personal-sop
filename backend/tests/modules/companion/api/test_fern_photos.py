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
        # One reading per photo: each photo goes to the reader on its own.
        say("1. Receipt: Jollibee, PHP 285.00, 2026-10-22."),
        say("1. Receipt: Jollibee, PHP 285.00, 2026-10-22."),
        say("", call("log_expense", amount=285, payee="Jollibee", category="dining")),
        say("Logged ₱285 at Jollibee."),
    )
    ids = [
        media(api, storage, kind="image", mime="image/jpeg", data=JPEG)  # type: ignore[arg-type]
        for _ in range(2)
    ]
    events = ask(client, api, {"text": "log this", "media_ids": ids})
    # Each photo went to the vision model in a request of its own.
    for seen in model.seen[:2]:
        assert [p["type"] for p in seen[-1].content[1:]] == ["image_url"]
    # Fern saw what the photos show, next to what the person typed.
    fern_in = str(model.seen[2][-1].content)
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

    from app.modules.capture.photo_read import CAREFUL

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


def test_a_label_on_the_server_key_is_read_by_three_readers_and_voted(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    """Seen live: one vision model reasoned until it ran out of room and
    answered nothing, so Fern called clear labels blank. On the server key
    three models now read each photo, and a number counts only when two of
    them read it alike."""
    import json

    from app.core.config import settings
    from app.modules.ai_providers import public as ai_public
    from app.modules.capture import public as capture
    from tests.modules.capture.api.helpers import ScriptedModel
    from tests.utils.mobile import ctx_for

    monkeypatch.setattr(settings, "AI_SERVER_FALLBACK", True)
    monkeypatch.setattr(settings, "DEFAULT_LLM_PROVIDER", "nebius")
    monkeypatch.setattr(settings, "NEBIUS_API_KEY", "server-nebius-key")
    monkeypatch.setattr(settings, "NEBIUS_VISION_MODEL", "a/reader")
    monkeypatch.setattr(settings, "NEBIUS_VISION_READERS", "a/reader,b/reader,c/reader")
    protein = {"a/reader": 10, "b/reader": 3.3, "c/reader": 10}
    kcal = {"a/reader": 90, "b/reader": 90, "c/reader": 30}
    seen: dict[str, ScriptedModel] = {}

    def factory(resolved: ai_public.ResolvedModel) -> ScriptedModel:
        reading = {
            "kind": "label",
            "product": "Nestle Non-Fat Milk",
            "serving_size": "250 mL",
            "per_serving": {
                "kcal": kcal[resolved.model],
                "protein_g": protein[resolved.model],
                "carbs_g": 12.5,
            },
        }
        model = ScriptedModel(script=[say(json.dumps({"photos": [reading]}))], seen=[])
        seen[resolved.model] = model
        return model

    monkeypatch.setattr(ai_public, "model_factory", factory)
    api = user(client, db)
    mid = media(api, storage, kind="image", mime="image/jpeg", data=JPEG)  # type: ignore[arg-type]
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        text, read = capture.describe_photos(ctx, [mid], "log this milk")
    assert sorted(seen) == ["a/reader", "b/reader", "c/reader"]
    assert len(read) == 1
    assert "Photo 1 — nutrition label: Nestle Non-Fat Milk" in text
    assert "Per serving: 90 kcal, carbs 12.5 g, protein 10 g." in text
    assert "Unclear" not in text


def test_a_second_message_with_many_photos_carries_the_first_as_text(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    """Kai, 2026-11-05: a second message with several photos, right after a
    first one, seemed not to go through. The model never gets the earlier
    photos again: they come back as their reading (text), so the second
    turn's chat request holds no image at all and stays small."""
    from uuid import uuid4

    api = user(client, db)
    api.assign("chat")
    api.assign("vision", vision=True)
    thread = str(uuid4())

    def photos(n: int) -> list[str]:
        return [
            media(api, storage, kind="image", mime="image/jpeg", data=JPEG)
            for _ in range(n)
        ]

    install(
        monkeypatch,
        *[say(f"Lunch plate {i}: fried chicken about 100 g.") for i in range(4)],
        say("Lunch noted."),
    )
    ask(client, api, {"text": "lunch", "media_ids": photos(4), "thread_id": thread})

    model = install(
        monkeypatch,
        *[say(f"Breakfast label {i}: 173 kcal per serving.") for i in range(4)],
        say("Breakfast noted."),
    )
    ask(
        client,
        api,
        {"text": "for breakfast", "media_ids": photos(4), "thread_id": thread},
    )
    readers, chat = model.seen[:4], model.seen[4]
    # This turn's photos: one per reader request, each read on its own.
    for seen in readers:
        assert [p["type"] for p in seen[-1].content[1:]] == ["image_url"]
    # Fern's own request: no image parts, the first turn as its reading.
    assert "image_url" not in str([m.content for m in chat])
    text = " ".join(str(m.content) for m in chat)
    assert "Lunch plate 0" in text and "Breakfast label 3" in text


def test_a_photo_turn_the_model_failed_stays_in_the_chat(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    """Kai, 2026-11-07: a log sent as a photo was gone from the chat when it
    was opened again. With the chat model failing, the fallback router read
    "log this receipt" as a log, tombstoned the stored question and handed
    only its words to capture: the photo was dropped and nothing of the
    turn stayed in the chat."""
    from uuid import uuid4

    api = user(client, db)
    api.assign("chat")
    api.assign("vision", vision=True)
    install(monkeypatch, fail=True)
    thread = str(uuid4())
    mid = media(api, storage, kind="image", mime="image/jpeg", data=JPEG)  # type: ignore[arg-type]
    me_id = str(uuid4())
    events = ask(
        client,
        api,
        {"text": "log this receipt", "media_ids": [mid], "thread_id": thread, "id": me_id},
    )
    assert events[-1]["type"] == "RUN_FINISHED"
    msgs = [
        m for m in api.get("/companion/messages")["data"] if m["thread_id"] == thread
    ]
    me = next(m for m in msgs if m["id"] == me_id)
    assert me["role"] == "me" and me["text"] == "log this receipt"
    assert [b["t"] for b in me["blocks"]] == ["photos"]
    sol = [m for m in msgs if m["role"] == "sol"]
    assert len(sol) == 1 and sol[0]["text"]


def test_a_photo_sent_with_the_ai_off_stays_in_the_chat_with_its_photo(
    client: TestClient,
    db: Session,
    storage: FakeStorage,
) -> None:
    from uuid import uuid4

    api = user(client, db)
    mid = media(api, storage, kind="image", mime="image/jpeg", data=JPEG)  # type: ignore[arg-type]
    me_id = str(uuid4())
    ask(client, api, {"text": "spent 120 on lunch", "media_ids": [mid], "id": me_id})
    msgs = api.get("/companion/messages")["data"]
    me = next(m for m in msgs if m["id"] == me_id)
    assert [b["t"] for b in me["blocks"]] == ["photos"]
    assert [m["role"] for m in msgs] == ["me", "sol"]
