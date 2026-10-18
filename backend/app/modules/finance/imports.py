"""Statement import (FIN-25..29): parse, reconcile, review, commit, undo.

Server-driven and REST-only. A file becomes :class:`calc.StatementRow`
values either by parsing CSV text here (a generic column mapping, or the
GCash and BPI export layouts) or from rows a vision/OCR step extracted from
a PDF or screenshot. Both paths then run the prototype's ``reconcile`` and
store one ``import_row`` per statement line for the review. Commit writes the
undo ledger (``created_ids`` plus a before-image of every record it changed)
so an undo reverts exactly what the import did.
"""

import csv
import io
import uuid
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import case
from sqlmodel import col

from app.modules.finance import calc, repo
from app.modules.finance import schema as S
from app.modules.finance.models import (
    Account,
    Category,
    FinRecord,
    ImportRow,
    StatementImport,
)
from app.modules.finance.services import _account, _check_record, _dirty, _settings
from app.modules.stats.public import mark_dirty
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict, invalid
from app.shared.ids import derived_id
from app.shared.money import MAX_MINOR

MAX_ROWS = 5000

# ---------------------------------------------------------------------------
# CSV parsing (pure)
# ---------------------------------------------------------------------------


class CsvError(ValueError):
    """A CSV the parser refuses. ``code`` is stable; ``row`` is the 1-based
    data-row number (never the cell's content)."""

    def __init__(self, code: str, row: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.row = row


# Header names of the bank layouts, matched case-insensitively.
LAYOUTS: dict[str, S.CsvMapping] = {
    # GCash › Transactions › "Download history" (CSV).
    "gcash": S.CsvMapping(
        date="Date and Time",
        description="Description",
        ref="Reference No.",
        debit="Debit",
        credit="Credit",
    ),
    # BPI online banking › Account history › Download (CSV).
    "bpi": S.CsvMapping(
        date="Transaction Date",
        description="Description",
        ref="Reference Number",
        debit="Debit",
        credit="Credit",
    ),
}
# Which account types each layout can belong to (a GCash file on a bank
# account is the prototype's "wrong account" case).
LAYOUT_TYPES: dict[str, tuple[str, ...]] = {
    "gcash": ("ewallet",),
    "bpi": ("bank", "credit"),
}

DATE_FORMATS = (
    "%Y-%m-%d",
    "%m/%d/%Y",
    "%m/%d/%y",
    "%Y/%m/%d",
    "%b %d, %Y",
    "%B %d, %Y",
    "%d %b %Y",
    "%d-%b-%Y",
    "%d %B %Y",
)
TIME_FORMATS = ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M:%S %p", "%I:%M%p")


def parse_date_time(text: str, fmt: str | None = None) -> tuple[date, str | None]:
    """A statement date cell, optionally carrying a time (``2026-10-01
    14:05``, ``10/01/2026 2:05 PM``). Returns ``(date, "HH:MM" | None)``."""
    t = " ".join(text.strip().split())
    if not t:
        raise ValueError("empty date")
    formats = (fmt,) if fmt else DATE_FORMATS
    for df in formats:
        try:
            return datetime.strptime(t, df).date(), None
        except ValueError:
            pass
        for tf in TIME_FORMATS:
            for sep in (" ", "T", ", "):
                try:
                    dt = datetime.strptime(t, f"{df}{sep}{tf}")
                except ValueError:
                    continue
                return dt.date(), f"{dt.hour:02d}:{dt.minute:02d}"
    raise ValueError("unknown date format")


def parse_time(text: str) -> str | None:
    t = text.strip()
    if not t:
        return None
    for tf in TIME_FORMATS:
        try:
            dt = datetime.strptime(t.upper(), tf)
        except ValueError:
            continue
        return f"{dt.hour:02d}:{dt.minute:02d}"
    raise ValueError("unknown time format")


def parse_amount(text: str) -> int | None:
    """A money cell -> signed centavos; ``None`` when blank. Accepts ₱/PHP,
    thousands separators, a leading minus, ``(1,234.00)`` and a trailing
    ``CR``/``DR``."""
    t = (
        text.strip()
        .upper()
        .replace("PHP", "")
        .replace("₱", "")
        .replace(",", "")
        .strip()
    )
    if not t or t in ("-", "—"):
        return None
    sign = 1
    if t.startswith("(") and t.endswith(")"):
        sign, t = -1, t[1:-1].strip()
    if t.endswith("CR"):
        t = t[:-2].strip()
    elif t.endswith("DR"):
        sign, t = -sign, t[:-2].strip()
    if t.startswith("-"):
        sign, t = -sign, t[1:].strip()
    elif t.startswith("+"):
        t = t[1:].strip()
    try:
        dec = Decimal(t)
    except InvalidOperation as exc:
        raise ValueError("not an amount") from exc
    if not dec.is_finite():
        raise ValueError("not an amount")
    minor = int((dec * 100).to_integral_value())
    if (dec * 100) != minor:
        raise ValueError("more than two decimals")
    if minor > MAX_MINOR:
        raise ValueError("amount out of range")
    return sign * minor


def _sniff(sample: str) -> type[csv.Dialect] | csv.Dialect:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        return csv.excel


def parse_csv(text: str, mapping: S.CsvMapping) -> list[calc.StatementRow]:
    """Parse CSV text with a column mapping into statement rows.

    Preamble lines before the header (bank exports often print the account
    name first) are skipped: the header is the first line that has the
    mapped date and description columns. Blank lines are skipped; any other
    line that fails to parse refuses the whole file (fail closed — a
    silently dropped row would reconcile to the wrong balance).
    """
    text = text.lstrip("﻿")
    reader = list(csv.reader(io.StringIO(text), _sniff(text[:4096])))
    want = {
        k: v.strip().lower()
        for k, v in mapping.model_dump(exclude={"date_format"}).items()
        if v is not None
    }
    header_at = None
    for i, line in enumerate(reader[:30]):
        names = [c.strip().lower() for c in line]
        if want["date"] in names and want["description"] in names:
            header_at = i
            break
    if header_at is None:
        raise CsvError("csv_header_not_found")
    names = [c.strip().lower() for c in reader[header_at]]
    missing = [k for k, v in want.items() if v not in names]
    if missing:
        raise CsvError("csv_columns_missing")
    idx = {k: names.index(v) for k, v in want.items()}
    rows: list[calc.StatementRow] = []
    for n, line in enumerate(reader[header_at + 1 :], start=1):
        if not any(c.strip() for c in line):
            continue
        if len(rows) >= MAX_ROWS:
            raise CsvError("csv_too_many_rows")

        def cell(key: str, line: list[str] = line) -> str:
            j = idx.get(key)
            return line[j] if j is not None and j < len(line) else ""

        try:
            day, tm = parse_date_time(cell("date"), mapping.date_format)
            if "time" in idx:
                tm = parse_time(cell("time")) or tm
            if "amount" in idx:
                signed = parse_amount(cell("amount"))
            else:
                debit = parse_amount(cell("debit"))
                credit = parse_amount(cell("credit"))
                if debit and credit:
                    raise ValueError("both debit and credit")
                signed = -abs(debit) if debit else (abs(credit) if credit else None)
        except ValueError as exc:
            raise CsvError("csv_row_invalid", n) from exc
        if not signed:
            raise CsvError("csv_row_invalid", n)
        raw = " ".join(cell("description").split())[:500]
        if not raw:
            raise CsvError("csv_row_invalid", n)
        pending = raw.upper().startswith("PENDING")
        rows.append(
            calc.StatementRow(
                ref=cell("ref").strip()[:80],
                date=day,
                time=tm or "12:00",
                raw=raw,
                amount=abs(signed),
                direction="in" if signed > 0 else "out",
                pending=pending,
            )
        )
    return rows


# ---------------------------------------------------------------------------
# Use cases
# ---------------------------------------------------------------------------


def _import(
    ctx: Ctx, import_id: uuid.UUID, *, include_deleted: bool = False
) -> StatementImport:
    return owned_repo.require(
        ctx, StatementImport, import_id, what="import", include_deleted=include_deleted
    )


def start_import(ctx: Ctx, *, data: S.ImportStart) -> StatementImport:
    """FIN-25: an import for an account, waiting for its rows."""
    _settings(ctx)
    _account(ctx, data.account_id)
    row, _ = owned_repo.upsert(
        ctx,
        StatementImport,
        data.id or uuid.uuid4(),
        {
            "account_id": data.account_id,
            "file_name": data.file_name,
            "file_type": data.file_type,
            "file_media_id": data.file_media_id,
            "status": "parsing",
            "file_kept": True,
        },
    )
    ctx.commit()
    return row


def _ingest(
    ctx: Ctx, imp: StatementImport, rows: list[calc.StatementRow]
) -> StatementImport:
    if imp.status not in ("parsing", "failed"):
        raise conflict("import_not_parsing", "This import was already read")
    if not rows:
        imp.status, imp.error_code = "failed", "no_rows"
        ctx.session.add(imp)
        ctx.session.flush()
        return imp
    state = repo.load_state(ctx)
    calc_rows = calc.reconcile(state, str(imp.account_id), rows, str(imp.id))
    first = min(r.date for r in rows)
    last = max(r.date for r in rows)
    for old in owned_repo.list_rows(ctx, ImportRow, col(ImportRow.import_id) == imp.id):
        owned_repo.soft_delete(ctx, old)
    for r in calc_rows:
        owned_repo.upsert(
            ctx,
            ImportRow,
            derived_id("import-row", imp.id, str(r.position)),
            {
                "import_id": imp.id,
                "position": r.position,
                "ref": r.row.ref,
                "on_date": r.row.date,
                "time": r.row.time,
                "raw": r.row.raw,
                "amount_minor": r.row.amount,
                "direction": r.row.direction,
                "pending": r.row.pending,
                "payee": r.payee[:120],
                "suggested_category_id": _uuid(r.suggested_category_id),
                "category_id": _uuid(r.category_id),
                "state": r.state,
                "reason": r.reason,
                "match_id": _uuid(r.match_id),
                "confidence": r.confidence,
                "decision": r.decision,
                "is_transfer": r.is_transfer,
            },
        )
    imp.period_from, imp.period_to = first, last
    imp.closing_minor = calc.statement_closing(
        state, str(imp.account_id), last, calc_rows
    )
    imp.status, imp.error_code = "review", None
    ctx.session.add(imp)
    ctx.session.flush()
    return imp


def _uuid(v: str | None) -> uuid.UUID | None:
    return uuid.UUID(v) if v else None


def ingest_csv(ctx: Ctx, *, import_id: uuid.UUID, data: S.CsvIn) -> StatementImport:
    imp = _import(ctx, import_id)
    acct = _account(ctx, imp.account_id)
    if data.layout == "generic":
        if data.mapping is None:
            raise invalid(
                "csv_mapping_required",
                "Say which columns hold the date, text and amount",
            )
        mapping = data.mapping
    else:
        mapping = LAYOUTS[data.layout]
        if acct.type not in LAYOUT_TYPES[data.layout] and not data.force_account:
            raise conflict(
                "wrong_account", "This file looks like it belongs to another account"
            )
    try:
        rows = parse_csv(data.text, mapping)
    except CsvError as exc:
        raise invalid(
            exc.code, "Couldn't read this file", {"row": exc.row} if exc.row else None
        ) from exc
    out = _ingest(ctx, imp, rows)
    ctx.commit()
    return out


def ingest_rows(
    ctx: Ctx, *, import_id: uuid.UUID, data: S.ExtractedIn
) -> StatementImport:
    """Rows a vision/OCR step read from a PDF or screenshot."""
    imp = _import(ctx, import_id)
    rows = [
        calc.StatementRow(
            ref=r.ref,
            date=r.date,
            time=r.time,
            raw=r.raw,
            amount=r.amount_minor,
            direction=r.direction,
            pending=r.pending,
        )
        for r in data.rows
    ]
    out = _ingest(ctx, imp, rows)
    ctx.commit()
    return out


def fail_import(ctx: Ctx, *, import_id: uuid.UUID, error_code: str) -> StatementImport:
    imp = _import(ctx, import_id)
    if imp.status not in ("parsing", "failed"):
        raise conflict("import_not_parsing", "This import was already read")
    imp.status, imp.error_code = "failed", error_code
    ctx.session.add(imp)
    ctx.commit()
    return imp


def retry_import(ctx: Ctx, *, import_id: uuid.UUID) -> StatementImport:
    imp = _import(ctx, import_id)
    if imp.status != "failed":
        raise conflict("import_not_failed", "Only a failed import can be retried")
    imp.status, imp.error_code = "parsing", None
    ctx.session.add(imp)
    ctx.commit()
    return imp


def patch_rows(ctx: Ctx, *, import_id: uuid.UUID, data: S.RowPatch) -> list[ImportRow]:
    """FIN-27/28 review: decide, categorise, rename or re-match rows."""
    imp = _import(ctx, import_id)
    if imp.status != "review":
        raise conflict("import_not_in_review", "This import is not being reviewed")
    if data.category_id is not None:
        owned_repo.require(ctx, Category, data.category_id, what="category")
    if data.match_id is not None:
        target = owned_repo.require(ctx, FinRecord, data.match_id, what="record")
        if imp.account_id not in (target.account_id, target.to_account_id):
            raise invalid("match_other_account", "That record is on another account")
    rows = []
    for rid in dict.fromkeys(data.row_ids):
        row = owned_repo.require(ctx, ImportRow, rid, what="import_row")
        if row.import_id != imp.id:
            raise invalid("row_other_import", "That row belongs to another import")
        patch = data.model_dump(exclude_unset=True, exclude={"row_ids"})
        if "match_id" in patch:
            if patch["match_id"] is None:
                row.state, row.match_id = "new", None
            else:
                row.state, row.decision = (
                    "probable",
                    row.decision if "decision" in patch else "take",
                )
        owned_repo.apply(row, patch)
        ctx.session.add(row)
        rows.append(row)
    ctx.session.flush()
    ctx.commit()
    return rows


_BEFORE_FIELDS = ("at", "amount_minor", "payee", "category_id", "import_id")


def _before(rec: FinRecord) -> dict[str, Any]:
    return {
        "at": rec.at.isoformat(),
        "amount_minor": rec.amount_minor,
        "payee": rec.payee,
        "category_id": str(rec.category_id) if rec.category_id else None,
        "import_id": str(rec.import_id) if rec.import_id else None,
    }


def _row_at(ctx: Ctx, row: ImportRow) -> datetime:
    """A statement's date and wall-clock time in the user's zone (a bank
    prints calendar dates, not business days)."""
    hh, mm = (row.time or "12:00").split(":")
    return datetime.combine(row.on_date, time(int(hh), int(mm)), tzinfo=ctx.clock.zone)


def commit_import(ctx: Ctx, *, import_id: uuid.UUID, data: S.CommitIn) -> S.CommitOut:
    """Write the reviewed rows: matched rows stamp their record; probable rows
    keep mine / take the statement / merge the amount; accepted new rows
    become records. Sets the account's last-reconciled date and returns the
    remaining gap between the statement's closing and the app balance."""
    imp = _import(ctx, import_id)
    if imp.status != "review":
        raise conflict("import_not_in_review", "This import is not being reviewed")
    rows = owned_repo.list_rows(
        ctx,
        ImportRow,
        col(ImportRow.import_id) == imp.id,
        order_by=[col(ImportRow.position)],
    )
    created: list[str] = []
    changed: list[dict[str, Any]] = []
    matched = ignored = 0
    transfer_acct: Account | None = None
    for r in rows:
        if r.decision != "ignore" and r.is_transfer and not r.match_id:
            if data.transfer_account_id is None:
                raise invalid(
                    "transfer_account_required",
                    "Pick the account the transfers came from",
                )
            transfer_acct = _account(ctx, data.transfer_account_id)
            if transfer_acct.id == imp.account_id:
                raise invalid("transfer_same_account", "Pick two different accounts")
            break
    for r in rows:
        if r.decision == "ignore":
            ignored += 1
            continue
        target = owned_repo.get(ctx, FinRecord, r.match_id) if r.match_id else None
        if r.state == "matched" and target is not None:
            matched += 1
            changed.append({"id": str(target.id), "before": _before(target)})
            old_day = ctx.clock.day_of(target.at)
            if ctx.clock.day_of(target.at) == r.on_date:
                target.at = _row_at(ctx, r)
            target.import_id = imp.id
            target.payee = target.payee or r.payee or None
            ctx.session.add(target)
            _dirty(ctx, old_day, ctx.clock.day_of(target.at))
        elif r.state == "probable" and target is not None:
            changed.append({"id": str(target.id), "before": _before(target)})
            old_day = ctx.clock.day_of(target.at)
            target.import_id = imp.id
            if r.decision in ("take", "merge"):
                target.amount_minor = r.amount_minor
            if r.decision == "take":
                target.at = _row_at(ctx, r)
                if target.category_id is None:
                    target.category_id = r.category_id
            target.edited_at = ctx.now
            ctx.session.add(target)
            _dirty(ctx, old_day, ctx.clock.day_of(target.at))
        elif r.state == "new" or r.decision == "accept":
            rid = derived_id("import-record", imp.id, str(r.position))
            values: dict[str, Any] = {
                "amount_minor": r.amount_minor,
                "at": _row_at(ctx, r),
                "status": "cleared",
                "source": "import",
                "import_id": imp.id,
                "note": r.raw,
            }
            if r.is_transfer and transfer_acct is not None:
                inbound = r.direction == "in"
                values |= {
                    "type": "transfer",
                    "account_id": transfer_acct.id if inbound else imp.account_id,
                    "to_account_id": imp.account_id if inbound else transfer_acct.id,
                    "payee": r.payee or None,
                    "category_id": None,
                }
            else:
                cat = r.category_id or r.suggested_category_id
                kind = owned_repo.get(ctx, Category, cat) if cat else None
                want = "income" if r.direction == "in" else "expense"
                values |= {
                    "type": want,
                    "account_id": imp.account_id,
                    "payee": r.payee or None,
                    "category_id": cat
                    if kind is not None and kind.kind == want
                    else None,
                }
            _check_record(
                ctx,
                type=values["type"],
                account_id=values["account_id"],
                to_account_id=values.get("to_account_id"),
                category_id=values["category_id"],
                is_refund=False,
            )
            rec, _ = owned_repo.upsert(ctx, FinRecord, rid, values)
            created.append(str(rec.id))
            _dirty(ctx, ctx.clock.day_of(rec.at))
    acct = _account(ctx, imp.account_id)
    acct.last_reconciled = imp.period_to
    ctx.session.add(acct)
    imp.status = "done"
    imp.file_kept = False
    imp.file_media_id = None
    imp.created_ids = created
    imp.changed = changed
    imp.counts = {
        "matched": matched,
        "created": len(created),
        "updated": len(changed) - matched,
        "ignored": ignored,
    }
    ctx.session.add(imp)
    ctx.session.flush()
    state = repo.load_state(ctx)
    gap = 0
    if imp.closing_minor is not None and imp.period_to is not None:
        gap = imp.closing_minor - calc.balance_of(
            state, repo.acct_of(acct), imp.period_to
        )
    ctx.commit()
    return S.CommitOut(
        gap_minor=gap,
        created=len(created),
        updated=len(changed) - matched,
        matched=matched,
        ignored=ignored,
    )


def undo_import(ctx: Ctx, *, import_id: uuid.UUID) -> StatementImport:
    """Revert only what the commit did: tombstone the records it created and
    put back the fields it overwrote."""
    imp = _import(ctx, import_id)
    if imp.status != "done":
        raise conflict("import_not_done", "Only a committed import can be undone")
    for rid in imp.created_ids:
        rec = owned_repo.get(ctx, FinRecord, uuid.UUID(rid))
        if rec is not None:
            owned_repo.soft_delete(ctx, rec)
            mark_dirty(ctx, module="finance", day=ctx.clock.day_of(rec.at))
    for ch in imp.changed:
        rec = owned_repo.get(
            ctx, FinRecord, uuid.UUID(str(ch["id"])), include_deleted=True
        )
        if rec is None:
            continue
        before = ch["before"]
        assert isinstance(before, dict)
        old_day = ctx.clock.day_of(rec.at)
        rec.at = datetime.fromisoformat(str(before["at"]))
        rec.amount_minor = int(before["amount_minor"])
        rec.payee = before["payee"]
        rec.category_id = _uuid(before["category_id"])
        rec.import_id = _uuid(before["import_id"])
        ctx.session.add(rec)
        _dirty(ctx, old_day, ctx.clock.day_of(rec.at))
    imp.status = "undone"
    ctx.session.add(imp)
    ctx.commit()
    return imp


def delete_import(ctx: Ctx, *, import_id: uuid.UUID) -> None:
    """Discard a draft or failed import (a committed one is undone instead)."""
    imp = _import(ctx, import_id)
    if imp.status not in ("parsing", "review", "failed"):
        raise conflict("import_committed", "Undo the import instead")
    owned_repo.soft_delete(ctx, imp)
    ctx.commit()


def restore_import(ctx: Ctx, *, import_id: uuid.UUID) -> StatementImport:
    """Undo a discard."""
    imp = _import(ctx, import_id, include_deleted=True)
    if imp.deleted_at is not None:
        owned_repo.restore(ctx, imp)
    ctx.commit()
    return imp


def discard_file(ctx: Ctx, *, import_id: uuid.UUID) -> StatementImport:
    """Stop keeping the uploaded file (OQ-FIN-11); the parsed rows stay."""
    imp = _import(ctx, import_id)
    imp.file_kept = False
    imp.file_media_id = None
    ctx.session.add(imp)
    ctx.commit()
    return imp


def list_imports(
    ctx: Ctx, *, account_id: uuid.UUID | None, skip: int, limit: int
) -> tuple[list[StatementImport], int]:
    where: list[Any] = []
    if account_id is not None:
        where.append(StatementImport.account_id == account_id)
    drafts_first = case(
        (col(StatementImport.status).in_(("parsing", "review")), 0), else_=1
    )
    rows = owned_repo.list_rows(
        ctx,
        StatementImport,
        *where,
        order_by=[drafts_first, col(StatementImport.created_at).desc()],
        skip=skip,
        limit=limit,
    )
    return rows, owned_repo.count_rows(ctx, StatementImport, *where)


def import_detail(ctx: Ctx, *, import_id: uuid.UUID) -> S.ImportDetail:
    imp = _import(ctx, import_id)
    rows = owned_repo.list_rows(
        ctx,
        ImportRow,
        col(ImportRow.import_id) == imp.id,
        order_by=[col(ImportRow.position)],
        limit=MAX_ROWS,
    )
    acct = _account(ctx, imp.account_id)
    state = repo.load_state(ctx)
    bal = calc.balance_of(state, repo.acct_of(acct), imp.period_to)
    out_rows = []
    for r in rows:
        pub = S.ImportRowPublic.model_validate(r)
        pub.needs_attention = calc.needs_attention(r.state, r.confidence)
        out_rows.append(pub)
    ctx.commit()
    return S.ImportDetail.model_validate(
        {
            "import": S.ImportPublic.model_validate(imp),
            "rows": out_rows,
            "app_balance_minor": bal,
        }
    )
