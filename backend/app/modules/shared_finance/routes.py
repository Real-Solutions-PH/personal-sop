"""Shared money REST routes (loans). The phone writes through the matching
sync actions (``finance.loan.*``) and reads its synced ``shared_member``
rows; these routes serve the same use cases, plus the proof photo URLs a
synced snapshot cannot hold."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends

from app.modules.iam.deps import require_permission
from app.modules.shared_finance import services
from app.modules.shared_finance.schema import (
    CashCreate,
    LoanCreate,
    LoanOut,
    LoanRespond,
    LoansOut,
    PaymentCreate,
    PaymentDecide,
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
