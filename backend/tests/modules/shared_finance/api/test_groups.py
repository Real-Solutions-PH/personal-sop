"""Shared savings goals and shared budgets: invites, deposits, withdrawals
another member okays, per-member breakdowns, the 80%/100% alerts, who may
do what, the synced member views."""

import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlmodel import Session, select

from app.modules.dashboard.models import Notification
from app.modules.iam.users.models import User
from app.modules.jobs.mobile import run_shared_budgets
from app.modules.shared_finance import groups
from app.modules.shared_finance.models import SharedBudget
from tests.modules.finance.api.helpers import op
from tests.modules.shared_finance.api.conftest import Member, Trio
from tests.utils.day import run_day

TODAY = run_day()


def _code(r: Any) -> str:
    detail = r.get("detail", r)
    return str(detail.get("code") if isinstance(detail, dict) else r.get("code"))


def _balance(m: Member) -> int:
    return m.fin.balances()[m.account]


def _goal(t: Trio, **extra: Any) -> dict[str, Any]:
    out: dict[str, Any] = t.kai.post(
        "/goals",
        {
            "name": "Japan trip",
            "target_minor": 10_000_000,
            "member_ids": [str(t.mia.id)],
            **extra,
        },
    )
    return out


def _join(m: Member, kind: str, oid: str, **extra: Any) -> None:
    m.post(
        "/groups/respond",
        {"kind": kind, "object_id": oid, "accept": True, **extra},
    )


def _entry(m: Member, gid: str, kind: str, amount: int, status: int = 200) -> Any:
    return m.post(
        f"/goals/{gid}/entries",
        {
            "kind": kind,
            "amount_minor": amount,
            "on_date": TODAY.isoformat(),
            "account_id": m.account,
        },
        status,
    )


def _titles(db: Session, who: Member) -> list[str]:
    return [
        n.title
        for n in db.exec(
            select(Notification).where(Notification.owner_id == who.id)
        ).all()
    ]


# ---------------------------------------------------------------- goals


def test_goal_invite_join_deposit_and_breakdown(trio: Trio, db: Session) -> None:
    g = _goal(trio)
    assert g["role"] == "owner" and g["balance_minor"] == 0
    seen = trio.mia.get("/groups")["goals"]
    assert [x["my_status"] for x in seen] == ["invited"]
    assert any("started a shared goal" in t for t in _titles(db, trio.mia))
    # Invited isn't joined: no money in yet.
    r = _entry(trio.mia, g["id"], "deposit", 100, 403)
    assert _code(r) == "not_active_member"

    _join(trio.mia, "goal", g["id"])
    kai0, mia0 = _balance(trio.kai), _balance(trio.mia)
    _entry(trio.kai, g["id"], "deposit", 500_000)
    out = _entry(trio.mia, g["id"], "deposit", 300_000)
    assert out["balance_minor"] == 800_000
    by = {m["person"]["name"]: m["amount_minor"] for m in out["members"]}
    assert by == {"Kai": 500_000, "Mia": 300_000}
    # Each deposit left the depositor's own account.
    assert _balance(trio.kai) == kai0 - 500_000
    assert _balance(trio.mia) == mia0 - 300_000
    # Mia sees only her own record on her entry.
    mine = [e for e in out["entries"] if e["by_id"] == str(trio.mia.id)][0]
    theirs = [e for e in out["entries"] if e["by_id"] == str(trio.kai.id)][0]
    assert mine["record_id"] and mine["account_id"] == trio.mia.account
    assert theirs["record_id"] is None and theirs["account_id"] is None


def test_withdrawal_needs_another_member(trio: Trio, db: Session) -> None:
    g = _goal(trio)
    _join(trio.mia, "goal", g["id"])
    _entry(trio.kai, g["id"], "deposit", 500_000)
    r = _entry(trio.kai, g["id"], "withdrawal", 600_000, 422)
    assert _code(r) == "over_balance"
    out = _entry(trio.kai, g["id"], "withdrawal", 200_000)
    w = [e for e in out["entries"] if e["kind"] == "withdrawal"][0]
    assert w["status"] == "sent"
    assert out["pending_minor"] == 200_000 and out["balance_minor"] == 500_000
    # Pending withdrawals count against what is left to take.
    r = _entry(trio.kai, g["id"], "withdrawal", 400_000, 422)
    assert _code(r) == "over_balance"
    assert any("wants to take" in t for t in _titles(db, trio.mia))

    path = f"/goals/{g['id']}/entries/{w['id']}"
    r = trio.kai.post(f"{path}/decide", {"accept": True}, 403)
    assert _code(r) == "not_your_call"
    r = trio.mia.post(f"{path}/decide", {"accept": False}, 422)
    assert _code(r) == "reason_required"
    kai0 = _balance(trio.kai)
    done = trio.mia.post(f"{path}/decide", {"accept": True})
    assert done["balance_minor"] == 300_000 and done["pending_minor"] == 0
    assert _balance(trio.kai) == kai0 + 200_000
    # Same answer again: nothing more; the other answer: refused.
    trio.mia.post(f"{path}/decide", {"accept": True})
    assert _balance(trio.kai) == kai0 + 200_000
    r = trio.mia.post(f"{path}/decide", {"accept": False, "reason": "no"}, 409)
    assert _code(r) == "entry_already_decided"


