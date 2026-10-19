"""Dashboard rules: the static tables against the prototype, review keys,
metric refs and the no-money rule for share cards."""

import json
from datetime import date
from pathlib import Path
from typing import Any

from app.modules.dashboard import logic as D
from app.modules.stats import logic as L

GOLDEN = Path(__file__).resolve().parents[3] / "golden"


def tables() -> dict[str, Any]:
    data: dict[str, Any] = json.loads((GOLDEN / "dashboard-tables.json").read_text())[
        "data"
    ]
    return data


def _field(f: D.ShareField) -> dict[str, Any]:
    out: dict[str, Any] = {"key": f.key, "label": f.label, "on": f.on}
    if f.sensitive is not None:
        out["sensitive"] = f.sensitive
    return out


def test_share_templates_match_prototype() -> None:
    t = tables()
    assert [_field(f) for f in D.COMMON] == t["common"]
    assert list(D.TEMPLATES) == [x["key"] for x in t["templates"]]
    for x in t["templates"]:
        label, formats, fields = D.TEMPLATES[x["key"]]
        assert label == x["label"]
        assert list(formats) == x["formats"]
        assert [_field(f) for f in fields] == x["fields"]


def test_paces_and_starters_match_prototype() -> None:
    t = tables()
    assert {k: (p.label, p.note, p.targets) for k, p in D.PACES.items()} == {
        k: (p["label"], p["note"], p["targets"]) for k, p in t["paces"].items()
    }
    for k, s in t["starters"].items():
        mine = D.STARTERS[k]
        assert (mine.metric, mine.label, mine.target, mine.unit, mine.comparator,
                mine.period, mine.hint) == (s["metric"], s["label"], s["target"],
                s["unit"], s["comparator"], s["period"], s["hint"])  # fmt: skip
    for row, (_k, s) in zip(t["fmtGoal"], D.STARTERS.items(), strict=True):
        spec = L.GoalSpec("x", s.metric, s.label, s.target, s.unit, s.comparator,
                          s.period, date(2026, 1, 1), "active")  # fmt: skip
        assert L.fmt_goal(spec) == row["text"]


def test_resolve_fields_overlays_and_drops_unknown() -> None:
    got = D.resolve_fields("profile", {"photo": True, "gone": True})
    assert got["photo"] is True and got["identity"] is False
    assert got["handle"] is False and got["mark"] is True
    assert "gone" not in got
    assert D.unknown_fields("goal", {"target": True, "x": False}) == ["x"]


def test_review_keys() -> None:
    assert D.review_period("w-2026-10-12") == ("week", date(2026, 10, 12))  # Monday
    assert D.review_period("w-2026-10-13") is None  # Tuesday
    assert D.review_period("m-2026-10-01") == ("month", date(2026, 10, 1))
    assert D.review_period("m-2026-10-02") is None
    assert D.review_period("m-2026-02-30") is None
    assert D.review_period("x-2026-10-01") is None
    assert D.review_period("w-2026-10-12 ") is None


def test_metric_refs() -> None:
    for ok in ("life", "onTarget", "habits:habits.rate", "finance:savings-rate"):
        assert D.valid_metric_ref(ok), ok
    for bad in (
        "",
        "lifex",
        "social:x",
        "habits:",
        "habits:a b",
        "fitness:" + "x" * 60,
    ):
        assert not D.valid_metric_ref(bad), bad


def test_scrub_money_drops_any_currency_string() -> None:
    card = {
        "a": "₱12,400",
        "b": ["33%", "PHP 5", {"c": "$3"}],
        "d": 4,
        "e": "spend -12%",
    }
    assert D.scrub_money(card) == {"a": None, "b": ["33%", None, {"c": None}], "d": 4,
                                   "e": "spend -12%"}  # fmt: skip


def test_budgets_pct_rounds_like_js() -> None:
    assert D.budgets_pct("3/4") == 75
    assert D.budgets_pct("1 / 8") == 13  # 12.5 rounds up
    assert D.budgets_pct("0/0") == 0
    assert D.budgets_pct("—") is None
