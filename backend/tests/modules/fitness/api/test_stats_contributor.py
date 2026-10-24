"""The prototype seed written to Postgres, read back through the snapshot
loader and the stats contributor at the golden frozen instant. Every expected
value is read from the prototype's golden output."""

import uuid
from collections.abc import Generator
from datetime import date, timedelta
from typing import Any

import pytest
from sqlmodel import Session

from app.modules.fitness import calc as C
from app.modules.fitness import repo
from app.modules.fitness.models import (
    Exercise,
    FitnessSettings,
    MacroTarget,
    Meal,
    MealItem,
    TemplateItem,
    WeighIn,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
)
from app.modules.fitness.stats import contributor
from app.modules.iam.users.models import User
from app.modules.stats.contract import StatsContributor, Window
from app.shared import owned_repo
from app.shared.context import Ctx
from tests.modules.fitness.unit.golden import load, tsr
from tests.utils.mobile import ctx_for, signed_in

SEED = load("fitness-seed")["data"]
GOLD = load("fitness-calc")["data"]
NOW = tsr(load("fitness-calc")["frozenNow"])
TODAY = date(2026, 10, 18)
NS = uuid.UUID("9b1c2d3e-0000-4000-8000-00000000f175")


def uid(key: str) -> uuid.UUID:
    return uuid.uuid5(NS, key)


def write_seed(ctx: Ctx, salt: str = "") -> None:
    """The prototype seed as rows; ``salt`` keeps a second seeded user's row
    ids apart from the first's."""

    def rid(key: str) -> uuid.UUID:
        return uid(salt + key)

    st = SEED["settings"]
    owned_repo.insert(
        ctx,
        FitnessSettings,
        {
            "units": st["units"],
            "rest_sec": st["restSec"],
            "weekly_target": st["weeklyTarget"],
            "progression": st["progression"],
            "goal_direction": st["goalDirection"],
            "goal_weight": st.get("goalWeight"),
        },
    )
    for e in SEED["exercises"]:
        owned_repo.insert(
            ctx,
            Exercise,
            {
                "name": e["name"],
                "equipment": e["equipment"],
                "muscle": e["muscle"],
                "load_type": e["loadType"],
                "rep_min": e["repMin"],
                "rep_max": e["repMax"],
                "increment": e["increment"],
                "archived": bool(e.get("archived")),
            },
            row_id=rid(e["id"]),
        )
    for order, t in enumerate(SEED["templates"]):
        owned_repo.insert(
            ctx,
            WorkoutTemplate,
            {"name": t["name"], "sort_order": order},
            row_id=rid(t["id"]),
        )
        for pos, i in enumerate(t["items"]):
            owned_repo.insert(
                ctx,
                TemplateItem,
                {
                    "template_id": rid(t["id"]),
                    "exercise_id": rid(i["exerciseId"]),
                    "position": pos,
                    "sets": i["sets"],
                },
            )
    for w in SEED["workouts"]:
        owned_repo.insert(
            ctx,
            Workout,
            {
                "name": w["name"],
                "template_id": rid(w["templateId"]) if w.get("templateId") else None,
                "started_at": tsr(w["startedAt"]),
                "ended_at": tsr(w["endedAt"]) if w.get("endedAt") else None,
                "status": w["status"],
            },
            row_id=rid(w["id"]),
        )
        for pos, we in enumerate(w["exercises"]):
            owned_repo.insert(
                ctx,
                WorkoutExercise,
                {
                    "workout_id": rid(w["id"]),
                    "exercise_id": rid(we["exerciseId"]),
                    "position": pos,
                },
                row_id=rid(we["id"]),
            )
            for i, s in enumerate(we["sets"]):
                owned_repo.insert(
                    ctx,
                    WorkoutSet,
                    {
                        "workout_exercise_id": rid(we["id"]),
                        "position": i,
                        "reps": s["reps"],
                        "weight": s["weight"],
                        "kind": s["kind"],
                        "completed_at": tsr(s["completedAt"])
                        if s.get("completedAt")
                        else None,
                    },
                    row_id=rid(s["id"]),
                )
    for wi in SEED["weighIns"]:
        owned_repo.insert(
            ctx,
            WeighIn,
            {
                "measured_at": tsr(wi["measuredAt"]),
                "weight_kg": wi["weightKg"],
                "body_fat_pct": wi.get("bodyFatPct"),
            },
        )
    for t in SEED["targets"]:
        owned_repo.insert(
            ctx,
            MacroTarget,
            {
                "effective_from": date.fromisoformat(t["effectiveFrom"]),
                "kcal": t["kcal"],
                "protein": t["protein"],
                "carbs": t["carbs"],
                "fat": t["fat"],
            },
            row_id=rid(t["id"]),
        )
    for m in SEED["meals"]:
        owned_repo.insert(
            ctx,
            Meal,
            {
                "eaten_at": tsr(m["eatenAt"]),
                "label": m["label"],
                "source": m["source"],
                "raw_input": m["rawInput"],
                "status": m["status"],
                "confidence": m.get("confidence"),
                "follow_up": m.get("followUp"),
            },
            row_id=rid(m["id"]),
        )
        for pos, i in enumerate(m["items"]):
            owned_repo.insert(
                ctx,
                MealItem,
                {
                    "meal_id": rid(m["id"]),
                    "position": pos,
                    "name": i["name"],
                    "qty": i["qty"],
                    "unit": i["unit"],
                    "kcal": i["kcal"],
                    "protein": i["protein"],
                    "carbs": i["carbs"],
                    "fat": i["fat"],
                    "assumption": i.get("assumption"),
                },
            )
    ctx.session.commit()


