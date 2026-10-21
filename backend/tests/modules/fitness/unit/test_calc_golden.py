"""``calc.py`` against the prototype's own outputs over three states: the
seed, a hand-built edge-case state, and a nutrition boundary grid."""

from datetime import date, datetime
from typing import Any

import pytest

from app.modules.fitness import calc as C
from tests.modules.fitness.unit.golden import load, state_from, tsr

FIXTURES = ("seed", "mini", "grid")


def _case(name: str) -> tuple[C.FitState, dict[str, Any], datetime, date]:
    if name == "seed":
        state = state_from(load("fitness-seed")["data"])
        expected = load("fitness-calc")["data"]
        now = tsr(load("fitness-calc")["frozenNow"])
    else:
        fx = load("fitness-mini" if name == "mini" else "fitness-nutrition-grid")
        state = state_from(fx["data"]["state"])
        expected = fx["data"]["calc"]
        now = tsr(fx["frozenNow"])
    return state, expected, now, state.clock.day_of(now)


@pytest.fixture(params=FIXTURES)
def case(
    request: pytest.FixtureRequest,
) -> tuple[C.FitState, dict[str, Any], datetime, date]:
    return _case(request.param)


def _d(s: str) -> date:
    return date.fromisoformat(s)


def test_frozen_day_is_the_harness_sunday() -> None:
    _, _, now, today = _case("seed")
    assert today == date(2026, 10, 18)
    assert now.hour == 4  # 12:00 Manila


def test_latest_bodyweight(case: Any) -> None:
    s, exp, _, _ = case
    assert C.latest_bodyweight(s) == exp["latestBodyweight"]


def test_ex_stats_every_workout_exercise(case: Any) -> None:
    s, exp, _, _ = case
    m = C.ex_map(s)
    bw = C.latest_bodyweight(s) or 0
    by_id = {(w.id, we.id): we for w in s.workouts for we in w.exercises}
    assert len(exp["exStats"]) == len(by_id)
    for row in exp["exStats"]:
        we = by_id[(row["workoutId"], row["weId"])]
        st = C.ex_stats(we, m.get(we.exercise_id), bw)
        assert st.best_e1rm == row["bestE1rm"], row
        assert st.heaviest == row["heaviest"], row
        assert st.volume == row["volume"], row
        assert st.done_sets == row["doneSets"], row
        assert (st.top.id if st.top else None) == row["topSetId"], row


def test_workout_totals(case: Any) -> None:
    s, exp, now, _ = case
    by_id = {w.id: w for w in s.workouts}
    for row in exp["workoutTotals"]:
        t = C.workout_totals(s, by_id[row["workoutId"]], now)
        assert (t.volume, t.done, t.planned) == (
            row["volume"],
            row["done"],
            row["planned"],
        )
        assert t.duration_sec == row["durationSec"]


def _pr(p: C.Pr) -> dict[str, Any]:
    return {
        "workoutId": p.workout_id,
        "exerciseId": p.exercise_id,
        "kind": p.kind,
        "value": p.value,
        "prev": p.prev,
        "at": p.at,
    }


def test_all_prs(case: Any) -> None:
    s, exp, _, _ = case
    got = [_pr(p) for p in C.all_prs(s)]
    want = [{**p, "at": tsr(p["at"])} for p in exp["allPrs"]]
    assert got == want
    by = C.prs_by_workout(C.all_prs(s))
    assert {k: [p.kind for p in v] for k, v in by.items()} == exp["prsByWorkout"]


def test_prs_with_an_unfinished_extra_workout(case: Any) -> None:
    s, exp, _, _ = case
    done = C.finished(s)
    if not done:
        assert exp["extraPrs"] == []
        return
    last = done[-1]
    extra = C.WorkoutS(
        id="extra",
        name=last.name,
        started_at=last.started_at,
        status="in_progress",
        exercises=last.exercises,
        template_id=last.template_id,
    )
    got = [_pr(p) for p in C.all_prs(s, extra) if p.workout_id == "extra"]
    assert got == [{**p, "at": tsr(p["at"])} for p in exp["extraPrs"]]


def _sug(x: C.Suggestion) -> dict[str, Any]:
    out: dict[str, Any] = {
        "kind": x.kind,
        "weight": x.weight,
        "reps": x.reps,
        "badge": x.badge,
        "detail": x.detail,
    }
    if x.last_reps is not None:
        out["last"] = {"weight": x.last_weight, "reps": x.last_reps}
    return out


def test_suggestion_double_progression(case: Any) -> None:
    s, exp, _, _ = case
    for ex_id, want in exp["suggestions"].items():
        assert _sug(C.suggestion(s, ex_id)) == want, ex_id


def test_suggestion_linear_progression(case: Any) -> None:
    s, exp, _, _ = case
    s.settings.progression = "linear"
    for ex_id, want in exp["linearSuggestions"].items():
        assert _sug(C.suggestion(s, ex_id)) == want, ex_id


