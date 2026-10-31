"""REST routes of the dashboard module: one endpoint per screen read and per
screen action of Today, Goals, Reviews, Wrap-up, Inbox, Share and onboarding.
Static paths are declared before ``/{id}`` ones."""

import uuid
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Query

from app.modules.dashboard import logic as D
from app.modules.dashboard import schema as S
from app.modules.dashboard import services as svc
from app.modules.iam.deps import require_permission
from app.modules.stats import public as stats_public
from app.modules.stats.schema import GoalProgressOut, RingOut, goal_progress_out
from app.shared.context import CtxDep, ReadCtxDep
from app.shared.domain import not_found
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited
from app.shared.schema import Message

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

READ = [Depends(require_permission("dashboard:read"))]
WRITE = [rate_limited("dashboard"), Depends(require_permission("dashboard:write"))]

ReviewKey = Annotated[str, Path(max_length=16)]
MissKey = Annotated[str, Path(min_length=1, max_length=120)]


def _ring(r: stats_public.DayRing) -> RingOut:
    return RingOut.model_validate(
        {
            "due": r.due,
            "done": r.done,
            "per": {k: {"due": d, "done": n} for k, (d, n) in r.per.items()},
        }
    )


# ---------------------------------------------------------------- today


@router.get("/today", response_model=S.TodayBundle, dependencies=READ)
def today(ctx: ReadCtxDep) -> Any:
    """The Today bundle: ring, Life Score, next up, card counts and the
    wrap-up state."""
    return svc.today_bundle(ctx)


# ---------------------------------------------------------------- goals


def _goal_out(ctx: CtxDep, goal_id: uuid.UUID) -> GoalProgressOut:
    view = next(
        (g for g in stats_public.goals_with_progress(ctx) if g.goal.id == str(goal_id)),
        None,
    )
    if view is None:  # pragma: no cover - the goal was just read or written
        raise not_found("goal")
    return goal_progress_out(view)


@router.get("/goals", response_model=S.GoalsOut, dependencies=READ)
def list_goals(ctx: ReadCtxDep, page: PaginationDep) -> Any:
    """Every goal with its progress against the current metric value."""
    views = [goal_progress_out(g) for g in stats_public.goals_with_progress(ctx)]
    return S.GoalsOut(data=views[page.skip : page.skip + page.limit], count=len(views))


@router.post("/goals", response_model=GoalProgressOut, dependencies=WRITE)
def create_goal(ctx: CtxDep, body: S.GoalCreate) -> Any:
    row = svc.create_goal(ctx, body)
    return _goal_out(ctx, row.id)


@router.get("/goals/{goal_id}", response_model=GoalProgressOut, dependencies=READ)
def read_goal(ctx: ReadCtxDep, goal_id: uuid.UUID) -> Any:
    svc.require_goal(ctx, goal_id)
    return _goal_out(ctx, goal_id)


@router.patch("/goals/{goal_id}", response_model=GoalProgressOut, dependencies=WRITE)
def update_goal(ctx: CtxDep, goal_id: uuid.UUID, body: S.GoalUpdate) -> Any:
    svc.update_goal(ctx, goal_id, body)
    return _goal_out(ctx, goal_id)


@router.post(
    "/goals/{goal_id}/archive", response_model=GoalProgressOut, dependencies=WRITE
)
def archive_goal(ctx: CtxDep, goal_id: uuid.UUID) -> Any:
    svc.set_goal_status(ctx, goal_id, "archived")
    return _goal_out(ctx, goal_id)


@router.post(
    "/goals/{goal_id}/restore", response_model=GoalProgressOut, dependencies=WRITE
)
def restore_goal(ctx: CtxDep, goal_id: uuid.UUID) -> Any:
    """Un-archive."""
    svc.set_goal_status(ctx, goal_id, "active")
    return _goal_out(ctx, goal_id)


@router.delete("/goals/{goal_id}", response_model=Message, dependencies=WRITE)
def delete_goal(ctx: CtxDep, goal_id: uuid.UUID) -> Any:
    svc.delete_goal(ctx, goal_id)
    return Message(message="Goal deleted")


@router.post(
    "/goals/{goal_id}/undelete", response_model=GoalProgressOut, dependencies=WRITE
)
def undelete_goal(ctx: CtxDep, goal_id: uuid.UUID) -> Any:
    """Undo of a delete."""
    svc.restore_deleted_goal(ctx, goal_id)
    return _goal_out(ctx, goal_id)


# ---------------------------------------------------------------- reviews


@router.get("/reviews", response_model=S.ReviewsOut, dependencies=READ)
def list_reviews(ctx: CtxDep, page: PaginationDep) -> Any:
    rows, count = svc.list_reviews(ctx, skip=page.skip, limit=page.limit)
    return S.ReviewsOut(data=rows, count=count)  # type: ignore[arg-type]


@router.put("/reviews/{key}", response_model=S.ReviewPublic, dependencies=WRITE)
def save_review(ctx: CtxDep, key: ReviewKey, body: S.ReviewIn) -> Any:
    """``saveReview``: ``w-<Monday>`` or ``m-<1st>``."""
    return svc.save_review(ctx, key, body)


# ---------------------------------------------------------------- wrap-up


