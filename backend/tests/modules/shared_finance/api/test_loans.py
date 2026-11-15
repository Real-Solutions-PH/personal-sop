"""Loans between two people: invite, pay with proof, confirm, reject, cash,
who may do what, idempotency, the synced member view and Fern's read."""

import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlmodel import Session, col, select

from app.modules.companion import money_status
from app.modules.dashboard.models import Notification
from app.modules.finance.models import FinRecord
from app.modules.iam.users.models import User
from app.modules.shared_finance import services
from app.modules.shared_finance.models import LoanEvent, LoanPayment, SharedMember
from app.modules.shared_finance.schema import PaymentDecide
from tests.modules.finance.api.helpers import op
from tests.modules.shared_finance.api.conftest import Member, Trio
from tests.utils.day import run_day
from tests.utils.mobile import ctx_for

TODAY = run_day()


def _code(r: Any) -> str:
    body = r if isinstance(r, dict) else r.json()
    detail = body.get("detail", body)
    return str(detail.get("code") if isinstance(detail, dict) else body.get("code"))


def _loan(t: Trio, **extra: Any) -> dict[str, Any]:
    body = {
        "borrower_id": str(t.mia.id),
        "principal_minor": 1_200_000,
        "purpose": "Phone",
        "schedule": {
            "kind": "monthly",
            "count": 6,
            "start": TODAY.isoformat(),
            "day": TODAY.day,
        },
        **extra,
    }
    out: dict[str, Any] = t.kai.post("/loans", body)
    return out


def _active(t: Trio, **extra: Any) -> dict[str, Any]:
    loan = _loan(t, **extra)
    out: dict[str, Any] = t.mia.post(f"/loans/{loan['id']}/respond", {"accept": True})
    return out


def _pay(t: Trio, loan_id: str, amount: int = 200_000, **extra: Any) -> dict[str, Any]:
    body = {
        "amount_minor": amount,
        "paid_on": TODAY.isoformat(),
        "account_id": t.mia.account,
        **extra,
    }
    out: dict[str, Any] = t.mia.post(f"/loans/{loan_id}/payments", body)
    return out


def _sent(loan: dict[str, Any]) -> dict[str, Any]:
    return next(p for p in loan["payments"] if p["status"] == "sent")


def _balance(m: Member) -> int:
    return m.fin.balances()[m.account]


# ---------------------------------------------------------------- invite


def test_lender_invites_borrower_who_sees_it_and_is_notified(
    trio: Trio, db: Session
) -> None:
    loan = _loan(trio)
    assert loan["role"] == "lender"
    assert loan["status"] == "invited"
    assert loan["total_minor"] == 1_200_000
    assert [i["amount_minor"] for i in loan["installments"]] == [200_000] * 6
    assert loan["installments"][0]["due"] == TODAY.isoformat()
    assert loan["borrower"]["name"] == "Mia"

    mine = trio.mia.get("/loans")
    assert mine["count"] == 1
    seen = mine["data"][0]
    assert seen["role"] == "borrower" and seen["status"] == "invited"
    assert seen["lender"]["name"] == "Kai"
    # Nothing is owed until the borrower accepts.
    assert mine["i_owe_minor"] == 0

    note = db.exec(
        select(Notification).where(Notification.owner_id == trio.mia.id)
    ).all()
    assert any("Kai added a loan" in n.title for n in note)
    assert all(n.href == f"/finance/shared/{loan['id']}" for n in note)


def test_create_is_idempotent_by_client_id(trio: Trio) -> None:
    lid = str(uuid.uuid4())
    a = _loan(trio, id=lid)
    b = _loan(trio, id=lid)
    assert a["id"] == b["id"] == lid
    assert trio.kai.get("/loans")["count"] == 1


def test_only_connected_people_and_never_yourself(trio: Trio) -> None:
    body = {
        "principal_minor": 100_000,
        "schedule": {"kind": "monthly", "count": 1, "start": "2026-12-01", "day": 1},
    }
    r = trio.kai.post("/loans", {**body, "borrower_id": str(trio.sam.id)}, 403)
    assert _code(r) == "not_connected"
    r = trio.kai.post("/loans", {**body, "borrower_id": str(trio.kai.id)}, 422)
    assert _code(r) == "self_loan"
    r = trio.kai.post("/loans", {**body, "borrower_id": str(uuid.uuid4())}, 404)
    assert _code(r) == "person_not_found"
    # The borrower following the lender is a connection too.
    trio.sam.c.put(
        f"/api/v1/social/people/{trio.kai.id}/follow", headers=trio.sam.headers
    )
    trio.kai.post("/loans", {**body, "borrower_id": str(trio.sam.id)})


