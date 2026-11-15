"""Sync registrations for shared money.

``shared_member`` is pull-only: each member's view of a loan, written by the
server whenever the loan changes, so the phone reads loans offline. Every
write is a domain action through the same use cases as REST, queued in the
outbox while offline.
"""

from typing import Any

from app.modules.shared_finance import schema as S
from app.modules.shared_finance import groups, services
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


def _goal(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    g = groups.create_goal(ctx, data=S.GoalCreate.model_validate(args))
    return {"goal_id": str(g.id)}


def _budget(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    b = groups.create_budget(ctx, data=S.BudgetCreate.model_validate(args))
    return {"budget_id": str(b.id)}


def _join(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.GroupRespond.model_validate(args)
    status = groups.respond(
        ctx,
        kind=a.kind,
        object_id=a.object_id,
        accept=a.accept,
        category_ids=a.category_ids,
    )
    return {"status": status}


def _categories(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.BudgetCategories.model_validate(args)
    groups.set_categories(ctx, budget_id=a.budget_id, category_ids=a.category_ids)
    return {"budget_id": str(a.budget_id)}


def _entry(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.EntryCreate.model_validate(args)
    return {"goal_id": str(groups.add_entry(ctx, data=a).id)}


def _entry_withdraw(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.EntryRef.model_validate(args)
    groups.withdraw_entry(ctx, goal_id=a.goal_id, entry_id=a.entry_id)
    return {"goal_id": str(a.goal_id)}


def _entry_decide(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.EntryDecide.model_validate(args)
    groups.decide_entry(
        ctx, goal_id=a.goal_id, entry_id=a.entry_id, accept=a.accept, reason=a.reason
    )
    return {"goal_id": str(a.goal_id)}


ACTIONS = (
    ("finance.loan.create", _create, S.LoanCreate),
    ("finance.loan.respond", _respond, S.LoanRespondArgs),
    ("finance.loan.cancel", _cancel, S.LoanRef),
    ("finance.loan.pay", _pay, S.PaymentCreateArgs),
    ("finance.loan.withdraw", _withdraw, S.PaymentRef),
    ("finance.loan.decide", _decide, S.PaymentDecideArgs),
    ("finance.loan.cash", _cash, S.CashCreateArgs),
    ("finance.goal.create", _goal, S.GoalCreate),
    ("finance.budget.create", _budget, S.BudgetCreate),
    ("finance.shared.respond", _join, S.GroupRespond),
    ("finance.budget.categories", _categories, S.BudgetCategories),
    ("finance.goal.entry", _entry, S.EntryCreate),
    ("finance.goal.withdraw", _entry_withdraw, S.EntryRef),
    ("finance.goal.decide", _entry_decide, S.EntryDecide),
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
