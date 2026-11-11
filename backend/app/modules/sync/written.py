"""The synced rows one piece of server work wrote, for the device that asked.

A pull hands out only rows whose writer committed before every transaction
still running began (``services._settled_before``). Fern holds a transaction
open for a whole turn and again while it learns from the reply, so a card
confirmed or a record logged in that window is not in the pull that follows
it, and nothing tells the phone to pull again: the record showed only after a
refresh. The work that wrote the rows therefore returns them itself (a Fern
reply, a card decision pushed as an action); the pull stays the backup.

Rows written through the ORM are seen (``after_flush``); a bulk ``UPDATE``
is not, and arrives with the pull.
"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy import event
from sqlmodel import Session, col, select

from app.modules.sync.registry import Entity, registry
from app.modules.sync.schema import SyncChange
from app.shared import owned_repo
from app.shared.context import Ctx

# A turn that rewrote a whole history returns its rows to the pull instead.
MAX_ROWS = 500


class Wrote(set[tuple[str, uuid.UUID]]):
    """``(table, id)`` of every row flushed while :func:`tracking` runs.

    ``take_fresh`` hands out the rows flushed since it was last called, so a
    Fern turn can send each tool's rows as that tool finishes (a row a later
    tool changes again is handed out again); the set itself keeps them all
    for the finished reply."""

    def __init__(self) -> None:
        super().__init__()
        self.fresh: set[tuple[str, uuid.UUID]] = set()

    def take_fresh(self) -> set[tuple[str, uuid.UUID]]:
        out = set(self.fresh)
        self.fresh.clear()
        return out


@contextmanager
def tracking(session: Session) -> Iterator[Wrote]:
    """Collect ``(table, id)`` of every row flushed in ``session`` while the
    block runs (created, changed or soft-deleted)."""
    seen = Wrote()

    def after_flush(s: Any, _ctx: Any) -> None:
        for obj in (*s.new, *s.dirty, *s.deleted):
            table = getattr(obj, "__tablename__", None)
            row_id = getattr(obj, "id", None)
            if isinstance(table, str) and isinstance(row_id, uuid.UUID):
                seen.add((table, row_id))
                seen.fresh.add((table, row_id))

    event.listen(session, "after_flush", after_flush)
    try:
        yield seen
    finally:
        event.remove(session, "after_flush", after_flush)


def changes(ctx: Ctx, seen: set[tuple[str, uuid.UUID]]) -> list[SyncChange]:
    """The rows in ``seen`` as a pull would hand them out now, in version
    order: only synced entities, only what ``ctx`` may see. Empty past
    ``MAX_ROWS`` (the pull brings them)."""
    if not seen or len(seen) > MAX_ROWS:
        return []
    by_table: dict[str, list[Entity]] = {}
    for entity in registry().entities.values():
        table = entity.model.__table__.name  # type: ignore[attr-defined]
        by_table.setdefault(table, []).append(entity)
    ids: dict[str, list[uuid.UUID]] = {}
    for table, row_id in seen:
        if table in by_table:
            ids.setdefault(table, []).append(row_id)
    out: list[SyncChange] = []
    for table, row_ids in ids.items():
        for entity in by_table[table]:
            model = entity.model
            # As stored, not the session's copy: a commit that skips expiry
            # (a Fern turn's, ``release_connection``) leaves the copy without
            # what the database set (the trigger's ``version``) or another
            # request changed since.
            rows = ctx.session.exec(
                select(model)
                .where(*owned_repo.scope(ctx, model), col(model.id).in_(row_ids))
                .execution_options(populate_existing=True)
            ).all()
            out.extend(
                SyncChange(
                    entity=entity.name,
                    id=row.id,
                    version=row.version,
                    deleted=row.deleted_at is not None,
                    row=None
                    if row.deleted_at is not None
                    else entity.public.model_validate(row).model_dump(mode="json"),
                )
                for row in rows
            )
    out.sort(key=lambda c: c.version)
    return out


def tables(seen: set[tuple[str, uuid.UUID]]) -> list[str]:
    """The tables ``seen`` touched, synced or not: the app refreshes what it
    reads from the server outside sync (the food library) by these."""
    return sorted({table for table, _ in seen})
