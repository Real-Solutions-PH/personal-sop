"""Sync registrations for the stats module.

The rollups are server-derived caches: devices pull them (history charts work
offline) but never push them.
"""

from app.modules.stats.models import DailyModuleStat, LifeScoreDaily
from app.modules.stats.schema import (
    DailyModuleStatPublic,
    LifeScoreDailyPublic,
    NoPush,
)
from app.modules.sync.registry import Entity, Registry


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="daily_module_stat",
            model=DailyModuleStat,
            payload=NoPush,
            public=DailyModuleStatPublic,
            read_only=True,
        )
    )
    r.entity(
        Entity(
            name="life_score_daily",
            model=LifeScoreDaily,
            payload=NoPush,
            public=LifeScoreDailyPublic,
            read_only=True,
        )
    )
