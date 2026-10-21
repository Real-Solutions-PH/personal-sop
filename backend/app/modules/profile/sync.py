"""Sync registrations for the profile module."""

import uuid

from pydantic import BaseModel

from app.modules.profile import public, services
from app.modules.profile.models import Identity, ModulePref, SetupSkip, UserProfile
from app.modules.profile.schema import (
    IdentityPublic,
    IdentitySync,
    ModulePrefRow,
    ModulePrefSync,
    ProfilePublic,
    ProfileUpdate,
    SetupSkipPublic,
    SetupSkipSync,
)
from app.modules.sync.registry import Entity, Registry
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid


def _upsert_profile(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> UserProfile:
    # One profile per user: the device's id for it is advisory.
    del row_id
    assert isinstance(payload, ProfileUpdate)
    return services.update_profile(ctx, payload)


def _upsert_module(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> ModulePref:
    assert isinstance(payload, ModulePrefSync)
    existing = owned_repo.get(ctx, ModulePref, row_id, include_deleted=True)
    module = payload.module or (existing.module if existing else None)
    if module is None:
        raise invalid("missing_fields", "Missing fields: module")
    current = public.module_settings(ctx)[module]
    data = {
        "module": module,
        "enabled": current.enabled if payload.enabled is None else payload.enabled,
        "weight": current.weight if payload.weight is None else payload.weight,
    }
    row, _ = owned_repo.upsert(ctx, ModulePref, row_id, data, natural_key=("module",))
    return row


def _upsert_identity(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> Identity:
    assert isinstance(payload, IdentitySync)
    existing = owned_repo.get(ctx, Identity, row_id)
    if (
        existing is None
        and owned_repo.count_rows(ctx, Identity) >= services.MAX_IDENTITIES
    ):
        raise invalid("too_many_identities", "Keep it to three identity statements")
    row, _ = owned_repo.upsert(
        ctx, Identity, row_id, payload.model_dump(exclude_unset=True)
    )
    return row


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="profile",
            model=UserProfile,
            payload=ProfileUpdate,
            public=ProfilePublic,
            upsert=_upsert_profile,
        )
    )
    r.entity(
        Entity(
            name="module_pref",
            model=ModulePref,
            payload=ModulePrefSync,
            public=ModulePrefRow,
            upsert=_upsert_module,
        )
    )
    r.entity(
        Entity(
            name="identity",
            model=Identity,
            payload=IdentitySync,
            public=IdentityPublic,
            upsert=_upsert_identity,
            create_required=("text",),
        )
    )
    r.entity(
        Entity(
            name="setup_skip",
            model=SetupSkip,
            payload=SetupSkipSync,
            public=SetupSkipPublic,
            create_required=("module",),
        )
    )
