"""Loan use cases: one function per screen action, each ending with
``ctx.commit()``.

Who may do what:

- only the two members see a loan; anyone else gets a natural 404
  (``loan_not_found``), with no existence leak;
- the lender makes, cancels, records cash and decides payments; the borrower
  answers the invite, sends and withdraws payments. The wrong member gets
  403 (``not_lender`` / ``not_borrower``): a borrower cannot accept their
  own payment, a lender cannot send one in the borrower's name;
- an account, and a proof photo, must be the CALLER's own.

Every write locks the loan row first, so two taps (or two devices) on the
same loan run one after the other; a payment already decided the same way
answers with the loan as it is (idempotent), the other way is 409
``payment_already_decided``. Ledger records get ids derived from the payment,
so a replay never books twice.
"""

import uuid
from datetime import date, datetime, timedelta
from typing import Any, Literal

from fastapi import HTTPException
from sqlalchemy import ColumnElement, or_
from sqlmodel import col, select

from app.modules.dashboard import public as dashboard
from app.modules.finance import public as finance
from app.modules.media import public as media
from app.modules.shared_finance import logic
from app.modules.shared_finance.models import (
    Loan,
    LoanEvent,
    LoanPayment,
    SharedMember,
)
from app.modules.shared_finance.schema import (
    CashCreate,
    CustomSchedule,
    EventOut,
    InstallmentOut,
    LoanCreate,
    LoanOut,
    LoansOut,
    MonthlySchedule,
    PaymentCreate,
    PaymentDecide,
    PaymentOut,
    PersonOut,
)
from app.modules.social import public as social
from app.shared.context import Ctx, make_ctx
from app.shared.currency import currency, money
from app.shared.domain import conflict, domain_error, invalid, not_found
from app.shared.ids import derived_id
from app.shared.money import MAX_MINOR

Role = Literal["lender", "borrower"]


def forbidden(code: str, message: str) -> HTTPException:
    return domain_error(403, code, message)


# ---------------------------------------------------------------- lookups


def _is_member(ctx: Ctx) -> ColumnElement[bool]:
    return or_(col(Loan.owner_id) == ctx.user_id, col(Loan.borrower_id) == ctx.user_id)


def _member_loan(ctx: Ctx, loan_id: uuid.UUID, *, lock: bool = False) -> Loan:
    """A live loan the caller is a member of; 404 otherwise."""
    q = select(Loan).where(
        Loan.id == loan_id,
        Loan.tenant_id == ctx.tenant_id,
        col(Loan.deleted_at).is_(None),
        _is_member(ctx),
    )
    if lock:
        q = q.with_for_update()
    loan = ctx.session.exec(q).first()
    if loan is None:
        raise not_found("loan")
    return loan


def role_of(ctx: Ctx, loan: Loan) -> Role:
    return "lender" if loan.owner_id == ctx.user_id else "borrower"


def _as_lender(ctx: Ctx, loan: Loan) -> None:
    if loan.owner_id != ctx.user_id:
        raise forbidden("not_lender", "Only the lender can do that")


def _as_borrower(ctx: Ctx, loan: Loan) -> None:
    if loan.borrower_id != ctx.user_id:
        raise forbidden("not_borrower", "Only the borrower can do that")


def _payment(
    ctx: Ctx, loan: Loan, payment_id: uuid.UUID, *, lock: bool = False
) -> LoanPayment:
    q = select(LoanPayment).where(
        LoanPayment.id == payment_id,
        LoanPayment.loan_id == loan.id,
        col(LoanPayment.deleted_at).is_(None),
    )
    if lock:
        q = q.with_for_update()
    p = ctx.session.exec(q).first()
    if p is None:
        raise not_found("payment")
    return p


def _payments(ctx: Ctx, loan_ids: list[uuid.UUID]) -> list[LoanPayment]:
    if not loan_ids:
        return []
    return list(
        ctx.session.exec(
            select(LoanPayment)
            .where(
                col(LoanPayment.loan_id).in_(loan_ids),
                col(LoanPayment.deleted_at).is_(None),
            )
            .order_by(col(LoanPayment.created_at), col(LoanPayment.id))
        ).all()
    )


