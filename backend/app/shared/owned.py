"""Base columns for every user-owned, syncable row.

Every domain table in the mobile API inherits :class:`OwnedRow`:

- ``id`` is minted on the device (UUID v4) so an offline create replays
  without id remapping; the server only mints ids for rows it derives, and
  those come from :func:`app.shared.ids.derived_id` so the device can mint the
  same one.
- ``owner_id`` / ``tenant_id`` sit on every row, children included, so the
  row-level-security policy and the sync pull are the same one-line filter on
  every table.
- ``version`` is assigned by the ``set_sync_version`` trigger from the single
  ``sync_version_seq`` sequence on every INSERT and UPDATE. It is the sync
  cursor: a pull asks for ``version > cursor``. Application code never writes
  it; ``0`` is only the pre-trigger placeholder.
- ``deleted_at`` is the tombstone: sync pulls ship deleted rows so other
  devices drop them, and undo restores by clearing it.

A table that sets ``shared_catalog = True`` is app-wide instead: every member
of the tenant reads its rows, ``owner_id`` is the row's author, and only the
author or an admin writes it (see :mod:`app.shared.owned_repo`).
"""

import uuid
from datetime import datetime, timezone
from typing import ClassVar

from sqlalchemy import BigInteger, CheckConstraint, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class OwnedRow(SQLModel):
    # True: readable by the whole tenant, writable by its author or an admin.
    shared_catalog: ClassVar[bool] = False

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE", index=True
    )
    tenant_id: uuid.UUID = Field(
        foreign_key="tenant.id", nullable=False, ondelete="CASCADE", index=True
    )
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_type=DateTime(timezone=True),  # type: ignore
        nullable=False,
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_type=DateTime(timezone=True),  # type: ignore
        nullable=False,
    )
    version: int = Field(
        default=0,
        sa_type=BigInteger,
        nullable=False,
        index=True,
        sa_column_kwargs={"server_default": "0"},
    )
    deleted_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
        index=True,
    )


def tstz() -> DateTime:
    """Column type for every timestamp: always timezone-aware."""
    return DateTime(timezone=True)


def enum_check(column: str, values: tuple[str, ...], *, name: str) -> CheckConstraint:
    """A CHECK that a text column holds one of ``values``.

    The API layer validates with ``Literal`` types too; the CHECK is the wall
    for writers that bypass the schemas (sync actions, jobs, migrations).
    """
    quoted = ", ".join("'" + v.replace("'", "''") + "'" for v in values)
    return CheckConstraint(f"{column} IN ({quoted})", name=name)


def minor_check(column: str, *, name: str, signed: bool = False) -> CheckConstraint:
    """Bound a money column (integer centavos) on both sides."""
    low = "-100000000000000" if signed else "0"
    return CheckConstraint(f"{column} BETWEEN {low} AND 100000000000000", name=name)


__all__ = ["JSONB", "OwnedRow", "enum_check", "minor_check", "tstz", "utcnow"]
