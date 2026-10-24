"""The nutrition stats contributor (ADR-0024) over the prototype seed written
to Postgres, at the golden frozen instant. Meals live in the fitness tables,
so the seed is the fitness one; every expected value is read from the
prototype's golden output."""

from collections.abc import Generator
from datetime import date, timedelta
from typing import Any

import pytest
from sqlmodel import Session

from app.modules.iam.users.models import User
from app.modules.nutrition.stats import contributor
from app.modules.stats.contract import StatsContributor, Window
from tests.modules.fitness.api.test_stats_contributor import (
    GOLD,
    NOW,
    TODAY,
    write_seed,
)
from tests.utils.mobile import ctx_for, signed_in


@pytest.fixture(scope="module")
def seeded(db: Session) -> Generator[User, None, None]:
    user, _ = signed_in(db)
    with ctx_for(user, now=NOW) as ctx:
        write_seed(ctx, salt="nutrition:")
    yield user


def _adh(days: int, offset: int) -> dict[str, Any]:
    return next(
        a for a in GOLD["adherence"] if a["days"] == days and a["offset"] == offset
    )


def _win(days: int, end_offset: int = 0) -> Window:
    last = TODAY + timedelta(days=end_offset)
    return Window(last - timedelta(days=days - 1), last)


def _closed_days(days: int) -> list[dict[str, Any]]:
    """The ``days`` days before today (the adherence window), from the
    prototype's 30 nutrition days."""
    first = (TODAY - timedelta(days=days)).isoformat()
    return [d for d in GOLD["nutritionDays30"] if first <= d["day"] < TODAY.isoformat()]


def test_contributor_satisfies_the_contract() -> None:
    c: StatsContributor = contributor
    assert (c.key, c.label, c.href) == ("nutrition", "Nutrition", "/nutrition")


def test_area_rate(seeded: User) -> None:
    """Calories on target and protein hit averaged over the logged days; a
    window with nothing logged is left out of the Life Score."""
    with ctx_for(seeded, now=NOW) as ctx:
        for days in (7, 30):
            a = _adh(days, 0)
            assert a["logged"]
            assert contributor.area_rate(ctx, _win(days)) == (
                (a["calorie"] + a["protein"]) / 2
            )
        assert _adh(30, 30)["logged"] == 0
        assert contributor.area_rate(ctx, _win(30, -30)) is None


def test_metrics(seeded: User) -> None:
    with ctx_for(seeded, now=NOW) as ctx:
        got = {m.key: m for m in contributor.metrics(ctx, _win(7), _win(7, -7))}
    a = _adh(7, 0)
    assert list(got) == ["calories", "protein", "kcal", "logged"]
    assert got["calories"].value == f"{round(a['calorie'] * 100)}%"
    assert got["protein"].value == f"{round(a['protein'] * 100)}%"
    eaten = [d for d in _closed_days(7) if d["meals"] > 0]
    avg = sum(d["totals"]["kcal"] for d in eaten) / len(eaten)
    assert got["kcal"].value == f"{int(avg + 0.5):,} kcal"
    assert got["kcal"].shareable is False
    assert got["logged"].value == str(len(eaten))


def test_misses(seeded: User) -> None:
    with ctx_for(seeded, now=NOW) as ctx:
        misses = contributor.misses(ctx, _win(30))
    want = {
        f"nut-over-{d['day']}"
        for d in GOLD["nutritionDays30"]
        if d["over"] and d["day"] != TODAY.isoformat()
    }
    assert want
    assert {m.id for m in misses} == want
    assert all(m.module == "nutrition" for m in misses)
    assert all(m.href == f"/nutrition?day={m.day.isoformat()}" for m in misses)


def test_day_progress_today(seeded: User) -> None:
    """The protein target, when a target applies."""
    with ctx_for(seeded, now=NOW) as ctx:
        prog = contributor.day_progress(ctx, [TODAY])[TODAY]
    nut = GOLD["nutritionDays30"][-1]
    assert nut["target"] is not None
    assert (prog.due, prog.done) == (1, 1 if nut["proteinHit"] else 0)


def test_facets(seeded: User) -> None:
    with ctx_for(seeded, now=NOW) as ctx:
        facets = contributor.facets(ctx, _win(7), _win(7, -7))
    assert [f.key for f in facets] == ["nutrition"]
    f = facets[0]
    cur, prev = _adh(7, 0), _adh(7, 7)
    assert f.module == "nutrition" and f.href == "/nutrition"
    assert f.value == (cur["calorie"] + cur["protein"]) / 2
    assert f.prev == (prev["calorie"] + prev["protein"]) / 2


def test_no_target_means_nothing_due(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user, now=NOW) as ctx:
        prog = contributor.day_progress(ctx, [TODAY])[TODAY]
        assert (prog.due, prog.done) == (0, 0)
        assert contributor.area_rate(ctx, _win(7)) is None
        assert contributor.misses(ctx, _win(30)) == []


def test_today_is_the_frozen_day() -> None:
    assert TODAY == date(2026, 10, 18)
