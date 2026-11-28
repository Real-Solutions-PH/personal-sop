"""Joint accounts: the owner shares an account with a friend, who accepts,
sees the balance and every transaction, and logs transactions into the
owner's ledger. One test per authorization fence; each seeds the other
fences to pass, so only the fence under test can refuse."""

import uuid
from typing import Any

from sqlmodel import Session, select

from app.modules.companion import money_status
from app.modules.dashboard.models import Notification
from app.modules.finance.models import FinRecord
from app.modules.iam.users.models import User
from app.modules.shared_finance import accounts
from app.modules.shared_finance.models import SharedMember
from tests.modules.finance.api.helpers import op
from tests.modules.shared_finance.api.conftest import Member, Trio
from tests.utils.day import run_day
from tests.utils.mobile import ctx_for

TODAY = run_day()


def _code(r: Any) -> str:
    detail = r.get("detail", r)
    return str(detail.get("code") if isinstance(detail, dict) else r.get("code"))


def _share(
    t: Trio, *members: Member, status: int = 200, by: Member | None = None
) -> Any:
    who = by or t.kai
    return who.post(
        f"/accounts/{t.kai.account}/share",
        {"member_ids": [str(m.id) for m in members]},
        status,
    )


def _respond(m: Member, t: Trio, accept: bool = True, status: int = 200) -> Any:
    return m.post(
        "/groups/respond",
        {"kind": "account", "object_id": t.kai.account, "accept": accept},
        status,
    )


def _joined(t: Trio) -> None:
    _share(t, t.mia)
    _respond(t.mia, t)


def _record(
    m: Member, t: Trio, amount: int = 25_000, status: int = 200, **extra: Any
) -> Any:
    body = {
        "type": "expense",
        "amount_minor": amount,
        "on_date": TODAY.isoformat(),
        "payee": "Groceries",
        **extra,
    }
    return m.post(f"/accounts/{t.kai.account}/records", body, status)


def _snapshot(db: Session, who: Member, t: Trio) -> SharedMember | None:
    db.expire_all()
    row = db.get(SharedMember, accounts.member_id(who.id, uuid.UUID(t.kai.account)))
    if row is None or row.deleted_at is not None:
        return None
    return row


def _titles(db: Session, who: Member) -> list[str]:
    return [
        n.title
        for n in db.exec(
            select(Notification).where(Notification.owner_id == who.id)
        ).all()
    ]


# ---------------------------------------------------------------- the happy path


def test_share_accept_then_both_see_the_joint_account(trio: Trio, db: Session) -> None:
    out = _share(trio, trio.mia)
    assert out["role"] == "owner"
    assert [(m["person"]["name"], m["status"]) for m in out["members"]] == [
        ("Kai", "active"),
        ("Mia", "invited"),
    ]
    assert any("invited you to a joint account" in x for x in _titles(db, trio.mia))
    # Invited: who and what, never the money.
    seen = trio.mia.get(f"/accounts/{trio.kai.account}")
    assert seen["my_status"] == "invited" and seen["balance_minor"] == 0
    assert seen["records"] == []

    assert _respond(trio.mia, trio)["status"] == "active"
    seen = trio.mia.get(f"/accounts/{trio.kai.account}")
    assert seen["my_status"] == "active" and seen["role"] == "member"
    assert seen["balance_minor"] == 5_000_000
    assert seen["owner"]["name"] == "Kai"
    assert any("Mia joined" in x for x in _titles(db, trio.kai))
    # Both list it.
    assert [a["id"] for a in trio.kai.get("/accounts")["data"]] == [trio.kai.account]
    assert [a["id"] for a in trio.mia.get("/accounts")["data"]] == [trio.kai.account]


def test_member_logs_into_the_owners_ledger(trio: Trio, db: Session) -> None:
    _joined(trio)
    food = trio.kai.fin.cats()["food"]
    out = _record(trio.mia, trio, 25_000, category_id=food)
    assert out["balance_minor"] == 5_000_000 - 25_000
    rec = out["records"][0]
    assert rec["by_id"] == str(trio.mia.id) and rec["signed_minor"] == -25_000
    assert rec["category_id"] == food
    # The owner's own ledger has it, marked with who logged it.
    assert trio.kai.fin.balances()[trio.kai.account] == 5_000_000 - 25_000
    row = db.get(FinRecord, uuid.UUID(rec["id"]))
    assert row is not None and row.owner_id == trio.kai.id
    assert row.logged_by == trio.mia.id
    # Mia's own accounts are untouched.
    assert trio.mia.fin.balances()[trio.mia.account] == 5_000_000
    # Same id again is a no-op, not a second record.
    again = _record(trio.mia, trio, 25_000, id=rec["id"])
    assert again["records_total"] == out["records_total"]


def test_owner_writes_refresh_the_members_view(trio: Trio, db: Session) -> None:
    _joined(trio)
    trio.kai.fin.expense(trio.kai.account, 100_000)
    snap = _snapshot(db, trio.mia, trio)
    assert snap is not None and snap.data["balance_minor"] == 5_000_000 - 100_000
    # And a rename by the owner reaches it too.
    trio.kai.fin.patch(f"/accounts/{trio.kai.account}", {"name": "House money"})
    snap = _snapshot(db, trio.mia, trio)
    assert snap is not None and snap.data["name"] == "House money"
    # Through the member's sync pull.
    rows = [
        c["row"]
        for c in trio.mia.fin.pull()["changes"]
        if c["entity"] == "shared_member" and not c["deleted"]
    ]
    assert [(r["kind"], r["role"]) for r in rows] == [("account", "member")]
    assert rows[0]["data"]["balance_minor"] == 5_000_000 - 100_000


