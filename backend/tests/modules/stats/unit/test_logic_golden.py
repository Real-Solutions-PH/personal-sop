"""The aggregation rules against the prototype's own output.

Every expected value is read from ``tests/golden/{dash,stats}-*.json``, which
``scripts/golden/stats.golden.test.ts`` writes by running the prototype's
dashboard hooks over the four modules' seeds at a frozen clock.
"""

import json
from datetime import date, timedelta
from functools import cache
from pathlib import Path
from typing import Any

import pytest

from app.modules.stats import logic as L
from app.modules.stats.contract import Metric

GOLDEN = Path(__file__).resolve().parents[3] / "golden"


@cache
def load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((GOLDEN / f"{name}.json").read_text())["data"]
    return data


def d(s: str) -> date:
    return date.fromisoformat(s)


def metric(m: dict[str, Any]) -> Metric:
    return Metric(
        key=m["key"],
        label=m["label"],
        value=m["value"],
        delta=m.get("delta"),
        good_when=m.get("goodWhen"),
        shareable=m["shareable"],
    )


def metrics(raw: dict[str, list[dict[str, Any]]]) -> dict[str, list[Metric]]:
    return {k: [metric(m) for m in v] for k, v in raw.items()}


def goal_spec(g: dict[str, Any]) -> L.GoalSpec:
    return L.GoalSpec(
        id=g["id"],
        metric=g["metric"],
        label=g["label"],
        target=g["target"],
        unit=g["unit"],
        comparator=g["comparator"],
        period=g["period"],
        created=d(g["createdAt"]),
        status=g["status"],
    )


# ---------------------------------------------------------------- life score


def test_life_score_and_levels() -> None:
    data = load("dash-life-score")
    for c in data["cases"]:
        score = L.life_score_of(c["rates"], c["weights"], c["enabled"])
        assert score == c["score"], c
        assert L.level_for(score).name == c["level"], c
    for lv in data["levels"]:
        assert L.level_for(lv["score"]).name == lv["level"]


def test_js_rounding_is_half_up_not_bankers() -> None:
    assert L.js_round(0.5) == 1
    assert L.js_round(2.5) == 3
    assert L.js_round(-0.5) == 0
    assert L.life_score_of({"habits": 0.625}, {"habits": 1}, {"habits": True}) == 63


def test_unrated_area_is_left_out_not_zeroed() -> None:
    w = {"habits": 3, "tasks": 2, "fitness": 3, "finance": 2}
    on = dict.fromkeys(w, True)
    rates: dict[str, float | None] = {
        "habits": 1.0,
        "tasks": None,
        "fitness": 0.5,
        "finance": None,
    }
    assert L.life_score_of(rates, w, on) == 75
    assert L.life_score_of(dict.fromkeys(w, None), w, on) is None


# ---------------------------------------------------------------- on target


def _items() -> list[L.SeriesItem]:
    return [
        L.SeriesItem(d(i["day"]), i["module"], i["done"])
        for i in load("stats-day-series")["items"]
    ]


@pytest.mark.parametrize("idx", range(18))
def test_day_series_matches_prototype(idx: int) -> None:
    data = load("stats-day-series")
    v = data["variants"][idx]
    today = d(data["today"])
    series = L.day_series(
        _items(),
        today=today,
        length=data["len"],
        enabled=v["enabled"],
        threshold=v["threshold"],
        sealed=[d(x) for x in v["wrapups"]],
    )
    got = [[r.due, r.done, r.on_target] for r in series]
    assert got == v["series"], v["name"]
    assert series[-1].day == today
    s = L.on_target_stats(series)
    assert s.__dict__ == {
        "rate": v["stats"]["rate"],
        "on_target": v["stats"]["onTarget"],
        "scored": v["stats"]["scored"],
        "current": v["stats"]["current"],
        "best": v["stats"]["best"],
    }
    for n, want in v["ranges"].items():
        # useOnTarget(n) runs over its own max(2n, 365)-day series.
        o = L.on_target(series[-L.series_length(int(n)) :], int(n))
        assert (o.rate, o.prev_rate, o.on_target, o.scored) == (
            want["rate"],
            want["prevRate"],
            want["onTarget"],
            want["scored"],
        ), (v["name"], n)
        assert (o.current, o.best, o.logged) == (
            want["current"],
            want["best"],
            want["logged"],
        ), (v["name"], n)