def test_custom_schedule_must_add_up(trio: Trio) -> None:
    base = {"borrower_id": str(trio.mia.id), "principal_minor": 300_000}
    r = trio.kai.post(
        "/loans",
        {
            **base,
            "schedule": {
                "kind": "custom",
                "installments": [
                    {"due": "2026-12-01", "amount_minor": 100_000},
                    {"due": "2026-12-15", "amount_minor": 100_000},
                ],
            },
        },
        422,
    )
    assert _code(r) == "installments_dont_add_up"
    ok = trio.kai.post(
        "/loans",
        {
            **base,
            "interest_minor": 30_000,
            "schedule": {
                "kind": "custom",
                "installments": [
                    {"due": "2027-01-15", "amount_minor": 130_000},
                    {"due": "2026-12-15", "amount_minor": 200_000},
                ],
            },
        },
    )
    assert ok["total_minor"] == 330_000
    # Ordered by due date, numbered in that order.
    assert [(i["n"], i["due"]) for i in ok["installments"]] == [
        (1, "2026-12-15"),
        (2, "2027-01-15"),
    ]


def test_outlay_logged_on_the_lenders_card(trio: Trio) -> None:
    before = _balance(trio.kai)
    loan = _loan(trio, account_id=trio.kai.account, log_outlay=True)
    assert loan["account_id"] == trio.kai.account
    assert loan["outlay_record_id"]
    assert _balance(trio.kai) == before - 1_200_000
    # The borrower never sees the lender's account or record.
    seen = trio.mia.get(f"/loans/{loan['id']}")
    assert seen["account_id"] is None and seen["outlay_record_id"] is None


def test_decline_and_cancel(trio: Trio) -> None:
    a = _loan(trio)
    out = trio.mia.post(f"/loans/{a['id']}/respond", {"accept": False})
    assert out["status"] == "declined"
    # Answering again the same way is a no-op; the other way is refused.
    trio.mia.post(f"/loans/{a['id']}/respond", {"accept": False})
    r = trio.mia.post(f"/loans/{a['id']}/respond", {"accept": True}, 409)
    assert _code(r) == "loan_not_invited"

    b = _loan(trio)
    r = trio.mia.post(f"/loans/{b['id']}/cancel", {}, 403)
    assert _code(r) == "not_lender"
    out = trio.kai.post(f"/loans/{b['id']}/cancel")
    assert out["status"] == "cancelled"
    trio.kai.post(f"/loans/{b['id']}/cancel")
    r = trio.mia.post(f"/loans/{b['id']}/respond", {"accept": True}, 409)
    assert _code(r) == "loan_not_invited"


# ---------------------------------------------------------------- pay + decide