def _events(ctx: Ctx, loan_ids: list[uuid.UUID]) -> list[LoanEvent]:
    if not loan_ids:
        return []
    return list(
        ctx.session.exec(
            select(LoanEvent)
            .where(col(LoanEvent.loan_id).in_(loan_ids))
            .order_by(col(LoanEvent.at), col(LoanEvent.created_at))
        ).all()
    )


def total_of(loan: Loan) -> int:
    return loan.principal_minor + loan.interest_minor


def _sums(payments: list[LoanPayment]) -> tuple[int, int]:
    """(accepted, still waiting for the lender)."""
    accepted = sum(p.amount_minor for p in payments if p.status == "accepted")
    pending = sum(p.amount_minor for p in payments if p.status == "sent")
    return accepted, pending


def _installments(loan: Loan) -> list[logic.Installment]:
    return [
        logic.Installment(
            n=int(str(i["n"])),
            due=date.fromisoformat(str(i["due"])),
            amount_minor=int(str(i["amount_minor"])),
        )
        for i in loan.installments
    ]


# ---------------------------------------------------------------- views


def _person(briefs: dict[uuid.UUID, Any], user_id: uuid.UUID) -> PersonOut:
    b = briefs.get(user_id)
    if b is None:
        return PersonOut(id=user_id, name="Someone")
    return PersonOut(
        id=user_id,
        name=b.name or "Someone",
        handle=b.handle,
        photo_media_id=b.photo_media_id,
    )


def _ins_out(s: logic.InstallmentState) -> InstallmentOut:
    return InstallmentOut(
        n=s.n,
        due=s.due,
        amount_minor=s.amount_minor,
        paid_minor=s.paid_minor,
        state=s.state,  # type: ignore[arg-type]
    )


def loan_out(
    loan: Loan,
    *,
    viewer: uuid.UUID,
    today: date,
    payments: list[LoanPayment],
    events: list[LoanEvent],
    briefs: dict[uuid.UUID, Any],
    urls: dict[uuid.UUID, media.VisibleMedia] | None = None,
) -> LoanOut:
    """The loan as ``viewer`` may see it: the other member's accounts and
    ledger records are never shown."""
    lender = viewer == loan.owner_id
    accepted, pending = _sums(payments)
    s = logic.summary(total_of(loan), _installments(loan), accepted, pending, today)
    pays = []
    for p in payments:
        shown = (urls or {}).get(p.proof_media_id) if p.proof_media_id else None
        pays.append(
            PaymentOut(
                id=p.id,
                kind=p.kind,  # type: ignore[arg-type]
                status=p.status,  # type: ignore[arg-type]
                amount_minor=p.amount_minor,
                paid_on=p.paid_on,
                note=p.note,
                by_id=p.owner_id,
                proof_media_id=p.proof_media_id,
                proof_url=shown.url if shown else None,
                proof_preview_url=shown.preview_url if shown else None,
                account_id=p.lender_account_id if lender else p.borrower_account_id,
                record_id=p.lender_record_id if lender else p.borrower_record_id,
                decided_at=p.decided_at,
                reason=p.reason,
                created_at=p.created_at,
            )
        )
    return LoanOut(
        id=loan.id,
        role="lender" if lender else "borrower",
        status=loan.status,  # type: ignore[arg-type]
        lender=_person(briefs, loan.owner_id),
        borrower=_person(briefs, loan.borrower_id),
        principal_minor=loan.principal_minor,
        interest_minor=loan.interest_minor,
        total_minor=total_of(loan),
        currency=loan.currency,
        purpose=loan.purpose,
        account_id=loan.lender_account_id if lender else None,
        outlay_record_id=loan.outlay_record_id if lender else None,
        schedule=loan.schedule,
        installments=[_ins_out(i) for i in s.installments],
        paid_minor=s.paid_minor,
        pending_minor=s.pending_minor,
        remaining_minor=s.remaining_minor,
        overdue_minor=s.overdue_minor,
        next_due=_ins_out(s.next_due) if s.next_due else None,
        payments=pays,
        events=[
            EventOut(
                kind=e.kind,
                at=e.at,
                actor_id=e.owner_id,
                payment_id=e.payment_id,
                amount_minor=e.amount_minor,
                text=e.text,
            )
            for e in events
        ],
        created_at=loan.created_at,
        responded_at=loan.responded_at,
        closed_at=loan.closed_at,
    )


