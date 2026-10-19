"""Sync registrations for the dashboard module (entities + domain actions).

Goal edits, archive (``status``), review fields, miss notes and share
defaults are field writes. Reviews, wrap-ups, miss notes and share defaults
are unique per natural key (period key, day, miss key, template): a pushed
create lands on (or revives) the row that key already has. Notifications are
server-created; a device only marks them read or dismisses them (delete).
Sealing and unsealing a day, wrap-up row actions, mark-all-read and the
onboarding finish are actions.
"""

import uuid
from datetime import date
from typing import Any, TypeVar

from pydantic import BaseModel

from app.modules.dashboard import logic as D
from app.modules.dashboard import services as svc
from app.modules.dashboard.models import (
    Goal,
    MissNote,
    Notification,
    Review,
    ShareDefault,
    WrapUp,
)
from app.modules.dashboard.schema import (
    GoalPublic,
    GoalSyncIn,
    MissNotePublic,
    MissNoteSyncIn,
    NotificationPublic,
    NotificationSyncIn,
    OnboardingIn,
    ReviewPublic,
    ReviewSyncIn,
    SealIn,
    ShareDefaultPublic,
    ShareDefaultSyncIn,
    WrapActionIn,
    WrapUpPublic,
    WrapUpSyncIn,
)
from app.modules.stats import public as stats_public
from app.modules.sync.registry import Action, Entity, Registry
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid, not_found
from app.shared.owned import OwnedRow

R = TypeVar("R", bound=OwnedRow)


def _natural(
    ctx: Ctx,
    model: type[R],
    row_id: uuid.UUID,
    data: dict[str, Any],
    key: str,
) -> R:
    """Upsert by client id; a create whose natural key is already held
    (live or tombstoned) lands on that row instead."""
    existing = owned_repo.get(ctx, model, row_id, include_deleted=True)
    if existing is None and key in data:
        row, _ = owned_repo.upsert(ctx, model, row_id, data, natural_key=(key,))
        return row
    row, _ = owned_repo.upsert(ctx, model, row_id, data)
    return row


# ---------------------------------------------------------------- entities


def _upsert_goal(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    data = payload.model_dump(exclude_unset=True)
    for k in ("metric", "label", "target", "comparator", "period", "status"):
        if k in data and data[k] is None:
            raise invalid("goal_field_required", "That field can't be empty")
    if "metric" in data and not D.valid_metric_ref(data["metric"]):
        raise invalid("goal_metric_invalid", "That metric can't be tracked as a goal")
    row, _ = owned_repo.upsert(ctx, Goal, row_id, data)
    return row


def _upsert_review(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    data = payload.model_dump(exclude_unset=True)
    if "key" in data and D.review_period(data["key"] or "") is None:
        raise invalid(
            "review_key_invalid", "A review is a week (Monday) or a month (1st)"
        )
    if data.get("done") and "done_at" not in data:
        data["done_at"] = ctx.now
    return _natural(ctx, Review, row_id, data, "key")


def _upsert_wrap_up(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    data = payload.model_dump(exclude_unset=True)
    row = _natural(ctx, WrapUp, row_id, data, "day")
    assert isinstance(row, WrapUp)
    stats_public.mark_dirty(ctx, module=svc.STATS_MODULE, day=row.day)
    return row


def _delete_wrap_up(ctx: Ctx, row_id: uuid.UUID) -> None:
    row = owned_repo.require(ctx, WrapUp, row_id, what="wrap_up")
    owned_repo.soft_delete(ctx, row)
    stats_public.mark_dirty(ctx, module=svc.STATS_MODULE, day=row.day)


def _upsert_miss_note(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    return _natural(
        ctx, MissNote, row_id, payload.model_dump(exclude_unset=True), "miss_key"
    )


def _upsert_notification(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    row = owned_repo.get(ctx, Notification, row_id)
    if row is None:
        raise not_found("notification")
    owned_repo.apply(row, payload.model_dump(exclude_unset=True, exclude_none=True))
    ctx.session.add(row)
    ctx.session.flush()
    return row


def _upsert_share_default(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    data = payload.model_dump(exclude_unset=True)
    existing = owned_repo.get(ctx, ShareDefault, row_id, include_deleted=True)
    template = data.get("template") or (existing.template if existing else None)
    if template is None:
        raise invalid("missing_fields", "A share default needs a template")
    if D.unknown_fields(template, data.get("fields") or {}):
        raise invalid("share_field_unknown", "That card has no such field")
    return _natural(ctx, ShareDefault, row_id, data, "template")


# ---------------------------------------------------------------- actions


class DayArgs(BaseModel):
    day: date | None = None


class NoArgs(BaseModel):
    pass


def _dump(schema: type[BaseModel], row: OwnedRow) -> dict[str, Any]:
    return schema.model_validate(row).model_dump(mode="json")


def _seal(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    return {"wrap_up": _dump(WrapUpPublic, svc.seal_day(ctx, SealIn.model_validate(a)))}


def _unseal(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    svc.unseal_day(ctx, DayArgs.model_validate(a).day or ctx.today)
    return {}


def _wrap_action(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    svc.wrap_action(ctx, WrapActionIn.model_validate(a))
    return {}


def _read_all(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    del a
    return {"marked": svc.mark_all_read(ctx)}


def _onboarding(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    created, skipped = svc.onboarding(ctx, OnboardingIn.model_validate(a))
    return {"created": [_dump(GoalPublic, g) for g in created], "skipped": skipped}


def register(r: Registry) -> None:
    r.entity(Entity("goal", Goal, GoalSyncIn, GoalPublic, upsert=_upsert_goal,
                    create_required=("metric", "label", "target")))  # fmt: skip
    r.entity(Entity("review", Review, ReviewSyncIn, ReviewPublic,
                    upsert=_upsert_review, create_required=("key",)))  # fmt: skip
    r.entity(Entity("wrap_up", WrapUp, WrapUpSyncIn, WrapUpPublic,
                    upsert=_upsert_wrap_up, delete=_delete_wrap_up,
                    create_required=("day", "at", "on_target", "done", "due")))  # fmt: skip
    r.entity(Entity("miss_note", MissNote, MissNoteSyncIn, MissNotePublic,
                    upsert=_upsert_miss_note, create_required=("miss_key", "note")))  # fmt: skip
    r.entity(Entity("notification", Notification, NotificationSyncIn,
                    NotificationPublic, upsert=_upsert_notification))  # fmt: skip
    r.entity(Entity("share_default", ShareDefault, ShareDefaultSyncIn,
                    ShareDefaultPublic, upsert=_upsert_share_default,
                    create_required=("template", "fields")))  # fmt: skip

    r.action(Action("dashboard.seal_day", _seal, SealIn))
    r.action(Action("dashboard.unseal_day", _unseal, DayArgs))
    r.action(Action("dashboard.wrap_action", _wrap_action, WrapActionIn))
    r.action(Action("dashboard.mark_all_read", _read_all, NoArgs))
    r.action(Action("dashboard.onboarding", _onboarding, OnboardingIn))
