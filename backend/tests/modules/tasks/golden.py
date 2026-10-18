"""Loaders for the prototype's golden fixtures (``scripts/golden/tasks.golden.test.ts``).

Expected values in these files come from running the TypeScript prototype at
a frozen clock; the Python under test never produces them.
"""

import json
from datetime import date, datetime
from functools import cache
from pathlib import Path
from typing import Any

from app.modules.tasks.logic import EventView, ListView, TasksState, TaskView

GOLDEN = Path(__file__).resolve().parents[2] / "golden"


@cache
def load(name: str) -> dict[str, Any]:
    raw: dict[str, Any] = json.loads((GOLDEN / f"{name}.json").read_text())
    return raw


def frozen_now() -> datetime:
    return datetime.fromisoformat(load("tasks-stats")["frozenNow"])


def _dt(v: str | None) -> datetime | None:
    return datetime.fromisoformat(v) if v else None


def _d(v: str | None) -> date | None:
    return date.fromisoformat(v) if v else None


def task_view(t: dict[str, Any]) -> TaskView:
    created = _dt(t["createdAt"])
    assert created is not None
    return TaskView(
        id=t["id"],
        # The seed's older grocery rows index their title pool with a negative
        # modulo, so the prototype itself leaves them untitled.
        title=t.get("title", ""),
        list_id=t["listId"],
        status=t["status"],
        created_at=created,
        due_date=_d(t["dueDate"]),
        due_time=t["dueTime"],
        remind_at=_dt(t["remindAt"]),
        recurrence=t["recurrence"],
        starred=t["starred"],
        completed_at=_dt(t["completedAt"]),
        deleted_at=_dt(t["deletedAt"]),
        source=t["source"],
        original_due=_d(t["originalDue"]),
        reschedule_count=t["rescheduleCount"],
        order=t["order"],
        notes=t["notes"],
    )


def seed_state(count_groceries: bool | None = None) -> TasksState:
    s = load("tasks-stats")["data"]["state"]
    return TasksState(
        lists=[
            ListView(
                id=lst["id"],
                name=lst["name"],
                kind=lst["kind"],
                sort_order=lst["sortOrder"],
                archived=lst["archivedAt"] is not None,
            )
            for lst in s["lists"]
        ],
        tasks=[task_view(t) for t in s["tasks"]],
        events=[
            EventView(type=e["type"], at=datetime.fromisoformat(e["at"]))
            for e in s["events"]
        ],
        count_groceries=(
            s["settings"]["countGroceries"]
            if count_groceries is None
            else count_groceries
        ),
    )
