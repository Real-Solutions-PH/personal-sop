"""Dashboard end to end: goals, reviews, wrap-up, inbox and notify, share
cards, onboarding, the Today bundle and sync, with real GoTrue users."""

import json
import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.modules.dashboard import public as dashboard_public
from app.modules.dashboard.models import Notification, WrapUp
from app.modules.habits import public as habits_public
from app.modules.profile.models import PushDevice
from app.modules.stats.models import LifeScoreDaily
from app.modules.tasks import public as tasks_public
from app.shared import events, push
from app.shared.context import Ctx
from tests.utils.mobile import ctx_for, signed_in
from tests.utils.user import create_auth_user, user_authentication_headers

API = f"{settings.API_V1_STR}/dashboard"
STATS = f"{settings.API_V1_STR}/stats"
PROFILE = f"{settings.API_V1_STR}/profile"
SYNC = f"{settings.API_V1_STR}/sync"

CAPTURE_STUB = pytest.mark.xfail(
    raises=NotImplementedError,
    strict=False,
    reason="capture.add_journal_entry is a stub until merge",
)


def ok(r: Any, status: int = 200) -> Any:
    assert r.status_code == status, r.text
    return r.json()


def err(r: Any, status: int, code: str | None = None) -> dict[str, Any]:
    assert r.status_code == status, r.text
    body: dict[str, Any] = r.json()
    if code is not None:
        assert body["code"] == code, body
    return body


def write(user: Any, fn: Any) -> Any:
    """One use case through public contracts; a returned row is detached
    with its committed state loaded."""
    with ctx_for(user) as ctx:
        out = fn(ctx)
        ctx.commit()
        if hasattr(out, "__table__"):
            ctx.session.refresh(out)
            ctx.session.expunge(out)
        return out


def op(kind: str, name: str, row_id: Any = None, **data: Any) -> dict[str, Any]:
    return {
        "op_id": str(uuid.uuid4()),
        "kind": kind,
        "name": name,
        "id": str(row_id) if row_id else None,
        "data": data,
    }


def sync_push(client: TestClient, h: dict[str, str], *ops: dict[str, Any]) -> list[Any]:
    return list(
        ok(client.post(f"{SYNC}/push", headers=h, json={"ops": list(ops)}))["results"]
    )


def monday_key(today: str) -> str:
    from datetime import date

    d = date.fromisoformat(today)
    return f"w-{(d - timedelta(days=d.weekday())).isoformat()}"


@dataclass
class Rec:
    pushed: list[push.PushMessage] = field(default_factory=list)
    events: list[tuple[uuid.UUID, str, dict[str, Any]]] = field(default_factory=list)
    dead: set[str] = field(default_factory=set)


@pytest.fixture()
def rec(monkeypatch: pytest.MonkeyPatch) -> Rec:
    r = Rec()

    def sender(messages: list[push.PushMessage]) -> list[push.PushTicket]:
        r.pushed.extend(messages)
        return [
            push.PushTicket(token=m.token, ok=False, error="DeviceNotRegistered")
            if m.token in r.dead
            else push.PushTicket(token=m.token, ok=True)
            for m in messages
        ]

    def sink(user_id: uuid.UUID, type_: str, data: dict[str, Any]) -> None:
        r.events.append((user_id, type_, data))

    monkeypatch.setattr(settings, "PUSH_ENABLED", True)
    monkeypatch.setattr(push, "push_sender", sender)
    monkeypatch.setattr(events, "sink", sink)
    return r


# ---------------------------------------------------------------- goals


