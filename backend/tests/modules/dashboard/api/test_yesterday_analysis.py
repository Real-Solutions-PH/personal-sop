"""The Yesterday page: which day "yesterday" is, what it lists, Fern's
analysis (kept once per day), its failure and retry, and the rules read
when no model may run. The model is substituted only through
``ai_providers.public.model_factory`` (``install``)."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.modules.ai_providers.models import AIUsage
from app.modules.dashboard import miss_analysis
from app.modules.dashboard.models import MissAnalysis
from app.modules.habits import public as habits_public
from app.modules.tasks import public as tasks_public
from tests.modules.capture.api.helpers import Api, install, say
from tests.utils.mobile import ctx_for, signed_in

API = settings.API_V1_STR
ANALYSIS = "/dashboard/misses/yesterday/analysis"
THREE = {"points": ["Reading slipped.", "Likely a late night.", "Read 10 pages first."]}


def api(client: TestClient, db: Session) -> Api:
    u, h = signed_in(db)
    a = Api(client, h)
    a.user = u  # type: ignore[attr-defined]
    # No weekly gym goal. Fitness reports a week under its session target as
    # a miss dated that week's Sunday, and it counts weeks from before the
    # account existed, so on every Monday business day a fresh account's
    # yesterday holds a "Missed 4 gym sessions (0/4)". These tests are about
    # habits and tasks; without this they fail one day in seven.
    a.patch("/fitness/settings", {"weekly_target": 0})
    return a


def _seed(a: Api, *, days_ago: int = 3) -> tuple[uuid.UUID, uuid.UUID]:
    """A daily habit made ``days_ago`` days back and never done, and a task
    due yesterday still open."""
    hid, tid = uuid.uuid4(), uuid.uuid4()
    now = datetime.now(UTC)
    with ctx_for(a.user, now=now) as ctx:  # type: ignore[attr-defined]
        h = habits_public.create_habit(ctx, name="Read", habit_id=hid)
        # A habit counts from the day it was made: back-date it.
        h.created_at = now - timedelta(days=days_ago)
        ctx.session.add(h)
        ctx.commit()
    with ctx_for(a.user, now=now) as ctx:  # type: ignore[attr-defined]
        tasks_public.create_tasks(
            ctx,
            [
                tasks_public.TaskDraft(
                    title="File taxes",
                    due_date=ctx.today - timedelta(days=1),
                    task_id=tid,
                )
            ],
        )
        ctx.commit()
    return hid, tid


def _usage(a: Api) -> list[AIUsage]:
    """The person's ai_usage rows, read in a session of its own (the shared
    ``db`` session would hold the table open and block a later migration
    test's DROP TABLE)."""
    with Session(engine) as s:
        return list(
            s.exec(
                select(AIUsage).where(col(AIUsage.owner_id) == a.user.id)  # type: ignore[attr-defined]
            ).all()
        )


def _kept(a: Api) -> list[MissAnalysis]:
    with Session(engine) as s:
        return list(
            s.exec(
                select(MissAnalysis).where(col(MissAnalysis.owner_id) == a.user.id)  # type: ignore[attr-defined]
            ).all()
        )


# ---------------------------------------------------------------- the day