def test_on_target_stats_boundaries() -> None:
    for case in load("stats-day-series")["grid"]:
        series = [
            L.DayResult(d(x["day"]), x["due"], x["done"], x["onTarget"])
            for x in case["series"]
        ]
        s = L.on_target_stats(series)
        want = case["stats"]
        assert (s.rate, s.on_target, s.scored, s.current, s.best) == (
            want["rate"],
            want["onTarget"],
            want["scored"],
            want["current"],
            want["best"],
        ), case


# ---------------------------------------------------------------- metrics, goals


def test_parse_metric_and_unit() -> None:
    for c in load("stats-goals")["parse"]:
        assert L.parse_metric(c["value"]) == c["n"], c
        assert L.unit_of(c["value"]) == c["unit"], c


def test_goal_progress_grid() -> None:
    for c in load("stats-goals")["progress"]:
        p = L.goal_progress(c["comparator"], c["target"], c["current"])
        assert (p.pct, p.hit, p.current) == (c["pct"], c["hit"], c["current"]), c


SEED_WEIGHTS = {"habits": 3, "tasks": 2, "fitness": 3, "nutrition": 2, "finance": 2}


def _books(
    enabled: dict[str, bool] | None = None,
) -> tuple[dict[str, L.BookEntry], dict[str, L.BookEntry]]:
    """The 7- and 30-day books. With every module on, the life scores are the
    prototype's; a variant with a module off re-weights the prototype's area
    rates (the life-score golden pins ``life_score_of`` itself)."""
    data = load("stats-goals")
    on = enabled or dict.fromkeys(L.MODULE_KEYS, True)

    def life(n: str) -> int | None:
        if enabled is None:
            score: int | None = data["life"][n]["score"]
            return score
        return L.life_score_of(data["life"][n]["rates"], SEED_WEIGHTS, on)

    week = L.metric_book(
        metrics(data["metrics"]["7"]), life("7"), data["onTarget"]["7"], on
    )
    month = L.metric_book(
        metrics(data["metrics"]["30"]), life("30"), data["onTarget"]["30"], on
    )
    return week, month


def _entry_json(e: L.BookEntry) -> dict[str, Any]:
    out: dict[str, Any] = {
        "ref": e.ref,
        "label": e.label,
        "module": e.module,
        "value": e.value,
        "n": e.n,
        "unit": e.unit,
        "goodWhen": e.good_when,
        "shareable": e.shareable,
    }
    if e.module != "life":
        out["delta"] = e.delta
    return out


def _strip_missing_delta(entry: dict[str, Any]) -> dict[str, Any]:
    # JSON.stringify drops an undefined delta; the port carries None.
    if entry["module"] != "life" and "delta" not in entry:
        return {**entry, "delta": None}
    return entry


def test_metric_book_matches_prototype() -> None:
    data = load("stats-goals")
    week, month = _books()
    for got, want in ((week, data["book"]["week"]), (month, data["book"]["month"])):
        assert list(got) == list(want)
        for ref, e in got.items():
            assert _entry_json(e) == _strip_missing_delta(want[ref]), ref


def test_goal_views_match_prototype() -> None:
    data = load("stats-goals")
    week, month = _books()
    views = L.goal_views(
        [goal_spec(g) for g in data["seedGoals"]],
        week,
        month,
        metrics(data["metrics"]["30"]),
    )
    assert len(views) == len(data["goals"])
    for v, want in zip(views, data["goals"], strict=True):
        assert v.label == want["goal"]["label"]
        assert v.progress.pct == want["pct"]
        assert v.progress.hit == want["hit"]
        assert v.progress.current == want["current"]
        assert (v.entry.ref if v.entry else None) == (
            want["entry"]["ref"] if want["entry"] else None
        )


