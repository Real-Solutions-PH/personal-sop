"""Sync registrations for the focus module (ADR-0025).

The phone runs the timer and writes sessions and segments as rows; each
upsert goes through the service, which checks it and re-derives the
session's totals. Settings are one row per user.
"""

import uuid

from pydantic import BaseModel

from app.modules.focus import services as svc
from app.modules.focus.models import FocusSegment, FocusSession, FocusSettings
from app.modules.focus.schema import (
    SegmentPublic,
    SegmentSyncIn,
    SessionPublic,
    SessionSyncIn,
    SettingsIn,
    SettingsSyncOut,
)
from app.modules.sync.registry import Entity, Registry
from app.shared.context import Ctx
from app.shared.owned import OwnedRow


def _upsert_session(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    assert isinstance(payload, SessionSyncIn)
    return svc.upsert_session_sync(ctx, row_id, payload)


def _delete_session(ctx: Ctx, row_id: uuid.UUID) -> None:
    svc.delete_session(ctx, session_id=row_id)


def _upsert_segment(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    assert isinstance(payload, SegmentSyncIn)
    return svc.upsert_segment_sync(ctx, row_id, payload)


def _delete_segment(ctx: Ctx, row_id: uuid.UUID) -> None:
    svc.delete_segment(ctx, segment_id=row_id)


def _upsert_settings(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    """One settings row per user whatever id the device minted."""
    del row_id
    assert isinstance(payload, SettingsIn)
    return svc.update_settings(ctx, patch=payload)


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="focus_session",
            model=FocusSession,
            payload=SessionSyncIn,
            public=SessionPublic,
            upsert=_upsert_session,
            delete=_delete_session,
            create_required=("started_at",),
        )
    )
    r.entity(
        Entity(
            name="focus_segment",
            model=FocusSegment,
            payload=SegmentSyncIn,
            public=SegmentPublic,
            upsert=_upsert_segment,
            delete=_delete_segment,
            create_required=("session_id", "kind", "started_at"),
        )
    )
    r.entity(
        Entity(
            name="focus_settings",
            model=FocusSettings,
            payload=SettingsIn,
            public=SettingsSyncOut,
            upsert=_upsert_settings,
        )
    )