def _views(ctx: Ctx, loans: list[Loan], *, with_urls: bool) -> list[LoanOut]:
    ids = [ln.id for ln in loans]
    payments = _payments(ctx, ids)
    events = _events(ctx, ids)
    people = {ln.owner_id for ln in loans} | {ln.borrower_id for ln in loans}
    briefs = social.briefs(ctx, people)
    urls = (
        media.visible_media(
            ctx, [p.proof_media_id for p in payments if p.proof_media_id]
        )
        if with_urls
        else None
    )
    return [
        loan_out(
            ln,
            viewer=ctx.user_id,
            today=ctx.today,
            payments=[p for p in payments if p.loan_id == ln.id],
            events=[e for e in events if e.loan_id == ln.id],
            briefs=briefs,
            urls=urls,
        )
        for ln in loans
    ]


def my_loans(ctx: Ctx) -> list[Loan]:
    return list(
        ctx.session.exec(
            select(Loan)
            .where(
                Loan.tenant_id == ctx.tenant_id,
                col(Loan.deleted_at).is_(None),
                _is_member(ctx),
            )
            .order_by(col(Loan.created_at).desc(), col(Loan.id))
        ).all()
    )


def list_loans(ctx: Ctx) -> LoansOut:
    data = _views(ctx, my_loans(ctx), with_urls=False)
    mine = ctx.currency.code
    open_ = [v for v in data if v.status == "active" and v.currency == mine]
    return LoansOut(
        data=data,
        count=len(data),
        owed_to_me_minor=sum(v.remaining_minor for v in open_ if v.role == "lender"),
        i_owe_minor=sum(v.remaining_minor for v in open_ if v.role == "borrower"),
    )


def get_loan(ctx: Ctx, *, loan_id: uuid.UUID) -> LoanOut:
    """One loan with short-lived proof photo URLs."""
    return _views(ctx, [_member_loan(ctx, loan_id)], with_urls=True)[0]


# ---------------------------------------------------------------- side effects


def member_id(user_id: uuid.UUID, loan_id: uuid.UUID) -> uuid.UUID:
    """The id of ``user_id``'s member row of a loan (the phone derives it)."""
    return derived_id("shared-member", user_id, f"loan:{loan_id}")


def _refresh_members(ctx: Ctx, loan: Loan) -> None:
    """Rewrite both members' synced snapshot of the loan."""
    ctx.session.flush()
    payments = _payments(ctx, [loan.id])
    events = _events(ctx, [loan.id])
    briefs = social.briefs(ctx, [loan.owner_id, loan.borrower_id])
    for user_id, role in ((loan.owner_id, "lender"), (loan.borrower_id, "borrower")):
        view = loan_out(
            loan,
            viewer=user_id,
            today=ctx.today,
            payments=payments,
            events=events,
            briefs=briefs,
        )
        rid = member_id(user_id, loan.id)
        row = ctx.session.get(SharedMember, rid)
        data = view.model_dump(mode="json")
        if row is None:
            row = SharedMember(
                id=rid,
                owner_id=user_id,
                tenant_id=loan.tenant_id,
                kind="loan",
                object_id=loan.id,
                role=role,
                status=loan.status,
                data=data,
            )
        else:
            row.status = loan.status
            row.data = data
            row.updated_at = ctx.now
            row.deleted_at = loan.deleted_at
        ctx.session.add(row)
    ctx.session.flush()


def _event(
    ctx: Ctx,
    loan: Loan,
    kind: str,
    *,
    payment: LoanPayment | None = None,
    amount_minor: int | None = None,
    text: str | None = None,
) -> None:
    ctx.session.add(
        LoanEvent(
            **ctx.owned(),
            loan_id=loan.id,
            payment_id=payment.id if payment else None,
            kind=kind,
            at=ctx.now,
            amount_minor=amount_minor,
            text=text[:280] if text else None,
        )
    )


def _notify(
    ctx: Ctx,
    loan: Loan,
    recipient: uuid.UUID,
    *,
    key: str,
    title: str,
    body: str = "",
) -> None:
    """The other member's inbox and a push; their phone pulls on it."""
    dashboard.notify(
        ctx,
        kind="social",
        title=title,
        body=body,
        href=f"/finance/shared/{loan.id}",
        dedupe_key=f"loan:{loan.id}:{key}"[:120],
        push=True,
        recipient_id=recipient,
    )


