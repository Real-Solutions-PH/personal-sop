"""``calc.py`` against the prototype's own results over the 90-day seed
(seed 20260926, frozen 2026-10-18 12:00 Asia/Manila)."""

from typing import Any

import pytest

from app.modules.finance import calc
from tests.modules.finance.unit.golden import c, d, data, plan_of, state, statement

S = state()
G = data()


def approx(pesos: float) -> Any:
    return pytest.approx(c(pesos), rel=1e-9, abs=1e-6)


def test_balances_net_worth_and_liquid() -> None:
    bal = calc.balances(S)
    assert bal == {k: round(v * 100) for k, v in G["balances"].items()}
    assert calc.net_worth(S) == round(G["netWorth"] * 100)
    assert calc.liquid(S) == round(G["liquid"] * 100)
    assert calc.liquid(S, bal, ["gcash"]) == round(G["liquidNoGcash"] * 100)
    # A credit card balance is a liability: it runs negative.
    assert bal["bpicc"] < 0


def test_net_worth_and_account_series() -> None:
    assert calc.net_worth_series(S, 90) == [round(x * 100) for x in G["netWorthSeries"]]
    for acct in S.accounts:
        g = G["accounts"][acct.id]
        assert calc.balance_of(S, acct) == round(g["balanceOf"] * 100)
        assert calc.balance_of(S, acct, calc.add_days(S.today, -10)) == round(
            g["balanceOfMinus10"] * 100
        )
        assert calc.account_series(S, acct, 60) == [
            round(x * 100) for x in g["series60"]
        ]


@pytest.mark.parametrize("i", range(len(G["flows"])))
def test_flow_in(i: int) -> None:
    g = G["flows"][i]
    first, last = d(g["from"]), d(g["to"])
    f = calc.flow_in(S, first, last)
    assert f.income == round(g["flow"]["income"] * 100)
    assert f.spend == round(g["flow"]["spend"] * 100)
    assert f.by_cat == {k: round(v * 100) for k, v in g["flow"]["byCat"].items()}
    assert f.by_payee == {k: round(v * 100) for k, v in g["flow"]["byPayee"].items()}
    assert f.count == g["flow"]["count"]
    assert calc.savings_rate(f) == pytest.approx(g["savingsRate"])
    ns = calc.no_spend_days(S, first, last)
    assert ns.count == g["noSpend"]["count"]
    assert ns.streak == g["noSpend"]["streak"]
    assert [(k.isoformat(), free) for k, free in ns.days] == [
        (x["key"], x["free"]) for x in g["noSpend"]["days"]
    ]
    assert calc.spend_in(S, first, last, None) == round(g["spendAll"] * 100)
    assert calc.spend_in(S, first, last, ["food"]) == round(g["spendFood"] * 100)


def _view_matches(v: calc.BudgetView, g: dict[str, Any]) -> None:
    assert v.budget.id == g["budget"]
    assert v.spent == round(g["spent"] * 100)
    assert v.limit == round(g["limit"] * 100)
    assert v.pct == pytest.approx(g["pct"])
    assert v.pace == pytest.approx(g["pace"])
    assert v.days_left == g["daysLeft"]
    assert v.safe_per_day == approx(g["safePerDay"])
    assert (v.first.isoformat(), v.last.isoformat()) == (g["from"], g["to"])


def test_budget_view_and_allowance() -> None:
    by_id = {b.id: b for b in S.budgets}
    for g in G["budgets"]:
        b = by_id[g["view"]["budget"]]
        v = calc.budget_view(S, b, g["month"])
        _view_matches(v, g["view"])
        assert calc.today_allowance(v, 0) == approx(g["allowance0"])
        assert calc.today_allowance(v, 50000) == approx(g["allowance500"])


def test_budget_view_with_custom_month_start() -> None:
    s5 = state(month_start_day=5)
    for b, g in zip(s5.budgets, G["budgetsSd5"], strict=True):
        _view_matches(calc.budget_view(s5, b), g)


def test_month_keys() -> None:
    for g in G["monthKeys"]:
        k = d(g["day"])
        assert calc.month_of(k, 1) == g["sd1"]
        assert calc.month_of(k, 5) == g["sd5"]
        assert [x.isoformat() for x in calc.month_range(g["sd5"], 5)] == g["range5"]
        assert [x.isoformat() for x in calc.month_range(calc.month_of(k, 28), 28)] == g[
            "range28"
        ]


