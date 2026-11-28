"""Shared money REST routes (loans). The phone writes through the matching
sync actions (``finance.loan.*``) and reads its synced ``shared_member``
rows; these routes serve the same use cases, plus the proof photo URLs a
synced snapshot cannot hold."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.modules.iam.deps import require_permission
from app.modules.shared_finance import accounts, groups, services
from app.modules.shared_finance.schema import (
    AccountShare,
    BudgetCreate,
    BudgetOut,
    CashCreate,
    CategoriesBody,
    DecideBody,
    EntryBody,
    EntryCreate,
    GoalCreate,
    GoalOut,
    GroupRespond,
    GroupsOut,
    JointRecordArgs,
    JointRecordBody,
    JointRecordsOut,
    LoanCreate,
    LoanOut,
    LoanRespond,
    LoansOut,
    PaymentCreate,
    PaymentDecide,
    SharedAccountOut,
    SharedAccountsOut,
)
from app.shared.context import CtxDep
from app.shared.rate_limit import rate_limited

router = APIRouter(prefix="/finance/shared", tags=["shared-finance"])

READ = [Depends(require_permission("finance:read"))]
WRITE = [rate_limited("finance"), Depends(require_permission("finance:write"))]


@router.get("/loans", response_model=LoansOut, dependencies=READ)
def list_loans(ctx: CtxDep) -> Any:
    """Loans I made and loans made to me, with what is still owed."""
    return services.list_loans(ctx)


@router.post("/loans", response_model=LoanOut, dependencies=WRITE)
def create_loan(ctx: CtxDep, data: LoanCreate) -> Any:
    """Lend to a person I'm connected with; they're invited to accept."""
    return services.create_loan(ctx, data=data)


@router.get("/loans/{loan_id}", response_model=LoanOut, dependencies=READ)
def get_loan(ctx: CtxDep, loan_id: uuid.UUID) -> Any:
    """One loan, with short-lived URLs of its proof photos."""
    return services.get_loan(ctx, loan_id=loan_id)


@router.post("/loans/{loan_id}/respond", response_model=LoanOut, dependencies=WRITE)
def respond(ctx: CtxDep, loan_id: uuid.UUID, data: LoanRespond) -> Any:
    """The borrower accepts or declines the invite."""
    return services.respond(ctx, loan_id=loan_id, accept=data.accept)


@router.post("/loans/{loan_id}/cancel", response_model=LoanOut, dependencies=WRITE)
def cancel(ctx: CtxDep, loan_id: uuid.UUID) -> Any:
    """The lender withdraws a loan with nothing paid on it."""
    return services.cancel(ctx, loan_id=loan_id)


@router.post("/loans/{loan_id}/payments", response_model=LoanOut, dependencies=WRITE)
def send_payment(ctx: CtxDep, loan_id: uuid.UUID, data: PaymentCreate) -> Any:
    """The borrower sends a payment (with proof) for the lender to confirm."""
    return services.send_payment(ctx, loan_id=loan_id, data=data)


@router.post(
    "/loans/{loan_id}/payments/{payment_id}/withdraw",
    response_model=LoanOut,
    dependencies=WRITE,
)
def withdraw_payment(ctx: CtxDep, loan_id: uuid.UUID, payment_id: uuid.UUID) -> Any:
    return services.withdraw_payment(ctx, loan_id=loan_id, payment_id=payment_id)


@router.post(
    "/loans/{loan_id}/payments/{payment_id}/decide",
    response_model=LoanOut,
    dependencies=WRITE,
)
def decide_payment(
    ctx: CtxDep, loan_id: uuid.UUID, payment_id: uuid.UUID, data: PaymentDecide
) -> Any:
    """The lender confirms (books it in both ledgers) or rejects with a
    reason."""
    return services.decide_payment(
        ctx, loan_id=loan_id, payment_id=payment_id, data=data
    )


@router.post("/loans/{loan_id}/cash", response_model=LoanOut, dependencies=WRITE)
def record_cash(ctx: CtxDep, loan_id: uuid.UUID, data: CashCreate) -> Any:
    """The lender records a payment received in hand."""
    return services.record_cash(ctx, loan_id=loan_id, data=data)


# ================================================================ goals, budgets


class Answered(BaseModel):
    status: str


@router.get("/groups", response_model=GroupsOut, dependencies=READ)
def list_groups(ctx: CtxDep) -> Any:
    """My shared savings goals and shared budgets (joined or invited)."""
    return groups.list_groups(ctx)


@router.post("/groups/respond", response_model=Answered, dependencies=WRITE)
def respond_group(ctx: CtxDep, data: GroupRespond) -> Any:
    """Join (or decline) a goal, budget or joint account I was invited to."""
    if data.kind == "account":
        return Answered(
            status=accounts.respond(ctx, account_id=data.object_id, accept=data.accept)
        )
    return Answered(
        status=groups.respond(
            ctx,
            kind=data.kind,
            object_id=data.object_id,
            accept=data.accept,
            category_ids=data.category_ids,
        )
    )


@router.post("/goals", response_model=GoalOut, dependencies=WRITE)
def create_goal(ctx: CtxDep, data: GoalCreate) -> Any:
    return groups.create_goal(ctx, data=data)


@router.get("/goals/{goal_id}", response_model=GoalOut, dependencies=READ)
def get_goal(ctx: CtxDep, goal_id: uuid.UUID) -> Any:
    return groups.get_goal(ctx, goal_id=goal_id)


@router.post("/goals/{goal_id}/entries", response_model=GoalOut, dependencies=WRITE)
def add_entry(ctx: CtxDep, goal_id: uuid.UUID, data: EntryBody) -> Any:
    """Put money in (counts at once) or ask to take some out (another
    member okays it)."""
    return groups.add_entry(ctx, data=EntryCreate(goal_id=goal_id, **data.model_dump()))


@router.post(
    "/goals/{goal_id}/entries/{entry_id}/withdraw",
    response_model=GoalOut,
    dependencies=WRITE,
)
def withdraw_entry(ctx: CtxDep, goal_id: uuid.UUID, entry_id: uuid.UUID) -> Any:
    return groups.withdraw_entry(ctx, goal_id=goal_id, entry_id=entry_id)


@router.post(
    "/goals/{goal_id}/entries/{entry_id}/decide",
    response_model=GoalOut,
    dependencies=WRITE,
)
def decide_entry(
    ctx: CtxDep, goal_id: uuid.UUID, entry_id: uuid.UUID, data: DecideBody
) -> Any:
    return groups.decide_entry(
        ctx, goal_id=goal_id, entry_id=entry_id, accept=data.accept, reason=data.reason
    )


@router.post("/budgets", response_model=BudgetOut, dependencies=WRITE)
def create_budget(ctx: CtxDep, data: BudgetCreate) -> Any:
    return groups.create_budget(ctx, data=data)


@router.get("/budgets/{budget_id}", response_model=BudgetOut, dependencies=READ)
def get_budget(ctx: CtxDep, budget_id: uuid.UUID) -> Any:
    return groups.get_budget(ctx, budget_id=budget_id)


@router.put(
    "/budgets/{budget_id}/categories", response_model=BudgetOut, dependencies=WRITE
)
def set_categories(ctx: CtxDep, budget_id: uuid.UUID, data: CategoriesBody) -> Any:
    """Which of my own categories count toward the shared budget."""
    return groups.set_categories(
        ctx, budget_id=budget_id, category_ids=data.category_ids
    )


# ================================================================ joint accounts


@router.get("/accounts", response_model=SharedAccountsOut, dependencies=READ)
def list_accounts(ctx: CtxDep) -> Any:
    """Joint accounts I share, am in, or am invited to."""
    return accounts.list_accounts(ctx)


@router.get(
    "/accounts/{account_id}", response_model=SharedAccountOut, dependencies=READ
)
def get_account(ctx: CtxDep, account_id: uuid.UUID) -> Any:
    """One joint account (its owner sees it even before sharing it)."""
    return accounts.account_view(ctx, account_id=account_id)


@router.post(
    "/accounts/{account_id}/share", response_model=SharedAccountOut, dependencies=WRITE
)
def share_account(ctx: CtxDep, account_id: uuid.UUID, data: AccountShare) -> Any:
    """The owner invites people they're connected with."""
    return accounts.share(ctx, account_id=account_id, member_ids=data.member_ids)