def _name(ctx: Ctx, user_id: uuid.UUID) -> str:
    b = social.briefs(ctx, [user_id]).get(user_id)
    return (b.name if b else "") or "Someone"


def _amount(loan: Loan, minor: int) -> str:
    return money(minor, currency(loan.currency))


def _record_at(ctx: Ctx, day: date) -> datetime:
    """When a ledger record of a payment made on ``day`` is booked."""
    if day == ctx.today:
        return ctx.now
    return ctx.clock.local_time(day, "12:00")


def _check_day(ctx: Ctx, day: date) -> None:
    if day > ctx.today + timedelta(days=1):
        raise invalid("paid_in_future", "That date hasn't come yet")


def _room(ctx: Ctx, loan: Loan, amount_minor: int) -> None:
    """A new payment never takes the loan past its total (counting the ones
    still waiting for the lender)."""
    accepted, pending = _sums(_payments(ctx, [loan.id]))
    if amount_minor > total_of(loan) - accepted - pending:
        raise invalid(
            "payment_over_balance", "That's more than what's left on the loan"
        )


def _close_if_paid(ctx: Ctx, loan: Loan) -> bool:
    accepted, _ = _sums(_payments(ctx, [loan.id]))
    if loan.status == "active" and accepted >= total_of(loan):
        loan.status = "paid"
        loan.closed_at = ctx.now
        ctx.session.add(loan)
        _event(ctx, loan, "paid_off", amount_minor=accepted)
        return True
    return False


# ---------------------------------------------------------------- loans


def _schedule(
    data: LoanCreate, total: int
) -> tuple[dict[str, object], list[dict[str, object]]]:
    sch = data.schedule
    if isinstance(sch, MonthlySchedule):
        if total < sch.count:
            raise invalid("installment_too_small", "Each payment must be above zero")
        rows = logic.monthly_installments(total, sch.count, sch.start, sch.day)
        spec: dict[str, object] = {
            "kind": "monthly",
            "count": sch.count,
            "start": sch.start.isoformat(),
            "day": sch.day,
        }
    else:
        assert isinstance(sch, CustomSchedule)
        ordered = sorted(sch.installments, key=lambda i: i.due)
        if sum(i.amount_minor for i in ordered) != total:
            raise invalid(
                "installments_dont_add_up",
                "The payments must add up to the loan's total",
            )
        rows = [
            logic.Installment(n=n + 1, due=i.due, amount_minor=i.amount_minor)
            for n, i in enumerate(ordered)
        ]
        spec = {"kind": "custom", "count": len(rows)}
    return spec, [
        {"n": r.n, "due": r.due.isoformat(), "amount_minor": r.amount_minor}
        for r in rows
    ]


def create_loan(ctx: Ctx, *, data: LoanCreate) -> LoanOut:
    if data.id is not None:
        held = ctx.session.get(Loan, data.id)
        if held is not None:
            if held.owner_id != ctx.user_id or held.tenant_id != ctx.tenant_id:
                raise conflict("id_conflict", "That id is already in use")
            return get_loan(ctx, loan_id=held.id)
    if data.borrower_id == ctx.user_id:
        raise invalid("self_loan", "You can't lend to yourself")
    social.person(ctx, data.borrower_id)
    if not social.connected(ctx, ctx.user_id, data.borrower_id):
        raise forbidden("not_connected", "Follow them (or have them follow you) first")
    total = data.principal_minor + data.interest_minor
    if total > MAX_MINOR:
        raise invalid("amount_out_of_range", "That amount is out of range")
    if data.account_id is not None:
        finance.require_account(ctx, data.account_id)
    spec, installments = _schedule(data, total)
    loan = Loan(
        **ctx.owned(),
        id=data.id or uuid.uuid4(),
        borrower_id=data.borrower_id,
        status="invited",
        principal_minor=data.principal_minor,
        interest_minor=data.interest_minor,
        currency=ctx.currency.code,
        purpose=(data.purpose or "").strip() or None,
        lender_account_id=data.account_id,
        schedule=spec,
        installments=installments,
    )
    ctx.session.add(loan)
    ctx.session.flush()
    borrower = _name(ctx, data.borrower_id)
    if data.log_outlay and data.account_id is not None:
        rec = finance.log_expense(
            ctx,
            amount_minor=data.principal_minor,
            account_id=data.account_id,
            payee=borrower,
            note=f"Lent to {borrower}" + (f": {loan.purpose}" if loan.purpose else ""),
            source="manual",
            record_id=derived_id("loan-outlay", loan.id, "outlay"),
        )
        loan.outlay_record_id = rec.id
        ctx.session.add(loan)
    _event(ctx, loan, "created", amount_minor=total)
    _refresh_members(ctx, loan)
    n = len(installments)
    _notify(
        ctx,
        loan,
        data.borrower_id,
        key="created",
        title=f"{_name(ctx, ctx.user_id)} added a loan with you",
        body=(
            f"{_amount(loan, total)} in {n} payment{'s' if n != 1 else ''}"
            " — accept it to start tracking"
        ),
    )
    ctx.commit()
    return get_loan(ctx, loan_id=loan.id)


