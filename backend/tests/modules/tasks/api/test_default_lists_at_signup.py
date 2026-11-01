"""Work, Life and Groceries exist from sign-up completion, so a new
account's first pull carries them and New task can file into a list."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.modules.tasks.models import TaskList
from tests.modules.finance.test_default_categories_at_signup import (
    _handle,
    complete_signup,
    pull_all,
)
from tests.utils.mobile import signed_in

TASKS = f"{settings.API_V1_STR}/tasks"

# Written out rather than read from the module under test: the device mints
# the same ids with uuid.v5 over this namespace (app/shared/ids.py).
NAMESPACE = uuid.UUID("6f1d7c2a-4b8e-5a3c-9d10-2e7f40b1c9a5")
DEFAULTS = {"work": "Work", "life": "Life", "groceries": "Groceries"}


def list_id(user_id: uuid.UUID, key: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"task-list-default:{user_id}:{key}"))


def owned_lists(db: Session, user_id: uuid.UUID) -> list[TaskList]:
    db.expire_all()
    return list(db.exec(select(TaskList).where(TaskList.owner_id == user_id)).all())


def test_signup_seeds_the_three_lists_the_first_pull_carries(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    complete_signup(client, h, _handle())

    pulled = {
        c["id"]: c["row"]
        for c in pull_all(client, h)
        if c["entity"] == "task_list" and not c["deleted"]
    }
    assert {i: r["name"] for i, r in pulled.items()} == {
        list_id(user.id, k): name for k, name in DEFAULTS.items()
    }
    assert pulled[list_id(user.id, "groceries")]["kind"] == "shopping"


def test_signup_twice_adds_no_extra_lists(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    handle = _handle()
    complete_signup(client, h, handle)
    complete_signup(client, h, handle)
    assert sorted(str(x.id) for x in owned_lists(db, user.id)) == sorted(
        list_id(user.id, k) for k in DEFAULTS
    )


def test_a_deleted_default_list_does_not_come_back(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    handle = _handle()
    complete_signup(client, h, handle)
    work = list_id(user.id, "work")
    r = client.delete(f"{TASKS}/lists/{work}", headers=h)
    assert r.status_code in (200, 204), r.text

    complete_signup(client, h, handle)
    r = client.post(f"{TASKS}/lists/defaults", headers=h)
    assert r.status_code == 200, r.text

    rows = {str(x.id): x for x in owned_lists(db, user.id)}
    assert rows[work].deleted_at is not None
    assert len(rows) == len(DEFAULTS)