def test_withdraw_reject_and_take_back(trio: Trio) -> None:
    g = _goal(trio)
    _join(trio.mia, "goal", g["id"])
    _entry(trio.kai, g["id"], "deposit", 500_000)
    a = _entry(trio.kai, g["id"], "withdrawal", 100_000)["entries"][-1]
    trio.mia.post(
        f"/goals/{g['id']}/entries/{a['id']}/decide",
        {"accept": False, "reason": "Not yet"},
    )
    b = _entry(trio.kai, g["id"], "withdrawal", 100_000)["entries"][-1]
    r = trio.mia.post(f"/goals/{g['id']}/entries/{b['id']}/withdraw", {}, 403)
    assert _code(r) == "not_your_entry"
    out = trio.kai.post(f"/goals/{g['id']}/entries/{b['id']}/withdraw")
    assert [e["status"] for e in out["entries"]] == [
        "accepted",
        "rejected",
        "withdrawn",
    ]
    assert out["entries"][1]["reason"] == "Not yet"
    assert out["balance_minor"] == 500_000


def test_alone_in_a_goal_nothing_comes_out(trio: Trio) -> None:
    g = _goal(trio)
    _entry(trio.kai, g["id"], "deposit", 100_000)
    r = _entry(trio.kai, g["id"], "withdrawal", 50_000, 409)
    assert _code(r) == "no_one_to_confirm"


def test_goal_permissions(trio: Trio) -> None:
    r = trio.kai.post("/goals", {"name": "x", "member_ids": [str(trio.sam.id)]}, 403)
    assert _code(r) == "not_connected"
    r = trio.kai.post("/goals", {"name": "x", "member_ids": [str(trio.kai.id)]}, 422)
    assert _code(r) == "self_member"
    g = _goal(trio)
    gid = g["id"]
    for method, path, body in (
        ("GET", f"/goals/{gid}", None),
        (
            "POST",
            f"/goals/{gid}/entries",
            {
                "kind": "deposit",
                "amount_minor": 1,
                "on_date": TODAY.isoformat(),
                "account_id": trio.sam.account,
            },
        ),
        ("POST", "/groups/respond", {"kind": "goal", "object_id": gid, "accept": True}),
    ):
        r = trio.sam.call(method, path, body, 404)
        assert _code(r) == "goal_not_found"
    assert trio.sam.get("/groups") == {"goals": [], "budgets": []}
    # Someone else's account is not yours to deposit from.
    r = trio.kai.post(
        f"/goals/{gid}/entries",
        {
            "kind": "deposit",
            "amount_minor": 1,
            "on_date": TODAY.isoformat(),
            "account_id": trio.mia.account,
        },
        404,
    )
    assert _code(r) == "account_not_found"
    # Declining removes it from view.
    trio.mia.post(
        "/groups/respond", {"kind": "goal", "object_id": gid, "accept": False}
    )
    trio.mia.get(f"/goals/{gid}", 404)


# ---------------------------------------------------------------- budgets


def test_budget_counts_each_members_chosen_categories(trio: Trio, db: Session) -> None:
    kc, mc = trio.kai.fin.cats(), trio.mia.fin.cats()
    b = trio.kai.post(
        "/budgets",
        {
            "name": "Groceries",
            "limit_minor": 1_000_000,
            "member_ids": [str(trio.mia.id)],
            "category_ids": [kc["groceries"]],
        },
    )
    assert b["my_category_ids"] == [kc["groceries"]]
    # Someone else's category is not yours to count.
    r = trio.mia.post(
        "/groups/respond",
        {
            "kind": "budget",
            "object_id": b["id"],
            "accept": True,
            "category_ids": [kc["dining"]],
        },
        404,
    )
    assert _code(r) == "category_not_found"
    _join(trio.mia, "budget", b["id"], category_ids=[mc["groceries"]])

    trio.kai.fin.expense(trio.kai.account, 300_000, kc["groceries"])
    trio.kai.fin.expense(trio.kai.account, 999_000, kc["dining"])  # not counted
    trio.mia.fin.expense(trio.mia.account, 200_000, mc["groceries"])
    out = trio.mia.get(f"/budgets/{b['id']}")
    assert out["spent_minor"] == 500_000
    assert {m["person"]["name"]: m["amount_minor"] for m in out["members"]} == {
        "Kai": 300_000,
        "Mia": 200_000,
    }

    # 85%: one 80% alert to each member, once.
    trio.mia.fin.expense(trio.mia.account, 350_000, mc["groceries"])
    assert run_shared_budgets() >= 1
    for m in (trio.kai, trio.mia):
        assert _titles(db, m).count("Groceries is 80% spent") == 1
    trio.kai.fin.expense(trio.kai.account, 200_000, kc["groceries"])
    run_shared_budgets()
    for m in (trio.kai, trio.mia):
        assert _titles(db, m).count("Groceries is used up") == 1
    seen = trio.kai.get(f"/budgets/{b['id']}")
    assert [e["text"] for e in seen["events"] if e["kind"] == "threshold"] == [
        "80%",
        "100%",
    ]


