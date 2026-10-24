"""Nutrition REST routes (ADR-0024): reads the Nutrition screens need that
the fitness routes do not serve. Meals and targets are still written through
``/fitness`` (Fern's tools, the outbox and every installed build call it), so
these routes share the fitness permissions."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlmodel import col, or_

from app.modules.fitness.models import FoodItem
from app.modules.iam.deps import require_permission
from app.modules.nutrition import schema as S
from app.shared import owned_repo
from app.shared.context import CtxDep
from app.shared.pagination import PaginationDep

router = APIRouter(prefix="/nutrition", tags=["nutrition"])

READ = [Depends(require_permission("fitness:read"))]


@router.get("/foods", response_model=S.FoodsOut, dependencies=READ)
def list_foods(
    ctx: CtxDep,
    pagination: PaginationDep,
    q: Annotated[str | None, Query(max_length=80)] = None,
) -> Any:
    """The person's food library, most used first; ``q`` narrows it to
    foods whose name contains the text."""
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
        data=[S.FoodOut.model_validate(r) for r in rows],
        count=owned_repo.count_rows(ctx, FoodItem, *where),
    )
