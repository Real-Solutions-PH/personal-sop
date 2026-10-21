"""Daily rollups: ``daily_module_stat`` and ``life_score_daily`` (ADR-0014).

``mark_dirty`` (``stats.public``) collects ``(owner, module, day)`` on the
session. After the session COMMITS, the listener installed here drains the set
and, per ``(owner, day)``, either defers the debounced ``stats.recompute_day``
job (``JOBS_ENABLED``) or recomputes inline on a fresh owner session. A
rolled-back write recomputes nothing. A failed recompute only logs: the rows
are caches the overview never reads, and ``rebuild`` restores them.

Row ids are derived (``derived_id``) from ``(owner, module, day)``, so a device
and the server agree on them and a recompute updates in place.
"""

import logging
import uuid
from collections.abc import Callable, Iterable
from datetime import date, timedelta
from typing import Any, TypeVar

from sqlalchemy import event
from sqlalchemy.orm import Session as OrmSession
from sqlmodel import Session, col, select

from app.core.config import settings as app_settings
from app.modules.iam.users.models import User
from app.modules.stats import logic as L
from app.modules.stats.contract import Window, contributors
from app.modules.stats.models import DailyModuleStat, LifeScoreDaily
from app.shared.context import Ctx, make_ctx
from app.shared.ids import derived_id

logger = logging.getLogger(__name__)

DIRTY_KEY = "stats_dirty"
DEBOUNCE_SECONDS = 30


def module_stat_id(owner: uuid.UUID, module: str, day: date) -> uuid.UUID:
    return derived_id("daily-module-stat", owner, f"{module}:{day.isoformat()}")


def life_score_id(owner: uuid.UUID, day: date) -> uuid.UUID:
    return derived_id("life-score-daily", owner, day.isoformat())


# ---------------------------------------------------------------- recompute


def recompute_day(ctx: Ctx, day: date, *, seal: bool = False) -> LifeScoreDaily:
    """Write the rollup rows of one business day for ``ctx``'s user. Flushes
    only; the caller commits."""
    from app.modules.stats import services

    s = services.settings(ctx)
    w = Window(day, day)
    rates: dict[str, float | None] = {}
    for k, c in contributors().items():
        rate = c.area_rate(ctx, w)
        rates[k] = rate
        p = c.day_progress(ctx, [day])[day]
        _put(
            ctx,
            DailyModuleStat,
            module_stat_id(ctx.user_id, k, day),
            module=k,
            day=day,
            due=p.due,
            done=p.done,
            rate=None if rate is None else L.clamp01(rate),
        )
    series = L.day_series(
        services.series_items(ctx, day, day),
        today=day,
        length=1,
        enabled=s.enabled,
        threshold=s.threshold,
        sealed=services.sealed_days(ctx, day, day),
    )
    # A day before today is judged as the series judges a closed day.
    result = series[0]
    on_target = result.on_target
    if day < ctx.today and result.due > 0:
        on_target = result.done / result.due >= s.threshold
    score = L.life_score_of(rates, s.weights, s.enabled)
    existing = ctx.session.get(LifeScoreDaily, life_score_id(ctx.user_id, day))
    return _put(
        ctx,
        LifeScoreDaily,
        life_score_id(ctx.user_id, day),
        day=day,
        score=score,
        level=L.level_for(score).name if score is not None else None,
        rates={k: v for k, v in rates.items() if v is not None},
        weights={k: s.weights[k] for k in L.MODULE_KEYS if s.enabled[k]},
        due=result.due,
        done=result.done,
        on_target=on_target,
        sealed=seal or bool(existing and existing.sealed),
    )


M = TypeVar("M", DailyModuleStat, LifeScoreDaily)


def _put(ctx: Ctx, model: type[M], row_id: uuid.UUID, **values: Any) -> M:
    row = ctx.session.get(model, row_id)
    if row is None:
        row = model(id=row_id, **ctx.owned(), **values)
    else:
        for k, v in values.items():
            setattr(row, k, v)
        row.updated_at = ctx.now
        row.deleted_at = None
    ctx.session.add(row)
    ctx.session.flush()
    return row


def rebuild(ctx: Ctx, first: date, last: date) -> int:
    """Recompute every day in ``[first, last]`` (the caches are always
    rebuildable from the module tables). Commits."""
    n = 0
    day = first
    while day <= last:
        recompute_day(ctx, day, seal=day < ctx.today)
        n += 1
        day += timedelta(days=1)
    ctx.commit()
    return n