def respond(ctx: Ctx, *, loan_id: uuid.UUID, accept: bool) -> LoanOut:
    loan = _member_loan(ctx, loan_id, lock=True)
    _as_borrower(ctx, loan)
    target = "active" if accept else "declined"
    if loan.status == target:
        return get_loan(ctx, loan_id=loan.id)
    if loan.status != "invited":
        raise conflict("loan_not_invited", "This loan was already answered")
    loan.status = target
    loan.responded_at = ctx.now
    ctx.session.add(loan)
    _event(ctx, loan, "accepted" if accept else "declined")
    _refresh_members(ctx, loan)
    me = _name(ctx, ctx.user_id)
    _notify(
        ctx,
        loan,
        loan.owner_id,
        key="answer",
        title=f"{me} accepted the loan" if accept else f"{me} declined the loan",
        body=_amount(loan, total_of(loan))
        + (f" · {loan.purpose}" if loan.purpose else ""),
    )
    ctx.commit()
    return get_loan(ctx, loan_id=loan.id)


def cancel(ctx: Ctx, *, loan_id: uuid.UUID) -> LoanOut:
    """The lender withdraws a loan nobody has paid anything on yet."""
    loan = _member_loan(ctx, loan_id, lock=True)
    _as_lender(ctx, loan)
    if loan.status == "cancelled":
        return get_loan(ctx, loan_id=loan.id)
    live = [p for p in _payments(ctx, [loan.id]) if p.status in ("sent", "accepted")]
    if loan.status not in ("invited", "active") or live:
        raise conflict(
            "loan_has_payments", "A loan with payments on it can't be cancelled"
        )
    loan.status = "cancelled"
    loan.closed_at = ctx.now
    ctx.session.add(loan)
    _event(ctx, loan, "cancelled")
    _refresh_members(ctx, loan)
    _notify(
        ctx,
        loan,
        loan.borrower_id,
        key="cancelled",
        title=f"{_name(ctx, ctx.user_id)} cancelled the loan",
        body=_amount(loan, total_of(loan)),
    )
    ctx.commit()
    return get_loan(ctx, loan_id=loan.id)


# ---------------------------------------------------------------- payments


def _replayed(ctx: Ctx, loan: Loan, payment_id: uuid.UUID | None) -> bool:
    """A create replayed with its client id: True when it is already there
    (as the caller's own payment of this loan)."""
    if payment_id is None:
        return False
    held = ctx.session.get(LoanPayment, payment_id)
    if held is None:
        return False
    if held.owner_id != ctx.user_id or held.loan_id != loan.id:
        raise conflict("id_conflict", "That id is already in use")
    return True


