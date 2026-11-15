"""Cross-module contract of the social module: who a person is and whom
they are connected with (shared money asks before two people share)."""

import uuid
from collections.abc import Iterable

from app.modules.iam.users.models import User
from app.modules.social import repo
from app.modules.social.schema import PersonBrief
from app.shared.context import Ctx


def person(ctx: Ctx, user_id: uuid.UUID) -> User:
    """An active user of the caller's tenant; 404 ``person_not_found``."""
    return repo.person(ctx, user_id)


def briefs(ctx: Ctx, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, PersonBrief]:
    """Name, handle and photo of each person, in one query."""
    return repo.briefs(ctx, ids)


def connected(ctx: Ctx, a: uuid.UUID, b: uuid.UUID) -> bool:
    """Either of the two follows the other."""
    return repo.follows(ctx, a, b) or repo.follows(ctx, b, a)
