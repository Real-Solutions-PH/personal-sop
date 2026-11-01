"""Request, response and sync-payload schemas of the finance module.

Every amount is integer centavos (``*_minor``) bounded on both sides; a
schedule and an end rule are validated value objects (written whole).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.shared.money import MAX_MINOR

Minor = Annotated[int, Field(ge=1, le=MAX_MINOR)]
SignedMinor = Annotated[int, Field(ge=-MAX_MINOR, le=MAX_MINOR)]
NonNegMinor = Annotated[int, Field(ge=0, le=MAX_MINOR)]
AccountType = Literal["cash", "bank", "ewallet", "credit", "investment"]
RecordType = Literal["expense", "income", "transfer"]
RecordSource = Literal[
    "chat", "quick-add", "photo", "import", "planned", "manual", "adjustment"
]
CategoryKind = Literal["expense", "income"]
Scope = Literal["aggregates", "records"]
Decision = Literal["accept", "ignore", "keep", "take", "merge"]
Name60 = Annotated[str, Field(min_length=1, max_length=60)]


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


class OnceSchedule(BaseModel):
    kind: Literal["once"]
    date: date


class MonthlySchedule(BaseModel):
    kind: Literal["monthly"]
    day: int = Field(ge=1, le=31)


class SemimonthlySchedule(BaseModel):
    kind: Literal["semimonthly"]
    days: tuple[Annotated[int, Field(ge=1, le=31)], Annotated[int, Field(ge=1, le=31)]]

    @field_validator("days")
    @classmethod
    def _distinct(cls, v: tuple[int, int]) -> tuple[int, int]:
        if v[0] == v[1]:
            raise ValueError("two different days")
        return v


class WeeklySchedule(BaseModel):
    kind: Literal["weekly"]
    every: int = Field(ge=1, le=52)
    anchor: date


Schedule = Annotated[
    OnceSchedule | MonthlySchedule | SemimonthlySchedule | WeeklySchedule,
    Field(discriminator="kind"),
]


class EndNever(BaseModel):
    kind: Literal["never"]


class EndDate(BaseModel):
    kind: Literal["date"]
    date: date


class EndCount(BaseModel):
    kind: Literal["count"]
    n: int = Field(ge=1, le=600)


EndRule = Annotated[EndNever | EndDate | EndCount, Field(discriminator="kind")]


def dump_value(v: BaseModel | dict[str, Any]) -> dict[str, Any]:
    """A schedule/end rule as stored JSONB (dates as ISO strings)."""
    if isinstance(v, BaseModel):
        return v.model_dump(mode="json")
    return v


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


class AccountFields(BaseModel):
    name: Name60 | None = None
    type: AccountType | None = None
    opening_minor: SignedMinor | None = None
    opening_date: date | None = None
    limit_minor: Minor | None = None
    color: str | None = Field(default=None, max_length=16)
    in_net_worth: bool | None = None
    in_projection: bool | None = None
    archived: bool | None = None
    manual: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10_000)
    last_reconciled: date | None = None
    rate_bp: int | None = Field(default=None, ge=0, le=10_000)
    matures_on: date | None = None
    goal_minor: Minor | None = None
    goal_by: date | None = None


class AccountCreate(AccountFields):
    id: uuid.UUID | None = None
    name: Name60
    type: AccountType


class AccountPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    type: str
    opening_minor: int
    opening_date: date
    limit_minor: int | None
    color: str
    in_net_worth: bool
    in_projection: bool
    archived: bool
    last_reconciled: date | None
    manual: bool
    sort_order: int
    rate_bp: int | None
    matures_on: date | None
    goal_minor: int | None
    goal_by: date | None
    version: int


class AccountView(AccountPublic):
    balance_minor: int
    reconciled_days_ago: int | None


class AccountsPublic(BaseModel):
    data: list[AccountView]
    count: int
    net_worth_minor: int
    liquid_minor: int


class AccountDetail(BaseModel):
    account: AccountView
    series_minor: list[int]


class AdjustBalance(BaseModel):
    actual_minor: SignedMinor
    note: str | None = Field(default=None, max_length=500)
    record_id: uuid.UUID | None = None


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


class CategoryFields(BaseModel):
    name: Name60 | None = None
    kind: CategoryKind | None = None
    parent_id: uuid.UUID | None = None
    icon: str | None = Field(default=None, max_length=32)
    discretionary: bool | None = None
    archived: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10_000)


class CategoryCreate(CategoryFields):
    id: uuid.UUID | None = None
    name: Name60
    kind: CategoryKind


class CategoryPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    kind: str
    parent_id: uuid.UUID | None
    icon: str
    discretionary: bool
    archived: bool
    system: bool
    slug: str | None
    sort_order: int
    version: int


class CategoriesPublic(BaseModel):
    data: list[CategoryPublic]
    count: int


class MoveCategory(BaseModel):
    parent_id: uuid.UUID


class CategoryUses(BaseModel):
    records: int
    planned: int
    budgets: int


class DeleteCategory(BaseModel):
    move_to: uuid.UUID | None = None


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------


class RecordFields(BaseModel):
    type: RecordType | None = None
    amount_minor: Minor | None = None
    account_id: uuid.UUID | None = None
    to_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    at: datetime | None = None
    payee: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    source: RecordSource | None = None
    receipt_media_id: uuid.UUID | None = None
    is_refund: bool | None = None
    status: Literal["cleared", "pending"] | None = None
    # Kept in another currency (a USD purchase): the amount as spent, in
    # hundredths of ``orig_currency``. ``amount_minor`` is then worked out
    # from the rate; ``fx_rate`` is the one the device used, kept when it
    # matches the amounts, else the server fetches the latest. Null
    # ``orig_currency`` clears all three.
    orig_currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    orig_amount_minor: Minor | None = None
    fx_rate: Decimal | None = Field(default=None, gt=0, le=1_000_000)

    @field_validator("at")
    @classmethod
    def _aware(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("timestamp needs a time zone")
        return v


class RecordCreate(RecordFields):
    id: uuid.UUID | None = None
    type: RecordType
    amount_minor: Minor
    account_id: uuid.UUID
    fee_minor: NonNegMinor = 0


class RecordUpdate(RecordFields):
    pass


class RecordPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    type: str
    amount_minor: int
    account_id: uuid.UUID
    to_account_id: uuid.UUID | None
    category_id: uuid.UUID | None
    at: datetime
    day: date | None = None
    payee: str | None
    note: str | None
    source: str
    receipt_media_id: uuid.UUID | None
    planned_id: uuid.UUID | None
    planned_on: date | None
    import_id: uuid.UUID | None
    is_refund: bool
    is_adjustment: bool
    fee_of: uuid.UUID | None
    status: str
    edited_at: datetime | None
    version: int
    orig_currency: str | None = None
    orig_amount_minor: int | None = None
    fx_rate: Decimal | None = None


class FxRatePublic(BaseModel):
    """One unit of ``base`` in the user's currency (``quote``), as of the
    last published reference day."""

    base: str
    quote: str
    rate: Decimal
    as_of: date


class RecordsPublic(BaseModel):
    data: list[RecordPublic]
    count: int


class RecordIds(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class Recategorise(RecordIds):
    category_id: uuid.UUID


class Duplicate(BaseModel):
    new_id: uuid.UUID | None = None


class RecordFilter(BaseModel):
    """FIN-08 filter & sort."""

    q: str | None = Field(default=None, max_length=120)
    type: RecordType | None = None
    account_ids: list[uuid.UUID] = Field(default_factory=list)
    category_ids: list[uuid.UUID] = Field(default_factory=list)
    first: date | None = None
    last: date | None = None
    min_minor: NonNegMinor | None = None
    max_minor: NonNegMinor | None = None
    sources: list[RecordSource] = Field(default_factory=list)
    pending_only: bool = False
    planned_id: uuid.UUID | None = None
    import_id: uuid.UUID | None = None
    sort: Literal["date", "amount", "payee"] = "date"


# ---------------------------------------------------------------------------
# Budgets
# ---------------------------------------------------------------------------


class BudgetFields(BaseModel):
    name: Name60 | None = None
    limit_minor: Minor | None = None
    rollover: bool | None = None
    start_date: date | None = None
    archived: bool | None = None
    # ``None`` = leave as is; ``[]`` = all expense categories.
    category_ids: list[uuid.UUID] | None = Field(default=None, max_length=100)


class BudgetCreate(BudgetFields):
    id: uuid.UUID | None = None
    name: Name60
    limit_minor: Minor


class BudgetPublic(BaseModel):
    id: uuid.UUID
    name: str
    period: str
    limit_minor: int
    rollover: bool
    start_date: date
    archived: bool
    category_ids: list[uuid.UUID]
    version: int


class BudgetViewOut(BaseModel):
    budget: BudgetPublic
    month: str
    first: date
    last: date
    spent_minor: int
    limit_minor: int
    carry_minor: int
    pct: float
    pace: float
    days_left: int
    safe_per_day_minor: int
    today_allowance_minor: int


class BudgetsPublic(BaseModel):
    data: list[BudgetViewOut]
    count: int


class BudgetDetail(BaseModel):
    view: BudgetViewOut
    history: list[BudgetViewOut]
    avg3_minor: int


# ---------------------------------------------------------------------------
# Planned items
# ---------------------------------------------------------------------------


class PlannedFields(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    type: RecordType | None = None
    amount_minor: Minor | None = None
    estimated: bool | None = None
    account_id: uuid.UUID | None = None
    to_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    schedule: Schedule | None = None
    start: date | None = None
    end_rule: EndRule | None = None
    auto_log: bool | None = None
    is_what_if: bool | None = None
    is_installment: bool | None = None
    in_projection: bool | None = None
    archived: bool | None = None


class PlannedCreate(PlannedFields):
    id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=80)
    type: RecordType
    amount_minor: Minor
    account_id: uuid.UUID
    schedule: Schedule


class PlannedPublic(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    amount_minor: int
    estimated: bool
    account_id: uuid.UUID
    to_account_id: uuid.UUID | None
    category_id: uuid.UUID | None
    schedule: dict[str, Any]
    start: date
    end_rule: dict[str, Any]
    auto_log: bool
    is_what_if: bool
    is_installment: bool
    in_projection: bool
    archived: bool
    skipped: list[date]
    snoozed: dict[str, date]
    monthly_eq_minor: int
    version: int


class PlannedList(BaseModel):
    data: list[PlannedPublic]
    count: int
    monthly_in_minor: int
    monthly_out_minor: int


class OccurrenceOut(BaseModel):
    planned_id: uuid.UUID
    name: str
    type: str
    amount_minor: int
    day: date
    orig: date
    status: Literal["paid", "skipped", "due", "upcoming", "overdue"]
    record_id: uuid.UUID | None


class OccurrencesPublic(BaseModel):
    data: list[OccurrenceOut]
    count: int


class OccurrenceRef(BaseModel):
    planned_id: uuid.UUID
    day: date


class Settle(OccurrenceRef):
    amount_minor: Minor | None = None
    account_id: uuid.UUID | None = None
    # The business day it was actually paid (default: today).
    paid_on: date | None = None


class Snooze(OccurrenceRef):
    days: int = Field(default=1, ge=1, le=60)


# ---------------------------------------------------------------------------
# Projection, reports, look-backs
# ---------------------------------------------------------------------------


class WhatIfIn(BaseModel):
    amount_minor: Minor
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    installments: int = Field(default=1, ge=1, le=60)


class ProjectionIn(BaseModel):
    horizon: Literal[6, 12, 24] | None = None
    include_unplanned: bool | None = None
    excluded_planned: list[uuid.UUID] | None = None
    excluded_accounts: list[uuid.UUID] = Field(default_factory=list)
    what_if: WhatIfIn | None = None
    extra_planned_ids: list[uuid.UUID] = Field(default_factory=list)


class ProjMonthOut(BaseModel):
    key: str
    inflow_minor: int
    planned_minor: int
    unplanned_minor: int
    what_if_minor: int
    net_minor: int
    end_minor: int
    end_base_minor: int


class LowOut(BaseModel):
    value_minor: int
    key: str


class ProjectionOut(BaseModel):
    start_minor: int
    months: list[ProjMonthOut]
    avg_unplanned_minor: int
    low: LowOut
    low_base: LowOut
    avg_surplus_minor: int
    has_income: bool
    recovery_months: int | None
    safety_floor_minor: int
    verdict: Literal["ok", "tight", "no"]


class FlowOut(BaseModel):
    income_minor: int
    spend_minor: int
    savings_rate: float
    count: int
    by_category: list[tuple[str, int]]
    by_payee: list[tuple[str, int]]


class ReportOut(BaseModel):
    period: Literal["this", "last", "3m"]
    first: date
    last: date
    prev_first: date
    prev_last: date
    month: str | None
    flow: FlowOut
    prev: FlowOut
    daily_minor: list[int]
    days: int
    weekday_avg_minor: list[int]
    months: list[tuple[str, int, int]]
    budgets: list[tuple[uuid.UUID, list[BudgetViewOut]]]
    net_worth_minor: list[int]


class LeakOut(BaseModel):
    payee: str
    n: int
    total_minor: int
    category_id: str | None


class LookbackOut(BaseModel):
    first: date
    last: date
    prev_first: date
    prev_last: date
    flow: FlowOut
    prev: FlowOut
    base_minor: int
    savings_rate: float
    prev_savings_rate: float
    no_spend_count: int
    no_spend_streak: int
    budgets: list[BudgetViewOut]
    kept: list[uuid.UUID]
    blown: list[uuid.UUID]
    where: list[tuple[str, int, int]]
    spikes: list[str]
    big_record_ids: list[uuid.UUID]
    leaks: list[LeakOut]
    subs_minor: int
    completeness: float
    top_share: float
    saved: "LookBackPublic | None" = None


class Snapshot(BaseModel):
    savings_rate: float = Field(ge=-1000, le=1)
    income_minor: NonNegMinor
    spend_minor: SignedMinor


class LookBackSave(BaseModel):
    id: uuid.UUID | None = None
    # Month "2026-09", ISO week "2026-W38" or custom "2026-09-01_2026-09-30".
    period: str = Field(
        min_length=7,
        max_length=24,
        pattern=r"^\d{4}-(\d{2}|W\d{2}|\d{2}-\d{2}_\d{4}-\d{2}-\d{2})$",
    )
    note: str = Field(default="", max_length=2000)
    snapshot: Snapshot


class LookBackPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    period: str
    note: str
    saved_at: datetime
    snapshot: dict[str, Any]
    version: int


class LookBacksPublic(BaseModel):
    data: list[LookBackPublic]
    count: int


class HomeOut(BaseModel):
    """FIN-01 in one read."""

    setup_done: bool
    net_worth_minor: int
    liquid_minor: int
    accounts: list[AccountView]
    spent_this_month_minor: int
    income_this_month_minor: int
    main_budget: BudgetViewOut | None
    upcoming: list[OccurrenceOut]
    due: list[OccurrenceOut]
    pending_records: int
    stale_accounts: list[uuid.UUID]
    projection_end_minor: int | None
    projection_low: LowOut | None
    net_worth_series_minor: list[int]
    runway_months: float


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class SettingsFields(BaseModel):
    default_account_id: uuid.UUID | None = None
    month_start_day: int | None = Field(default=None, ge=1, le=28)
    horizon: Literal[6, 12, 24] | None = None
    include_unplanned: bool | None = None
    safety_floor_minor: NonNegMinor | None = None
    ai_scope: Scope | None = None
    disclaimer_ack: bool | None = None
    nudge_days: int | None = Field(default=None, ge=0, le=90)
    # HH:MM in the user's clock, or null to turn bill reminders off.
    bill_reminder: str | None = Field(
        default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$"
    )
    proj_excluded_planned: list[uuid.UUID] | None = Field(default=None, max_length=500)
    setup_done: bool | None = None


class SettingsPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    default_account_id: uuid.UUID | None
    last_account_id: uuid.UUID | None
    last_category_id: uuid.UUID | None
    month_start_day: int
    horizon: int
    include_unplanned: bool
    safety_floor_minor: int
    ai_scope: str
    disclaimer_ack: bool
    nudge_days: int
    bill_reminder: str | None
    proj_excluded_planned: list[str]
    setup_done: bool
    version: int


# ---------------------------------------------------------------------------
# Statement import
# ---------------------------------------------------------------------------


class ImportStart(BaseModel):
    id: uuid.UUID | None = None
    account_id: uuid.UUID
    file_name: str = Field(min_length=1, max_length=255)
    file_type: Literal["pdf", "csv", "image"]
    file_media_id: uuid.UUID | None = None


class CsvMapping(BaseModel):
    """Column names of a generic CSV: one signed amount column, or separate
    debit/credit columns."""

    date: str = Field(max_length=60)
    description: str = Field(max_length=60)
    amount: str | None = Field(default=None, max_length=60)
    debit: str | None = Field(default=None, max_length=60)
    credit: str | None = Field(default=None, max_length=60)
    time: str | None = Field(default=None, max_length=60)
    ref: str | None = Field(default=None, max_length=60)
    date_format: str | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def _amount_columns(self) -> "CsvMapping":
        if self.amount is None and (self.debit is None or self.credit is None):
            raise ValueError("an amount column, or debit and credit columns")
        return self


class CsvIn(BaseModel):
    text: str = Field(min_length=1, max_length=2_000_000)
    layout: Literal["generic", "gcash", "bpi"] = "generic"
    mapping: CsvMapping | None = None
    # Accept the account a layout detected even when it differs.
    force_account: bool = False


class ExtractedRow(BaseModel):
    """A statement row a vision/OCR step extracted."""

    ref: str = Field(default="", max_length=80)
    date: date
    time: str = Field(default="00:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    raw: str = Field(min_length=1, max_length=500)
    amount_minor: Minor
    direction: Literal["in", "out"]
    pending: bool = False


class ExtractedIn(BaseModel):
    rows: list[ExtractedRow] = Field(max_length=5000)


class ImportFail(BaseModel):
    error_code: Literal[
        "unreadable", "password", "bad_password", "wrong_account", "no_rows"
    ]


class RowPatch(BaseModel):
    row_ids: list[uuid.UUID] = Field(min_length=1, max_length=5000)
    decision: Decision | None = None
    category_id: uuid.UUID | None = None
    payee: str | None = Field(default=None, max_length=120)
    match_id: uuid.UUID | None = None


class CommitIn(BaseModel):
    # The other side of rows read as transfers ("Cash-in via InstaPay").
    transfer_account_id: uuid.UUID | None = None


class ImportRowPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    position: int
    ref: str
    on_date: date
    time: str | None
    raw: str
    amount_minor: int
    direction: str
    pending: bool
    payee: str
    suggested_category_id: uuid.UUID | None
    state: str
    reason: str | None
    match_id: uuid.UUID | None
    confidence: float
    decision: str
    category_id: uuid.UUID | None
    is_transfer: bool
    needs_attention: bool = False


class ImportPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    account_id: uuid.UUID
    file_name: str
    file_type: str
    period_from: date | None
    period_to: date | None
    closing_minor: int | None
    status: str
    counts: dict[str, int] | None
    created_ids: list[str]
    file_kept: bool
    error_code: str | None
    created_at: datetime
    version: int


class ImportDetail(BaseModel):
    import_: ImportPublic = Field(alias="import")
    rows: list[ImportRowPublic]
    app_balance_minor: int
    model_config = ConfigDict(populate_by_name=True)


class ImportsPublic(BaseModel):
    data: list[ImportPublic]
    count: int


class CommitOut(BaseModel):
    gap_minor: int
    created: int
    updated: int
    matched: int
    ignored: int


# ---------------------------------------------------------------------------
# Advisor
# ---------------------------------------------------------------------------


class ThreadCreate(BaseModel):
    id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=120)


class ThreadUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class MessageCreate(BaseModel):
    id: uuid.UUID | None = None
    role: Literal["user", "ai"]
    text: str = Field(min_length=1, max_length=8000)
    answer: dict[str, Any] | None = None
    scope: Scope = "aggregates"


class MessagePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    thread_id: uuid.UUID
    role: str
    text: str
    at: datetime
    answer: dict[str, Any] | None
    scope: str
    version: int


class ThreadPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    created_at: datetime
    version: int


class ThreadDetail(ThreadPublic):
    messages: list[MessagePublic]


class ThreadsPublic(BaseModel):
    data: list[ThreadPublic]
    count: int


class AdviceIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    scope: Scope = "aggregates"


class Ok(BaseModel):
    ok: bool = True
    ids: list[uuid.UUID] = Field(default_factory=list)


LookbackOut.model_rebuild()