def send_payment(ctx: Ctx, *, loan_id: uuid.UUID, data: PaymentCreate) -> LoanOut:
    """The borrower pays and attaches proof; the lender confirms it."""
    loan = _member_loan(ctx, loan_id, lock=True)
    _as_borrower(ctx, loan)
    if _replayed(ctx, loan, data.id):
        return get_loan(ctx, loan_id=loan.id)
    if loan.status != "active":
        raise conflict("loan_not_active", "This loan isn't open for payments")
    _check_day(ctx, data.paid_on)
    _room(ctx, loan, data.amount_minor)
    finance.require_account(ctx, data.account_id)
    if data.proof_media_id is not None:
        # Owner-scoped: only a photo the borrower uploaded themselves.
        media.require_ready(ctx, data.proof_media_id)
    p = LoanPayment(
        **ctx.owned(),
        id=data.id or uuid.uuid4(),
        loan_id=loan.id,
        kind="transfer",
        status="sent",
        amount_minor=data.amount_minor,
        paid_on=data.paid_on,
        note=(data.note or "").strip() or None,
        proof_media_id=data.proof_media_id,
        borrower_account_id=data.account_id,
    )
    ctx.session.add(p)
    ctx.session.flush()
    _event(ctx, loan, "payment_sent", payment=p, amount_minor=p.amount_minor)
    _refresh_members(ctx, loan)
    _notify(
        ctx,
        loan,
        loan.owner_id,
        key=f"sent:{p.id}",
        title=f"{_name(ctx, ctx.user_id)} sent {_amount(loan, p.amount_minor)}",
        body="Check the proof and confirm it"
        if p.proof_media_id
        else "Confirm it when it arrives",
    )
    ctx.commit()
    return get_loan(ctx, loan_id=loan.id)


def withdraw_payment(ctx: Ctx, *, loan_id: uuid.UUID, payment_id: uuid.UUID) -> LoanOut:
    loan = _member_loan(ctx, loan_id, lock=True)
    _as_borrower(ctx, loan)
    p = _payment(ctx, loan, payment_id, lock=True)
    if p.owner_id != ctx.user_id:
        raise forbidden("not_your_payment", "Only who sent it can withdraw it")
    if p.status == "withdrawn":
        return get_loan(ctx, loan_id=loan.id)
    if p.status != "sent":
        raise conflict("payment_already_decided", "That payment was already answered")
    p.status = "withdrawn"
    p.decided_at = ctx.now
    p.decided_by = ctx.user_id
    ctx.session.add(p)
    _event(ctx, loan, "payment_withdrawn", payment=p, amount_minor=p.amount_minor)
    _refresh_members(ctx, loan)
    _notify(
        ctx,
        loan,
        loan.owner_id,
        key=f"withdrawn:{p.id}",
        title=f"{_name(ctx, ctx.user_id)} withdrew a payment",
        body=_amount(loan, p.amount_minor),
    )
    ctx.commit()
    return get_loan(ctx, loan_id=loan.id)


def _borrower_record(ctx: Ctx, loan: Loan, p: LoanPayment) -> uuid.UUID | None:
    """The expense in the borrower's own ledger, booked as the borrower on
    the account they chose when sending (skipped when that account is gone,
    or when their currency differs and no rate can be had)."""
    if p.borrower_account_id is None:
        return None
    user = social.person(ctx, loan.borrower_id)
    bctx = make_ctx(ctx.session, user, now=ctx.now)
    if finance.get_account(bctx, p.borrower_account_id) is None:
        return None
    amount, foreign = p.amount_minor, None
    if bctx.currency.code != loan.currency:
        try:
            rate = finance.fx_rate(bctx, loan.currency)
        except HTTPException:
            return None
        amount = finance.convert(p.amount_minor, rate)
        if not 1 <= amount <= MAX_MINOR:
            return None
        foreign = finance.Foreign(
            currency=loan.currency, amount_minor=p.amount_minor, rate=rate
        )
    rec = finance.log_expense(
        bctx,
        amount_minor=amount,
        account_id=p.borrower_account_id,
        payee=_name(ctx, loan.owner_id),
        note=_note("Loan payment", loan, p),
        source="manual",
        at=_record_at(bctx, p.paid_on),
        record_id=derived_id("loan-payment", p.id, "borrower"),
        foreign=foreign,
    )
    return rec.id


def _note(head: str, loan: Loan, p: LoanPayment) -> str:
    parts = [head]
    if loan.purpose:
        parts.append(loan.purpose)
    if p.note:
        parts.append(p.note)
    return " · ".join(parts)[:500]


def _lender_record(
    ctx: Ctx, loan: Loan, p: LoanPayment, account_id: uuid.UUID
) -> uuid.UUID:
    rec = finance.log_income(
        ctx,
        amount_minor=p.amount_minor,
        account_id=account_id,
        payee=_name(ctx, loan.borrower_id),
        note=_note("Loan repayment", loan, p),
        source="manual",
        at=_record_at(ctx, p.paid_on),
        record_id=derived_id("loan-payment", p.id, "lender"),
    )
    return rec.id