def test_seed_reaches_every_suggestion_kind() -> None:
    _, exp, _, _ = _case("seed")
    mini = _case("mini")[1]
    kinds = {v["kind"] for d in (exp, mini) for v in d["suggestions"].values()}
    assert kinds >= {"weight", "reps", "new"}


def test_history_and_stalled(case: Any) -> None:
    s, exp, _, today = case
    for ex_id, want in exp["history"].items():
        hist = C.exercise_history(s, ex_id)
        assert [(h.workout.id, h.stats.best_e1rm) for h in hist] == [
            (h["workoutId"], h["bestE1rm"]) for h in want
        ]
        assert C.is_stalled(s, hist, today) is exp["stalled"][ex_id], ex_id


def test_seed_has_stalled_and_moving_lifts() -> None:
    exp = _case("seed")[1]
    assert True in exp["stalled"].values() and False in exp["stalled"].values()


def test_sessions_by_week_and_streak(case: Any) -> None:
    s, exp, _, today = case
    got = [
        {"start": w.start.isoformat(), "count": w.count}
        for w in C.sessions_by_week(s, 20, today)
    ]
    assert got == exp["sessionsByWeek"]
    assert C.consistency_streak(s, today) == exp["consistencyStreak"]


def _trend(points: list[C.TrendPoint]) -> list[dict[str, Any]]:
    out = []
    for p in points:
        row: dict[str, Any] = {"day": p.day.isoformat()}
        if p.raw is not None:
            row["raw"] = p.raw
        if p.avg is not None:
            row["avg"] = p.avg
        out.append(row)
    return out


def test_weight_trend_and_rate(case: Any) -> None:
    s, exp, _, today = case
    assert {k.isoformat(): v for k, v in C.daily_weights(s).items()} == exp[
        "dailyWeights"
    ]
    assert _trend(C.weight_trend(s, 30, today)) == exp["weightTrend30"]
    assert _trend(C.weight_trend(s, 90, today)) == exp["weightTrend90"]
    r = C.weekly_rate(s, today)
    want = exp["weeklyRate"]
    assert (None if r is None else {"kg": r.kg, "pct": r.pct, "avg": r.avg}) == want


def _macros(m: C.Macros) -> dict[str, float]:
    return {"kcal": m.kcal, "protein": m.protein, "carbs": m.carbs, "fat": m.fat}


def test_nutrition_days(case: Any) -> None:
    s, exp, _, today = case
    got = C.nutrition_days(s, 30, today)
    assert len(got) == len(exp["nutritionDays30"])
    for g, w in zip(got, exp["nutritionDays30"], strict=True):
        assert g.day.isoformat() == w["day"]
        assert _macros(g.totals) == w["totals"], w["day"]
        assert (g.target.id if g.target else None) == (w.get("target") or {}).get("id")
        assert (g.meals, g.kcal_ok, g.protein_hit, g.over, g.verdict) == (
            w["meals"],
            w["kcalOk"],
            w["proteinHit"],
            w["over"],
            w["verdict"],
        ), w["day"]


def test_grid_reaches_every_verdict() -> None:
    exp = _case("grid")[1]
    verdicts = {d["verdict"] for d in exp["nutritionDays30"]}
    assert verdicts == {"hit", "over", "under", "none"}


def test_adherence(case: Any) -> None:
    s, exp, _, today = case
    for row in exp["adherence"]:
        a = C.adherence(s, row["days"], today, row["offset"])
        assert (a.logged, a.calorie, a.protein, a.over_days, a.coverage) == (
            row["logged"],
            row["calorie"],
            row["protein"],
            row["overDays"],
            row["coverage"],
        ), row


def test_overload_rate(case: Any) -> None:
    s, exp, _, today = case
    for days, want in exp["overloadRate"].items():
        assert C.overload_rate(s, int(days), today) == want, days


def test_period_summary(case: Any) -> None:
    s, exp, now, today = case
    for row in exp["periodSummary"]:
        p = C.period_summary(s, row["days"], today, now, row["endOffset"])
        assert (p.sessions, p.target, p.session_rate, p.missed, p.prs, p.volume) == (
            row["sessions"],
            row["target"],
            row["sessionRate"],
            row["missed"],
            row["prs"],
            row["volume"],
        ), row


def test_target_for_is_versioned_by_effective_from(case: Any) -> None:
    s, exp, _, _ = case
    for day, tid in exp["targetFor"].items():
        t = C.target_for(s, _d(day))
        assert (t.id if t else None) == tid, day


def test_next_template(case: Any) -> None:
    s, exp, _, _ = case
    t = C.next_template(s)
    assert (t.id if t else None) == exp["nextTemplate"]


def test_day_totals(case: Any) -> None:
    s, exp, _, _ = case
    for day, want in exp["dayTotals"].items():
        t = C.day_totals(s, _d(day))
        assert _macros(t.totals) == want["totals"]
        assert (t.pending, t.to_review, t.count) == (
            want["pending"],
            want["toReview"],
            want["count"],
        )


def test_macros_left_today() -> None:
    s, exp, _, today = _case("seed")
    left = C.macros_left(s, today)
    assert left is not None
    assert _macros(left) == exp["macrosLeftToday"]