@router.get("/wrap-up", response_model=S.WrapUpState, dependencies=READ)
def wrap_up_state(ctx: CtxDep, day: date | None = None) -> Any:
    the_day = day or ctx.today
    ring = stats_public.day_ring(ctx, day=the_day)
    return S.WrapUpState(
        day=the_day,
        sealed=svc.wrap_up_for(ctx, the_day),  # type: ignore[arg-type]
        ring=_ring(ring),
        threshold=ring.threshold,
        on_target_now=ring.on_target,
        evening=svc.is_evening(ctx),
    )


@router.post("/wrap-up/seal", response_model=S.WrapUpPublic, dependencies=WRITE)
def seal_day(ctx: CtxDep, body: S.SealIn) -> Any:
    return svc.seal_day(ctx, body)


@router.post("/wrap-up/unseal", response_model=Message, dependencies=WRITE)
def unseal_day(ctx: CtxDep, day: date | None = None) -> Any:
    svc.unseal_day(ctx, day or ctx.today)
    return Message(message="Day reopened")


@router.post("/wrap-up/actions", response_model=S.WrapActionOut, dependencies=WRITE)
def wrap_action(ctx: CtxDep, body: S.WrapActionIn) -> Any:
    """Tick a task, check a habit or skip a habit from the wrap-up list."""
    svc.wrap_action(ctx, body)
    return S.WrapActionOut(
        kind=body.kind,
        id=body.id,
        ring=_ring(stats_public.day_ring(ctx, day=body.day or ctx.today)),
    )


# ---------------------------------------------------------------- inbox


@router.get("/notifications", response_model=S.NotificationsOut, dependencies=READ)
def list_notifications(ctx: CtxDep, page: PaginationDep) -> Any:
    rows, count, unread = svc.list_notifications(ctx, skip=page.skip, limit=page.limit)
    return S.NotificationsOut(data=rows, count=count, unread=unread)  # type: ignore[arg-type]


@router.post("/notifications/read-all", response_model=Message, dependencies=WRITE)
def mark_all_read(ctx: CtxDep) -> Any:
    n = svc.mark_all_read(ctx)
    return Message(message=f"{n} marked read")


@router.post(
    "/notifications/{notification_id}/read",
    response_model=S.NotificationPublic,
    dependencies=WRITE,
)
def mark_read(ctx: CtxDep, notification_id: uuid.UUID) -> Any:
    return svc.mark_read(ctx, notification_id)


@router.delete(
    "/notifications/{notification_id}", response_model=Message, dependencies=WRITE
)
def dismiss(ctx: CtxDep, notification_id: uuid.UUID) -> Any:
    svc.dismiss(ctx, notification_id)
    return Message(message="Dismissed")


@router.post(
    "/notifications/{notification_id}/restore",
    response_model=S.NotificationPublic,
    dependencies=WRITE,
)
def undismiss(ctx: CtxDep, notification_id: uuid.UUID) -> Any:
    """Undo of a dismiss."""
    return svc.undismiss(ctx, notification_id)


@router.put("/misses/{miss_key}/note", response_model=Message, dependencies=WRITE)
def note_miss(ctx: CtxDep, miss_key: MissKey, body: S.MissNoteIn) -> Any:
    """``noteMiss``: a blank note removes it."""
    row = svc.note_miss(ctx, miss_key, body.note)
    return Message(message="Note saved" if row else "Note removed")


# ---------------------------------------------------------------- share


@router.get(
    "/share/templates", response_model=list[S.ShareTemplateOut], dependencies=READ
)
def share_templates(ctx: CtxDep) -> Any:
    """Every card template with its fields, defaults overlaid with the
    user's saved choices."""
    saved = svc.share_defaults(ctx)
    return [
        S.ShareTemplateOut(
            key=key,  # type: ignore[arg-type]
            label=label,
            formats=list(formats),
            fields=[
                S.ShareFieldOut(
                    key=f.key,
                    label=f.label,
                    on=saved[key][f.key],
                    sensitive=f.sensitive,
                )
                for f in D.template_fields(key)
            ],
        )
        for key, (label, formats, _fields) in D.TEMPLATES.items()
    ]


@router.put(
    "/share/{template}/defaults",
    response_model=S.ShareDefaultPublic,
    dependencies=WRITE,
)
def save_share_defaults(
    ctx: CtxDep, template: D.ShareTemplate, body: S.ShareDefaultsIn
) -> Any:
    return svc.save_share_defaults(ctx, template, body.fields)


@router.get("/share/{template}/card", response_model=S.ShareCardOut, dependencies=READ)
def share_card(
    ctx: CtxDep,
    template: D.ShareTemplate,
    goal_id: Annotated[uuid.UUID | None, Query()] = None,
) -> Any:
    return svc.share_card(ctx, template, goal_id)


# ---------------------------------------------------------------- onboarding


@router.post("/onboarding", response_model=S.OnboardingOut, dependencies=WRITE)
def onboarding(ctx: CtxDep, body: S.OnboardingIn) -> Any:
    """Starter goals for the chosen modules at the chosen pace."""
    created, skipped = svc.onboarding(ctx, body)
    return S.OnboardingOut(created=created, skipped=skipped)  # type: ignore[arg-type]