@pytest.fixture(scope="module")
def seeded(db: Session) -> Generator[User, None, None]:
    user, _ = signed_in(db)
    with ctx_for(user, now=NOW) as ctx:
        write_seed(ctx)
    yield user


def _ctx(user: User) -> Any:
    return ctx_for(user, now=NOW)


def _gold_period(days: int, end: int) -> dict[str, Any]:
    return next(
        p for p in GOLD["periodSummary"] if p["days"] == days and p["endOffset"] == end
    )


def _gold_adh(days: int, offset: int) -> dict[str, Any]:
    return next(
        a for a in GOLD["adherence"] if a["days"] == days and a["offset"] == offset
    )


def _win(days: int, end_offset: int = 0) -> Window:
    last = TODAY + timedelta(days=end_offset)
    return Window(last - timedelta(days=days - 1), last)


def test_contributor_satisfies_the_contract() -> None:
    c: StatsContributor = contributor
    assert c.key == "fitness"


def test_snapshot_from_postgres_matches_the_prototype(seeded: User) -> None:
    with _ctx(seeded) as ctx:
        assert ctx.today == TODAY
        s = repo.load_state(ctx)
        assert len(C.all_prs(s)) == len(GOLD["allPrs"])
        assert [p.kind for p in C.all_prs(s)] == [p["kind"] for p in GOLD["allPrs"]]
        p = C.period_summary(s, 30, TODAY, NOW)
        g = _gold_period(30, 0)
        assert (p.sessions, p.prs, p.volume, p.session_rate) == (
            g["sessions"],
            g["prs"],
            g["volume"],
            g["sessionRate"],
        )
        assert C.consistency_streak(s, TODAY) == GOLD["consistencyStreak"]
        nt = C.next_template(s)
        assert nt is not None and nt.id == str(uid(GOLD["nextTemplate"]))
        left = C.macros_left(s, TODAY)
        assert left is not None
        assert (left.kcal, left.protein, left.carbs, left.fat) == tuple(
            GOLD["macrosLeftToday"][k] for k in ("kcal", "protein", "carbs", "fat")
        )


def test_area_rate(seeded: User) -> None:
    """Training only: meals count toward the nutrition area (ADR-0024)."""
    with _ctx(seeded) as ctx:
        for days, off in [(7, 0), (30, 0), (30, 30)]:
            p = _gold_period(days, -off)
            assert contributor.area_rate(ctx, _win(days, -off)) == p["sessionRate"]


def test_metrics(seeded: User) -> None:
    with _ctx(seeded) as ctx:
        got = {m.key: m for m in contributor.metrics(ctx, _win(7), _win(7, -7))}
    cur, prev = _gold_period(7, 0), _gold_period(7, -7)
    assert list(got) == ["sessions", "prs", "volume", "overload", "weight"]
    assert (got["sessions"].value, got["sessions"].delta) == (
        str(cur["sessions"]),
        cur["sessions"] - prev["sessions"],
    )
    assert (got["prs"].value, got["prs"].delta) == (
        str(cur["prs"]),
        cur["prs"] - prev["prs"],
    )
    # 17,479 kg this week vs 25,368.9 kg: "17.5t", -31%.
    assert (got["volume"].value, got["volume"].delta) == ("17.5t", -31)
    assert got["overload"].value == f"{round(GOLD['overloadRate']['28'] * 100)}%"
    rate = GOLD["weeklyRate"]
    assert got["weight"].value == "78.6 kg" and got["weight"].delta == -0.32
    assert rate["avg"] == pytest.approx(78.56)
    assert got["weight"].good_when == "down" and got["weight"].shareable is False


def test_misses(seeded: User) -> None:
    with _ctx(seeded) as ctx:
        misses = contributor.misses(ctx, _win(90))
    ids = {m.id for m in misses}
    weeks = GOLD["sessionsByWeek"][:-1]
    first = (TODAY - timedelta(days=89)).isoformat()
    under = {
        f"fit-miss-{w['start']}"
        for w in weeks
        if w["count"] < 4 and w["start"] >= first
    }
    stalled = {f"fit-stall-{uid(k)}" for k, v in GOLD["stalled"].items() if v}
    assert under and stalled
    assert ids == under | stalled
    assert [m.day for m in misses] == sorted((m.day for m in misses), reverse=True)


def test_day_progress_today(seeded: User) -> None:
    with _ctx(seeded) as ctx:
        prog = contributor.day_progress(ctx, [TODAY])[TODAY]
    """The weigh-in and, while the week is short, a workout; the protein
    target is the nutrition ring's."""
    week = GOLD["sessionsByWeek"][-1]["count"]
    due = 1 + (1 if week < 4 else 0)
    done = 1 if TODAY.isoformat() in GOLD["dailyWeights"] else 0
    assert (prog.due, prog.done) == (due, done)


def test_facets_and_achievements(seeded: User) -> None:
    with _ctx(seeded) as ctx:
        facets = {f.key: f for f in contributor.facets(ctx, _win(7), _win(7, -7))}
        ach = {a.id: a for a in contributor.achievements(ctx)}
        cal = contributor.calendar(ctx, _win(7))
    assert facets["training"].value == _gold_period(7, 0)["sessionRate"]
    assert facets["training"].prev == _gold_period(7, -7)["sessionRate"]
    assert "nutrition" not in facets
    p30 = _gold_period(30, 0)["prs"]
    assert ach["pr-30"].earned is (p30 >= 1) and ach["pr-30"].value == str(p30)
    assert ach["first-workout"].earned and ach["first-pr"].earned
    assert len(cal) == _gold_period(7, 0)["sessions"]
    assert all(c.done for c in cal)