def test_goal_lifecycle_and_progress(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    hid = uuid.uuid4()

    def habit(ctx: Ctx) -> None:
        habits_public.create_habit(ctx, name="Read", habit_id=hid)
        habits_public.log_habit(ctx, habit_id=hid, day=ctx.today, status="done")

    write(user, habit)
    gid = uuid.uuid4()
    body = {"id": str(gid), "metric": "habits:habits.rate", "label": "Habits",
            "target": 80, "unit": "%"}  # fmt: skip
    g = ok(client.post(f"{API}/goals", headers=h, json=body))
    assert g["id"] == str(gid) and g["status"] == "active"
    # 100% done this week against >= 80%: hit, measured live.
    assert (g["current"], g["value"], g["hit"]) == (100, "100%", True)
    assert g["pct"] == 1.25
    assert ok(client.post(f"{API}/goals", headers=h, json=body))["id"] == str(gid)

    g = ok(client.patch(f"{API}/goals/{gid}", headers=h, json={"target": 200}))
    assert g["target"] == 200 and g["hit"] is False and g["pct"] == 0.5
    err(client.patch(f"{API}/goals/{gid}", headers=h, json={"label": None}), 422)
    err(client.patch(f"{API}/goals/{gid}", headers=h, json={"metric": "nope"}), 422,
        "goal_metric_invalid")  # fmt: skip
    assert (
        ok(client.post(f"{API}/goals/{gid}/archive", headers=h))["status"] == "archived"
    )
    assert (
        ok(client.post(f"{API}/goals/{gid}/restore", headers=h))["status"] == "active"
    )
    listed = ok(client.get(f"{API}/goals", headers=h))
    assert listed["count"] == 1 and listed["data"][0]["id"] == str(gid)
    ok(client.delete(f"{API}/goals/{gid}", headers=h))
    err(client.get(f"{API}/goals/{gid}", headers=h), 404, "goal_not_found")
    assert ok(client.get(f"{API}/goals", headers=h))["count"] == 0
    assert ok(client.post(f"{API}/goals/{gid}/undelete", headers=h))["id"] == str(gid)

    err(client.post(f"{API}/goals", headers=h, json={**body, "id": None,
        "metric": "social:x"}), 422, "goal_metric_invalid")  # fmt: skip
    err(client.post(f"{API}/goals", headers=h, json={**body, "target": "nan"}), 422)


def test_life_goal_and_lte(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    life = ok(client.post(f"{API}/goals", headers=h, json={"metric": "life",
        "label": "x", "target": 75, "period": "month"}))  # fmt: skip
    assert life["label"] == "Life Score"  # follows the metric's label
    ov = ok(client.get(f"{STATS}/overview", headers=h, params={"range": "30d"}))
    assert life["current"] == ov["life_score"]
    lte = ok(client.post(f"{API}/goals", headers=h, json={"metric": "tasks:tasks.overdue",
        "label": "Overdue", "target": 2, "comparator": "lte"}))  # fmt: skip
    assert lte["current"] == 0 and lte["hit"] is True and lte["pct"] == 1


def test_goals_are_private(client: TestClient, db: Session) -> None:
    _, ha = signed_in(db)
    _, hb = signed_in(db)
    g = ok(client.post(f"{API}/goals", headers=ha, json={"metric": "life",
        "label": "L", "target": 1}))  # fmt: skip
    for r in (
        client.get(f"{API}/goals/{g['id']}", headers=hb),
        client.patch(f"{API}/goals/{g['id']}", headers=hb, json={"target": 2}),
        client.post(f"{API}/goals/{g['id']}/archive", headers=hb),
        client.delete(f"{API}/goals/{g['id']}", headers=hb),
    ):
        err(r, 404, "goal_not_found")
    assert ok(client.get(f"{API}/goals", headers=hb))["count"] == 0
    # Reusing another user's id is a conflict, never a takeover.
    err(client.post(f"{API}/goals", headers=hb, json={"id": g["id"], "metric": "life",
        "label": "L", "target": 1}), 409, "id_conflict")  # fmt: skip


def test_role_less_user_is_403(client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db, assign_default_role=False)
    h = user_authentication_headers(email=user.email, password=password)
    err(client.get(f"{API}/today", headers=h), 403)
    err(client.post(f"{API}/goals", headers=h, json={"metric": "life", "label": "x",
        "target": 1}), 403)  # fmt: skip


def test_pagination_bounds(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    for i in range(3):
        ok(client.post(f"{API}/goals", headers=h, json={"metric": "life",
            "label": f"L{i}", "target": i + 1}))  # fmt: skip
    page = ok(client.get(f"{API}/goals", headers=h, params={"skip": 1, "limit": 1}))
    assert page["count"] == 3 and len(page["data"]) == 1
    err(client.get(f"{API}/goals", headers=h, params={"limit": 101}), 422)
    err(client.get(f"{API}/notifications", headers=h, params={"skip": -1}), 422)


# ---------------------------------------------------------------- reviews


def test_reviews(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    today = ok(client.get(f"{STATS}/today", headers=h))["day"]
    key = monday_key(today)
    r = ok(client.put(f"{API}/reviews/{key}", headers=h, json={"reflection": "ok"}))
    assert r["done"] is False and r["done_at"] is None
    r2 = ok(client.put(f"{API}/reviews/{key}", headers=h,
                       json={"done": True, "focus": "tasks:tasks.onTime"}))  # fmt: skip
    assert (
        r2["id"] == r["id"]
        and r2["done"]
        and r2["done_at"]
        and r2["reflection"] == "ok"
    )
    err(client.put(f"{API}/reviews/w-2026-10-13", headers=h, json={}), 422,
        "review_key_invalid")  # fmt: skip
    err(client.put(f"{API}/reviews/{key}", headers=h, json={"focus": "x"}), 422)
    assert ok(client.get(f"{API}/reviews", headers=h))["count"] == 1


@CAPTURE_STUB
def test_review_reflection_goes_to_journal(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    key = monday_key(ok(client.get(f"{STATS}/today", headers=h))["day"])
    ok(client.put(f"{API}/reviews/{key}", headers=h,
                  json={"reflection": "Good week", "journal": True}))  # fmt: skip


# ---------------------------------------------------------------- wrap-up


def test_seal_and_unseal(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    hid = uuid.uuid4()
    write(user, lambda ctx: habits_public.create_habit(ctx, name="Walk", habit_id=hid))
    state = ok(client.get(f"{API}/wrap-up", headers=h))
    assert state["sealed"] is None and state["on_target_now"] is False
    before = ok(client.get(f"{STATS}/overview", headers=h))
    assert before["days_series"][-1]["on_target"] is None  # open, short: unscored

    w = ok(client.post(f"{API}/wrap-up/seal", headers=h, json={}))
    assert (w["on_target"], w["done"], w["due"]) == (False, 0, state["ring"]["due"])
    after = ok(client.get(f"{STATS}/overview", headers=h))
    assert after["days_series"][-1]["on_target"] is False  # sealed short: a miss
    db.expire_all()
    life = db.exec(
        select(LifeScoreDaily).where(LifeScoreDaily.owner_id == user.id)
    ).one()
    assert life.on_target is False  # the drain recomputed the sealed day
    assert ok(client.get(f"{API}/today", headers=h))["wrap_up"]["id"] == w["id"]

    ok(client.post(f"{API}/wrap-up/unseal", headers=h))
    err(client.post(f"{API}/wrap-up/unseal", headers=h), 404, "wrap_up_not_found")
    assert (
        ok(client.get(f"{STATS}/overview", headers=h))["days_series"][-1]["on_target"]
        is None
    )
    again = ok(client.post(f"{API}/wrap-up/seal", headers=h, json={}))
    assert again["id"] == w["id"]  # the day's row is revived, not duplicated
    tomorrow = state["day"][:8] + "99"  # invalid -> 422
    err(client.post(f"{API}/wrap-up/seal", headers=h, json={"day": tomorrow}), 422)


def test_seal_future_day_refused(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    with ctx_for(user) as ctx:
        future = (ctx.today + timedelta(days=1)).isoformat()
    err(client.post(f"{API}/wrap-up/seal", headers=h, json={"day": future}), 422,
        "wrapup_future")  # fmt: skip


@CAPTURE_STUB
def test_seal_with_reflection_goes_to_journal(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ok(client.post(f"{API}/wrap-up/seal", headers=h, json={"reflection": "Calm day"}))


def test_wrap_up_actions(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    a, b = uuid.uuid4(), uuid.uuid4()

    def setup(ctx: Ctx) -> uuid.UUID:
        habits_public.create_habit(ctx, name="A", habit_id=a)
        habits_public.create_habit(ctx, name="B", habit_id=b)
        (t,) = tasks_public.create_tasks(
            ctx, [tasks_public.TaskDraft(title="T", due_date=ctx.today)]
        )
        return t.id

    tid = write(user, setup)
    r = ok(client.post(f"{API}/wrap-up/actions", headers=h,
                       json={"kind": "check_habit", "id": str(a)}))  # fmt: skip
    assert r["ring"]["per"]["habits"] == {"due": 2, "done": 1}
    r = ok(client.post(f"{API}/wrap-up/actions", headers=h,
                       json={"kind": "skip_habit", "id": str(b)}))  # fmt: skip
    assert r["ring"]["per"]["habits"] == {"due": 1, "done": 1}  # skipped: not due
    r = ok(client.post(f"{API}/wrap-up/actions", headers=h,
                       json={"kind": "complete_task", "id": str(tid)}))  # fmt: skip
    assert r["ring"]["per"]["tasks"]["done"] == 1
    _, hb = signed_in(db)
    err(client.post(f"{API}/wrap-up/actions", headers=hb,
                    json={"kind": "check_habit", "id": str(a)}), 404)  # fmt: skip
    err(client.post(f"{API}/wrap-up/actions", headers=h,
                    json={"kind": "nope", "id": str(a)}), 422)  # fmt: skip


# ---------------------------------------------------------------- inbox + notify


def test_notify_dedupes_and_inbox_actions(
    client: TestClient, db: Session, rec: Rec
) -> None:
    user, h = signed_in(db)

    def post(ctx: Ctx) -> Any:
        return dashboard_public.notify(
            ctx, kind="reminder", title="Water", body="Drink", dedupe_key="k1"
        )

    first = write(user, post)
    assert first is not None
    assert write(user, post) is None  # same key: no second row
    assert [e[1] for e in rec.events] == ["dashboard.notification"]
    assert rec.events[0][0] == user.id and rec.events[0][2]["title"] == "Water"
    assert rec.pushed == []  # push=False

    inbox = ok(client.get(f"{API}/notifications", headers=h))
    assert (inbox["count"], inbox["unread"]) == (1, 1)
    nid = inbox["data"][0]["id"]
    assert ok(client.post(f"{API}/notifications/{nid}/read", headers=h))["read"] is True
    write(user, lambda ctx: dashboard_public.notify(ctx, kind="system", title="Two"))
    assert ok(client.get(f"{API}/notifications", headers=h))["unread"] == 1
    ok(client.post(f"{API}/notifications/read-all", headers=h))
    assert ok(client.get(f"{API}/notifications", headers=h))["unread"] == 0

    ok(client.delete(f"{API}/notifications/{nid}", headers=h))
    assert ok(client.get(f"{API}/notifications", headers=h))["count"] == 1
    # Dismissed reminders are not re-posted under the same key.
    assert write(user, post) is None
    assert ok(client.post(f"{API}/notifications/{nid}/restore", headers=h))["id"] == nid
    assert ok(client.get(f"{API}/notifications", headers=h))["count"] == 2

    _, hb = signed_in(db)
    err(client.post(f"{API}/notifications/{nid}/read", headers=hb), 404)
    err(client.delete(f"{API}/notifications/{nid}", headers=hb), 404)
    assert ok(client.get(f"{API}/notifications", headers=hb))["count"] == 0


def test_notify_to_another_recipient(db: Session, rec: Rec) -> None:
    a, _ = signed_in(db)
    b, _ = signed_in(db)
    row = write(a, lambda ctx: dashboard_public.notify(
        ctx, kind="social", title="Hi", dedupe_key="same", recipient_id=b.id))  # fmt: skip
    assert row is not None and row.owner_id == b.id
    # The same key for a different recipient is a different notification.
    assert write(a, lambda ctx: dashboard_public.notify(
        ctx, kind="social", title="Hi", dedupe_key="same")) is not None  # fmt: skip
    assert {e[0] for e in rec.events} == {a.id, b.id}


def test_push_goes_through_sender_and_disables_dead_tokens(
    client: TestClient, db: Session, rec: Rec
) -> None:
    user, h = signed_in(db)
    good, dead = "ExponentPushToken[good-one]", "ExponentPushToken[dead-one]"
    for t in (good, dead):
        ok(client.post(f"{PROFILE}/push-devices", headers=h,
                       json={"token": t, "platform": "ios"}))  # fmt: skip
    rec.dead.add(dead)
    row = write(user, lambda ctx: dashboard_public.notify(
        ctx, kind="reminder", title="Pay rent", body="Today", href="/finance",
        dedupe_key="rent", push=True))  # fmt: skip
    assert sorted(m.token for m in rec.pushed) == sorted([good, dead])
    assert {m.title for m in rec.pushed} == {"Pay rent"}
    assert rec.pushed[0].data["href"] == "/finance"
    db.expire_all()
    devices = {d.token: d for d in db.exec(select(PushDevice).where(
        PushDevice.owner_id == user.id)).all()}  # fmt: skip
    assert devices[dead].disabled_at is not None
    assert devices[good].disabled_at is None
    note = db.get(Notification, row.id)
    assert note is not None and note.pushed_at is not None

    rec.pushed.clear()
    write(user, lambda ctx: dashboard_public.notify(
        ctx, kind="reminder", title="Again", push=True))  # fmt: skip
    assert [m.token for m in rec.pushed] == [good]  # the dead token is skipped


def test_rolled_back_notify_sends_nothing(db: Session, rec: Rec) -> None:
    user, _ = signed_in(db)
    with ctx_for(user) as ctx:
        dashboard_public.notify(ctx, kind="system", title="Ghost", push=True)
        ctx.session.rollback()
    assert rec.events == [] and rec.pushed == []
    db.expire_all()
    assert (
        db.exec(select(Notification).where(Notification.owner_id == user.id)).first()
        is None
    )


def test_miss_notes(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ok(
        client.put(
            f"{API}/misses/miss-x-2026-10-01/note", headers=h, json={"note": " why "}
        )
    )
    with ctx_for(user) as ctx:
        assert dashboard_public.miss_notes(ctx, ["miss-x-2026-10-01"]) == {
            "miss-x-2026-10-01": "why"
        }
    ok(
        client.put(
            f"{API}/misses/miss-x-2026-10-01/note", headers=h, json={"note": "  "}
        )
    )
    with ctx_for(user) as ctx:
        assert dashboard_public.miss_notes(ctx, ["miss-x-2026-10-01"]) == {}
    ok(
        client.put(
            f"{API}/misses/miss-x-2026-10-01/note", headers=h, json={"note": "b"}
        )
    )
    with ctx_for(user) as ctx:
        assert dashboard_public.miss_notes(ctx, ["miss-x-2026-10-01"]) == {
            "miss-x-2026-10-01": "b"
        }


# ---------------------------------------------------------------- share


def test_share_defaults_and_cards_never_carry_money(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    ok(client.patch(PROFILE, headers=h, json={"name": "Kai"}))
    ok(client.post(f"{settings.API_V1_STR}/finance/start-fresh", headers=h))
    ok(client.post(f"{settings.API_V1_STR}/finance/accounts", headers=h,
                   json={"name": "Wallet", "type": "cash"}))  # fmt: skip
    from app.modules.finance import public as finance_public

    write(user, lambda ctx: finance_public.log_income(ctx, amount_minor=1_234_500))
    write(user, lambda ctx: finance_public.log_expense(ctx, amount_minor=432_100))

    templates = ok(client.get(f"{API}/share/templates", headers=h))
    assert [t["key"] for t in templates] == ["life", "weekly", "monthly", "streak",
                                             "finance", "profile", "goal"]  # fmt: skip
    for t in templates:
        card = ok(client.get(f"{API}/share/{t['key']}/card", headers=h))
        blob = json.dumps(card, ensure_ascii=False)
        assert "₱" not in blob and "12345" not in blob and "4321" not in blob, t["key"]
        assert "handle" not in card["data"]  # off by default
    fin = ok(client.get(f"{API}/share/finance/card", headers=h))["data"]
    assert fin["savings30"]["value"].endswith("%")

    err(client.put(f"{API}/share/life/defaults", headers=h,
                   json={"fields": {"bogus": True}}), 422, "share_field_unknown")  # fmt: skip
    err(client.put(f"{API}/share/nope/defaults", headers=h, json={"fields": {}}), 422)
    ok(client.put(f"{API}/share/profile/defaults", headers=h,
                  json={"fields": {"handle": True, "identity": True}}))  # fmt: skip
    prof = ok(client.get(f"{API}/share/profile/card", headers=h))
    assert prof["fields"]["handle"] is True and "handle" in prof["data"]
    assert "identities" in prof["data"] and "photo_media_id" not in prof["data"]
    again = ok(client.put(f"{API}/share/profile/defaults", headers=h,
                          json={"fields": {"handle": False}}))  # fmt: skip
    assert again["fields"] == {"handle": False}
    t = {x["key"]: x for x in ok(client.get(f"{API}/share/templates", headers=h))}
    assert {f["key"]: f["on"] for f in t["profile"]["fields"]}["identity"] is False


# ---------------------------------------------------------------- onboarding, today


def test_onboarding_creates_starters_once(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    out = ok(client.post(f"{API}/onboarding", headers=h,
                         json={"modules": ["habits", "fitness"], "pace": "steady",
                               "targets": {"fitness": 5}}))  # fmt: skip
    got = {g["metric"]: g for g in out["created"]}
    assert got["habits:habits.rate"]["target"] == 80
    assert got["fitness:sessions"]["target"] == 5
    assert all(g["via"] == "onboarding" for g in out["created"])
    again = ok(client.post(f"{API}/onboarding", headers=h,
                           json={"modules": ["habits", "finance"]}))  # fmt: skip
    assert again["skipped"] == ["habits"]
    assert [g["metric"] for g in again["created"]] == ["finance:savings-rate"]
    assert again["created"][0]["target"] == 10  # gentle
    err(client.post(f"{API}/onboarding", headers=h, json={"modules": ["social"]}), 422)


def test_today_bundle(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    hid = uuid.uuid4()
    write(user, lambda ctx: habits_public.create_habit(ctx, name="Plan", habit_id=hid))
    write(user, lambda ctx: dashboard_public.notify(ctx, kind="system", title="Hey"))
    t = ok(client.get(f"{API}/today", headers=h))
    assert t["counts"]["unread"] == 1
    assert t["counts"]["items"] == 1 and t["counts"]["items_done"] == 0
    assert t["next_up"]["title"].endswith("Plan")
    assert t["ring"]["per"]["habits"] == {"due": 1, "done": 0}
    assert t["wrap_up"] is None and t["level"]
    ov = ok(client.get(f"{STATS}/overview", headers=h))
    assert t["life_score"] == ov["life_score"]  # one statistic everywhere


# ---------------------------------------------------------------- sync


def test_sync_entities_and_actions(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    gid = uuid.uuid4()
    (r,) = sync_push(client, h, op("upsert", "goal", gid, metric="life", label="L",
                                   target=70))  # fmt: skip
    assert r["status"] == "applied" and r["row"]["status"] == "active"
    create = op("upsert", "goal", gid, target=72)
    (r,) = sync_push(client, h, create)
    assert r["row"]["target"] == 72 and r["row"]["label"] == "L"
    (replay,) = sync_push(client, h, create)
    assert replay["replayed"] is True
    (r,) = sync_push(client, h, op("upsert", "goal", uuid.uuid4(), label="x"))
    assert r["status"] == "rejected" and r["code"] == "missing_fields"
    (r,) = sync_push(client, h, op("upsert", "goal", uuid.uuid4(), metric="bad",
                                   label="x", target=1))  # fmt: skip
    assert r["code"] == "goal_metric_invalid"

    key = monday_key(ok(client.get(f"{STATS}/today", headers=h))["day"])
    r1 = sync_push(client, h, op("upsert", "review", uuid.uuid4(), key=key, done=True))[
        0
    ]
    r2 = sync_push(client, h, op("upsert", "review", uuid.uuid4(), key=key,
                                 reflection="b"))[0]  # fmt: skip
    assert r1["row"]["id"] == r2["row"]["id"]  # one review per period
    assert r2["row"]["done"] is True and r2["row"]["done_at"]

    (r,) = sync_push(client, h, op("action", "dashboard.seal_day"))
    assert r["status"] == "applied" and r["result"]["wrap_up"]["done"] == 0
    wid = r["result"]["wrap_up"]["id"]
    (r,) = sync_push(client, h, op("delete", "wrap_up", wid))
    assert r["status"] == "applied"
    db.expire_all()
    w = db.get(WrapUp, uuid.UUID(wid))
    assert w is not None and w.deleted_at is not None

    row = write(
        user, lambda ctx: dashboard_public.notify(ctx, kind="system", title="N")
    )
    (r,) = sync_push(client, h, op("upsert", "notification", row.id, read=True))
    assert r["row"]["read"] is True
    (r,) = sync_push(client, h, op("upsert", "notification", uuid.uuid4(), read=True))
    assert r["status"] == "rejected" and r["code"] == "notification_not_found"
    (r,) = sync_push(client, h, op("delete", "notification", row.id))
    assert r["status"] == "applied"
    (r,) = sync_push(client, h, op("upsert", "notification", row.id, deleted_at=None))
    assert r["status"] == "applied"  # undo of a dismiss

    (r,) = sync_push(client, h, op("upsert", "share_default", uuid.uuid4(),
                                   template="goal", fields={"target": False}))  # fmt: skip
    assert r["row"]["fields"] == {"target": False}
    (r,) = sync_push(client, h, op("upsert", "share_default", uuid.uuid4(),
                                   template="goal", fields={"nope": True}))  # fmt: skip
    assert r["code"] == "share_field_unknown"
    (r,) = sync_push(client, h, op("upsert", "miss_note", uuid.uuid4(),
                                   miss_key="m1", note="n"))  # fmt: skip
    assert r["row"]["note"] == "n"
    (r,) = sync_push(client, h, op("action", "dashboard.mark_all_read"))
    assert r["status"] == "applied"
    (r,) = sync_push(client, h, op("action", "dashboard.onboarding", modules=["tasks"]))
    assert r["result"]["created"][0]["metric"] == "tasks:tasks.onTime"

    pulled = ok(
        client.get(f"{SYNC}/pull", headers=h, params={"cursor": 0, "limit": 500})
    )
    names = {c["entity"] for c in pulled["changes"]}
    assert {"goal", "review", "wrap_up", "notification", "share_default",
            "miss_note"} <= names  # fmt: skip
    tomb = [c for c in pulled["changes"] if c["entity"] == "wrap_up"]
    assert tomb and tomb[-1]["deleted"] is True

    _, hb = signed_in(db)
    (r,) = sync_push(client, hb, op("upsert", "goal", gid, target=1))
    assert r["status"] == "rejected"  # another user's id is never theirs
