"""Finance (IA M4). Every amount is integer centavos (``*_minor``)."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Float,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlmodel import Field

from app.shared.owned import JSONB, OwnedRow, enum_check, minor_check, tstz

ACCOUNT_TYPES = ("cash", "bank", "ewallet", "credit", "investment")
RECORD_TYPES = ("expense", "income", "transfer")
RECORD_SOURCES = (
    "chat",
    "quick-add",
    "photo",
    "import",
    "planned",
    "manual",
    "adjustment",
)
CATEGORY_KINDS = ("expense", "income")
IMPORT_STATUSES = ("parsing", "review", "done", "failed", "undone")
FILE_TYPES = ("pdf", "csv", "image")
MATCH_STATES = ("matched", "probable", "new", "duplicate", "pending")
ROW_DECISIONS = ("accept", "ignore", "keep", "take", "merge")
ADVISOR_SCOPES = ("aggregates", "records")


def _money() -> BigInteger:
    return BigInteger()


class Account(OwnedRow, table=True):
    __tablename__ = "account"
    __table_args__ = (
        enum_check("type", ACCOUNT_TYPES, name="ck_account_type"),
        minor_check("opening_minor", name="ck_account_opening", signed=True),
        CheckConstraint(
            "limit_minor IS NULL OR (limit_minor > 0 AND limit_minor <= 100000000000000)",
            name="ck_account_limit",
        ),
        CheckConstraint(
            "rate_bp IS NULL OR rate_bp BETWEEN 0 AND 10000", name="ck_account_rate"
        ),
        minor_check("goal_minor", name="ck_account_goal"),
    )

    name: str = Field(max_length=60)
    type: str = Field(sa_type=String(12))  # type: ignore
    opening_minor: int = Field(default=0, sa_type=_money())  # type: ignore
    opening_date: date
    limit_minor: int | None = Field(default=None, sa_type=_money())  # type: ignore
    color: str = Field(default="fin", max_length=16)
    in_net_worth: bool = True
    in_projection: bool = True
    archived: bool = False
    last_reconciled: date | None = None
    manual: bool = False
    sort_order: int = 0
    # Savings: interest p.a. in basis points, a time deposit's maturity, and
    # an optional goal (target amount, target date).
    rate_bp: int | None = None
    matures_on: date | None = None
    goal_minor: int | None = Field(default=None, sa_type=_money())  # type: ignore
    goal_by: date | None = None


class Category(OwnedRow, table=True):
    """One level of nesting (``parent_id``). ``system`` rows (Transfer fee,
    Adjustment, Uncategorised) cannot be deleted."""

    __tablename__ = "category"
    __table_args__ = (enum_check("kind", CATEGORY_KINDS, name="ck_category_kind"),)

    name: str = Field(max_length=60)
    kind: str = Field(sa_type=String(8))  # type: ignore
    parent_id: uuid.UUID | None = Field(
        default=None, foreign_key="category.id", ondelete="SET NULL", index=True
    )
    icon: str = Field(default="tag", max_length=32)
    discretionary: bool = False
    archived: bool = False
    system: bool = False
    slug: str | None = Field(default=None, max_length=40)
    sort_order: int = Field(default=0, sa_column_kwargs={"server_default": "0"})


class FinRecord(OwnedRow, table=True):
    """An expense, income or transfer. A transfer's fee is a separate expense
    with ``fee_of`` pointing at the transfer; a refund is income in the
    original expense category with ``is_refund``."""

    __tablename__ = "fin_record"
    __table_args__ = (
        enum_check("type", RECORD_TYPES, name="ck_fin_record_type"),
        enum_check("source", RECORD_SOURCES, name="ck_fin_record_source"),
        enum_check("status", ("cleared", "pending"), name="ck_fin_record_status"),
        minor_check("amount_minor", name="ck_fin_record_amount", signed=True),
        CheckConstraint(
            "(type = 'transfer') = (to_account_id IS NOT NULL)",
            name="ck_fin_record_transfer_target",
        ),
        CheckConstraint(
            "to_account_id IS NULL OR to_account_id <> account_id",
            name="ck_fin_record_transfer_self",
        ),
        CheckConstraint(
            "is_adjustment OR amount_minor > 0", name="ck_fin_record_positive"
        ),
        # Kept in another currency: the amount as spent and the rate used,
        # together or not at all.
        CheckConstraint(
            "(orig_currency IS NULL) = (orig_amount_minor IS NULL) "
            "AND (orig_currency IS NULL) = (fx_rate IS NULL)",
            name="ck_fin_record_fx_together",
        ),
        CheckConstraint(
            "orig_amount_minor IS NULL OR orig_amount_minor > 0",
            name="ck_fin_record_orig_positive",
        ),
        CheckConstraint("fx_rate IS NULL OR fx_rate > 0", name="ck_fin_record_fx_rate"),
    )

    type: str = Field(sa_type=String(8))  # type: ignore
    amount_minor: int = Field(sa_type=_money())  # type: ignore
    account_id: uuid.UUID = Field(
        foreign_key="account.id", ondelete="CASCADE", index=True
    )
    to_account_id: uuid.UUID | None = Field(
        default=None, foreign_key="account.id", ondelete="CASCADE", index=True
    )
    category_id: uuid.UUID | None = Field(
        default=None, foreign_key="category.id", ondelete="SET NULL", index=True
    )
    at: datetime = Field(sa_type=tstz(), index=True)  # type: ignore
    payee: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    source: str = Field(default="manual", sa_type=String(10))  # type: ignore
    receipt_media_id: uuid.UUID | None = Field(
        default=None, foreign_key="media_object.id", ondelete="SET NULL"
    )
    planned_id: uuid.UUID | None = Field(
        default=None, foreign_key="planned_item.id", ondelete="SET NULL", index=True
    )
    planned_on: date | None = None
    # A record kept in another currency: ``amount_minor`` is the amount in the
    # user's currency at ``fx_rate`` (one unit of ``orig_currency``).
    orig_currency: str | None = Field(default=None, sa_type=String(3))  # type: ignore
    orig_amount_minor: int | None = Field(default=None, sa_type=BigInteger)
    fx_rate: Decimal | None = Field(default=None, sa_type=Numeric(18, 8))  # type: ignore
    import_id: uuid.UUID | None = Field(
        default=None, foreign_key="statement_import.id", ondelete="SET NULL", index=True
    )
    is_refund: bool = False
    is_adjustment: bool = False
    fee_of: uuid.UUID | None = Field(
        default=None, foreign_key="fin_record.id", ondelete="CASCADE"
    )
    status: str = Field(default="cleared", sa_type=String(8))  # type: ignore
    edited_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore


class Budget(OwnedRow, table=True):
    """``categories`` empty (no ``budget_category`` rows) means all expense."""

    __tablename__ = "budget"
    __table_args__ = (
        enum_check("period", ("monthly",), name="ck_budget_period"),
        CheckConstraint(
            "limit_minor > 0 AND limit_minor <= 100000000000000", name="ck_budget_limit"
        ),
    )

    name: str = Field(max_length=60)
    period: str = Field(default="monthly", sa_type=String(8))  # type: ignore
    limit_minor: int = Field(sa_type=_money())  # type: ignore
    rollover: bool = False
    start_date: date
    archived: bool = False


class BudgetCategory(OwnedRow, table=True):
    __tablename__ = "budget_category"
    __table_args__ = (
        UniqueConstraint("budget_id", "category_id", name="uq_budget_category"),
    )

    budget_id: uuid.UUID = Field(
        foreign_key="budget.id", ondelete="CASCADE", index=True
    )
    category_id: uuid.UUID = Field(foreign_key="category.id", ondelete="CASCADE")


class PlannedItem(OwnedRow, table=True):
    """A bill, payday, installment or what-if. ``schedule`` is
    ``{kind: once|monthly|semimonthly|weekly, ...}``; ``end_rule`` is
    ``{kind: never|date|count, ...}``."""

    __tablename__ = "planned_item"
    __table_args__ = (
        enum_check("type", RECORD_TYPES, name="ck_planned_type"),
        CheckConstraint(
            "amount_minor > 0 AND amount_minor <= 100000000000000",
            name="ck_planned_amount",
        ),
    )

    name: str = Field(max_length=80)
    type: str = Field(sa_type=String(8))  # type: ignore
    amount_minor: int = Field(sa_type=_money())  # type: ignore
    estimated: bool = False
    account_id: uuid.UUID = Field(foreign_key="account.id", ondelete="CASCADE")
    to_account_id: uuid.UUID | None = Field(
        default=None, foreign_key="account.id", ondelete="CASCADE"
    )
    category_id: uuid.UUID | None = Field(
        default=None, foreign_key="category.id", ondelete="SET NULL"
    )
    schedule: dict[str, object] = Field(sa_type=JSONB)
    start: date
    end_rule: dict[str, object] = Field(
        default_factory=lambda: {"kind": "never"}, sa_type=JSONB
    )
    auto_log: bool = False
    is_what_if: bool = False
    is_installment: bool = False
    in_projection: bool = True
    archived: bool = False


class PlannedSkip(OwnedRow, table=True):
    __tablename__ = "planned_skip"
    __table_args__ = (UniqueConstraint("planned_id", "on_day", name="uq_planned_skip"),)

    planned_id: uuid.UUID = Field(
        foreign_key="planned_item.id", ondelete="CASCADE", index=True
    )
    on_day: date


class PlannedSnooze(OwnedRow, table=True):
    __tablename__ = "planned_snooze"
    __table_args__ = (
        UniqueConstraint("planned_id", "on_day", name="uq_planned_snooze"),
    )

    planned_id: uuid.UUID = Field(
        foreign_key="planned_item.id", ondelete="CASCADE", index=True
    )
    on_day: date
    until_day: date


class StatementImport(OwnedRow, table=True):
    __tablename__ = "statement_import"
    __table_args__ = (
        enum_check("status", IMPORT_STATUSES, name="ck_import_status"),
        enum_check("file_type", FILE_TYPES, name="ck_import_file_type"),
    )

    account_id: uuid.UUID = Field(foreign_key="account.id", ondelete="CASCADE")
    file_name: str = Field(max_length=255)
    file_type: str = Field(sa_type=String(6))  # type: ignore
    file_media_id: uuid.UUID | None = Field(
        default=None, foreign_key="media_object.id", ondelete="SET NULL"
    )
    period_from: date | None = None
    period_to: date | None = None
    closing_minor: int | None = Field(default=None, sa_type=_money())  # type: ignore
    status: str = Field(default="parsing", sa_type=String(8))  # type: ignore
    # {matched, created, updated, ignored}
    counts: dict[str, int] | None = Field(default=None, sa_type=JSONB)
    # Undo ledger: ids this import created, and before-images it overwrote.
    created_ids: list[str] = Field(default_factory=list, sa_type=JSONB)
    changed: list[dict[str, object]] = Field(default_factory=list, sa_type=JSONB)
    file_kept: bool = True
    error_code: str | None = Field(default=None, max_length=40)


class ImportRow(OwnedRow, table=True):
    """Kept after commit for audit (IA M4 ImportRow note)."""

    __tablename__ = "import_row"
    __table_args__ = (
        enum_check("state", MATCH_STATES, name="ck_import_row_state"),
        enum_check("decision", ROW_DECISIONS, name="ck_import_row_decision"),
        enum_check("direction", ("in", "out"), name="ck_import_row_direction"),
        CheckConstraint(
            "amount_minor > 0 AND amount_minor <= 100000000000000",
            name="ck_import_row_amount",
        ),
        CheckConstraint(
            "confidence >= 0 AND confidence <= 1", name="ck_import_row_confidence"
        ),
    )

    import_id: uuid.UUID = Field(
        foreign_key="statement_import.id", ondelete="CASCADE", index=True
    )
    position: int
    ref: str = Field(max_length=80)
    on_date: date
    time: str | None = Field(default=None, max_length=5)
    raw: str = Field(max_length=500)
    amount_minor: int = Field(sa_type=_money())  # type: ignore
    direction: str = Field(sa_type=String(3))  # type: ignore
    pending: bool = False
    payee: str = Field(default="", max_length=120)
    suggested_category_id: uuid.UUID | None = Field(
        default=None, foreign_key="category.id", ondelete="SET NULL"
    )
    state: str = Field(default="new", sa_type=String(10))  # type: ignore
    reason: str | None = Field(default=None, max_length=200)
    match_id: uuid.UUID | None = Field(
        default=None, foreign_key="fin_record.id", ondelete="SET NULL"
    )
    confidence: float = Field(default=0, sa_type=Float)
    decision: str = Field(default="accept", sa_type=String(6))  # type: ignore
    category_id: uuid.UUID | None = Field(
        default=None, foreign_key="category.id", ondelete="SET NULL"
    )
    is_transfer: bool = False


class LookBack(OwnedRow, table=True):
    __tablename__ = "look_back"
    __table_args__ = (UniqueConstraint("owner_id", "period", name="uq_look_back"),)

    # "2026-09", "2026-W38" or a custom "2026-09-01_2026-09-30".
    period: str = Field(max_length=24)
    note: str = Field(default="", max_length=2000)
    saved_at: datetime = Field(sa_type=tstz())  # type: ignore
    snapshot: dict[str, object] = Field(sa_type=JSONB)


class AdvisorThread(OwnedRow, table=True):
    __tablename__ = "advisor_thread"

    title: str = Field(max_length=120)


class AdvisorMessage(OwnedRow, table=True):
    __tablename__ = "advisor_message"
    __table_args__ = (
        enum_check("role", ("user", "ai"), name="ck_advisor_msg_role"),
        enum_check("scope", ADVISOR_SCOPES, name="ck_advisor_msg_scope"),
    )

    thread_id: uuid.UUID = Field(
        foreign_key="advisor_thread.id", ondelete="CASCADE", index=True
    )
    role: str = Field(sa_type=String(4))  # type: ignore
    text: str = Field(max_length=8000)
    at: datetime = Field(sa_type=tstz())  # type: ignore
    answer: dict[str, object] | None = Field(default=None, sa_type=JSONB)
    scope: str = Field(default="aggregates", sa_type=String(10))  # type: ignore


class FinanceSettings(OwnedRow, table=True):
    __tablename__ = "finance_settings"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_finance_settings_owner"),
        CheckConstraint("month_start_day BETWEEN 1 AND 28", name="ck_fin_month_start"),
        CheckConstraint("horizon IN (6, 12, 24)", name="ck_fin_horizon"),
        enum_check("ai_scope", ADVISOR_SCOPES, name="ck_fin_ai_scope"),
        minor_check("safety_floor_minor", name="ck_fin_safety_floor"),
        CheckConstraint("nudge_days BETWEEN 0 AND 90", name="ck_fin_nudge"),
    )

    default_account_id: uuid.UUID | None = Field(
        default=None, foreign_key="account.id", ondelete="SET NULL"
    )
    last_account_id: uuid.UUID | None = Field(
        default=None, foreign_key="account.id", ondelete="SET NULL"
    )
    last_category_id: uuid.UUID | None = Field(
        default=None, foreign_key="category.id", ondelete="SET NULL"
    )
    month_start_day: int = 1
    horizon: int = 12
    include_unplanned: bool = True
    safety_floor_minor: int = Field(default=0, sa_type=_money())  # type: ignore
    ai_scope: str = Field(default="aggregates", sa_type=String(10))  # type: ignore
    disclaimer_ack: bool = False
    nudge_days: int = 7
    # HH:MM in the user's clock for bill reminders, or null for off.
    bill_reminder: str | None = Field(default="09:00", max_length=5)
    proj_excluded_planned: list[str] = Field(default_factory=list, sa_type=JSONB)
    setup_done: bool = False
