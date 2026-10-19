"""The aggregate statistic end to end: real GoTrue users, real module writes,
the after-commit dirty drain and the rollup rows."""

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.modules.finance import public as finance_public
from app.modules.fitness import public as fitness_public
from app.modules.habits import public as habits_public
from app.modules.stats import logic as L
from app.modules.stats import rollups
from app.modules.stats.models import DailyModuleStat, LifeScoreDaily
from app.modules.tasks import public as tasks_public
from app.shared.context import Ctx
from tests.utils.mobile import ctx_for, signed_in
from tests.utils.user import create_auth_user, user_authentication_headers

API = f"{settings.API_V1_STR}/stats"
PROFILE = f"{settings.API_V1_STR}/profile"
SYNC = f"{settings.API_V1_STR}/sync"


def ok(r: Any, status: int = 200) -> Any:
    assert r.status_code == status, r.text
    return r.json()


def err(r: Any, status: int, code: str | None = None) -> dict[str, Any]:
    assert r.status_code == status, r.text
    body: dict[str, Any] = r.json()
    if code is not None:
        assert body["code"] == code, body
    return body


def overview(client: TestClient, h: dict[str, str], rng: str = "7d") -> dict[str, Any]:
    out: dict[str, Any] = ok(
        client.get(f"{API}/overview", headers=h, params={"range": rng})
    )
    return out


