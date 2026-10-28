"""Journal entries (CAP-15/16) and the AI settings row (CAP-17)."""

import uuid
from datetime import date, timedelta
from typing import Any

from sqlmodel import col, func, or_, select

from app.modules.capture import ports
from app.modules.capture.models import AISettings, JournalEntry
from app.modules.capture.rules import DEFAULT_MONEY_THRESHOLD_MINOR, DEFAULT_RULES
from app.modules.capture.schema import AISettingsUpdate, JournalIn, JournalUpdate
from app.modules.stats import public as stats
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.ids import derived_id

MAX_STREAK_DAYS = 3660


def _dirty(ctx: Ctx, day: date) -> None:
    stats.mark_dirty(ctx, module="journal", day=day)


def _tick_journal_habit(ctx: Ctx, entry: JournalEntry) -> None:
    """The prototype's ``addJournalEntry`` checks an active habit named like
    "Journal" for the entry's day when it has no log yet. A one-tap mood
    check-in (tagged ``check-in``) is not journaling and never ticks it."""
    if entry.day > ctx.today or "check-in" in entry.tags:
        return
    for h in ports.habits.find_habits(ctx, "journal", limit=5):
        if h.status != "active" or "journal" not in h.name.lower():
            continue
        if ports.habit_log_on(ctx, h.id, entry.day) is None:
            ports.habits.log_habit(
                ctx,
                habit_id=h.id,
                day=entry.day,
                source="capture",
                log_id=derived_id("journal-habit", entry.id, str(h.id)),
            )
        return


def add_entry(
    ctx: Ctx,
    *,
    body: str,
    day: date | None = None,
    source: str = "text",
    mood: int | None = None,
    tags: list[str] | None = None,
    area: str | None = None,
    private: bool = True,
    transcript: str | None = None,
    capture_id: uuid.UUID | None = None,
    entry_id: uuid.UUID | None = None,
) -> JournalEntry:
    """Create (or replay) an entry. Flushes only."""
    rid = entry_id or uuid.uuid4()
    existing = owned_repo.get(ctx, JournalEntry, rid, include_deleted=True)
    if existing is not None and existing.deleted_at is None:
        return existing
    row, _ = owned_repo.upsert(
        ctx,
        JournalEntry,
        rid,
        {
            "day": day or ctx.today,
            "body": body.strip(),
            "source": source,
            "mood": mood,
            "tags": list(tags or []),
            "area": area,
            "private": private,
            "transcript": transcript,
            "capture_id": capture_id,
        },
    )
    _tick_journal_habit(ctx, row)
    _dirty(ctx, row.day)
    return row


def delete_entry_row(ctx: Ctx, entry_id: uuid.UUID) -> None:
    row = owned_repo.require(ctx, JournalEntry, entry_id, what="journal_entry")
    owned_repo.soft_delete(ctx, row)
    _dirty(ctx, row.day)


# ---------------------------------------------------------------- use cases


def create(ctx: Ctx, *, data: JournalIn) -> JournalEntry:
    row = add_entry(
        ctx,
        body=data.body,
        day=data.day,
        source=data.source,
        mood=data.mood,
        tags=data.tags,
        area=data.area,
        private=data.private,
        transcript=data.transcript,
        entry_id=data.id,
    )
    ctx.commit()
    return row


def update(ctx: Ctx, *, entry_id: uuid.UUID, data: JournalUpdate) -> JournalEntry:
    row = owned_repo.require(ctx, JournalEntry, entry_id, what="journal_entry")
    patch = data.model_dump(exclude_unset=True)
    if "body" in patch:
        patch["body"] = patch["body"].strip()
    before = row.day
    owned_repo.apply(row, patch)
    ctx.session.add(row)
    ctx.session.flush()
    _dirty(ctx, before)
    _dirty(ctx, row.day)
    ctx.commit()
    return row


def delete(ctx: Ctx, *, entry_id: uuid.UUID) -> None:
    delete_entry_row(ctx, entry_id)
    ctx.commit()


