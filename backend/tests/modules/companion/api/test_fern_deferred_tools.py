"""Rarely used tools are named, not sent (companion/loop.py ``DEFERRED``):
every call carried all 75 tool schemas, about 12,000 tokens, and the
person waited on reading them before the first word (``test_turn_budget``).
"""

import json
from collections.abc import Sequence
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import ToolMessage
from sqlmodel import Session

from app.modules.companion import loop
from tests.modules.capture.api.helpers import ScriptedModel, call, install, say, user


def _bound(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """The tool names each model call was bound with."""
    seen: list[list[str]] = []

    def bind_tools(self: ScriptedModel, tools: Sequence[Any], **kw: Any) -> Any:
        del kw
        seen.append([t["function"]["name"] for t in tools])
        return self

    monkeypatch.setattr(ScriptedModel, "bind_tools", bind_tools)
    return seen


def _result(model: Any, call_no: int, name: str) -> dict[str, Any]:
    msg = next(
        m for m in model.seen[call_no] if isinstance(m, ToolMessage) and m.name == name
    )
    out: dict[str, Any] = json.loads(str(msg.content))
    return out


def test_rare_tools_are_named_and_sent_once_loaded(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    bound = _bound(monkeypatch)
    model = install(
        monkeypatch,
        say("", call("load_tools", names=["focus_status", "no_such_tool"])),
        say("", call("focus_status")),
        say("No focus time today."),
    )
    api.post("/companion/ask", {"text": "how much did I focus today"})
    first, second = bound[0], bound[1]
    assert "load_tools" in first and "focus_status" not in first
    assert not loop.DEFERRED & set(first)
    assert "focus_status" in second
    assert _result(model, 1, "load_tools") == {
        "loaded": ["focus_status"],
        "unknown": ["no_such_tool"],
    }
    assert "error" not in _result(model, 2, "focus_status")


def test_a_deferred_tool_called_without_loading_still_runs(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    bound = _bound(monkeypatch)
    model = install(
        monkeypatch, say("", call("focus_status")), say("No focus time today.")
    )
    api.post("/companion/ask", {"text": "how much did I focus today"})
    assert "error" not in _result(model, 1, "focus_status")
    assert "focus_status" in bound[1]


def test_every_deferred_name_is_a_tool_fern_has() -> None:
    from app.modules.companion import services

    assert services.READ_TOOLS | services.WRITE_TOOLS >= loop.DEFERRED
