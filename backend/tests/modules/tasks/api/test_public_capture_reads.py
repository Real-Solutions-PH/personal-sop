"""The reads capture makes through tasks' ``public.py``: the parser's open
task list and list keys, the Q&A's open tasks by due date, and the
post-complete "N left today" count."""

import uuid
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.tasks import public
from tests.modules.tasks.api.helpers import API, day, new_list, new_task, ok, today
from tests.utils.mobile import ctx_for, signed_in


def test_open_task_lists_and_due_count(client: TestClient, db: Session) -> None:
    user, headers = signed_in(db)
    undated = new_task(client, headers, "Undated")["id"]
    overdue = new_task(client, headers, "Overdue", due_date=day(-2))["id"]
    due_today = new_task(client, headers, "Today", due_date=day(0))["id"]
    later = new_task(client, headers, "Later", due_date=day(3))["id"]
    done = new_task(client, headers, "Done", due_date=day(-1))["id"]
    ok(client.post(f"{API}/{done}/complete", headers=headers))

    with ctx_for(user) as ctx:
        newest = public.list_open_tasks(ctx, order="newest", limit=10)
        assert [str(t.id) for t in newest] == [later, due_today, overdue, undated]
        by_due = public.list_open_tasks(ctx, order="due", limit=10)
        # Postgres sorts NULL last ascending: the undated task comes last.
        assert [str(t.id) for t in by_due] == [overdue, due_today, later, undated]
        assert len(public.list_open_tasks(ctx, order="due", limit=2)) == 2

        # Overdue and due-today count; the done one, undated and later do not.
        assert public.count_open_due_by(ctx, day=today()) == 2
        # The bound is inclusive: on the later task's day it counts too.
        assert public.count_open_due_by(ctx, day=today() + timedelta(days=3)) == 3
        assert public.count_open_due_by(ctx, day=today() - timedelta(days=3)) == 0


def test_list_keys(client: TestClient, db: Session) -> None:
    user, headers = signed_in(db)
    with ctx_for(user) as ctx:
        assert "work" not in public.list_keys(ctx)
    work = new_list(client, headers, "Work")["id"]
    job2 = new_list(client, headers, "  job   2 ")["id"]
    shop = new_list(client, headers, "Weekly shop", kind="shopping")["id"]
    with ctx_for(user) as ctx:
        keys = public.list_keys(ctx)
        assert keys["work"] == uuid.UUID(work)
        assert keys["job2"] == uuid.UUID(job2)
        # No list named Groceries: the first shopping list stands in.
        assert keys["groceries"] == uuid.UUID(shop)
