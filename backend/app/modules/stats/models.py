"""Materialised daily rollups behind the aggregate statistic.

These are caches of what each module's contributor computes; they can always
be rebuilt from the module tables (``stats.services.rebuild``). They are
server-owned and never pushed by a client.
"""

from datetime import date

from sqlalchemy import CheckConstraint, Float, String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import JSONB, OwnedRow, enum_check

STAT_MODULES = (
    "habits",
    "tasks",
    "fitness",
    "nutrition",
    "focus",
    "finance",
    "screen",
)


class DailyModuleStat(OwnedRow, table=True):
    __tablename__ = "daily_module_stat"
    __table_args__ = (
        UniqueConstraint("owner_id", "module", "day", name="uq_daily_module_stat"),
        enum_check("module", STAT_MODULES, name="ck_daily_module_stat_module"),
        CheckConstraint("due >= 0 AND done >= 0", name="ck_daily_module_stat_counts"),
        CheckConstraint(
            "rate IS NULL OR (rate >= 0 AND rate <= 1)",
            name="ck_daily_module_stat_rate",
        ),
    )

    module: str = Field(sa_type=String(16))  # type: ignore
    day: date = Field(index=True)
    due: int = 0
    done: int = 0
    rate: float | None = Field(default=None, sa_type=Float)
    metrics: dict[str, object] = Field(default_factory=dict, sa_type=JSONB)


class LifeScoreDaily(OwnedRow, table=True):
    __tablename__ = "life_score_daily"
    __table_args__ = (
        UniqueConstraint("owner_id", "day", name="uq_life_score_daily"),
        CheckConstraint(
            "score IS NULL OR (score >= 0 AND score <= 100)", name="ck_life_score"
        ),
    )

    day: date = Field(index=True)
    score: int | None = None
    level: str | None = Field(default=None, max_length=24)
    rates: dict[str, float] = Field(default_factory=dict, sa_type=JSONB)
    weights: dict[str, int] = Field(default_factory=dict, sa_type=JSONB)
    due: int = 0
    done: int = 0
    on_target: bool | None = None
    sealed: bool = False
