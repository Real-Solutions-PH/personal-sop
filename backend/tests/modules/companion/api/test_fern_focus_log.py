"""Fern logs focus time the timer never saw. Seen live 2026-11-14 00:01:
"Record the following focus sessions … about two hours … starting off
9 AM … another session for about one hour at 12 PM … another focus session
starting at 10 PM to 12 AM" got "No tool can backfill focus time"."""

import json
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import ToolMessage
from sqlmodel import Session

from app.modules.focus.models import FocusSession
from tests.modules.capture.api.helpers import call, install, say, user
from tests.modules.companion.api.test_fern_agent import live, rows_of, stream
from tests.utils.mobile import ctx_for

KAI = (
    "Record the following focus sessions so I did focus sessions and the "
    "morning for about two hours probably starting off 9 AM then I need "
    "another session for about one hour at 12 PM. Then I also did another "
    "focus session starting at 10 PM to 12 AM."
)


def _result(model: Any, seen: int) -> dict[str, Any]:
    msg = next(m for m in reversed(model.seen[seen]) if isinstance(m, ToolMessage))
    out: dict[str, Any] = json.loads(str(msg.content))
    return out


def test_focus_blocks_said_afterwards_are_logged(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        # Yesterday, so every block is in the past whatever the hour now.
        day = (ctx.today - timedelta(days=1)).isoformat()
    blocks = [
        {"start": "09:00", "minutes": 120, "day": day},
        {"start": "12:00", "minutes": 60, "day": day},
        {"start": "22:00", "end": "00:00", "day": day},
    ]
    model = install(
        monkeypatch,
        say("", call("log_focus", blocks=blocks)),
        # The same three again: each overlaps what was just logged.
        say("", call("log_focus", blocks=blocks[:1])),
        say("Logged 5 hours of focus."),
    )
    events = stream(api, client, KAI)
    first = _result(model, 1)
    assert [b["minutes"] for b in first["logged"]] == [120, 60, 120], first
    assert first["refused"] == []
    again = _result(model, 2)
    assert again["logged"] == [] and again["refused"][0]["error"] == (
        "focus_logged_overlap"
    )
    rows = live(rows_of(api, FocusSession))
    assert len(rows) == 3 and {r.source for r in rows} == {"manual"}
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    assert step["tool"] == "log_focus" and step["ok"], step
