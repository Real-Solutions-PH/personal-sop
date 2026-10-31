"""Budgets, planned items, occurrence actions, projection, reports, review,
look-backs and the advisor routes."""

import uuid
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.shared.day import DayClock
from app.shared.ids import derived_id
from tests.modules.finance.api.helpers import API, Fin
from tests.utils.mobile import signed_in

TODAY = DayClock().today()  # a new user has the default clock


def _fin(client: TestClient, db: Session) -> Fin:
    _, headers = signed_in(db)
    return Fin(client, headers)


def _weekly(
    f: Fin,
    account: str,
    *,
    type: str = "expense",
    auto: bool = False,
    cat: str | None = None,
    amount: int = 99_900,
) -> dict:  # type: ignore[type-arg]
    anchor = (TODAY - timedelta(days=14)).isoformat()
    body = {
        "name": "Rent share" if type == "expense" else "Allowance",
        "type": type,
        "amount_minor": amount,
        "account_id": account,
        "category_id": cat,
        "schedule": {"kind": "weekly", "every": 1, "anchor": anchor},
        "start": anchor,
        "auto_log": auto,
    }
    out: dict = f.post("/planned", body)  # type: ignore[type-arg]
    return out


def test_budget_crud_view_and_validation(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("Cash", type="cash")
    f.expense(a, 30_000, cats["dining"])
    f.expense(a, 5_000, cats["grab"])
    food = f.post(
        "/budgets",
        {"name": "Food", "limit_minor": 100_000, "category_ids": [cats["food"]]},
    )
    everything = f.post("/budgets", {"name": "All", "limit_minor": 1_000_000})
    assert everything["category_ids"] == []
    f.post("/budgets", {"name": "Bad", "limit_minor": 0}, status=422)
    f.post(
        "/budgets",
        {"name": "Bad", "limit_minor": 100, "category_ids": [cats["salary"]]},
        status=422,
    )
    views = {v["budget"]["id"]: v for v in f.get("/budgets")["data"]}
    assert views[food["id"]]["spent_minor"] == 30_000  # dining is under Food
    assert views[everything["id"]]["spent_minor"] == 35_000
    v = views[food["id"]]
    assert v["limit_minor"] == 100_000 and v["carry_minor"] == 0
    assert 0 < v["pace"] <= 1 and v["pct"] == 0.3
    detail = f.get(f"/budgets/{food['id']}")
    assert len(detail["history"]) == 6
    upd = f.patch(
        f"/budgets/{food['id']}",
        {"category_ids": [cats["dining"], cats["coffee"]], "rollover": True},
    )
    assert (
        set(upd["category_ids"]) == {cats["dining"], cats["coffee"]} and upd["rollover"]
    )
    f.delete(f"/budgets/{food['id']}")
    f.get(f"/budgets/{food['id']}", status=404)
    assert f.get("/budgets-average", category_ids=[cats["food"]])["avg3_minor"] >= 0


def test_planned_crud_and_occurrence_statuses(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("BPI", type="bank")
    p = _weekly(f, a, cat=cats["rent"])
    assert p["monthly_eq_minor"] == round(99_900 * 52 / 12)
    occ = f.get(
        "/occurrences",
        first=(TODAY - timedelta(days=14)).isoformat(),
        last=(TODAY + timedelta(days=7)).isoformat(),
    )["data"]
    assert [(o["day"], o["status"]) for o in occ] == [
        ((TODAY - timedelta(days=14)).isoformat(), "overdue"),
        ((TODAY - timedelta(days=7)).isoformat(), "overdue"),
        (TODAY.isoformat(), "due"),
        ((TODAY + timedelta(days=7)).isoformat(), "upcoming"),
    ]
    assert len(f.get("/planned/due")["data"]) == 3
    f.post(
        "/planned",
        {
            "name": "x",
            "type": "transfer",
            "amount_minor": 1,
            "account_id": a,
            "schedule": {"kind": "monthly", "day": 5},
        },
        status=422,
    )
    f.post(
        "/planned",
        {
            "name": "x",
            "type": "expense",
            "amount_minor": 1,
            "account_id": a,
            "schedule": {"kind": "monthly", "day": 32},
        },
        status=422,
    )
    f.post(
        "/planned",
        {
            "name": "x",
            "type": "expense",
            "amount_minor": 1,
            "account_id": a,
            "schedule": {"kind": "fortnightly"},
        },
        status=422,
    )
    f.post(
        "/planned",
        {
            "name": "x",
            "type": "expense",
            "amount_minor": 1,
            "account_id": a,
            "schedule": {"kind": "semimonthly", "days": [15, 15]},
        },
        status=422,
    )
    once = f.post(
        "/planned",
        {
            "name": "13th month",
            "type": "income",
            "amount_minor": 2_750_000,
            "account_id": a,
            "category_id": cats["salary"],
            "schedule": {"kind": "once", "date": "2026-12-18"},
        },
    )
    assert once["start"] == "2026-12-18"
    assert f.get("/planned", tab="one-off")["count"] == 1
    assert f.get("/planned", tab="recurring")["count"] == 1
    lst = f.get("/planned")
    assert (
        lst["monthly_out_minor"] == round(99_900 * 52 / 12)
        and lst["monthly_in_minor"] == 0
    )
    upd = f.patch(f"/planned/{p['id']}", {"end_rule": {"kind": "count", "n": 2}})
    assert upd["end_rule"] == {"kind": "count", "n": 2}
    occ = f.get(
        "/occurrences",
        first=(TODAY - timedelta(days=20)).isoformat(),
        last=(TODAY + timedelta(days=20)).isoformat(),
        planned_id=p["id"],
    )["data"]
    assert len(occ) == 2
    f.delete(f"/planned/{once['id']}")


def test_settle_skip_unskip_snooze(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("BPI", type="bank", opening=1_000_000)
    p = _weekly(f, a, cat=cats["rent"])
    day = (TODAY - timedelta(days=7)).isoformat()
    rec = f.post(
        "/planned/settle", {"planned_id": p["id"], "day": day, "amount_minor": 100_000}
    )
    assert rec["id"] == str(derived_id("planned-record", uuid.UUID(p["id"]), day))
    assert (
        rec["planned_on"],
        rec["source"],
        rec["amount_minor"],
        rec["category_id"],
    ) == (day, "planned", 100_000, cats["rent"])
    again = f.post("/planned/settle", {"planned_id": p["id"], "day": day})
    assert again["id"] == rec["id"] and f.get("/records")["count"] == 1
    f.post(
        "/planned/settle",
        {"planned_id": p["id"], "day": (TODAY - timedelta(days=6)).isoformat()},
        status=422,
    )
    statuses = {
        o["orig"]: o["status"]
        for o in f.get(
            "/occurrences",
            first=(TODAY - timedelta(days=14)).isoformat(),
            last=TODAY.isoformat(),
        )["data"]
    }
    assert statuses[day] == "paid"
    first = (TODAY - timedelta(days=14)).isoformat()
    f.post("/planned/skip", {"planned_id": p["id"], "day": first})
    f.post("/planned/skip", {"planned_id": p["id"], "day": first})  # idempotent
    detail = f.get(f"/planned/{p['id']}")
    assert detail["skipped"] == [first]
    f.post("/planned/unskip", {"planned_id": p["id"], "day": first})
    assert f.get(f"/planned/{p['id']}")["skipped"] == []
    f.post(
        "/planned/skip", {"planned_id": p["id"], "day": first}
    )  # revived, not re-inserted
    assert f.get(f"/planned/{p['id']}")["skipped"] == [first]
    # Snoozing an overdue occurrence starts from today.
    sn = f.post(
        "/planned/snooze", {"planned_id": p["id"], "day": TODAY.isoformat(), "days": 3}
    )
    assert sn["until_day"] == (TODAY + timedelta(days=3)).isoformat()
    sn = f.post(
        "/planned/snooze", {"planned_id": p["id"], "day": TODAY.isoformat(), "days": 2}
    )
    assert sn["until_day"] == (TODAY + timedelta(days=5)).isoformat()
    occ = f.get(
        "/occurrences",
        first=TODAY.isoformat(),
        last=(TODAY + timedelta(days=6)).isoformat(),
    )["data"]
    assert [(o["orig"], o["day"], o["status"]) for o in occ] == [
        (TODAY.isoformat(), (TODAY + timedelta(days=5)).isoformat(), "upcoming")
    ]
    # A planned item with a paid occurrence cannot be deleted.
    r = f.c.delete(f"{API}/planned/{p['id']}", headers=f.h)
    assert r.status_code == 409 and r.json()["code"] == "planned_has_records"


def test_auto_log_is_idempotent(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("GCash")
    _weekly(f, a, type="income", auto=True, cat=cats["salary"], amount=500_000)
    _weekly(f, a, type="expense", auto=False, cat=cats["rent"])
    logged = f.post("/planned/auto-log")["data"]
    assert sorted(r["planned_on"] for r in logged) == [
        (TODAY - timedelta(days=14)).isoformat(),
        (TODAY - timedelta(days=7)).isoformat(),
        TODAY.isoformat(),
    ]
    assert {r["type"] for r in logged} == {"income"}
    assert f.post("/planned/auto-log")["count"] == 0
    assert f.balances()[a] == 1_500_000


def test_projection_reports_review_and_look_backs(
    client: TestClient, db: Session
) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("BPI", type="bank", opening=10_000_000)
    card = f.account("Card", type="ewallet", in_projection=False)
    f.expense(a, 50_000, cats["dining"], payee="Jollibee")
    f.post(
        "/planned",
        {
            "name": "Salary",
            "type": "income",
            "amount_minor": 2_750_000,
            "account_id": a,
            "category_id": cats["salary"],
            "schedule": {"kind": "semimonthly", "days": [15, 30]},
        },
    )
    p = f.get("/projection")
    assert p["start_minor"] == 10_000_000 - 50_000
    assert len(p["months"]) == 12 and p["has_income"]
    assert p["verdict"] in ("ok", "tight", "no")
    w = f.post(
        "/projection",
        {
            "horizon": 6,
            "what_if": {
                "amount_minor": 4_500_000,
                "month": p["months"][2]["key"],
                "installments": 3,
            },
            "excluded_accounts": [card],
        },
    )
    assert len(w["months"]) == 6
    assert [m["what_if_minor"] for m in w["months"][2:5]] == [1_500_000] * 3
    assert w["low"]["value_minor"] <= w["low_base"]["value_minor"]
    f.post("/projection", {"horizon": 7}, status=422)
    f.post(
        "/projection", {"what_if": {"amount_minor": 1, "month": "2026-13"}}, status=422
    )
    for period in ("this", "last", "3m"):
        rep = f.get("/reports", period=period)
        assert rep["period"] == period and len(rep["weekday_avg_minor"]) == 7
    assert f.get("/reports", period="this")["flow"]["by_payee"] == [
        ["Jollibee", 50_000]
    ]
    f.get("/reports", period="year", status=422)
    rv = f.get("/review")
    assert rv["saved"] is None
    period = rv["first"][:7]
    saved = f.post(
        "/review",
        {
            "period": period,
            "note": "ok month",
            "snapshot": {"savings_rate": 0.4, "income_minor": 100, "spend_minor": 60},
        },
    )
    again = f.post(
        "/review",
        {
            "period": period,
            "note": "edited",
            "snapshot": {"savings_rate": 0.4, "income_minor": 100, "spend_minor": 60},
        },
    )
    assert again["id"] == saved["id"] and again["note"] == "edited"
    assert f.get("/review", period=period)["saved"]["note"] == "edited"
    assert f.get("/look-backs")["count"] == 1
    custom = f.get(
        "/review", first=(TODAY - timedelta(days=6)).isoformat(), last=TODAY.isoformat()
    )
    assert custom["flow"]["spend_minor"] == 50_000
    f.get("/review", period="2026-W38", status=422)
    home = f.get("/home")
    assert home["net_worth_minor"] == 10_000_000 - 50_000
    assert home["spent_this_month_minor"] == 50_000


def test_advisor_threads_and_answer(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    f.account("BPI", type="bank", opening=5_000_000)
    t = f.post("/advisor/threads", {"title": "Laptop?"})
    m = f.post(
        f"/advisor/threads/{t['id']}/messages",
        {"role": "user", "text": "can I afford a 45k laptop?"},
    )
    ans = f.post("/advisor/answer", {"text": m["text"]})
    assert ans["intent"] == "afford" and ans["disclaimer"]
    ai = f.post(
        f"/advisor/threads/{t['id']}/messages",
        {"role": "ai", "text": "Yes", "answer": ans},
    )
    detail = f.get(f"/advisor/threads/{t['id']}")
    assert [x["role"] for x in detail["messages"]] == ["user", "ai"]
    leaks = f.post("/advisor/answer", {"text": "where is my money leaking?"})
    assert leaks["needs_records"] is True
    assert (
        f.post(
            "/advisor/answer",
            {"text": "where is my money leaking?", "scope": "records"},
        )["needs_records"]
        is False
    )
    f.patch(f"/advisor/threads/{t['id']}", {"title": "Laptop"})
    f.delete(f"/advisor/threads/{t['id']}/messages/{ai['id']}")
    assert len(f.get(f"/advisor/threads/{t['id']}")["messages"]) == 1
    assert f.get("/advisor/threads")["count"] == 1
    f.delete(f"/advisor/threads/{t['id']}")
    f.get(f"/advisor/threads/{t['id']}", status=404)
    f.post(
        f"/advisor/threads/{uuid.uuid4()}/messages",
        {"role": "user", "text": "x"},
        status=404,
    )
    f.post("/advisor/threads", {"title": ""}, status=422)
