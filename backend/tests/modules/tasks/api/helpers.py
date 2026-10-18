"""Shared helpers for the tasks API tests."""

import uuid
from datetime import date, timedelta
from typing import Any

from fastapi.testclient import TestClient

from app.core.config import settings
from app.shared.day import DayClock

API = f"{settings.API_V1_STR}/tasks"
SYNC = f"{settings.API_V1_STR}/sync"


def today() -> date:
    # A fresh user has no profile: Asia/Manila, day starts 04:00.
    return DayClock().today()


def day(n: int) -> str:
    return (today() + timedelta(days=n)).isoformat()


def ok(r: Any, status: int = 200) -> Any:
    assert r.status_code == status, r.text
    return r.json()


def new_task(
    client: TestClient, headers: dict[str, str], title: str = "Task", **fields: Any
) -> dict[str, Any]:
    return ok(client.post(f"{API}/", headers=headers, json={"title": title, **fields}))  # type: ignore[no-any-return]


def new_list(
    client: TestClient, headers: dict[str, str], name: str = "List", **fields: Any
) -> dict[str, Any]:
    return ok(
        client.post(f"{API}/lists", headers=headers, json={"name": name, **fields})
    )  # type: ignore[no-any-return]


def op(
    kind: str, entity: str, row_id: uuid.UUID | str | None = None, /, **data: Any
) -> dict[str, Any]:
    return {
        "op_id": str(uuid.uuid4()),
        "kind": kind,
        "name": entity,
        "id": str(row_id) if row_id else None,
        "data": data,
    }


def push(
    client: TestClient, headers: dict[str, str], *ops: dict[str, Any]
) -> list[dict[str, Any]]:
    body = ok(client.post(f"{SYNC}/push", headers=headers, json={"ops": list(ops)}))
    return list(body["results"])


def pull(
    client: TestClient, headers: dict[str, str], cursor: int = 0
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    while True:
        body = ok(
            client.get(f"{SYNC}/pull?cursor={cursor}&limit=1000", headers=headers)
        )
        changes.extend(body["changes"])
        cursor = body["cursor"]
        if not body["truncated"]:
            return changes