def areas(ov: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {a["module"]: a for a in ov["areas"]}


def module_row(db: Session, owner: uuid.UUID, module: str) -> DailyModuleStat | None:
    db.expire_all()
    return db.exec(
        select(DailyModuleStat).where(
            DailyModuleStat.owner_id == owner, DailyModuleStat.module == module
        )
    ).first()


def life_rows(db: Session, owner: uuid.UUID) -> list[LifeScoreDaily]:
    db.expire_all()
    return list(
        db.exec(select(LifeScoreDaily).where(LifeScoreDaily.owner_id == owner)).all()
    )


def write(user: Any, fn: Any) -> None:
    """Run one module write through its public contract as a use case."""
    with ctx_for(user) as ctx:
        fn(ctx)
        ctx.commit()


# ---------------------------------------------------------------- shape


def test_empty_user_overview(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ov = overview(client, h)
    assert ov["range"] == "7d" and ov["days"] == 7
    assert [a["module"] for a in ov["areas"]] == list(L.MODULE_KEYS)
    assert ov["gate_open"] is False and ov["logged_days"] == 0
    assert ov["on_target"]["threshold"] == 0.8
    assert len(ov["days_series"]) == 7
    assert [f["key"] for f in ov["facets"]] == [
        "habits", "routines", "tasks", "training", "nutrition", "finance",
    ]  # fmt: skip
    # The score is exactly the weighted mean of the reported area rates.
    rates = {k: a["rate"] for k, a in areas(ov).items()}
    weights = {k: a["weight"] for k, a in areas(ov).items()}
    enabled = {k: a["enabled"] for k, a in areas(ov).items()}
    assert ov["life_score"] == L.life_score_of(rates, weights, enabled)


def test_ranges_and_validation(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    for rng, days in (("30d", 30), ("90d", 90), ("1y", 365)):
        ov = overview(client, h, rng)
        assert ov["days"] == days and len(ov["days_series"]) == days
    err(client.get(f"{API}/overview", headers=h, params={"range": "2d"}), 422)
    err(
        client.get(
            f"{API}/calendar",
            headers=h,
            params={"from": "2026-01-10", "to": "2026-01-01"},
        ),
        422,
        "range_invalid",
    )
    err(
        client.get(
            f"{API}/misses",
            headers=h,
            params={"from": "2024-01-01", "to": "2026-01-01"},
        ),
        422,
        "range_too_long",
    )
    err(client.get(f"{API}/calendar", headers=h, params={"limit": 101}), 422)


def test_role_less_user_is_403(client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db, assign_default_role=False)
    h = user_authentication_headers(email=user.email, password=password)
    err(client.get(f"{API}/overview", headers=h), 403)
    err(client.get(f"{API}/today", headers=h), 403)


# ---------------------------------------------------------------- writes move it


def test_a_write_in_each_module_moves_overview_and_rollups(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    before = overview(client, h)
    assert life_rows(db, user.id) == []

    # habits: a daily habit done today
    hid = uuid.uuid4()

    def habit(ctx: Ctx) -> None:
        habits_public.create_habit(ctx, name="Read", habit_id=hid)
        habits_public.log_habit(ctx, habit_id=hid, day=ctx.today, status="done")

    write(user, habit)
    after_h = overview(client, h)
    assert areas(after_h)["habits"]["rate"] != areas(before)["habits"]["rate"]
    assert after_h["today"]["per"]["habits"] == {"due": 1, "done": 1}
    row = module_row(db, user.id, "habits")
    assert row is not None and (row.due, row.done) == (1, 1)
    assert row.id == rollups.module_stat_id(user.id, "habits", row.day)
    (life,) = life_rows(db, user.id)
    assert (life.due, life.done, life.on_target) == (1, 1, True)

    # tasks: a task due today, completed
    def task(ctx: Ctx) -> None:
        (t,) = tasks_public.create_tasks(
            ctx, [tasks_public.TaskDraft(title="Ship", due_date=ctx.today)]
        )
        tasks_public.complete_task(ctx, task_id=t.id)

    write(user, task)
    row = module_row(db, user.id, "tasks")
    assert row is not None and row.done >= 1
    after_t = overview(client, h)
    assert after_t["today"]["per"]["tasks"]["done"] >= 1
    (life,) = life_rows(db, user.id)
    assert (life.due, life.done) == (2, 2)  # one habit + one task item today

    # fitness: a weigh-in (always due) moves the fitness day
    fit = module_row(db, user.id, "fitness")
    done_before = fit.done if fit else 0
    write(user, lambda ctx: fitness_public.log_weigh_in(ctx, kg=80.0))
    fit = module_row(db, user.id, "fitness")
    assert fit is not None and fit.done == done_before + 1
    assert overview(client, h)["today"]["per"]["fitness"]["done"] >= 1

    # finance: income moves the savings rate
    ok(client.post(f"{settings.API_V1_STR}/finance/start-fresh", headers=h))
    ok(
        client.post(
            f"{settings.API_V1_STR}/finance/accounts",
            headers=h,
            json={"name": "Wallet", "type": "cash"},
        )
    )
    fin_before = areas(overview(client, h, "30d"))["finance"]["rate"]
    write(user, lambda ctx: finance_public.log_income(ctx, amount_minor=5_000_000))
    fin_after = areas(overview(client, h, "30d"))["finance"]["rate"]
    assert fin_after != fin_before
    assert module_row(db, user.id, "finance") is not None


def test_rolled_back_write_recomputes_nothing(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    with ctx_for(user) as ctx:
        habits_public.create_habit(ctx, name="Never")
        ctx.session.rollback()
        # A later commit on the same session must not drain the rolled-back
        # write's dirty mark.
        ctx.commit()
    assert life_rows(db, user.id) == []
    assert (
        ok(client.get(f"{API}/today", headers=h))["ring"]["per"]["habits"]["due"] == 0
    )


def test_rebuild_and_seal(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user) as ctx:
        habits_public.create_habit(ctx, name="Walk")
        ctx.commit()
        today = ctx.today
        assert rollups.rebuild(ctx, today - L_days(2), today) == 3
    rows = {r.day: r for r in life_rows(db, user.id)}
    assert len(rows) == 3
    assert rows[today - L_days(1)].sealed and not rows[today].sealed
    with ctx_for(user) as ctx:
        # Yesterday is already sealed by the rebuild: nothing to do.
        assert rollups.seal_yesterday(ctx) is False


def L_days(n: int) -> Any:
    from datetime import timedelta

    return timedelta(days=n)


# ---------------------------------------------------------------- settings


def test_disabling_a_module_or_zero_weight_removes_it(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    hid = uuid.uuid4()

    def habit(ctx: Ctx) -> None:
        habits_public.create_habit(ctx, name="Stretch", habit_id=hid)
        habits_public.log_habit(ctx, habit_id=hid, day=ctx.today, status="done")

    write(user, habit)
    full = overview(client, h)
    assert areas(full)["habits"]["rate"] == 1

    def score_without(ov: dict[str, Any], module: str) -> int | None:
        a = areas(ov)
        return L.life_score_of(
            {k: v["rate"] for k, v in a.items()},
            {k: v["weight"] for k, v in a.items()},
            {k: v["enabled"] and k != module for k, v in a.items()},
        )

    ok(client.patch(f"{PROFILE}/modules/habits", headers=h, json={"enabled": False}))
    off = overview(client, h)
    assert areas(off)["habits"]["enabled"] is False
    assert off["life_score"] == score_without(full, "habits")
    assert off["today"]["per"]["habits"] == {"due": 1, "done": 1}
    assert off["today"]["due"] == full["today"]["due"] - 1
    assert next(f for f in off["facets"] if f["key"] == "habits")["off"] is True
    assert not any(m["module"] == "habits" for m in off["metrics"])

    ok(
        client.patch(
            f"{PROFILE}/modules/habits", headers=h, json={"enabled": True, "weight": 0}
        )
    )
    zero = overview(client, h)
    assert areas(zero)["habits"]["weight"] == 0
    assert zero["life_score"] == score_without(full, "habits")


def test_threshold_moves_on_target(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ids = [uuid.uuid4(), uuid.uuid4()]

    def habits(ctx: Ctx) -> None:
        for i, hid in enumerate(ids):
            habits_public.create_habit(ctx, name=f"H{i}", habit_id=hid)
        habits_public.log_habit(ctx, habit_id=ids[0], day=ctx.today, status="done")

    write(user, habits)
    today = ok(client.get(f"{API}/today", headers=h))
    # Two habits plus fitness's weigh-in and workout: 1 of 4 done.
    assert (today["ring"]["due"], today["ring"]["done"]) == (4, 1)
    assert today["on_target_now"] is False
    ok(client.patch(PROFILE, headers=h, json={"target_threshold": 0.25}))
    assert ok(client.get(f"{API}/today", headers=h))["on_target_now"] is True


# ---------------------------------------------------------------- isolation


def test_second_user_never_sees_first_users_data(
    client: TestClient, db: Session
) -> None:
    a, ha = signed_in(db)
    b, hb = signed_in(db)
    empty = overview(client, hb)
    hid = uuid.uuid4()

    def habit(ctx: Ctx) -> None:
        habits_public.create_habit(ctx, name="Mine", habit_id=hid)
        habits_public.log_habit(ctx, habit_id=hid, day=ctx.today, status="done")

    write(a, habit)
    assert areas(overview(client, ha))["habits"]["rate"] == 1
    other = overview(client, hb)
    assert other["life_score"] == empty["life_score"]
    assert other["areas"] == empty["areas"]
    assert other["today"] == empty["today"]
    assert life_rows(db, b.id) == []
    cal = ok(client.get(f"{API}/calendar", headers=hb))
    assert cal["count"] == 0


# ---------------------------------------------------------------- feeds


def test_feeds_and_series(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    hid = uuid.uuid4()

    def habit(ctx: Ctx) -> None:
        habits_public.create_habit(ctx, name="Journal", habit_id=hid, time="21:00")

    write(user, habit)
    cal = ok(client.get(f"{API}/calendar", headers=h))
    assert cal["count"] == 1 and cal["data"][0]["module"] == "habits"
    assert (
        ok(client.get(f"{API}/calendar", headers=h, params={"limit": 0}))["data"] == []
    )
    ok(client.get(f"{API}/misses", headers=h))
    ach = ok(client.get(f"{API}/achievements", headers=h))
    assert ach["count"] == len(ach["data"]) > 0
    assert {a["id"] for a in ach["data"]} >= {"streak-7", "best-week", "first-goal"}
    assert ach["unseen"] == len(ach["trophies"])
    ok(client.get(f"{API}/facets", headers=h, params={"range": "30d"}))
    today = ok(client.get(f"{API}/today", headers=h))
    assert today["ring"]["per"]["habits"]["due"] == 1
    life = ok(client.get(f"{API}/metrics/life", headers=h))
    assert life["ref"] == "life" and life["week"]["label"] == "Life Score"
    err(client.get(f"{API}/metrics/nope:thing", headers=h), 404, "metric_not_found")
    for metric in ok(client.get(f"{API}/series/metrics", headers=h)):
        for days in (7, 90):
            s = ok(
                client.get(
                    f"{API}/series", headers=h, params={"metric": metric, "days": days}
                )
            )
            assert s["metric"] == metric
            if metric == "spendCats":
                assert s["kind"] == "donut"
    err(client.get(f"{API}/series", headers=h, params={"metric": "bogus"}), 422)
    err(
        client.get(f"{API}/series", headers=h, params={"metric": "life", "days": 0}),
        422,
    )


def test_trophy_seen_follows_profile(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    hid = uuid.uuid4()

    def habit(ctx: Ctx) -> None:
        habits_public.create_habit(ctx, name="Floss", habit_id=hid)
        habits_public.log_habit(ctx, habit_id=hid, day=ctx.today, status="done")

    write(user, habit)
    ach = ok(client.get(f"{API}/achievements", headers=h))
    earned = [t["id"] for t in ach["trophies"]]
    assert earned  # first on-target day at least
    ok(client.patch(PROFILE, headers=h, json={"seen_trophies": earned}))
    again = ok(client.get(f"{API}/achievements", headers=h))
    assert again["unseen"] == 0 and all(t["seen"] for t in again["trophies"])


# ---------------------------------------------------------------- sync


def test_rollups_pull_but_never_push(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    write(user, lambda ctx: habits_public.create_habit(ctx, name="Sync"))
    pulled = ok(
        client.get(f"{SYNC}/pull", headers=h, params={"cursor": 0, "limit": 500})
    )
    names = {c["entity"] for c in pulled["changes"]}
    assert {"daily_module_stat", "life_score_daily"} <= names
    row = next(c for c in pulled["changes"] if c["entity"] == "life_score_daily")
    assert row["row"]["due"] == 1
    res = ok(
        client.post(
            f"{SYNC}/push",
            headers=h,
            json={
                "ops": [
                    {
                        "op_id": str(uuid.uuid4()),
                        "kind": "upsert",
                        "name": "life_score_daily",
                        "id": row["id"],
                        "data": {"score": 100},
                    }
                ]
            },
        )
    )
    assert res["results"][0]["status"] == "rejected"
    assert res["results"][0]["code"] == "unknown_entity"