def test_pay_with_proof_then_lender_confirms_into_both_ledgers(
    trio: Trio, photo: Callable[[Member], str], db: Session
) -> None:
    loan = _active(trio)
    assert loan["status"] == "active"
    kai0, mia0 = _balance(trio.kai), _balance(trio.mia)

    proof = photo(trio.mia)
    sent = _pay(trio, loan["id"], proof_media_id=proof, note="Nov")
    p = _sent(sent)
    assert p["proof_media_id"] == proof and p["note"] == "Nov"
    assert sent["pending_minor"] == 200_000 and sent["paid_minor"] == 0
    # Nothing is booked until the lender confirms.
    assert (_balance(trio.kai), _balance(trio.mia)) == (kai0, mia0)

    # The lender sees the proof (a short-lived URL) and is notified.
    seen = trio.kai.get(f"/loans/{loan['id']}")
    assert _sent(seen)["proof_url"]
    assert any(
        "Mia sent ₱2,000" in n.title
        for n in db.exec(
            select(Notification).where(Notification.owner_id == trio.kai.id)
        ).all()
    )

    done = trio.kai.post(
        f"/loans/{loan['id']}/payments/{p['id']}/decide",
        {"accept": True, "account_id": trio.kai.account},
    )
    assert done["paid_minor"] == 200_000
    assert done["remaining_minor"] == 1_000_000
    assert done["pending_minor"] == 0
    assert done["installments"][0]["state"] == "paid"
    assert done["next_due"]["n"] == 2
    assert _balance(trio.kai) == kai0 + 200_000
    assert _balance(trio.mia) == mia0 - 200_000

    # Each side's own record, linked from the payment.
    kp = done["payments"][0]
    assert kp["status"] == "accepted" and kp["account_id"] == trio.kai.account
    mp = trio.mia.get(f"/loans/{loan['id']}")["payments"][0]
    assert mp["account_id"] == trio.mia.account
    assert mp["record_id"] and mp["record_id"] != kp["record_id"]
    kr = db.get(FinRecord, uuid.UUID(kp["record_id"]))
    mr = db.get(FinRecord, uuid.UUID(mp["record_id"]))
    assert kr is not None and kr.owner_id == trio.kai.id and kr.type == "income"
    assert mr is not None and mr.owner_id == trio.mia.id and mr.type == "expense"
    assert mr.payee == "Kai" and kr.payee == "Mia"

    # Deciding again the same way changes nothing; the other way is refused.
    again = trio.kai.post(
        f"/loans/{loan['id']}/payments/{p['id']}/decide",
        {"accept": True, "account_id": trio.kai.account},
    )
    assert again["paid_minor"] == 200_000
    assert _balance(trio.kai) == kai0 + 200_000
    r = trio.kai.post(
        f"/loans/{loan['id']}/payments/{p['id']}/decide",
        {"accept": False, "reason": "oops"},
        409,
    )
    assert _code(r) == "payment_already_decided"

    kinds = [e["kind"] for e in done["events"]]
    assert kinds == ["created", "accepted", "payment_sent", "payment_accepted"]


def test_reject_needs_a_reason_and_the_borrower_sees_it(trio: Trio) -> None:
    loan = _active(trio)
    p = _sent(_pay(trio, loan["id"]))
    path = f"/loans/{loan['id']}/payments/{p['id']}"
    r = trio.kai.post(f"{path}/decide", {"accept": False}, 422)
    assert _code(r) == "reason_required"
    r = trio.kai.post(f"{path}/decide", {"accept": True}, 422)
    assert _code(r) == "account_required"
    trio.kai.post(f"{path}/decide", {"accept": False, "reason": "Not received yet"})
    seen = trio.mia.get(f"/loans/{loan['id']}")
    assert seen["payments"][0]["status"] == "rejected"
    assert seen["payments"][0]["reason"] == "Not received yet"
    assert seen["paid_minor"] == 0 and seen["pending_minor"] == 0
    r = trio.mia.post(f"{path}/withdraw", {}, 409)
    assert _code(r) == "payment_already_decided"


def test_withdraw_a_sent_payment(trio: Trio) -> None:
    loan = _active(trio)
    p = _sent(_pay(trio, loan["id"]))
    path = f"/loans/{loan['id']}/payments/{p['id']}"
    r = trio.kai.post(f"{path}/withdraw", {}, 403)
    assert _code(r) == "not_borrower"
    out = trio.mia.post(f"{path}/withdraw")
    assert out["payments"][0]["status"] == "withdrawn"
    trio.mia.post(f"{path}/withdraw")
    r = trio.kai.post(
        f"{path}/decide", {"accept": True, "account_id": trio.kai.account}, 409
    )
    assert _code(r) == "payment_already_decided"


def test_payments_never_exceed_what_is_left(trio: Trio) -> None:
    loan = _active(trio)
    _pay(trio, loan["id"], 1_000_000)
    # 2,000 left, but the 10,000 still waiting counts.
    r = trio.mia.post(
        f"/loans/{loan['id']}/payments",
        {
            "amount_minor": 300_000,
            "paid_on": TODAY.isoformat(),
            "account_id": trio.mia.account,
        },
        422,
    )
    assert _code(r) == "payment_over_balance"
    r = trio.mia.post(
        f"/loans/{loan['id']}/payments",
        {
            "amount_minor": 100,
            "paid_on": (TODAY + timedelta(days=5)).isoformat(),
            "account_id": trio.mia.account,
        },
        422,
    )
    assert _code(r) == "paid_in_future"