def test_transfer_hides_the_owners_other_account(trio: Trio) -> None:
    _joined(trio)
    other = trio.kai.fin.account("Kai private", opening=0)
    trio.kai.fin.post(
        "/records",
        {
            "type": "transfer",
            "amount_minor": 10_000,
            "account_id": trio.kai.account,
            "to_account_id": other,
        },
    )
    rec = trio.mia.get(f"/accounts/{trio.kai.account}")["records"][0]
    assert rec["kind"] == "transfer_out" and rec["payee"] == "Transfer out"
    assert "Kai private" not in str(trio.mia.get(f"/accounts/{trio.kai.account}"))


def test_decline_leaves_no_view(trio: Trio, db: Session) -> None:
    _share(trio, trio.mia)
    assert _respond(trio.mia, trio, accept=False)["status"] == "declined"
    trio.mia.get(f"/accounts/{trio.kai.account}", 404)
    assert _snapshot(db, trio.mia, trio) is None
    assert trio.mia.get("/accounts")["data"] == []


def test_sync_actions_record_and_leave(trio: Trio) -> None:
    _joined(trio)
    rid = str(uuid.uuid4())
    res = trio.mia.fin.push(
        op(
            "action",
            "finance.account.record",
            id=rid,
            account_id=trio.kai.account,
            type="income",
            amount_minor=40_000,
            on_date=TODAY.isoformat(),
        )
    )
    assert res[0]["status"] == "applied", res
    assert trio.kai.fin.balances()[trio.kai.account] == 5_000_000 + 40_000
    res = trio.mia.fin.push(
        op("action", "finance.account.leave", account_id=trio.kai.account)
    )
    assert res[0]["status"] == "applied", res
    trio.mia.get(f"/accounts/{trio.kai.account}", 404)


def test_joint_balance_counts_in_the_members_net_worth(trio: Trio, db: Session) -> None:
    _joined(trio)
    user = db.get(User, trio.mia.id)
    assert user is not None
    with ctx_for(user) as ctx:
        out = money_status.status(ctx)
    joint = [a for a in out["accounts"] if a["type"] == "joint"]
    assert len(joint) == 1 and joint[0]["owner"] == "Kai"
    # Mia's own 50,000.00 plus the joint 50,000.00.
    assert "100,000" in out["net_worth"]


def test_goals_and_budgets_list_ignores_account_memberships(trio: Trio) -> None:
    _joined(trio)
    assert trio.mia.get("/groups") == {"goals": [], "budgets": []}


# ---------------------------------------------------------------- fences


def test_fence_stranger_cannot_see_or_act(trio: Trio) -> None:
    _joined(trio)
    trio.sam.get(f"/accounts/{trio.kai.account}", 404)
    trio.sam.get(f"/accounts/{trio.kai.account}/records", 404)
    r = _record(trio.sam, trio, status=404)
    assert _code(r) == "account_not_found"
    r = _share(trio, trio.mia, by=trio.sam, status=404)
    assert _code(r) == "account_not_found"
    trio.sam.post(f"/accounts/{trio.kai.account}/leave", status=404)
    trio.sam.post(
        f"/accounts/{trio.kai.account}/members/{trio.mia.id}/remove", status=404
    )


def test_fence_only_friends_are_added(trio: Trio) -> None:
    r = _share(trio, trio.sam, status=403)
    assert _code(r) == "not_connected"
    r = _share(trio, trio.kai, status=422)
    assert _code(r) == "self_member"


def test_fence_invited_member_cannot_log(trio: Trio) -> None:
    _share(trio, trio.mia)
    r = _record(trio.mia, trio, status=403)
    assert _code(r) == "not_active_member"
    trio.mia.get(f"/accounts/{trio.kai.account}/records", 403)


def test_fence_member_cannot_share_or_remove(trio: Trio) -> None:
    _joined(trio)
    r = _share(trio, trio.kai, by=trio.mia, status=403)
    assert _code(r) == "owner_only"
    r = trio.mia.post(
        f"/accounts/{trio.kai.account}/members/{trio.kai.id}/remove", status=403
    )
    assert _code(r) == "owner_only"


def test_fence_member_logs_only_against_the_owners_categories(trio: Trio) -> None:
    _joined(trio)
    mine = trio.mia.fin.cats()["food"]
    r = _record(trio.mia, trio, category_id=mine, status=404)
    assert _code(r) == "category_not_found"


def test_fence_removed_member_loses_access(trio: Trio, db: Session) -> None:
    _joined(trio)
    out = trio.kai.post(f"/accounts/{trio.kai.account}/members/{trio.mia.id}/remove")
    assert [m["person"]["name"] for m in out["members"]] == ["Kai"]
    trio.mia.get(f"/accounts/{trio.kai.account}", 404)
    assert _snapshot(db, trio.mia, trio) is None


def test_fence_owner_cannot_leave_and_member_can(trio: Trio) -> None:
    _joined(trio)
    r = trio.kai.post(f"/accounts/{trio.kai.account}/leave", status=409)
    assert _code(r) == "owner_cannot_leave"
    assert trio.mia.post(f"/accounts/{trio.kai.account}/leave")["status"] == "left"
    trio.mia.get(f"/accounts/{trio.kai.account}", 404)


def test_fence_archived_account_is_not_shared(trio: Trio) -> None:
    trio.kai.fin.patch(f"/accounts/{trio.kai.account}", {"archived": True})
    r = _share(trio, trio.mia, status=409)
    assert _code(r) == "account_archived"


def test_fence_record_id_of_someone_else_is_refused(trio: Trio) -> None:
    _joined(trio)
    theirs = trio.kai.fin.expense(trio.kai.account, 1_000)
    r = _record(trio.mia, trio, id=theirs["id"], status=409)
    assert _code(r) == "id_conflict"