def test_avg_spend() -> None:
    for g in G["avgSpend"]:
        assert calc.avg_spend(S, g["ids"]) == approx(g["avg"])


def _synthetic() -> dict[str, calc.Plan]:
    base = G["seed"]["planned"][0]
    over = {
        "sx-m31": {"schedule": {"kind": "monthly", "day": 31}, "start": "2026-01-10"},
        "sx-semi": {
            "schedule": {"kind": "semimonthly", "days": [15, 30]},
            "start": "2026-01-01",
        },
        "sx-w1": {
            "schedule": {"kind": "weekly", "every": 1, "anchor": "2026-09-02"},
            "start": "2026-09-02",
        },
        "sx-w2": {
            "schedule": {"kind": "weekly", "every": 2, "anchor": "2026-08-30"},
            "start": "2026-08-01",
        },
        "sx-enddate": {
            "schedule": {"kind": "monthly", "day": 8},
            "start": "2026-06-01",
            "end": {"kind": "date", "date": "2026-11-08"},
        },
        "sx-count": {
            "schedule": {"kind": "monthly", "day": 8},
            "start": "2026-06-09",
            "end": {"kind": "count", "n": 4},
        },
        "sx-once": {"schedule": {"kind": "once", "date": "2026-11-02"}},
    }
    return {k: plan_of({**base, **v, "id": k}) for k, v in over.items()}


def test_occurrences_and_monthly_equivalent() -> None:
    plans = {p.id: p for p in S.planned} | _synthetic()
    assert len(G["occurrences"]) == len(plans) * 4
    for g in G["occurrences"]:
        got = calc.occurrences(plans[g["id"]], d(g["from"]), d(g["to"]))
        assert [x.isoformat() for x in got] == g["days"], g["id"]
    for g in G["monthlyEq"]:
        assert calc.monthly_eq(plans[g["id"]]) == approx(g["eq"])


def _occ(rows: list[calc.Occurrence]) -> list[tuple[str, str, str, str, str | None]]:
    return [
        (o.item.id, o.day.isoformat(), o.orig.isoformat(), o.status, o.record_id)
        for o in rows
    ]


def _g_occ(rows: list[dict[str, Any]]) -> list[tuple[str, str, str, str, str | None]]:
    return [(r["id"], r["day"], r["orig"], r["status"], r["recordId"]) for r in rows]


def test_occurrences_in_statuses() -> None:
    g = G["occurrencesIn"]
    t = S.today
    assert _occ(
        calc.occurrences_in(S, calc.add_days(t, -30), calc.add_days(t, 30))
    ) == _g_occ(g["plain"])
    assert _occ(
        calc.occurrences_in(
            S, calc.add_days(t, -30), calc.add_days(t, 220), include_what_if=True
        )
    ) == _g_occ(g["whatIf"])
    assert _occ(calc.due_now(S)) == _g_occ(g["dueNow"])
    edited = state()
    for e in g["editedPlanned"]:
        p = next(x for x in edited.planned if x.id == e["id"])
        p.skipped = {d(x) for x in e["skipped"]}
        p.snoozed = {d(k): d(v) for k, v in e["snoozed"].items()}
    got = _occ(calc.occurrences_in(edited, calc.add_days(t, -30), calc.add_days(t, 30)))
    assert got == _g_occ(g["edited"])
    assert {x[3] for x in got} >= {"paid", "skipped", "upcoming"}


def _proj_matches(p: calc.Projection, g: dict[str, Any]) -> None:
    assert p.start == round(g["start"] * 100)
    assert p.avg_unplanned == approx(g["avgUnplanned"])
    assert p.has_income == g["hasIncome"]
    assert p.recovery_months == g["recoveryMonths"]
    assert len(p.months) == len(g["months"])
    for m, gm in zip(p.months, g["months"], strict=True):
        assert m.key == gm["key"]
        assert m.inflow == round(gm["inflow"] * 100)
        assert m.planned == round(gm["planned"] * 100)
        assert m.unplanned == approx(gm["unplanned"])
        assert m.what_if == approx(gm["whatIf"])
        assert m.net == approx(gm["net"])
        assert m.end == approx(gm["end"])
        assert m.end_base == approx(gm["endBase"])
    assert (p.low.key, p.low_base.key) == (g["low"]["key"], g["lowBase"]["key"])
    assert p.low.value == approx(g["low"]["value"])
    assert p.low_base.value == approx(g["lowBase"]["value"])
    assert p.avg_surplus == approx(g["avgSurplus"])