def test_invited_loan_takes_no_payments(trio: Trio) -> None:
    loan = _loan(trio)
    r = trio.mia.post(
        f"/loans/{loan['id']}/payments",
        {
            "amount_minor": 100,
            "paid_on": TODAY.isoformat(),
            "account_id": trio.mia.account,
        },
        409,
    )
    assert _code(r) == "loan_not_active"


def test_cash_and_paid_in_full(trio: Trio, db: Session) -> None:
    loan = _active(trio, principal_minor=300_000)
    kai0, mia0 = _balance(trio.kai), _balance(trio.mia)
    out = trio.kai.post(
        f"/loans/{loan['id']}/cash",
        {
            "amount_minor": 100_000,
            "paid_on": TODAY.isoformat(),
            "account_id": trio.kai.account,
        },
    )
    assert out["paid_minor"] == 100_000
    assert out["payments"][0]["kind"] == "cash"
    assert out["payments"][0]["status"] == "accepted"
    assert _balance(trio.kai) == kai0 + 100_000
    # Cash in hand: the borrower's ledger is not touched.
    assert _balance(trio.mia) == mia0
    r = trio.mia.post(
        f"/loans/{loan['id']}/cash",
        {
            "amount_minor": 1,
            "paid_on": TODAY.isoformat(),
            "account_id": trio.mia.account,
        },
        403,
    )
    assert _code(r) == "not_lender"

    p = _sent(_pay(trio, loan["id"], 200_000))
    done = trio.kai.post(
        f"/loans/{loan['id']}/payments/{p['id']}/decide",
        {"accept": True, "account_id": trio.kai.account},
    )
    assert done["status"] == "paid"
    assert done["remaining_minor"] == 0 and done["next_due"] is None
    assert done["closed_at"]
    assert done["events"][-1]["kind"] == "paid_off"
    titles = [
        n.title
        for n in db.exec(
            select(Notification).where(Notification.owner_id == trio.mia.id)
        ).all()
    ]
    assert any(t.startswith("Loan paid in full") for t in titles)
    r = trio.kai.post(f"/loans/{loan['id']}/cancel", {}, 409)
    assert _code(r) == "loan_has_payments"


# ---------------------------------------------------------------- who may


def test_non_member_gets_404_everywhere(trio: Trio) -> None:
    loan = _active(trio)
    p = _sent(_pay(trio, loan["id"]))
    lid = loan["id"]
    sam = trio.sam
    assert sam.get("/loans")["count"] == 0
    for method, path, body in (
        ("GET", f"/loans/{lid}", None),
        ("POST", f"/loans/{lid}/respond", {"accept": True}),
        ("POST", f"/loans/{lid}/cancel", {}),
        (
            "POST",
            f"/loans/{lid}/payments",
            {
                "amount_minor": 1,
                "paid_on": TODAY.isoformat(),
                "account_id": sam.account,
            },
        ),
        ("POST", f"/loans/{lid}/payments/{p['id']}/withdraw", {}),
        (
            "POST",
            f"/loans/{lid}/payments/{p['id']}/decide",
            {"accept": True, "account_id": sam.account},
        ),
        (
            "POST",
            f"/loans/{lid}/cash",
            {
                "amount_minor": 1,
                "paid_on": TODAY.isoformat(),
                "account_id": sam.account,
            },
        ),
    ):
        r = sam.call(method, path, body, 404)
        assert _code(r) == "loan_not_found"


def test_borrower_cannot_accept_own_payment(trio: Trio) -> None:
    loan = _active(trio)
    p = _sent(_pay(trio, loan["id"]))
    r = trio.mia.post(
        f"/loans/{loan['id']}/payments/{p['id']}/decide",
        {"accept": True, "account_id": trio.mia.account},
        403,
    )
    assert _code(r) == "not_lender"
    assert trio.mia.get(f"/loans/{loan['id']}")["paid_minor"] == 0


