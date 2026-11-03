import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

OpKind = Literal["upsert", "delete", "action"]
OpStatus = Literal["applied", "conflict", "rejected"]


class SyncOp(BaseModel):
    op_id: uuid.UUID
    kind: OpKind
    # Entity name for upsert/delete, action name for action.
    name: str = Field(min_length=1, max_length=40)
    id: uuid.UUID | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    # The version the device last saw for this row (None: device-created).
    base_version: int | None = None
    # When the person made this change on the device. The op is applied as
    # of then (``ctx.now``), so an op that waited in a slow or offline
    # outbox stamps the time it happened, not the time it arrived.
    at: datetime | None = None


class SyncPush(BaseModel):
    ops: list[SyncOp] = Field(max_length=200)


class SyncChange(BaseModel):
    entity: str
    id: uuid.UUID
    version: int
    deleted: bool
    row: dict[str, Any] | None


class SyncOpResult(BaseModel):
    op_id: uuid.UUID
    status: OpStatus
    code: str | None = None
    message: str | None = None
    # The server's row after the op (applied) or as it stands (conflict).
    row: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    # An applied action: the synced rows it wrote, so the device shows them
    # without waiting for a pull (``written``). Never on a replay.
    changes: list[SyncChange] = Field(default_factory=list)
    replayed: bool = False


class SyncPushResult(BaseModel):
    results: list[SyncOpResult]
    cursor: int


class SyncPull(BaseModel):
    changes: list[SyncChange]
    cursor: int
    truncated: bool
    # Rows past ``cursor`` are committed but wait for an older writer still
    # running (``_settled_before``): pull again shortly.
    held: bool = False
