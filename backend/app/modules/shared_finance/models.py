"""Money shared between two people (loans first).

A shared object is its own table, never a row of somebody's ledger:

- ``loan``: ``owner_id`` is the LENDER, ``borrower_id`` the other member.
  Who may read or act on a loan is decided in ``services`` (the two members),
  never by ownership alone.
- ``loan_payment``: one proposed or recorded repayment. ``owner_id`` is who
  wrote it (the borrower for a sent payment, the lender for cash). Its
  ``status`` moves once, out of ``sent``; a decided payment is never edited.
- ``loan_event``: the append-only audit trail; ``owner_id`` is the actor.
- ``shared_member``: one row per member per shared object, OWNED BY THAT
  MEMBER and written only by the server. It carries the member's role and a
  snapshot of the object as that member may see it, so the owner-scoped sync
  pull brings each member their loans and they read offline.

Each member's own ledger gets its own records (income for the lender, an
expense for the borrower), linked from the payment; nobody writes the other
member's records through the API.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, CheckConstraint, Index, String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import JSONB, OwnedRow, enum_check, minor_check, tstz

SHARED_KINDS = ("loan",)
MEMBER_ROLES = ("lender", "borrower")
LOAN_STATUSES = ("invited", "active", "declined", "cancelled", "paid")
PAYMENT_KINDS = ("transfer", "cash")
PAYMENT_STATUSES = ("sent", "accepted", "rejected", "withdrawn")
EVENT_KINDS = (
    "created",
    "accepted",
    "declined",
    "cancelled",
    "payment_sent",
    "payment_accepted",
    "payment_rejected",
    "payment_withdrawn",
    "cash_recorded",
    "paid_off",
)


class Loan(OwnedRow, table=True):
    __tablename__ = "loan"
    __table_args__ = (
        enum_check("status", LOAN_STATUSES, name="ck_loan_status"),
        CheckConstraint(
            "principal_minor > 0 AND principal_minor <= 100000000000000",
            name="ck_loan_principal",
        ),
        minor_check("interest_minor", name="ck_loan_interest"),
        CheckConstraint("owner_id <> borrower_id", name="ck_loan_self"),
    )

    borrower_id: uuid.UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", index=True
    )
    status: str = Field(default="invited", sa_type=String(10))  # type: ignore
    principal_minor: int = Field(sa_type=BigInteger)
    interest_minor: int = Field(default=0, sa_type=BigInteger)
    # The lender's currency: every amount of the loan is in it.
    currency: str = Field(default="PHP", sa_type=String(3))  # type: ignore
    purpose: str | None = Field(default=None, max_length=120)
    # The lender's own account the money (or the item) was paid from.
    lender_account_id: uuid.UUID | None = Field(
        default=None, foreign_key="account.id", ondelete="SET NULL"
    )
    outlay_record_id: uuid.UUID | None = Field(
        default=None, foreign_key="fin_record.id", ondelete="SET NULL"
    )
    # {kind: monthly, count, start, day} or {kind: custom}
    schedule: dict[str, object] = Field(sa_type=JSONB)
    # [{n, due, amount_minor}], fixed when the loan is made.
    installments: list[dict[str, object]] = Field(sa_type=JSONB)
    responded_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    closed_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore


class LoanPayment(OwnedRow, table=True):
    __tablename__ = "loan_payment"
    __table_args__ = (
        enum_check("kind", PAYMENT_KINDS, name="ck_loan_payment_kind"),
        enum_check("status", PAYMENT_STATUSES, name="ck_loan_payment_status"),
        CheckConstraint(
            "amount_minor > 0 AND amount_minor <= 100000000000000",
            name="ck_loan_payment_amount",
        ),
        # A decision is all or nothing: who, when, and (to reject) why.
        CheckConstraint(
            "(status = 'sent') = (decided_at IS NULL)",
            name="ck_loan_payment_decided",
        ),
        CheckConstraint(
            "status <> 'rejected' OR reason IS NOT NULL",
            name="ck_loan_payment_reason",
        ),
        Index("ix_loan_payment_loan_status", "loan_id", "status"),
    )

    loan_id: uuid.UUID = Field(foreign_key="loan.id", ondelete="CASCADE", index=True)
    kind: str = Field(default="transfer", sa_type=String(8))  # type: ignore
    status: str = Field(default="sent", sa_type=String(10))  # type: ignore
    amount_minor: int = Field(sa_type=BigInteger)
    paid_on: date
    note: str | None = Field(default=None, max_length=280)
    proof_media_id: uuid.UUID | None = Field(
        default=None, foreign_key="media_object.id", ondelete="SET NULL"
    )
    # The borrower's own account it left (a sent payment).
    borrower_account_id: uuid.UUID | None = Field(
        default=None, foreign_key="account.id", ondelete="SET NULL"
    )
    # The lender's own account it arrived in (chosen when accepting).
    lender_account_id: uuid.UUID | None = Field(
        default=None, foreign_key="account.id", ondelete="SET NULL"
    )
    decided_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    decided_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    reason: str | None = Field(default=None, max_length=280)
    lender_record_id: uuid.UUID | None = Field(
        default=None, foreign_key="fin_record.id", ondelete="SET NULL"
    )
    borrower_record_id: uuid.UUID | None = Field(
        default=None, foreign_key="fin_record.id", ondelete="SET NULL"
    )


class LoanEvent(OwnedRow, table=True):
    """Append-only: a row is written once and never updated."""

    __tablename__ = "loan_event"
    __table_args__ = (enum_check("kind", EVENT_KINDS, name="ck_loan_event_kind"),)

    loan_id: uuid.UUID = Field(foreign_key="loan.id", ondelete="CASCADE", index=True)
    payment_id: uuid.UUID | None = Field(
        default=None, foreign_key="loan_payment.id", ondelete="CASCADE"
    )
    kind: str = Field(sa_type=String(20))  # type: ignore
    at: datetime = Field(sa_type=tstz())  # type: ignore
    amount_minor: int | None = Field(default=None, sa_type=BigInteger)
    text: str | None = Field(default=None, max_length=280)


class SharedMember(OwnedRow, table=True):
    """A member's view of one shared object (server-written, synced)."""

    __tablename__ = "shared_member"
    __table_args__ = (
        UniqueConstraint("owner_id", "kind", "object_id", name="uq_shared_member"),
        enum_check("kind", SHARED_KINDS, name="ck_shared_member_kind"),
        enum_check("role", MEMBER_ROLES, name="ck_shared_member_role"),
    )

    kind: str = Field(sa_type=String(8))  # type: ignore
    object_id: uuid.UUID = Field(index=True)
    role: str = Field(sa_type=String(10))  # type: ignore
    status: str = Field(sa_type=String(10))  # type: ignore
    data: dict[str, object] = Field(default_factory=dict, sa_type=JSONB)