def test_projection_variants() -> None:
    g = G["projections"]
    cur = calc.month_of(S.today, 1)
    assert calc.avg_unplanned(S) == approx(G["avgUnplanned"])
    _proj_matches(calc.project(S, horizon=12, include_unplanned=True), g["default"])
    _proj_matches(calc.project(S, horizon=6, include_unplanned=False), g["noUnplanned"])
    _proj_matches(
        calc.project(
            S,
            horizon=12,
            include_unplanned=True,
            excluded_planned=["pl-rent", "pl-sal2"],
        ),
        g["excludedPlanned"],
    )
    _proj_matches(
        calc.project(
            S, horizon=12, include_unplanned=True, excluded_accounts=["gcash"]
        ),
        g["excludedAccounts"],
    )
    _proj_matches(
        calc.project(
            S,
            horizon=12,
            include_unplanned=True,
            what_if=calc.WhatIf(4500000, calc.add_months(cur, 2), 1),
        ),
        g["whatIfOnce"],
    )
    _proj_matches(
        calc.project(
            S,
            horizon=24,
            include_unplanned=True,
            what_if=calc.WhatIf(3000000, calc.add_months(cur, 1), 12),
        ),
        g["whatIf12"],
    )
    _proj_matches(
        calc.project(
            S, horizon=12, include_unplanned=True, what_if=calc.WhatIf(20000000, cur, 1)
        ),
        g["whatIfNow"],
    )
    _proj_matches(
        calc.project(
            S,
            horizon=12,
            include_unplanned=True,
            extra_planned=[p for p in S.planned if p.is_what_if],
        ),
        g["extraPlanned"],
    )


@pytest.mark.parametrize("idx", [0, 1])
def test_reconcile_and_statement_closing(idx: int) -> None:
    g = G["reconcile"][idx]
    rows = calc.reconcile(S, g["account"], statement(g["account"]), g["importId"])
    assert len(rows) == len(g["rows"])
    for r, gr in zip(rows, g["rows"], strict=True):
        assert (r.payee, r.state, r.decision, r.match_id, r.reason) == (
            gr["payee"],
            gr["state"],
            gr["decision"],
            gr["matchId"],
            gr["reason"],
        )
        assert (r.suggested_category_id, r.category_id) == (
            gr["suggestedCategoryId"],
            gr["categoryId"],
        )
        assert r.is_transfer == gr["isTransfer"]
        assert r.confidence == pytest.approx(gr["confidence"])
        assert calc.needs_attention(r.state, r.confidence) == gr["needsAttention"]
    assert calc.statement_closing(S, g["account"], d(g["closingTo"]), rows) == round(
        g["closing"] * 100
    )


def test_guess_payee_and_suggest_category() -> None:
    for g in G["guess"]:
        assert calc.guess_payee(g["raw"]) == (g["payee"], g["cat"])
    for g in G["suggest"]:
        assert calc.suggest_category(S, g["payee"]) == g["cat"]


@pytest.mark.parametrize("idx", [0, 1, 2])
def test_report_data(idx: int) -> None:
    g = G["reports"][idx]
    r = calc.report_data(S, g["period"])
    assert [
        r.range.first.isoformat(),
        r.range.last.isoformat(),
        r.range.prev_first.isoformat(),
        r.range.prev_last.isoformat(),
    ] == [g["range"][k] for k in ("from", "to", "prevFrom", "prevTo")]
    assert r.flow.spend == round(g["flow"]["spend"] * 100)
    assert r.prev.income == round(g["prev"]["income"] * 100)
    assert [[k, v] for k, v in r.by_cat] == [[k, round(v * 100)] for k, v in g["byCat"]]
    assert [[k, v] for k, v in r.payees] == [
        [k, round(v * 100)] for k, v in g["payees"]
    ]
    assert r.daily == [round(x * 100) for x in g["daily"]]
    assert r.days == g["days"]
    assert r.weekday_avg == [approx(x) for x in g["weekdayAvg"]]
    assert [(k, i, s) for k, i, s in r.months] == [
        (m["key"], round(m["income"] * 100), round(m["spend"] * 100))
        for m in g["months"]
    ]
    for (b, hist), gb in zip(r.budgets, g["budgets"], strict=True):
        assert b.id == gb["id"]
        for v, gv in zip(hist, gb["hist"], strict=True):
            _view_matches(v, gv)
    assert r.net_worth == [round(x * 100) for x in g["nw"]]