def decide_payment(
    ctx: Ctx, *, loan_id: uuid.UUID, payment_id: uuid.UUID, data: PaymentDecide
) -> LoanOut:
    """The lender confirms (books it in both ledgers) or rejects with a
    reason. Deciding again the same way is a no-op."""
    loan = _member_loan(ctx, loan_id, lock=True)
    _as_lender(ctx, loan)
    p = _payment(ctx, loan, payment_id, lock=True)
    want = "accepted" if data.accept else "rejected"
    if p.status == want:
        return get_loan(ctx, loan_id=loan.id)
    if p.status != "sent":
        raise conflict("payment_already_decided", "That payment was already answered")
    if data.accept:
        if data.account_id is None:
            raise invalid("account_required", "Pick the account it arrived in")
        finance.require_account(ctx, data.account_id)
        p.lender_account_id = data.account_id
        p.lender_record_id = _lender_record(ctx, loan, p, data.account_id)
        p.borrower_record_id = _borrower_record(ctx, loan, p)
    else:
        reason = (data.reason or "").strip()
        if not reason:
            raise invalid("reason_required", "Say why, so they can fix it")
        p.reason = reason
    p.status = want
    p.decided_at = ctx.now
    p.decided_by = ctx.user_id
    ctx.session.add(p)
    _event(
        ctx,
        loan,
        "payment_accepted" if data.accept else "payment_rejected",
        payment=p,
        amount_minor=p.amount_minor,
        text=p.reason,
    )
    paid_off = data.accept and _close_if_paid(ctx, loan)
    _refresh_members(ctx, loan)
    me = _name(ctx, ctx.user_id)
    if data.accept:
        accepted, _ = _sums(_payments(ctx, [loan.id]))
        left = max(0, total_of(loan) - accepted)
        _notify(
            ctx,
            loan,
            loan.borrower_id,
            key=f"decided:{p.id}",
            title=(
                f"Loan paid in full — {me} confirmed your last payment"
                if paid_off
                else f"{me} confirmed your {_amount(loan, p.amount_minor)}"
            ),
            body="Nothing left to pay" if paid_off else f"{_amount(loan, left)} left",
        )
    else:
        _notify(
            ctx,
            loan,
            loan.borrower_id,
            key=f"decided:{p.id}",
            title=f"{me} didn't confirm your {_amount(loan, p.amount_minor)}",
            body=p.reason or "",
        )
    ctx.commit()
    return get_loan(ctx, loan_id=loan.id)


def record_cash(ctx: Ctx, *, loan_id: uuid.UUID, data: CashCreate) -> LoanOut:
    """The lender got paid in hand: recorded as accepted straight away, in
    the lender's ledger only (the borrower's account is not known)."""
    loan = _member_loan(ctx, loan_id, lock=True)
    _as_lender(ctx, loan)
    if _replayed(ctx, loan, data.id):
        return get_loan(ctx, loan_id=loan.id)
    if loan.status != "active":
        raise conflict("loan_not_active", "This loan isn't open for payments")
    _check_day(ctx, data.paid_on)
    _room(ctx, loan, data.amount_minor)
    finance.require_account(ctx, data.account_id)
    p = LoanPayment(
        **ctx.owned(),
        id=data.id or uuid.uuid4(),
        loan_id=loan.id,
        kind="cash",
        status="accepted",
        amount_minor=data.amount_minor,
        paid_on=data.paid_on,
        note=(data.note or "").strip() or None,
        lender_account_id=data.account_id,
        decided_at=ctx.now,
        decided_by=ctx.user_id,
    )
    ctx.session.add(p)
    ctx.session.flush()
    p.lender_record_id = _lender_record(ctx, loan, p, data.account_id)
    ctx.session.add(p)
    _event(ctx, loan, "cash_recorded", payment=p, amount_minor=p.amount_minor)
    paid_off = _close_if_paid(ctx, loan)
    _refresh_members(ctx, loan)
    _notify(
        ctx,
        loan,
        loan.borrower_id,
        key=f"cash:{p.id}",
        title=(
            "Loan paid in full"
            if paid_off
            else f"{_name(ctx, ctx.user_id)} recorded {_amount(loan, p.amount_minor)} cash"
        ),
        body=f"Paid on {p.paid_on.isoformat()}",
    )
    ctx.commit()
    return get_loan(ctx, loan_id=loan.id)