def restore(ctx: Ctx, *, entry_id: uuid.UUID) -> JournalEntry:
    row = owned_repo.require(
        ctx, JournalEntry, entry_id, what="journal_entry", include_deleted=True
    )
    owned_repo.restore(ctx, row)
    _dirty(ctx, row.day)
    ctx.commit()
    return row


def get(ctx: Ctx, *, entry_id: uuid.UUID) -> JournalEntry:
    return owned_repo.require(ctx, JournalEntry, entry_id, what="journal_entry")


def streak(ctx: Ctx) -> int:
    """Consecutive days with an entry, ending today (or yesterday when
    today has none yet), as the journal list computes it."""
    since = ctx.today - timedelta(days=MAX_STREAK_DAYS)
    days = set(
        ctx.session.exec(
            select(col(JournalEntry.day))
            .where(
                JournalEntry.owner_id == ctx.user_id,
                JournalEntry.tenant_id == ctx.tenant_id,
                col(JournalEntry.deleted_at).is_(None),
                col(JournalEntry.day) >= since,
            )
            .distinct()
        ).all()
    )
    base = 0 if ctx.today in days else -1
    n = 0
    while ctx.today + timedelta(days=base - n) in days:
        n += 1
    return n


def find(
    ctx: Ctx,
    *,
    q: str | None,
    area: str | None,
    tag: str | None,
    mood: int | None,
    skip: int,
    limit: int,
) -> tuple[list[JournalEntry], int]:
    where: list[Any] = []
    if area:
        where.append(col(JournalEntry.area) == area)
    if mood:
        where.append(col(JournalEntry.mood) == mood)
    if tag:
        where.append(col(JournalEntry.tags).contains([tag.lower()]))
    if q:
        needle = q.lower().replace("%", "").replace("_", "")
        where.append(
            or_(
                func.lower(col(JournalEntry.body)).contains(needle),
                col(JournalEntry.tags).contains([needle]),
            )
        )
    rows = owned_repo.list_rows(
        ctx,
        JournalEntry,
        *where,
        order_by=[col(JournalEntry.day).desc(), col(JournalEntry.created_at).desc()],
        skip=skip,
        limit=limit,
    )
    return rows, owned_repo.count_rows(ctx, JournalEntry, *where)


# ---------------------------------------------------------------- settings


def settings_row(ctx: Ctx) -> AISettings:
    """The user's AI settings, created with the prototype's defaults on first
    read. Flushes only."""
    row = owned_repo.find_one(ctx, AISettings, include_deleted=True)
    if row is None:
        row, _ = owned_repo.insert_once(
            ctx,
            AISettings,
            {
                "rules": dict(DEFAULT_RULES),
                "money_threshold_minor": DEFAULT_MONEY_THRESHOLD_MINOR,
            },
            row_id=derived_id("ai-settings", ctx.user_id, "row"),
        )
    elif row.deleted_at is not None:
        owned_repo.restore(ctx, row)
    if set(row.rules) != set(DEFAULT_RULES):
        row.rules = {**DEFAULT_RULES, **row.rules}
        ctx.session.add(row)
        ctx.session.flush()
    return row


def get_settings(ctx: Ctx) -> AISettings:
    row = settings_row(ctx)
    ctx.commit()
    return row


def patch_settings_row(ctx: Ctx, patch: dict[str, Any]) -> AISettings:
    row = settings_row(ctx)
    if patch.get("rules") is not None:
        patch["rules"] = {**row.rules, **patch["rules"]}
    owned_repo.apply(row, {k: v for k, v in patch.items() if v is not None})
    ctx.session.add(row)
    ctx.session.flush()
    return row


def update_settings(ctx: Ctx, *, data: AISettingsUpdate) -> AISettings:
    row = patch_settings_row(ctx, data.model_dump(exclude_unset=True))
    ctx.commit()
    return row