def test_period_range_with_custom_month_start() -> None:
    s5 = state(month_start_day=5)
    for g in G["reportsSd5"]:
        r = calc.period_range(s5, g["period"])
        assert [
            r.first.isoformat(),
            r.last.isoformat(),
            r.prev_first.isoformat(),
            r.prev_last.isoformat(),
        ] == [g["from"], g["to"], g["prevFrom"], g["prevTo"]]


@pytest.mark.parametrize("idx", [0, 1])
def test_lookback(idx: int) -> None:
    g = G["lookbacks"][idx]
    x = calc.lookback(S, d(g["from"]), d(g["to"]), d(g["prevFrom"]), d(g["prevTo"]))
    assert x.flow.spend == round(g["flow"]["spend"] * 100)
    assert x.base == approx(g["base"])
    assert x.rate == pytest.approx(g["rate"])
    assert x.prev_rate == pytest.approx(g["prevRate"])
    assert (x.no_spend.count, x.no_spend.streak) == (
        g["noSpend"]["count"],
        g["noSpend"]["streak"],
    )
    assert [v.budget.id for v in x.kept] == g["kept"]
    assert [v.budget.id for v in x.blown] == g["blown"]
    assert len(x.budgets) == len(g["budgets"])
    assert [list(w) for w in x.where] == [
        [k, round(v * 100), round(p * 100)] for k, v, p in g["where"]
    ]
    assert [w[0] for w in x.spikes] == g["spikes"]
    assert [r.id for r in x.big] == g["big"]
    assert [(lk.payee, lk.n, lk.v, lk.cat) for lk in x.leaks] == [
        (lk["payee"], lk["n"], round(lk["v"] * 100), lk["cat"]) for lk in g["leaks"]
    ]
    assert x.subs == round(g["subs"] * 100)
    assert x.completeness == pytest.approx(g["completeness"])
    assert x.top_share == pytest.approx(g["topShare"])


def test_stats_numbers() -> None:
    g = G["stats"]
    assert calc.runway_months(S) == pytest.approx(g["runway"])
    assert calc.budget_score(S) == pytest.approx(g["budgetScore"])
    assert calc.area_rate(S, 7) == pytest.approx(g["areaRate7"])
    assert calc.area_rate(S, 30) == pytest.approx(g["areaRate30"])
    assert calc.area_rate(S, 90) == pytest.approx(g["areaRate90"])


def test_reconcile_tolerance_and_day_windows() -> None:
    g = G["boundary"]
    s = calc.State(
        today=S.today,
        accounts=[calc.Acct(id="acc", type="cash", opening=0)],
        records=[
            calc.Rec(
                id=r["id"],
                type="expense",
                amount=round(r["amount"] * 100),
                account_id="acc",
                day=d(r["day"]),
            )
            for r in g["records"]
        ],
    )
    rows = [
        calc.StatementRow(
            ref=r["ref"],
            date=d(r["date"]),
            time=r["time"],
            raw=r["raw"],
            amount=round(r["amount"] * 100),
            direction=r["direction"],
        )
        for r in g["rows"]
    ]
    got = calc.reconcile(s, "acc", rows, "imp-b")
    assert [(r.state, r.match_id, r.reason) for r in got] == [
        (x["state"], x["matchId"], x["reason"]) for x in g["reconcile"]
    ]


def test_occurrence_status_around_today() -> None:
    g = G["boundary"]
    s = calc.State(
        today=S.today,
        planned=[
            calc.Plan(
                id=p["id"],
                name=p["id"],
                type="expense",
                amount=100,
                account_id="acc",
                schedule=p["schedule"],
                start=d("2026-01-01"),
            )
            for p in g["statusPlans"]
        ],
    )
    t = S.today
    got = _occ(calc.occurrences_in(s, calc.add_days(t, -3), calc.add_days(t, 3)))
    assert got == _g_occ(g["statusRows"])
    assert [x[3] for x in got] == ["overdue", "due", "due", "upcoming"]