def test_budget_categories_change_and_empty_means_all(trio: Trio) -> None:
    kc = trio.kai.fin.cats()
    b = trio.kai.post(
        "/budgets",
        {"name": "All", "limit_minor": 5_000_000, "member_ids": [str(trio.mia.id)]},
    )
    trio.kai.fin.expense(trio.kai.account, 100_000, kc["dining"])
    assert trio.kai.get(f"/budgets/{b['id']}")["spent_minor"] == 100_000
    out = trio.kai.call(
        "PUT", f"/budgets/{b['id']}/categories", {"category_ids": [kc["groceries"]]}
    )
    assert out["spent_minor"] == 0
    r = trio.mia.call(
        "PUT", f"/budgets/{b['id']}/categories", {"category_ids": []}, 403
    )
    assert _code(r) == "not_active_member"
    trio.sam.call("GET", f"/budgets/{b['id']}", None, 404)


def test_job_refreshes_views(trio: Trio, db: Session) -> None:
    kai = db.get(User, trio.kai.id)
    assert kai is not None
    b = trio.kai.post(
        "/budgets",
        {"name": "Fun", "limit_minor": 100_000, "member_ids": [str(trio.mia.id)]},
    )
    row = db.get(SharedBudget, uuid.UUID(b["id"]))
    assert row is not None
    trio.kai.fin.expense(trio.kai.account, 100_000)
    assert run_shared_budgets() >= 1
    rows = [
        c["row"]
        for c in trio.kai.fin.pull()["changes"]
        if c["entity"] == "shared_member" and not c["deleted"]
    ]
    assert rows and rows[0]["kind"] == "budget"
    assert rows[0]["data"]["spent_minor"] == 100_000
    assert groups.member_id(trio.kai.id, "budget", row.id) == uuid.UUID(rows[0]["id"])


# ---------------------------------------------------------------- sync, audit


def test_sync_actions_for_goals_and_budgets(trio: Trio) -> None:
    gid, bid, eid = (str(uuid.uuid4()) for _ in range(3))
    res = trio.kai.fin.push(
        op(
            "action",
            "finance.goal.create",
            id=gid,
            name="Sofa",
            member_ids=[str(trio.mia.id)],
        ),
        op(
            "action",
            "finance.budget.create",
            id=bid,
            name="Food",
            limit_minor=900_000,
            member_ids=[str(trio.mia.id)],
        ),
        op(
            "action",
            "finance.goal.entry",
            id=eid,
            goal_id=gid,
            kind="deposit",
            amount_minor=50_000,
            on_date=TODAY.isoformat(),
            account_id=trio.kai.account,
        ),
        op(
            "action",
            "finance.budget.categories",
            budget_id=bid,
            category_ids=[trio.kai.fin.cats()["dining"]],
        ),
    )
    assert [r["status"] for r in res] == ["applied"] * 4, res
    res = trio.mia.fin.push(
        op("action", "finance.shared.respond", kind="goal", object_id=gid, accept=True),
        op(
            "action",
            "finance.shared.respond",
            kind="budget",
            object_id=bid,
            accept=False,
        ),
    )
    assert [r["result"] for r in res] == [{"status": "active"}, {"status": "declined"}]
    wid = str(uuid.uuid4())
    res = trio.kai.fin.push(
        op(
            "action",
            "finance.goal.entry",
            id=wid,
            goal_id=gid,
            kind="withdrawal",
            amount_minor=10_000,
            on_date=TODAY.isoformat(),
            account_id=trio.kai.account,
        ),
        op("action", "finance.goal.decide", goal_id=gid, entry_id=wid, accept=True),
    )
    assert res[0]["status"] == "applied"
    assert res[1]["status"] == "rejected" and res[1]["code"] == "not_your_call"
    res = trio.kai.fin.push(
        op("action", "finance.goal.withdraw", goal_id=gid, entry_id=wid)
    )
    assert res[0]["status"] == "applied"

    kinds = {
        (c["row"]["kind"], c["row"]["role"])
        for c in trio.mia.fin.pull()["changes"]
        if c["entity"] == "shared_member" and not c["deleted"]
    }
    # Mia declined the budget: only the goal is hers to see.
    assert kinds == {("goal", "member")}


def test_shared_events_are_append_only(trio: Trio, db: Session) -> None:
    g = _goal(trio)
    with pytest.raises(DBAPIError):
        db.exec(  # type: ignore[call-overload]
            text("UPDATE shared_event SET text = 'x' WHERE object_id = :id"),
            params={"id": g["id"]},
        )
    db.rollback()