# ---------------------------------------------------------------- achievements


def _series_for(case: dict[str, Any]) -> list[L.DayResult]:
    data = load("stats-day-series")
    st = case["state"]
    return L.day_series(
        _items(),
        today=d(data["today"]),
        length=L.series_length(365),
        enabled=st["enabled"],
        threshold=st["threshold"],
        sealed=[d(x) for x in st["wrapups"]],
    )


def _trophy_json(t: L.Trophy | None) -> dict[str, Any] | None:
    if t is None:
        return None
    out: dict[str, Any] = {
        "id": t.id,
        "type": t.type,
        "title": t.title,
        "value": t.value,
        "detail": t.detail,
        "day": t.day.isoformat(),
        "href": t.href,
    }
    if t.share_ref is not None:
        out["shareRef"] = t.share_ref
    return out


@pytest.mark.parametrize("idx", range(6))
def test_achievements_match_prototype(idx: int) -> None:
    gdata = load("stats-goals")
    case = load("stats-achievements")["cases"][idx]
    st = case["state"]
    today = d(load("stats-day-series")["today"])
    series = _series_for(case)
    assert L.on_target(series, 365).current == case["current"]
    week, month = _books(st["enabled"])
    views = L.goal_views(
        [goal_spec(g) for g in st["goals"]],
        week,
        month,
        metrics(gdata["metrics"]["30"]),
    )
    got = L.achievements(
        series=series,
        current=case["current"],
        m30=metrics(gdata["metrics"]["30"]),
        m90=metrics(gdata["metrics"]["90"]),
        goals=views,
        wrapup_days=[d(x) for x in st["wrapups"]],
        enabled=st["enabled"],
        today=today,
    )
    for v, wg in zip(views, case["goals"], strict=True):
        assert (v.label, v.progress.pct, v.progress.hit) == (
            wg["goal"]["label"],
            wg["pct"],
            wg["hit"],
        ), wg["goal"]["id"]
    want = case["achievements"]
    assert [a.id for a in got] == [w["id"] for w in want]
    for a, w in zip(got, want, strict=True):
        assert a.type == w["type"], a.id
        assert a.title == w["title"], a.id
        assert a.requirement == w["requirement"], a.id
        assert a.pct == pytest.approx(w["progress"]["pct"], abs=1e-12), a.id
        assert a.text == w["progress"]["text"], a.id
        assert _trophy_json(a.trophy) == w["trophy"], a.id
    assert [_trophy_json(t) for t in L.trophies(got)] == case["trophies"]


# ---------------------------------------------------------------- facets


@pytest.mark.parametrize("idx", range(6))
def test_facets_compose_like_prototype(idx: int) -> None:
    case = load("stats-facets")["cases"][idx]
    by_key = {f["key"]: f for f in case["facets"]}

    def pair(k: str) -> tuple[float, float]:
        return (by_key[k]["value"], by_key[k]["prev"])

    got = L.compose_facets(
        rates=case["rates"],
        prev_rates=case["prevRates"],
        enabled=case["enabled"],
        routines=pair("routines"),
        training=pair("training"),
        nutrition=pair("nutrition"),
        routine_extra=[metric(m) for m in by_key["routines"]["extra"]],
    )
    assert [f.key for f in got] == [f["key"] for f in case["facets"]]
    for f, w in zip(got, case["facets"], strict=True):
        assert (f.label, f.module, f.href, f.off) == (
            w["label"],
            w["module"],
            w["href"],
            w["off"],
        ), f.key
        assert f.value == w["value"] and f.prev == w["prev"], f.key
        assert (list(f.metric_keys) if f.metric_keys is not None else None) == w[
            "metricKeys"
        ]


def test_series_window_is_inclusive_of_today() -> None:
    today = date(2026, 10, 18)
    s = L.day_series([], today=today, length=3, enabled={}, threshold=0.8)
    assert [r.day for r in s] == [today - timedelta(days=2 - i) for i in range(3)]
