import uuid
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


class SyncPush(BaseModel):
    ops: list[SyncOp] = Field(max_length=200)


class SyncOpResult(BaseModel):
    op_id: uuid.UUID
    status: OpStatus
    code: str | None = None
    message: str | None = None
    # The server's row after the op (applied) or as it stands (conflict).
    row: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    replayed: bool = False


class SyncPushResult(BaseModel):
    results: list[SyncOpResult]
    cursor: int


class SyncChange(BaseModel):
    entity: str
    id: uuid.UUID
    version: int
    deleted: bool
    row: dict[str, Any] | None


class SyncPull(BaseModel):
    changes: list[SyncChange]
    cursor: int
    truncated: bool
