"""Photo captures through a vision model, through OCR, and with no model at
all; voice captures through the one transcription seam."""

import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.ai_providers.models import AIUsage
from app.modules.capture import seams
from app.modules.finance.models import FinRecord, ImportRow, StatementImport
from app.modules.fitness.models import Meal, MealItem
from tests.modules.capture.api.helpers import (
    KEY,
    FakeStorage,
    card_of,
    install,
    media,
    say,
    storage,
    user,
)
from tests.modules.media.test_sniff import JPEG

__all__ = ["storage"]
AUDIO = b"ID3fake-audio-bytes"


def _photo(api: object, store: FakeStorage, **extra: object) -> dict:
    mid = media(api, store, kind="image", mime="image/jpeg", data=JPEG)  # type: ignore[arg-type]
    return api.capture(source="photo", media_id=mid, **extra)  # type: ignore[attr-defined,no-any-return]


def test_vision_meal_fills_a_pending_meal(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, storage: FakeStorage
) -> None:
    api = user(client, db)
    api.assign("vision", vision=True)
    est = {
        "items": [
            {"name": "Chicken adobo", "qty": 2, "unit": "pc", "kcal": 380, "protein": 32, "carbs": 4, "fat": 26},
            {"name": "Rice", "qty": 1, "unit": "cup", "kcal": 205, "protein": 4, "carbs": 45, "fat": 0},
        ],
        "confidence": 0.7,
        "follow_up": None,
    }
    model = install(monkeypatch, say(json.dumps(est)))
    cap = _photo(api, storage, hint="meal", text="lunch")
    card = card_of(cap, "meal")
    assert (card["tier"], card["state"]) == ("confirm", "proposed")  # photos always confirm
    assert cap["engine"] == "ai"
    # the image bytes and the caption reached the model
    sent = model.seen[0][-1].content
    assert sent[0]["text"].endswith("The user says: lunch")
    assert sent[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    saved = api.post(f"/capture/cards/{card['id']}/confirm")
    with Session(db_engine) as s:
        meal = s.get(Meal, uuid.UUID(saved["refs"][0]))
        assert meal is not None and meal.status == "estimated" and meal.photo_media_id is not None
        items = s.exec(select(MealItem).where(MealItem.meal_id == meal.id)).all()
        assert sorted(i.kcal for i in items) == [205, 380]
        usage = s.exec(select(AIUsage).where(AIUsage.owner_id == api.user.id)).all()  # type: ignore[attr-defined]
        assert [u.purpose for u in usage] == ["vision"]


def test_vision_receipt_label_statement_whiteboard(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, storage: FakeStorage
) -> None:
    api = user(client, db)
    api.assign("vision", vision=True)
    install(
        monkeypatch,
        say(json.dumps({"merchant": "Puregold", "total": 1240.5, "date": None, "category": "groceries"})),
        say(json.dumps({"name": "SkyFlakes", "serving": "1 pack", "kcal": 130, "protein": 3, "carbs": 20, "fat": 4})),
        say(json.dumps({"rows": [
            {"date": "2026-10-10", "time": "09:00", "description": "GRAB PH", "amount": 250, "direction": "out"},
            {"date": "2026-10-11", "description": "SALARY", "amount": 35000, "direction": "in"},
        ]})),
        say(json.dumps({"tasks": ["Email Anna", "Book venue"]})),
    )
    receipt = card_of(_photo(api, storage, hint="receipt"), "expense")
    assert receipt["payload"]["amount_minor"] == 124050 and receipt["payload"]["from_receipt"] is True
    assert receipt["payload"]["category_id"] == api.cats()["groceries"]
    saved = api.post(f"/capture/cards/{receipt['id']}/confirm")
    with Session(db_engine) as s:
        rec = s.get(FinRecord, uuid.UUID(saved["refs"][0]))
        assert rec is not None and rec.receipt_media_id is not None and rec.source == "photo"
    label = card_of(_photo(api, storage, hint="label"), "meal")
    assert label["ask"]["field"] == "servings"
    out = api.post(f"/capture/cards/{label['id']}/answer", {"value": "2"})
    lab = card_of(out, "meal")
    assert lab["payload"]["items"][0]["kcal"] == 260
    statement = _photo(api, storage, hint="statement")
    handoff = statement["replies"][0]["body"]
    assert handoff["tone"] == "handoff" and statement["cards"] == []
    imp_id = handoff["actions"][0]["href"].rsplit("/", 1)[1]
    with Session(db_engine) as s:
        imp = s.get(StatementImport, uuid.UUID(imp_id))
        assert imp is not None and imp.status == "review"
        assert len(s.exec(select(ImportRow).where(ImportRow.import_id == imp.id)).all()) == 2
    board = card_of(_photo(api, storage, hint="whiteboard"), "task")
    assert [t["title"] for t in board["payload"]["tasks"]] == ["Email Anna", "Book venue"]
    assert board["tier"] == "confirm"


def test_no_vision_reads_the_photo_with_ocr(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, storage: FakeStorage
) -> None:
    api = user(client, db)
    seen: list[bytes] = []

    def fake_ocr(image: bytes, mime: str) -> str:
        seen.append(image)
        return "PUREGOLD\nTOTAL 1,240.00"

    monkeypatch.setattr(seams, "ocr_text", fake_ocr)
    cap = _photo(api, storage, hint="receipt")
    card = card_of(cap, "expense")
    assert seen == [JPEG]
    assert card["payload"]["amount_minor"] == 124000 and card["tier"] == "confirm"
    assert cap["engine"] == "rules"


def test_no_model_meal_photo_uses_the_caption_estimator(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, storage: FakeStorage
) -> None:
    api = user(client, db)
    monkeypatch.setattr(seams, "ocr_text", lambda image, mime: None)
    meal = card_of(_photo(api, storage, hint="meal", text="adobo with 1 cup rice"), "meal")
    assert meal["tier"] == "confirm" and len(meal["payload"]["items"]) == 2
    blank = _photo(api, storage, hint="meal")
    assert blank["cards"] == [] and blank["replies"][0]["body"]["title"] == "Couldn't find anything to log"
    # "auto" with nothing readable asks what the photo is; the answer runs it
    auto = _photo(api, storage)
    q = card_of(auto, "photo")
    assert q["ask"]["field"] == "hint"
    out = api.post(f"/capture/cards/{q['id']}/answer", {"value": "note"})
    assert card_of(out, "photo")["state"] == "discarded"
    assert any(r["body"].get("title") == "Saved as a note" for r in out["replies"])


def test_voice_is_transcribed_through_the_seam(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, storage: FakeStorage
) -> None:
    api = user(client, db)
    api.assign("transcription", model="whisper-1")
    calls: list[tuple[str, bytes, str]] = []

    def fake(resolved: object, audio: bytes, *, filename: str, mime: str, language: str | None) -> str:
        calls.append((resolved.model, audio, mime))  # type: ignore[attr-defined]
        return "spent 250 on grab"

    monkeypatch.setattr(seams, "transcribe", fake)
    mid = media(api, storage, kind="audio", mime="audio/mpeg", data=AUDIO)
    cap = api.capture(source="voice", media_id=mid, duration_sec=7)
    assert calls == [("whisper-1", AUDIO, "audio/mpeg")]
    assert cap["transcript"] == "spent 250 on grab" and cap["text"] == "spent 250 on grab"
    assert card_of(cap, "expense")["state"] == "saved"
    with Session(db_engine) as s:
        u = s.exec(select(AIUsage).where(AIUsage.owner_id == api.user.id)).all()  # type: ignore[attr-defined]
        assert [x.purpose for x in u] == ["transcription"] and u[0].cost_minor > 0
    # a failing provider keeps the recording and says so, without its text
    def boom(*a: object, **k: object) -> str:
        raise seams.SeamError("transcription_failed")

    monkeypatch.setattr(seams, "transcribe", boom)
    mid2 = media(api, storage, kind="audio", mime="audio/mpeg", data=AUDIO)
    r = api.capture(source="voice", media_id=mid2, status=422)
    assert r["detail"]["code"] == "transcription_failed" if "detail" in r else r["code"] == "transcription_failed"
    assert all(KEY not in t for t in api.texts)


def test_browser_transcription_needs_the_transcript(
    client: TestClient, db: Session, storage: FakeStorage
) -> None:
    api = user(client, db)
    api.patch("/capture/settings", {"transcription": "browser"})
    mid = media(api, storage, kind="audio", mime="audio/mpeg", data=AUDIO)
    api.capture(source="voice", media_id=mid, status=422)
    mid2 = media(api, storage, kind="audio", mime="audio/mpeg", data=AUDIO)
    cap = api.capture(source="voice", media_id=mid2, transcript="meditated 10 min")
    assert cap["transcript"] == "meditated 10 min" and cap["status"] == "done"
