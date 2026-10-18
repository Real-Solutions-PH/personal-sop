"""Cross-module contract of the finance module (implemented by finance).

Amounts are integer centavos.
"""

import uuid
from datetime import date, datetime
from typing import Literal

from app.modules.finance.models import Account, Category, FinRecord, PlannedItem
from app.shared.context import Ctx

RecordSource = Literal[
    "chat", "quick-add", "photo", "import", "planned", "manual", "adjustment"
]


def default_account(ctx: Ctx) -> Account | None:
    """Settings' default account, else the last used, else the first cash."""
    raise NotImplementedError


def resolve_category(
    ctx: Ctx, hint: str, *, kind: Literal["expense", "income"] = "expense"
) -> Category | None:
    """Match a free-text hint ("grab", "food", "sweldo") to a category."""
    raise NotImplementedError


def log_expense(
    ctx: Ctx,
    *,
    amount_minor: int,
    category_id: uuid.UUID | None = None,
    account_id: uuid.UUID | None = None,
    payee: str | None = None,
    note: str | None = None,
    source: RecordSource = "chat",
    at: datetime | None = None,
    receipt_media_id: uuid.UUID | None = None,
    record_id: uuid.UUID | None = None,
) -> FinRecord:
    raise NotImplementedError


def log_income(
    ctx: Ctx,
    *,
    amount_minor: int,
    category_id: uuid.UUID | None = None,
    account_id: uuid.UUID | None = None,
    payee: str | None = None,
    source: RecordSource = "chat",
    at: datetime | None = None,
    record_id: uuid.UUID | None = None,
) -> FinRecord:
    raise NotImplementedError


def log_transfer(
    ctx: Ctx,
    *,
    amount_minor: int,
    from_account_id: uuid.UUID,
    to_account_id: uuid.UUID,
    fee_minor: int = 0,
    source: RecordSource = "chat",
    at: datetime | None = None,
    record_id: uuid.UUID | None = None,
) -> list[FinRecord]:
    """Returns the transfer and, when ``fee_minor`` > 0, its fee expense."""
    raise NotImplementedError


def add_planned(
    ctx: Ctx,
    *,
    name: str,
    amount_minor: int,
    day: date,
    account_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    type: Literal["expense", "income"] = "expense",
    planned_id: uuid.UUID | None = None,
) -> PlannedItem:
    raise NotImplementedError


def find_account(ctx: Ctx, hint: str) -> Account | None:
    raise NotImplementedError


def delete_records(ctx: Ctx, *, record_ids: list[uuid.UUID]) -> None:
    raise NotImplementedError


def restore_records(ctx: Ctx, *, record_ids: list[uuid.UUID]) -> None:
    raise NotImplementedError


def delete_planned(ctx: Ctx, *, planned_id: uuid.UUID) -> None:
    raise NotImplementedError


def spend_between(ctx: Ctx, first: date, last: date) -> int:
    """Total spend (expenses minus refunds, no transfers/adjustments)."""
    raise NotImplementedError