@router.get(
    "/accounts/{account_id}/records", response_model=JointRecordsOut, dependencies=READ
)
def list_account_records(
    ctx: CtxDep,
    account_id: uuid.UUID,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> Any:
    """Every transaction, newest first, paged."""
    return accounts.list_records(ctx, account_id=account_id, skip=skip, limit=limit)


@router.post(
    "/accounts/{account_id}/records",
    response_model=SharedAccountOut,
    dependencies=WRITE,
)
def add_account_record(
    ctx: CtxDep, account_id: uuid.UUID, data: JointRecordBody
) -> Any:
    """An active member logs an expense or income on the joint account."""
    return accounts.add_record(
        ctx, data=JointRecordArgs(account_id=account_id, **data.model_dump())
    )


@router.post(
    "/accounts/{account_id}/leave", response_model=Answered, dependencies=WRITE
)
def leave_account(ctx: CtxDep, account_id: uuid.UUID) -> Any:
    return Answered(status=accounts.leave(ctx, account_id=account_id))


@router.post(
    "/accounts/{account_id}/members/{user_id}/remove",
    response_model=SharedAccountOut,
    dependencies=WRITE,
)
def remove_account_member(
    ctx: CtxDep, account_id: uuid.UUID, user_id: uuid.UUID
) -> Any:
    """Only the owner removes people."""
    return accounts.remove_member(ctx, account_id=account_id, user_id=user_id)
