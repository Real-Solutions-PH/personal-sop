"""Fern files a task into one of the person's lists when they name it, and
leaves it in the Inbox otherwise; it never makes a list on the way."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.companion import grounding
from app.modules.tasks.models import TaskList
from tests.modules.capture.api.helpers import Api, call, user
from tests.modules.companion.api.test_fern_agent import live, rows_of, tasks_of
from tests.modules.companion.api.test_fern_fitness import tool_result, turn
from tests.utils.mobile import ctx_for


def fern(client: TestClient, db: Session) -> Api:
    api = user(client, db, accounts=False)
    api.assign("chat")  # type: ignore[attr-defined]
    return api


def make_list(api: Api, name: str) -> str:
    out: dict[str, Any] = api.post("/tasks/lists", {"name": name})
    return str(out["id"])


def add(
    api: Api,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    *tasks: dict[str, Any],
) -> dict[str, Any]:
    _, model = turn(
        api, client, monkeypatch, "add these", call("create_tasks", tasks=list(tasks))
    )
    return tool_result(model)


def list_of(api: Api, title: str) -> str | None:
    t = next(t for t in tasks_of(api) if t.title == title)
    return str(t.list_id) if t.list_id else None


def test_a_named_list_files_the_task_there(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    work = make_list(api, "Work")
    make_list(api, "Life")
    out = add(api, client, monkeypatch, {"title": "Finish the deck", "list": "work"})
    assert list_of(api, "Finish the deck") == work
    assert "unknown_lists" not in out


def test_an_unknown_list_leaves_the_task_in_the_inbox_and_says_so(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    make_list(api, "Work")
    out = add(api, client, monkeypatch, {"title": "Call mum", "list": "Family"})
    assert list_of(api, "Call mum") is None
    assert out["unknown_lists"] == ["Family"]
    assert [x.name for x in live(rows_of(api, TaskList))] == ["Work"]


def test_no_list_goes_to_the_inbox(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    make_list(api, "Work")
    out = add(api, client, monkeypatch, {"title": "Water plants"})
    assert list_of(api, "Water plants") is None
    assert "unknown_lists" not in out


def test_another_users_list_never_resolves(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = fern(client, db)
    make_list(other, "Secret")
    api = fern(client, db)
    out = add(api, client, monkeypatch, {"title": "Peek", "list": "Secret"})
    assert list_of(api, "Peek") is None
    assert out["unknown_lists"] == ["Secret"]


def test_an_archived_list_is_never_chosen(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    old = make_list(api, "Errands")
    api.post(f"/tasks/lists/{old}/archive", {"archived": True})
    out = add(api, client, monkeypatch, {"title": "Post office", "list": "Errands"})
    assert list_of(api, "Post office") is None
    assert out["unknown_lists"] == ["Errands"]


def test_the_snapshot_names_live_lists_in_order_capped_at_twenty(
    client: TestClient, db: Session
) -> None:
    api = fern(client, db)
    names = [f"List {i:02d}" for i in range(23)]
    ids = [make_list(api, n) for n in names]
    api.post(f"/tasks/lists/{ids[0]}/archive", {"archived": True})
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        shown = grounding.snapshot(ctx)["task_lists"]
    assert shown == names[1:21]
