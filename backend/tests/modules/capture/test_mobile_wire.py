"""The mobile live capture path against the server's schemas.

``mobile/src/live/__tests__/capture.test.ts`` writes what the device sends to
``fixtures/capture-wire.json``: sync ops (validated against the entity's
payload model, with no field silently dropped) and request bodies (validated
against the route's model). ``fixtures/capture-recorded.json`` holds frames
the server really streamed, which the jest tests replay; they must still
match the response schemas. Pure validation: no database.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from app.modules.capture.schema import (
    AnswerIn,
    CaptureDetail,
    CaptureIn,
    CapturePublic,
    CardPublic,
    PayloadIn,
    QuickAddIn,
    ReplyPublic,
)
from app.modules.companion.schema import AskOut, MessagePublic
from app.modules.media.schema import UploadRequest
from app.modules.sync.registry import registry

FIXTURES = Path(__file__).resolve().parents[4] / "mobile/src/live/__tests__/fixtures"
WIRE: dict[str, Any] = json.loads((FIXTURES / "capture-wire.json").read_text())
RECORDED: dict[str, Any] = json.loads((FIXTURES / "capture-recorded.json").read_text())
REST: dict[str, type[BaseModel]] = {
    "CaptureIn": CaptureIn,
    "PayloadIn": PayloadIn,
    "QuickAddIn": QuickAddIn,
    "AnswerIn": AnswerIn,
    "UploadRequest": UploadRequest,
}


def _id(op: dict[str, Any]) -> str:
    return f"{op['kind']}:{op['name']}"


def test_fixture_covers_every_pushed_entity() -> None:
    assert {_id(op) for op in WIRE["ops"]} >= {
        "upsert:capture",
        "upsert:journal_entry",
        "upsert:ai_settings",
    }
    sources = {
        op["data"].get("source") for op in WIRE["ops"] if op["name"] == "capture"
    }
    assert sources == {"text", "voice", "photo", "file"}
    kinds = {
        r["data"]["payload"]["kind"] for r in WIRE["rest"] if r["model"] == "PayloadIn"
    }
    assert len(kinds) == 15  # every card payload kind


@pytest.mark.parametrize("op", WIRE["ops"], ids=[_id(op) for op in WIRE["ops"]])
def test_op_validates_with_no_dropped_field(op: dict[str, Any]) -> None:
    entity = registry().entities[op["name"]]
    assert not entity.read_only
    model = entity.payload
    assert set(op["data"]) <= set(model.model_fields), "unknown field"
    parsed = model.model_validate(op["data"])
    assert parsed.model_fields_set == set(op["data"])


def test_creates_carry_the_required_fields() -> None:
    reg = registry()
    for op in WIRE["ops"]:
        required = reg.entities[op["name"]].create_required
        if op["kind"] == "upsert" and any(k in op["data"] for k in required):
            assert set(required) <= set(op["data"])


@pytest.mark.parametrize(
    "body", WIRE["rest"], ids=[f"{b['model']}-{i}" for i, b in enumerate(WIRE["rest"])]
)
def test_request_body_validates(body: dict[str, Any]) -> None:
    model = REST[body["model"]]
    parsed = model.model_validate(body["data"])
    # nothing the device sends is ignored (aliases: transfer's "from")
    dumped = parsed.model_dump(mode="json", by_alias=True, exclude_unset=True)
    assert set(body["data"]) <= set(dumped)
    if body["model"] == "PayloadIn":
        assert dumped["payload"].keys() >= body["data"]["payload"].keys()


FRAME_MODELS: dict[str, type[BaseModel]] = {
    "card": CardPublic,
    "info": ReplyPublic,
    "message": MessagePublic,
}


def _frames() -> list[tuple[str, str, Any]]:
    out = []
    for name, rec in RECORDED.items():
        if isinstance(rec, dict) and "frames" in rec:
            out += [(name, e, d) for e, d in rec["frames"]]
    return out


@pytest.mark.parametrize("frame", _frames(), ids=lambda f: f"{f[0]}-{f[1]}")
def test_recorded_frame_matches_the_schema(frame: tuple[str, str, Any]) -> None:
    _, event, data = frame
    if event == "card":
        model: type[BaseModel] = (
            CardPublic if data.get("t") == "record" else ReplyPublic
        )
        model.model_validate(data)
    elif event == "capture":
        (CaptureDetail if "cards" in data else CapturePublic).model_validate(data)
    elif event == "done":
        (CaptureDetail if "client_uuid" in data else AskOut).model_validate(data)
    elif event in FRAME_MODELS:
        FRAME_MODELS[event].model_validate(data)
    elif event == "ask":
        assert set(data) == {"card_id", "ask"}
    elif event == "text.delta":
        assert set(data) == {"text"}
    elif event == "block":
        assert isinstance(data.get("t"), str)
    else:
        raise AssertionError(f"unknown frame {event}")


def test_recorded_rows_match_the_sync_schemas() -> None:
    reg = registry()
    for c in RECORDED["pull"]:
        reg.entities[c["entity"]].public.model_validate(c["row"])
    for name in ("undo", "redo", "edit"):
        CardPublic.model_validate(RECORDED[name])
    CaptureDetail.model_validate(RECORDED["answer"])
    CaptureDetail.model_validate(RECORDED["refused"]["detail"])
