import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FoodOut(BaseModel):
    """One food of the person's library. Amounts are per ``basis`` (per
    100 g, per piece or per serving); sodium is in milligrams, every other
    amount in grams."""

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
    source: str
    verified: bool
    use_count: int
    last_used_at: datetime | None


class FoodsOut(BaseModel):
    data: list[FoodOut]
    count: int
