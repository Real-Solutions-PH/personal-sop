"""Sync registrations for shared money.

``shared_member`` is pull-only: each member's view of a loan, written by the
server whenever the loan changes, so the phone reads loans offline. Every
write is a domain action through the same use cases as REST, queued in the
outbox while offline.
"""

from typing import Any

from app.modules.shared_finance import schema as S
from app.modules.shared_finance import services
from app.modules.shared_finance.models import SharedMember
from app.modules.sync.registry import Action, Entity, Registry
from app.shared.context import Ctx


def _out(view: S.LoanOut) -> dict[str, Any]:
    return {"loan_id": str(view.id), "status": view.status}


def _create(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    return _out(services.create_loan(ctx, data=S.LoanCreate.model_validate(args)))


def _respond(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.LoanRespondArgs.model_validate(args)
    return _out(services.respond(ctx, loan_id=a.loan_id, accept=a.accept))


def _cancel(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.LoanRef.model_validate(args)
    return _out(services.cancel(ctx, loan_id=a.loan_id))


def _pay(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.PaymentCreateArgs.model_validate(args)
    return _out(services.send_payment(ctx, loan_id=a.loan_id, data=a))


def _withdraw(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.PaymentRef.model_validate(args)
    return _out(
        services.withdraw_payment(ctx, loan_id=a.loan_id, payment_id=a.payment_id)
    )


def _decide(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.PaymentDecideArgs.model_validate(args)
    return _out(
        services.decide_payment(ctx, loan_id=a.loan_id, payment_id=a.payment_id, data=a)
    )


def _cash(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.CashCreateArgs.model_validate(args)
    return _out(services.record_cash(ctx, loan_id=a.loan_id, data=a))


ACTIONS = (
    ("finance.loan.create", _create, S.LoanCreate),
    ("finance.loan.respond", _respond, S.LoanRespondArgs),
    ("finance.loan.cancel", _cancel, S.LoanRef),
    ("finance.loan.pay", _pay, S.PaymentCreateArgs),
    ("finance.loan.withdraw", _withdraw, S.PaymentRef),
    ("finance.loan.decide", _decide, S.PaymentDecideArgs),
    ("finance.loan.cash", _cash, S.CashCreateArgs),
)


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="shared_member",
            model=SharedMember,
            payload=S.SharedMemberSync,
            public=S.SharedMemberRow,
            read_only=True,
        )
    )
    for name, handler, args in ACTIONS:
        r.action(Action(name=name, handler=handler, args=args))