def test_lender_cannot_fake_borrower_proof(
    trio: Trio, photo: Callable[[Member], str]
) -> None:
    loan = _active(trio)
    body = {
        "amount_minor": 200_000,
        "paid_on": TODAY.isoformat(),
        "account_id": trio.kai.account,
        "proof_media_id": photo(trio.kai),
    }
    # The lender cannot send a payment in the borrower's name...
    r = trio.kai.post(f"/loans/{loan['id']}/payments", body, 403)
    assert _code(r) == "not_borrower"
    # ...and the borrower cannot attach someone else's photo or account.
    r = trio.mia.post(
        f"/loans/{loan['id']}/payments", {**body, "account_id": trio.mia.account}, 404
    )
    assert _code(r) == "media_not_found"
    r = trio.mia.post(
        f"/loans/{loan['id']}/payments",
        {**body, "proof_media_id": None},
        404,
    )
    assert _code(r) == "account_not_found"


def test_lender_must_book_into_own_account(trio: Trio) -> None:
    loan = _active(trio)
    p = _sent(_pay(trio, loan["id"]))
    r = trio.kai.post(
        f"/loans/{loan['id']}/payments/{p['id']}/decide",
        {"accept": True, "account_id": trio.mia.account},
        404,
    )
    assert _code(r) == "account_not_found"
    r = trio.kai.post(
        "/loans",
        {
            "borrower_id": str(trio.mia.id),
            "principal_minor": 100,
            "account_id": trio.mia.account,
            "schedule": {
                "kind": "monthly",
                "count": 1,
                "start": "2026-12-01",
                "day": 1,
            },
        },
        404,
    )
    assert _code(r) == "account_not_found"


# ---------------------------------------------------------------- integrity


def test_concurrent_accepts_book_once(trio: Trio, db: Session) -> None:
    loan = _active(trio)
    p = _sent(_pay(trio, loan["id"]))
    kai = db.get(User, trio.kai.id)
    assert kai is not None
    data = PaymentDecide(accept=True, account_id=uuid.UUID(trio.kai.account))

    def accept() -> int:
        with ctx_for(kai) as ctx:
            out = services.decide_payment(
                ctx,
                loan_id=uuid.UUID(loan["id"]),
                payment_id=uuid.UUID(p["id"]),
                data=data,
            )
            return out.paid_minor

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: accept(), range(2)))
    assert results == [200_000, 200_000]
    db.expire_all()
    records = db.exec(
        select(FinRecord).where(
            FinRecord.owner_id == trio.kai.id,
            FinRecord.type == "income",
            col(FinRecord.deleted_at).is_(None),
        )
    ).all()
    assert len(records) == 1
    events = db.exec(
        select(LoanEvent).where(
            LoanEvent.loan_id == uuid.UUID(loan["id"]),
            LoanEvent.kind == "payment_accepted",
        )
    ).all()
    assert len(events) == 1


def test_audit_trail_and_decisions_are_final_in_the_database(
    trio: Trio, db: Session
) -> None:
    loan = _active(trio)
    p = _sent(_pay(trio, loan["id"]))
    trio.kai.post(
        f"/loans/{loan['id']}/payments/{p['id']}/decide",
        {"accept": True, "account_id": trio.kai.account},
    )
    with pytest.raises(DBAPIError):
        db.exec(  # type: ignore[call-overload]
            text("UPDATE loan_event SET text = 'x' WHERE loan_id = :id"),
            params={"id": loan["id"]},
        )
    db.rollback()
    with pytest.raises(DBAPIError):
        db.exec(  # type: ignore[call-overload]
            text("UPDATE loan_payment SET amount_minor = 1 WHERE id = :id"),
            params={"id": p["id"]},
        )
    db.rollback()
    row = db.get(LoanPayment, uuid.UUID(p["id"]))
    assert row is not None and row.amount_minor == 200_000


# ---------------------------------------------------------------- sync + Fern