@pytest.mark.parametrize(
    ("tz", "start", "now", "yesterday"),
    [
        # Kiritimati is UTC+14: at 11:00 UTC on the 6th it is already
        # 01:00 on the 7th there, so yesterday is the 6th (the UTC calendar
        # would say the 5th).
        ("Pacific/Kiritimati", 0, "2026-11-06T11:00:00+00:00", "2026-11-06"),
        # Pago Pago is UTC-11: at 05:00 UTC on the 7th it is 18:00 on the
        # 6th, so yesterday is the 5th (UTC would say the 6th).
        ("Pacific/Pago_Pago", 0, "2026-11-07T05:00:00+00:00", "2026-11-05"),
        # Manila with the default 4 am day start: 03:30 local on the 7th
        # still belongs to the 6th, so yesterday is the 5th.
        ("Asia/Manila", 4, "2026-11-06T19:30:00+00:00", "2026-11-05"),
    ],
)
def test_yesterday_is_the_users_own_day(
    client: TestClient, db: Session, tz: str, start: int, now: str, yesterday: str
) -> None:
    a = api(client, db)
    a.patch("/profile", {"timezone": tz, "day_start_hour": start})
    with ctx_for(a.user, now=datetime.fromisoformat(now)) as ctx:  # type: ignore[attr-defined]
        assert miss_analysis.yesterday(ctx).isoformat() == yesterday
        assert miss_analysis.facts(ctx).day.isoformat() == yesterday


# ---------------------------------------------------------------- the list


def test_lists_yesterdays_misses_only_with_notes(
    client: TestClient, db: Session
) -> None:
    a = api(client, db)
    hid, tid = _seed(a)
    with ctx_for(a.user) as ctx:  # type: ignore[attr-defined]
        day = miss_analysis.yesterday(ctx)
    # A reflection note saved through the existing miss_note route.
    a.put(f"/dashboard/misses/miss-{hid}-{day.isoformat()}/note", {"note": "Sick"})
    with ctx_for(a.user) as ctx:  # type: ignore[attr-defined]
        f = miss_analysis.facts(ctx)
    ids = {m["id"]: m for m in f.misses}
    assert set(ids) == {f"miss-{hid}-{day.isoformat()}", f"task-overdue:{tid}"}
    assert all(m["day"] == day.isoformat() for m in f.misses)
    assert ids[f"miss-{hid}-{day.isoformat()}"]["note"] == "Sick"
    assert {m["kind"] for m in f.misses} == {"missed", "overdue"}
    # The days before yesterday feed the pattern, never the list.
    assert f.week and all(m["day"] < day.isoformat() for m in f.week)
    # The same feed the Misses page reads, restricted to the one day.
    feed = a.get("/stats/misses", **{"from": day.isoformat(), "to": day.isoformat()})[
        "data"
    ]
    assert {m["id"] for m in feed if m["day"] == day.isoformat()} == set(ids)
    note = next(m for m in feed if m["id"] == f"miss-{hid}-{day.isoformat()}")
    assert note["note"] == "Sick"


# ---------------------------------------------------------------- analysis


