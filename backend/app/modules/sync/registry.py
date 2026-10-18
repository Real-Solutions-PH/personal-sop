"""What the sync engine can push and pull.

Each domain module declares its syncable entities and its domain actions in
its own ``sync.py`` (``def register(r: Registry) -> None``). The engine never
writes a table directly: a pushed upsert goes through the entity's ``upsert``
use case and a pushed action through the module's action handler, so every
business rule that guards a REST write guards a synced write too.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from importlib import import_module
from typing import Any

from pydantic import BaseModel

from app.shared.context import Ctx
from app.shared.owned import OwnedRow

# (ctx, id, validated payload) -> row
UpsertFn = Callable[[Ctx, uuid.UUID, BaseModel], OwnedRow]
DeleteFn = Callable[[Ctx, uuid.UUID], None]
# Undo of a delete when clearing ``deleted_at`` is not enough (e.g. a task
# whose ``status`` must leave "deleted" too). Returns the restored row.
RestoreFn = Callable[[Ctx, uuid.UUID], OwnedRow]
# (ctx, args) -> JSON-able result
ActionFn = Callable[[Ctx, dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class Entity:
    name: str
    model: type[OwnedRow]
    payload: type[BaseModel]
    public: type[BaseModel]
    upsert: UpsertFn | None = None
    delete: DeleteFn | None = None
    restore: RestoreFn | None = None
    # Pulled but never pushed (server-derived rows, e.g. stats rollups).
    read_only: bool = False
    # ``payload`` fields are all optional so an op carries only what changed
    # (field-level last-writer-wins); these must be present to CREATE a row.
    create_required: tuple[str, ...] = ()


@dataclass(frozen=True)
class Action:
    name: str
    handler: ActionFn
    args: type[BaseModel]


@dataclass
class Registry:
    entities: dict[str, Entity] = field(default_factory=dict)
    actions: dict[str, Action] = field(default_factory=dict)

    def entity(self, spec: Entity) -> None:
        if spec.name in self.entities:
            raise ValueError(f"sync entity registered twice: {spec.name}")
        self.entities[spec.name] = spec

    def action(self, spec: Action) -> None:
        if spec.name in self.actions:
            raise ValueError(f"sync action registered twice: {spec.name}")
        self.actions[spec.name] = spec


# Every module that contributes to sync. A module missing here is invisible to
# the mobile app's offline path — tests/modules/sync asserts this list covers
# every OwnedRow table that is not social (social syncs via REST + events).
SYNC_MODULES = (
    "profile",
    "habits",
    "tasks",
    "fitness",
    "finance",
    "capture",
    "dashboard",
    "companion",
    "weather",
    "stats",
)

_registry: Registry | None = None


def registry() -> Registry:
    global _registry
    if _registry is None:
        reg = Registry()
        for name in SYNC_MODULES:
            module = import_module(f"app.modules.{name}.sync")
            module.register(reg)
        _registry = reg
    return _registry
