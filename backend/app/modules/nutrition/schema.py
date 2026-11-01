import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FoodOut(BaseModel):
    """One food of the shared library. Amounts are per ``basis`` (per 100 g,
    per piece or per serving); sodium is in milligrams, every other amount in
    grams. ``can_edit``: the caller is its author or an admin."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    aliases: list[str]
    basis: str
    unit_grams: float | None
    state: str | None
    kcal: float
    protein: float
    carbs: float
    fat: float
    fiber: float | None
    sat_fat: float | None
    sugar: float | None
    sodium: float | None
    notes: str | None = None
    source: str
    verified: bool
    use_count: int
    last_used_at: datetime | None
    photo_media_id: uuid.UUID | None = None
    photo_url: str | None = None
    can_edit: bool = False


class FoodsOut(BaseModel):
    data: list[FoodOut]
    count: int


Amount = Field(default=None, ge=0, le=100_000)


class FoodPatch(BaseModel):
    """What a member may change on a food (every field optional)."""

    name: str | None = Field(default=None, min_length=1, max_length=160)
    aliases: list[str] | None = Field(default=None, max_length=30)
    basis: Literal["100g", "piece", "serving"] | None = None
    unit_grams: float | None = Field(default=None, gt=0, le=100_000)
    state: Literal["raw", "cooked", "as_sold"] | None = None
    kcal: float | None = Amount
    protein: float | None = Amount
    carbs: float | None = Amount
    fat: float | None = Amount
    fiber: float | None = Amount
    sat_fat: float | None = Amount
    sugar: float | None = Amount
    sodium: float | None = Amount
    notes: str | None = Field(default=None, max_length=500)
    photo_media_id: uuid.UUID | None = None
