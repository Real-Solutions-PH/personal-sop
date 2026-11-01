"""How many vision readers a chat photo waits for: a plate needs one, a
label two that agree, and only a disagreement brings in the third."""

import json
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.ai_providers import public as ai_public
from app.modules.capture import public as capture
from tests.modules.capture.api.helpers import (
    FakeStorage,
    ScriptedModel,
    media,
    say,
    storage,
    user,
)
from tests.modules.media.test_sniff import JPEG
from tests.utils.mobile import ctx_for

__all__ = ["storage"]


def _server_readers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "AI_SERVER_FALLBACK", True)
    monkeypatch.setattr(settings, "DEFAULT_LLM_PROVIDER", "nebius")
    monkeypatch.setattr(settings, "NEBIUS_API_KEY", "server-nebius-key")
    monkeypatch.setattr(settings, "NEBIUS_VISION_MODEL", "a/reader")
    monkeypatch.setattr(settings, "NEBIUS_VISION_READERS", "a/reader,b/reader,c/reader")


class Slow(ScriptedModel):
    """A reader that takes ``delay`` seconds to answer."""

    delay: float = 0.0

    def _generate(
        self, messages: Any, stop: Any = None, run_manager: Any = None, **kw: Any
    ) -> Any:
        time.sleep(self.delay)
        return super()._generate(messages, stop, run_manager, **kw)


def _install(
    monkeypatch: pytest.MonkeyPatch,
    readings: dict[str, dict[str, Any]],
    delays: dict[str, float] | None = None,
) -> dict[str, Slow]:
    seen: dict[str, Slow] = {}

    def factory(resolved: ai_public.ResolvedModel) -> Slow:
        m = Slow(
            script=[say(json.dumps({"photos": [readings[resolved.model]]}))],
            seen=[],
            delay=(delays or {}).get(resolved.model, 0.0),
        )
        seen[resolved.model] = m
        return m

    monkeypatch.setattr(ai_public, "model_factory", factory)
    return seen


def _label(kcal: float) -> dict[str, Any]:
    return {
        "kind": "label",
        "product": "Kirkland Signature Fish Oil",
        "serving_size": "1 softgel",
        "per_serving": {"kcal": kcal, "fat_g": 1},
    }


def _read(client: TestClient, db: Session, storage: FakeStorage) -> tuple[str, float]:
    api = user(client, db)
    mid = media(api, storage, kind="image", mime="image/jpeg", data=JPEG)  # type: ignore[arg-type]
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        t0 = time.monotonic()
        text, _ = capture.describe_photos(ctx, [mid], "")
        return text, time.monotonic() - t0


def test_a_plate_is_answered_by_the_first_reader_without_waiting(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    _server_readers(monkeypatch)
    plate = {
        "kind": "meal",
        "what": "rice and adobo",
        "foods": [{"name": "rice", "grams": 180}],
    }
    seen = _install(
        monkeypatch,
        {"a/reader": plate, "b/reader": plate, "c/reader": plate},
        delays={"b/reader": 3.0},
    )
    text, took = _read(client, db, storage)
    assert "Foods: rice about 180 g." in text
    # The second reader was started but never waited for; the third never.
    assert took < 2.0
    assert "c/reader" not in seen


def test_two_readers_that_agree_on_a_label_settle_it(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    _server_readers(monkeypatch)
    seen = _install(
        monkeypatch,
        {"a/reader": _label(10), "b/reader": _label(10), "c/reader": _label(90)},
    )
    text, _ = _read(client, db, storage)
    assert "Per serving: 10 kcal, fat 1 g." in text
    assert sorted(seen) == ["a/reader", "b/reader"]


def test_a_disagreement_brings_in_the_third_reader(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    _server_readers(monkeypatch)
    seen = _install(
        monkeypatch,
        {"a/reader": _label(10), "b/reader": _label(100), "c/reader": _label(10)},
    )
    text, _ = _read(client, db, storage)
    assert "Per serving: 10 kcal, fat 1 g." in text
    assert sorted(seen) == ["a/reader", "b/reader", "c/reader"]
