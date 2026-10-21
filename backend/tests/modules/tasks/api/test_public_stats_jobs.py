"""The cross-module contract, the stats contributor and the job entry points
against the database (service level, through ``ctx_for``)."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.stats.contract import Window
from app.modules.stats.public import DIRTY_KEY
from app.modules.tasks import jobs, public
from app.modules.tasks.stats import contributor
from app.shared.ids import derived_id
from tests.modules.tasks.api.helpers import API, day, new_task, ok, today
from tests.utils.mobile import ctx_for, signed_in

DAILY = {"rule": {"kind": "daily"}, "mode": "fixed"}


def test_public_create_complete_uncomplete_find_remove(
    client: TestClient, db: Session
) -> None:
    user, headers = signed_in(db)
    tid = uuid.uuid4()
    with ctx_for(user) as ctx:
        made = public.create_tasks(
            ctx,
            [
                public.TaskDraft(
                    title="Call Mark", due_date=today(), remind=True, task_id=tid
                )
            ],
            source="capture-text",
        )
        assert made[0].id == tid and made[0].remind_at is not None
        # replay-safe
        assert (
            public.create_tasks(ctx, [public.TaskDraft(title="dup", task_id=tid)])[
                0
            ].title
            == "Call Mark"
        )
        # the dirty marker is collected for the stats module
        assert ("tasks", today()) in {(m, d) for _, m, d in ctx.session.info[DIRTY_KEY]}
        ctx.session.commit()
    with ctx_for(user) as ctx:
        assert [t.id for t in public.find_open_tasks(ctx, "mark")] == [tid]
        assert public.find_open_tasks(ctx, "   ") == []
        assert public.complete_task(ctx, task_id=tid).status == "done"
        assert public.find_open_tasks(ctx, "mark") == []
        assert public.uncomplete_task(ctx, task_id=tid).status == "open"
        public.remove_tasks(ctx, task_ids=[tid])
        ctx.session.commit()
    assert client.get(f"{API}/{tid}", headers=headers).status_code == 404


def test_public_complete_spawns_the_derived_next(
    client: TestClient, db: Session
) -> None:
    user, headers = signed_in(db)
    t = new_task(client, headers, due_date=day(0), recurrence=DAILY)
    with ctx_for(user) as ctx:
        public.complete_task(ctx, task_id=uuid.UUID(t["id"]))
        ctx.session.commit()
    nid = derived_id("task-next", uuid.UUID(t["id"]), day(1))
    assert ok(client.get(f"{API}/{nid}", headers=headers))["due_date"] == day(1)


def test_contributor_reads_the_users_rows(client: TestClient, db: Session) -> None:
    user, headers = signed_in(db)
    on_time = new_task(client, headers, "on time", due_date=day(0))
    late = new_task(client, headers, "late", due_date=day(-1))
    pushed = new_task(client, headers, "pushed", due_date=day(0))
    for n in (1, 2, 3):
        ok(
            client.post(
                f"{API}/{pushed['id']}/reschedule", headers=headers, json={"days": n}
            )
        )
    ok(client.post(f"{API}/{on_time['id']}/complete", headers=headers))
    ok(client.post(f"{API}/{late['id']}/complete", headers=headers))
    t0 = today()
    week = Window(t0 - timedelta(days=6), t0)
    prev = Window(t0 - timedelta(days=13), t0 - timedelta(days=7))
    with ctx_for(user) as ctx:
        assert contributor.area_rate(ctx, week) == 0.5  # 1 of 2 on time
        assert contributor.area_rate(ctx, prev) == 0.5  # nothing: neutral
        metrics = {m.key: m for m in contributor.metrics(ctx, week, prev)}
        assert list(metrics) == [
            "tasks.done",
            "tasks.onTime",
            "tasks.streak",
            "tasks.overdue",
            "tasks.reschedules",
            "tasks.followThrough",
        ]
        assert (metrics["tasks.done"].value, metrics["tasks.onTime"].value) == (
            "2",
            "50%",
        )
        assert metrics["tasks.reschedules"].value == "3"
        assert metrics["tasks.followThrough"].value == "0.5"  # (1 + .5) / 3
        kinds = {
            m.kind for m in contributor.misses(ctx, Window(t0 - timedelta(days=30), t0))
        }
        assert kinds == {"late", "pushed"}
        cal = contributor.calendar(ctx, Window(t0, t0 + timedelta(days=3)))
        # "pushed" now sits at today + 3
        assert {c.title for c in cal} == {"on time", "pushed"}
        prog = contributor.day_progress(ctx, [t0, t0 - timedelta(days=1)])
        assert (prog[t0].due, prog[t0].done) == (2, 2)  # on time + late, both done
        # "late" was due yesterday but only created today: it did not exist then
        assert (
            prog[t0 - timedelta(days=1)].due,
            prog[t0 - timedelta(days=1)].done,
        ) == (0, 0)
        assert contributor.achievements(ctx) == []


def test_reminder_job_posts_once_per_reminder(client: TestClient, db: Session) -> None:
    user, headers = signed_in(db)
    soon = datetime.now(UTC) - timedelta(minutes=1)
    new_task(
        client,
        headers,
        "ping",
        due_date=day(0),
        due_time="09:00",
        remind_at=soon.isoformat(),
    )
    now = datetime.now(UTC)
    with ctx_for(user, now=now) as ctx:
        assert jobs.send_reminders(ctx) == 1
    with ctx_for(user, now=now) as ctx:
        assert jobs.send_reminders(ctx) == 0  # deduped


def test_digest_job(client: TestClient, db: Session) -> None:
    user, headers = signed_in(db)
    ok(
        client.patch(
            f"{API}/settings",
            headers=headers,
            json={
                "digest_on": True,
                "digest_time": "04:00",
                "quiet_start": "04:00",
                "quiet_end": "04:00",
            },
        )
    )
    new_task(client, headers, "x", due_date=day(0))
    with ctx_for(user) as ctx:
        assert jobs.send_digest(ctx) is True
    with ctx_for(user) as ctx:
        assert jobs.send_digest(ctx) is False


def test_job_entry_points_skip_users_with_nothing_due(db: Session) -> None:
    # No reminders in the window and no digest subscribers → no notify call.
    far = datetime(2001, 1, 1, tzinfo=UTC)
    assert jobs.run_reminders(db, now=far) == 0