def test_sync_actions_and_member_rows(trio: Trio) -> None:
    lid = str(uuid.uuid4())
    res = trio.kai.fin.push(
        op(
            "action",
            "finance.loan.create",
            borrower_id=str(trio.mia.id),
            principal_minor=1_200_000,
            id=lid,
            schedule={"kind": "monthly", "count": 6, "start": "2026-12-01", "day": 1},
        )
    )
    assert res[0]["status"] == "applied", res
    assert res[0]["result"] == {"loan_id": lid, "status": "invited"}
    res = trio.mia.fin.push(
        op("action", "finance.loan.respond", loan_id=lid, accept=True)
    )
    assert res[0]["status"] == "applied", res
    pid = str(uuid.uuid4())
    res = trio.mia.fin.push(
        op(
            "action",
            "finance.loan.pay",
            loan_id=lid,
            id=pid,
            amount_minor=200_000,
            paid_on=TODAY.isoformat(),
            account_id=trio.mia.account,
        )
    )
    assert res[0]["status"] == "applied", res
    # The lender decides, the borrower can't: a refusal, not an error.
    res = trio.mia.fin.push(
        op(
            "action",
            "finance.loan.decide",
            loan_id=lid,
            payment_id=pid,
            accept=True,
            account_id=trio.mia.account,
        )
    )
    assert res[0]["status"] == "rejected" and res[0]["code"] == "not_lender"
    res = trio.kai.fin.push(
        op(
            "action",
            "finance.loan.decide",
            loan_id=lid,
            payment_id=pid,
            accept=True,
            account_id=trio.kai.account,
        )
    )
    assert res[0]["status"] == "applied", res

    def member(m: Member) -> dict[str, Any]:
        rows = [
            c["row"]
            for c in m.fin.pull()["changes"]
            if c["entity"] == "shared_member" and not c["deleted"]
        ]
        assert len(rows) == 1
        out: dict[str, Any] = rows[0]
        return out

    k, m = member(trio.kai), member(trio.mia)
    assert k["role"] == "lender" and m["role"] == "borrower"
    assert k["object_id"] == m["object_id"] == lid
    assert k["status"] == m["status"] == "active"
    assert k["id"] == str(services.member_id(trio.kai.id, uuid.UUID(lid)))
    assert m["data"]["paid_minor"] == 200_000
    # Each member's view shows only their own side's account.
    assert k["data"]["payments"][0]["account_id"] == trio.kai.account
    assert m["data"]["payments"][0]["account_id"] == trio.mia.account
    # The snapshot never carries a presigned URL.
    assert m["data"]["payments"][0]["proof_url"] is None
    # A device can't write the member row.
    res = trio.mia.fin.push(op("upsert", "shared_member", m["id"], status="paid"))
    assert res[0]["status"] == "rejected"


def test_fern_finance_status_lists_what_is_still_owed(trio: Trio, db: Session) -> None:
    loan = _active(trio)
    p = _sent(_pay(trio, loan["id"]))
    trio.kai.post(
        f"/loans/{loan['id']}/payments/{p['id']}/decide",
        {"accept": True, "account_id": trio.kai.account},
    )
    kai = db.get(User, trio.kai.id)
    mia = db.get(User, trio.mia.id)
    assert kai is not None and mia is not None
    with ctx_for(kai) as ctx:
        loans = money_status.status(ctx)["loans"]
    assert loans == [
        {
            "person": "Mia",
            "direction": "they_owe_me",
            "status": "open",
            "purpose": "Phone",
            "total": "₱12,000",
            "paid": "₱2,000",
            "still_owed": "₱10,000",
            "sent_awaiting_confirmation": "₱0",
            "overdue": None,
            "next_payment": {
                "due": loans[0]["next_payment"]["due"],
                "amount": "₱2,000",
            },
            "payments_made": 1,
            "payments_total": 6,
        }
    ]
    with ctx_for(mia) as ctx:
        theirs = money_status.status(ctx)["loans"]
    assert theirs[0]["direction"] == "i_owe_them"
    assert theirs[0]["person"] == "Kai"
    assert trio.kai.get("/loans")["owed_to_me_minor"] == 1_000_000
    assert trio.mia.get("/loans")["i_owe_minor"] == 1_000_000


def test_member_rows_are_owned_by_each_member(trio: Trio, db: Session) -> None:
    loan = _loan(trio)
    rows = db.exec(
        select(SharedMember).where(SharedMember.object_id == uuid.UUID(loan["id"]))
    ).all()
    assert {(r.owner_id, r.role) for r in rows} == {
        (trio.kai.id, "lender"),
        (trio.mia.id, "borrower"),
    }