def seal_yesterday(ctx: Ctx) -> bool:
    """Final recompute of the user's yesterday, marking it sealed. Returns
    False when it was already sealed. Commits."""
    day = ctx.today - timedelta(days=1)
    row = ctx.session.get(LifeScoreDaily, life_score_id(ctx.user_id, day))
    if row is not None and row.sealed:
        return False
    recompute_day(ctx, day, seal=True)
    ctx.commit()
    return True


# ---------------------------------------------------------------- user runs


def _engine_session() -> Session:
    from app.core.db import engine

    return Session(engine)


# One named seam: tests point recomputes at their own session factory.
session_factory: Callable[[], Session] = _engine_session


def recompute_for(owner_id: uuid.UUID, days: Iterable[date]) -> int:
    """Recompute ``days`` for one user on a fresh owner session (job body and
    the inline fallback). Returns how many days were written."""
    with session_factory() as session:
        user = session.get(User, owner_id)
        if user is None:
            return 0
        ctx = make_ctx(session, user)
        n = 0
        for day in sorted(set(days)):
            recompute_day(ctx, day)
            n += 1
        session.commit()
        return n


def seal_all() -> int:
    """Seal yesterday for every user with a profile (hourly job: each user's
    yesterday rolls over at their own day start)."""
    from app.modules.profile.models import UserProfile

    sealed = 0
    with session_factory() as session:
        owners = session.exec(
            select(UserProfile.owner_id).where(col(UserProfile.deleted_at).is_(None))
        ).all()
        for owner in owners:
            user = session.get(User, owner)
            if user is None:
                continue
            try:
                sealed += seal_yesterday(make_ctx(session, user))
            except Exception:  # one user's bad data must not stop the rest
                session.rollback()
                logger.exception("stats seal failed for one user")
    return sealed


# ---------------------------------------------------------------- dirty drain


def _enqueue(owner: uuid.UUID, day: date) -> None:
    from procrastinate.exceptions import AlreadyEnqueued

    from app.modules.stats.jobs import recompute_day_task

    try:
        recompute_day_task.configure(
            queueing_lock=f"stats:{owner}:{day.isoformat()}",
            schedule_in={"seconds": DEBOUNCE_SECONDS},
        ).defer(owner_id=str(owner), day=day.isoformat())
    except AlreadyEnqueued:
        pass  # a recompute for this day is already waiting: debounced


def _inline(owner: uuid.UUID, days: set[date]) -> None:
    recompute_for(owner, days)


def drain(dirty: Iterable[tuple[object, str, date]]) -> None:
    by_owner: dict[uuid.UUID, set[date]] = {}
    for owner, _module, day in dirty:
        if isinstance(owner, uuid.UUID):
            by_owner.setdefault(owner, set()).add(day)
    for owner, days in by_owner.items():
        if app_settings.JOBS_ENABLED:
            for day in days:
                try:
                    _enqueue(owner, day)
                except Exception:  # noqa: BLE001 - queue down: recompute now
                    logger.warning("stats recompute enqueue failed", exc_info=True)
                    _safe_inline(owner, {day})
        else:
            _safe_inline(owner, days)


def _safe_inline(owner: uuid.UUID, days: set[date]) -> None:
    try:
        _inline(owner, days)
    except Exception:  # noqa: BLE001 - a cache never fails the write
        logger.warning("stats inline recompute failed", exc_info=True)


READY_KEY = "stats_dirty_committed"


def _after_commit(session: OrmSession) -> None:
    # SQLAlchemy fires this on a SAVEPOINT release too; only the outermost
    # commit has made the rows visible to other connections.
    if session.get_nested_transaction() is not None:
        return
    dirty = session.info.pop(DIRTY_KEY, None)
    if dirty:
        # Not drained here: ``after_commit`` runs while the session still
        # holds its pooled connection, and the inline recompute checks out a
        # second one. Under load every writer held one connection waiting
        # for another and the pool deadlocked. Drain once it is returned.
        session.info.setdefault(READY_KEY, []).extend(dirty)


def _after_transaction_end(session: OrmSession, transaction: Any) -> None:
    if transaction.parent is not None:
        return  # a savepoint or subtransaction; the root still holds the line
    ready = session.info.pop(READY_KEY, None)
    if ready:
        drain(ready)


def _after_rollback(session: OrmSession) -> None:
    if session.get_nested_transaction() is not None:
        return  # a savepoint rolled back; the outer transaction goes on
    session.info.pop(DIRTY_KEY, None)


_installed = False


def install() -> None:
    """Attach the drain to every ORM session (idempotent)."""
    global _installed
    if _installed:
        return
    event.listen(OrmSession, "after_commit", _after_commit)
    event.listen(OrmSession, "after_rollback", _after_rollback)
    event.listen(OrmSession, "after_transaction_end", _after_transaction_end)
    _installed = True