def test_nothing_missed_celebrates_without_a_model_call(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    a.assign("chat")
    model = install(monkeypatch, say(json.dumps(THREE)))
    out = a.post(ANALYSIS)
    assert (out["state"], out["source"], out["points"], out["misses"]) == (
        "celebrate",
        "none",
        [],
        0,
    )
    assert model.seen == [] and _usage(a) == []


def test_analysis_is_kept_once_per_day(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    _seed(a)
    a.assign("chat")
    model = install(monkeypatch, say(f"<think>hm</think>{json.dumps(THREE)}"))
    first = a.post(ANALYSIS)
    assert (first["state"], first["source"]) == ("analysis", "fern")
    assert first["points"] == THREE["points"] and first["misses"] == 2
    # The model read yesterday's misses, by title, and Fern's voice.
    sent = " ".join(str(m.content) for m in model.seen[0])
    assert "Fern" in sent and "Missed: Read" in sent and "File taxes" in sent
    # Reopening: the kept answer, no second call, one metered row.
    again = a.post(ANALYSIS)
    assert again["points"] == THREE["points"] and len(model.seen) == 1
    usage = _usage(a)
    assert len(usage) == 1 and usage[0].ok and usage[0].purpose == "chat"
    assert (usage[0].input_tokens, usage[0].output_tokens) == (120, 30)
    rows = _kept(a)
    assert len(rows) == 1 and rows[0].day.isoformat() == first["day"]


def test_analysis_is_redone_when_the_misses_change(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    hid, _ = _seed(a)
    a.assign("chat")
    later = {"points": ["Only taxes slipped.", "Paperwork stalls.", "Open the form."]}
    model = install(monkeypatch, say(json.dumps(THREE)), say(json.dumps(later)))
    a.post(ANALYSIS)
    # The habit ticked for yesterday after all: one miss fewer.
    with ctx_for(a.user) as ctx:  # type: ignore[attr-defined]
        habits_public.log_habit(
            ctx, habit_id=hid, day=miss_analysis.yesterday(ctx), status="done"
        )
        ctx.commit()
    out = a.post(ANALYSIS)
    assert out["points"] == later["points"] and out["misses"] == 1
    assert len(model.seen) == 2


def test_provider_failure_is_an_error_and_retry_works(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    _seed(a)
    a.assign("chat")
    install(monkeypatch, fail=True)
    body: Any = a.post(ANALYSIS, status=503)
    assert body["code"] == "analysis_failed"
    assert "sk-" not in json.dumps(body)  # the provider's error text never leaks
    usage = _usage(a)
    assert len(usage) == 1 and usage[0].ok is False  # metered even though it failed
    assert _kept(a) == []
    # An answer with nothing usable is the same error, not an empty success.
    install(monkeypatch, say("I think you did fine!"))
    assert a.post(ANALYSIS, status=503)["code"] == "analysis_failed"
    # Retry once the provider answers.
    install(monkeypatch, say(json.dumps(THREE)))
    assert a.post(ANALYSIS)["points"] == THREE["points"]


def test_ai_off_gives_the_rules_read(client: TestClient, db: Session) -> None:
    a = api(client, db)
    hid, _ = _seed(a)
    a.assign("chat")
    a.patch("/capture/settings", {"ai_enabled": False})
    out = a.post(ANALYSIS)
    assert (out["state"], out["source"]) == ("analysis", "rules")
    assert len(out["points"]) == 3
    assert out["points"][0].startswith("2 things slipped yesterday")
    # The habit slipped every day since it was made: named as a pattern,
    # and it is what today starts with.
    assert "Read slipped" in out["points"][1] and "pattern" in out["points"][1]
    assert out["points"][2] == "Today, do Read first, before anything else."
    assert _usage(a) == []


def test_rules_read_quotes_a_note() -> None:
    def miss(title: str, area: str, note: str | None = None) -> dict[str, Any]:
        m: dict[str, Any] = {"id": title, "day": "2026-11-05", "area": area,
                             "kind": "missed", "title": title}  # fmt: skip
        if note:
            m["note"] = note
        return m

    f = miss_analysis.YesterdayFacts(
        day=datetime(2026, 11, 5).date(),
        misses=[
            miss("Missed: Gym", "habits", "Work ran late"),
            miss("Unpaid: Rent", "finance"),
        ],
        week=[],
        due=4,
        done=2,
        on_target=False,
    )
    pts = miss_analysis.rules_points(f)
    assert pts[0] == "2 things slipped yesterday, 1 of them in habits."
    assert pts[1] == 'You noted "Work ran late" on Gym.'
    assert pts[2] == "Today, do Gym first, before anything else."


def test_analysis_is_private_and_needs_the_permission(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    _seed(a)
    a.assign("chat")
    install(monkeypatch, say(json.dumps(THREE)))
    a.post(ANALYSIS)
    b = api(client, db)  # another person: their own (empty) yesterday
    assert b.post(ANALYSIS)["state"] == "celebrate"


def test_points_parser() -> None:
    p = miss_analysis._points
    assert p(None) is None and p("") is None and p("{}") is None
    assert p('{"points": []}') is None
    assert p('noise {"points": ["  a \\n b ", 3, "c", "d", "e"]}') == ["a b", "c", "d"]
    assert p('{"points": ["' + "x" * 500 + '"]}') == ["x" * 240]
