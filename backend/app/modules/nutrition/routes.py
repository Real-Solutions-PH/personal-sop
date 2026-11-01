"""Nutrition REST routes (ADR-0024): reads the Nutrition screens need that
the fitness routes do not serve, and the food library's editor. Meals and
targets are still written through ``/fitness`` (Fern's tools, the outbox and
every installed build call it), so these routes share the fitness
permissions."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from sqlmodel import col, or_

from app.modules.fitness import food_library
from app.modules.fitness.models import FoodItem
from app.modules.iam.deps import require_permission
from app.modules.media import public as media_public
from app.modules.nutrition import schema as S
from app.shared import owned_repo
from app.shared.context import Ctx, CtxDep
from app.shared.domain import invalid
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited

router = APIRouter(prefix="/nutrition", tags=["nutrition"])

READ = [Depends(require_permission("fitness:read"))]
WRITE = [rate_limited("fitness"), Depends(require_permission("fitness:write"))]


def _out(ctx: Ctx, rows: list[FoodItem]) -> list[S.FoodOut]:
    """Foods with their photo links (one query for the page) and whether
    the caller may edit each."""
    photos = media_public.visible_media(
        ctx, [r.photo_media_id for r in rows if r.photo_media_id]
    )
    out = []
    for r in rows:
        photo = photos.get(r.photo_media_id) if r.photo_media_id else None
        out.append(
            S.FoodOut.model_validate(r).model_copy(
                update={
                    "photo_url": (photo.preview_url or photo.url) if photo else None,
                    "can_edit": owned_repo.can_write(ctx, r),
                }
            )
        )
    return out


@router.get("/foods", response_model=S.FoodsOut, dependencies=READ)
def list_foods(
    ctx: CtxDep,
    pagination: PaginationDep,
    q: Annotated[str | None, Query(max_length=80)] = None,
) -> Any:
    """The shared food library, most used first; ``q`` narrows it to foods
    whose name contains the text."""
    where = []
    text = (q or "").strip()
    if text:
        like = f"%{text}%"
        where.append(or_(col(FoodItem.name).ilike(like), col(FoodItem.key).ilike(like)))
    rows = owned_repo.list_rows(
        ctx,
        FoodItem,
        *where,
        order_by=[col(FoodItem.use_count).desc(), col(FoodItem.name)],
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return S.FoodsOut(
        data=_out(ctx, rows),
        count=owned_repo.count_rows(ctx, FoodItem, *where),
    )


@router.get("/foods/{food_id}", response_model=S.FoodOut, dependencies=READ)
def read_food(ctx: CtxDep, food_id: uuid.UUID) -> Any:
    return _out(ctx, [owned_repo.require(ctx, FoodItem, food_id, what="food")])[0]


@router.patch("/foods/{food_id}", response_model=S.FoodOut, dependencies=WRITE)
def update_food(ctx: CtxDep, food_id: uuid.UUID, body: S.FoodPatch) -> Any:
    """Edit a food's name, numbers, notes or photo. Only its author or an
    admin may (403 ``catalog_read_only``)."""
    try:
        row = food_library.update_food(
            ctx, food_id, body.model_dump(exclude_unset=True)
        )
    except ValueError:
        raise invalid("food_name_required", "A food needs a name") from None
    ctx.commit()
    ctx.session.refresh(row)
    return _out(ctx, [row])[0]


@router.post("/foods/{food_id}/use", status_code=204, dependencies=WRITE)
def count_food_use(ctx: CtxDep, food_id: uuid.UUID) -> Response:
    """A food was picked from the library into a meal: count the use, which
    orders the library (most used first)."""
    row = owned_repo.require(ctx, FoodItem, food_id, what="food")
    row.use_count = (row.use_count or 0) + 1
    row.last_used_at = ctx.now
    ctx.session.add(row)
    ctx.commit()
    return Response(status_code=204)
