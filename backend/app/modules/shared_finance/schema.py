"""Request and response schemas of shared money. Amounts are integer
centavos (``*_minor``) of the loan's currency (the lender's)."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.shared.money import MAX_MINOR

Minor = Annotated[int, Field(ge=1, le=MAX_MINOR)]
NonNegMinor = Annotated[int, Field(ge=0, le=MAX_MINOR)]
Role = Literal["lender", "borrower"]
LoanStatus = Literal["invited", "active", "declined", "cancelled", "paid"]
PaymentStatus = Literal["sent", "accepted", "rejected", "withdrawn"]
InstallmentState = Literal["paid", "partial", "overdue", "due", "upcoming"]

MAX_INSTALLMENTS = 120


# ---------------------------------------------------------------- inputs


class MonthlySchedule(BaseModel):
    kind: Literal["monthly"] = "monthly"
    count: int = Field(ge=1, le=MAX_INSTALLMENTS)
    start: date
    day: int = Field(ge=1, le=31)


class CustomInstallment(BaseModel):
    due: date
    amount_minor: Minor


class CustomSchedule(BaseModel):
    kind: Literal["custom"] = "custom"
    installments: list[CustomInstallment] = Field(
        min_length=1, max_length=MAX_INSTALLMENTS
    )


Schedule = Annotated[MonthlySchedule | CustomSchedule, Field(discriminator="kind")]


class LoanCreate(BaseModel):
    """A lender's new loan to a person they are connected with."""

    id: uuid.UUID | None = None
    borrower_id: uuid.UUID
    principal_minor: Minor
    interest_minor: NonNegMinor = 0
    purpose: str | None = Field(default=None, max_length=120)
    # The lender's own account (or credit card) it was paid from.
    account_id: uuid.UUID | None = None
    # Also log the principal as an expense on that account.
    log_outlay: bool = False
    schedule: Schedule

    @model_validator(mode="after")
    def _outlay_needs_account(self) -> "LoanCreate":
        if self.log_outlay and self.account_id is None:
            raise ValueError("log_outlay needs account_id")
        return self


class LoanRespond(BaseModel):
    accept: bool


class PaymentCreate(BaseModel):
    """The borrower's repayment, sent for the lender to confirm."""

    id: uuid.UUID | None = None
    amount_minor: Minor
    paid_on: date
    # The borrower's own account it left.
    account_id: uuid.UUID
    proof_media_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=280)


class CashCreate(BaseModel):
    """A repayment the lender received in hand and records directly."""

    id: uuid.UUID | None = None
    amount_minor: Minor
    paid_on: date
    # The lender's own account it went into.
    account_id: uuid.UUID
    note: str | None = Field(default=None, max_length=280)


class PaymentDecide(BaseModel):
    accept: bool
    # Accepting: the lender's own account it arrived in.
    account_id: uuid.UUID | None = None
    # Rejecting: why (the borrower sees it).
    reason: str | None = Field(default=None, max_length=280)


# Sync action args: the same bodies, naming the loan (and payment).


class LoanRef(BaseModel):
    loan_id: uuid.UUID


class LoanRespondArgs(LoanRespond, LoanRef):
    pass


class PaymentCreateArgs(PaymentCreate, LoanRef):
    pass


class CashCreateArgs(CashCreate, LoanRef):
    pass


class PaymentRef(LoanRef):
    payment_id: uuid.UUID


class PaymentDecideArgs(PaymentDecide, PaymentRef):
    pass


# ---------------------------------------------------------------- outputs


class PersonOut(BaseModel):
    id: uuid.UUID
    name: str
    handle: str | None = None
    photo_media_id: uuid.UUID | None = None


class InstallmentOut(BaseModel):
    n: int
    due: date
    amount_minor: int
    paid_minor: int
    state: InstallmentState


class PaymentOut(BaseModel):
    id: uuid.UUID
    kind: Literal["transfer", "cash"]
    status: PaymentStatus
    amount_minor: int
    paid_on: date
    note: str | None
    by_id: uuid.UUID
    proof_media_id: uuid.UUID | None
    # Short-lived; only on a REST read, never in the synced snapshot.
    proof_url: str | None = None
    proof_preview_url: str | None = None
    # The viewer's own side: the account it left (borrower) or arrived in
    # (lender), and the viewer's ledger record of it.
    account_id: uuid.UUID | None
    record_id: uuid.UUID | None
    decided_at: datetime | None
    reason: str | None
    created_at: datetime


class EventOut(BaseModel):
    kind: str
    at: datetime
    actor_id: uuid.UUID
    payment_id: uuid.UUID | None
    amount_minor: int | None
    text: str | None


class LoanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: Role
    status: LoanStatus
    lender: PersonOut
    borrower: PersonOut
    principal_minor: int
    interest_minor: int
    total_minor: int
    currency: str
    purpose: str | None
    # The lender's own account (null for the borrower).
    account_id: uuid.UUID | None
    outlay_record_id: uuid.UUID | None
    schedule: dict[str, object]
    installments: list[InstallmentOut]
    paid_minor: int
    pending_minor: int
    remaining_minor: int
    overdue_minor: int
    next_due: InstallmentOut | None
    payments: list[PaymentOut]
    events: list[EventOut]
    created_at: datetime
    responded_at: datetime | None
    closed_at: datetime | None


class LoansOut(BaseModel):
    data: list[LoanOut]
    count: int
    # Open loans in the viewer's currency: what others still owe them and
    # what they still owe.
    owed_to_me_minor: int
    i_owe_minor: int


class SharedMemberRow(BaseModel):
    """The synced row: a member's view of one shared object."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    kind: str
    object_id: uuid.UUID
    role: str
    status: str
    data: dict[str, object]


class SharedMemberSync(BaseModel):
    """Never written by a device (the entity is read-only)."""


# ================================================================ goals, budgets

MemberStatus = Literal["invited", "active", "declined", "left"]


class GoalCreate(BaseModel):
    """A savings goal shared with people the maker is connected with."""

    id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=80)
    target_minor: Minor | None = None
    deadline: date | None = None
    member_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)


class BudgetCreate(BaseModel):
    """A monthly budget shared with people the maker is connected with."""

    id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=80)
    limit_minor: Minor
    member_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)
    # The maker's own categories that count toward it (empty: all spending).
    category_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class GroupRef(BaseModel):
    kind: Literal["goal", "budget"]
    object_id: uuid.UUID


class GroupRespond(GroupRef):
    accept: bool
    # Budget: the member's own categories that count (empty: all spending).
    category_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class BudgetCategories(BaseModel):
    budget_id: uuid.UUID
    category_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class EntryCreate(BaseModel):
    """A deposit into, or a withdrawal request out of, a shared goal."""

    id: uuid.UUID | None = None
    goal_id: uuid.UUID
    kind: Literal["deposit", "withdrawal"]
    amount_minor: Minor
    on_date: date
    # The writer's own account: where a deposit left, a withdrawal lands.
    account_id: uuid.UUID
    note: str | None = Field(default=None, max_length=280)


class EntryRef(BaseModel):
    goal_id: uuid.UUID
    entry_id: uuid.UUID


class EntryDecide(EntryRef):
    accept: bool
    reason: str | None = Field(default=None, max_length=280)


class MemberOut(BaseModel):
    person: PersonOut
    role: Literal["owner", "member"]
    status: MemberStatus
    # Goal: accepted deposits less accepted withdrawals. Budget: spent this
    # month in the member's chosen categories.
    amount_minor: int


class EntryOut(BaseModel):
    id: uuid.UUID
    kind: Literal["deposit", "withdrawal"]
    status: PaymentStatus
    amount_minor: int
    on_date: date
    note: str | None
    by_id: uuid.UUID
    # The viewer's own account / record (null on another member's entry).
    account_id: uuid.UUID | None
    record_id: uuid.UUID | None
    decided_at: datetime | None
    decided_by: uuid.UUID | None
    reason: str | None
    created_at: datetime


class GroupEventOut(BaseModel):
    kind: str
    at: datetime
    actor_id: uuid.UUID
    entry_id: uuid.UUID | None
    amount_minor: int | None
    text: str | None


class GoalOut(BaseModel):
    id: uuid.UUID
    role: Literal["owner", "member"]
    my_status: MemberStatus
    status: Literal["active", "closed"]
    name: str
    currency: str
    target_minor: int | None
    deadline: date | None
    balance_minor: int
    pending_minor: int
    members: list[MemberOut]
    entries: list[EntryOut]
    events: list[GroupEventOut]
    created_at: datetime


class BudgetOut(BaseModel):
    id: uuid.UUID
    role: Literal["owner", "member"]
    my_status: MemberStatus
    status: Literal["active", "closed"]
    name: str
    currency: str
    limit_minor: int
    # The current month (calendar month of the viewer's day).
    month: str
    spent_minor: int
    # The viewer's own categories that count (others' are their own).
    my_category_ids: list[uuid.UUID]
    members: list[MemberOut]
    events: list[GroupEventOut]
    created_at: datetime


class GroupsOut(BaseModel):
    goals: list[GoalOut]
    budgets: list[BudgetOut]


# REST bodies (the path names the goal / entry / budget).


class EntryBody(BaseModel):
    id: uuid.UUID | None = None
    kind: Literal["deposit", "withdrawal"]
    amount_minor: Minor
    on_date: date
    account_id: uuid.UUID
    note: str | None = Field(default=None, max_length=280)


class DecideBody(BaseModel):
    accept: bool
    reason: str | None = Field(default=None, max_length=280)


class CategoriesBody(BaseModel):
    category_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)
