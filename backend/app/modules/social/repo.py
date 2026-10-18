"""Queries of the social module, and the visibility rules.

Social rows are read across owners, so these helpers never go through
``owned_repo`` reads (which pin ``owner_id`` to the caller). Every query is
pinned to the caller's tenant instead, and visibility is decided here:

- a person is visible to everyone in the same tenant;
- a post is visible to everyone in the tenant (the following feed narrows to
  followed authors, for-you shows the tenant);
- a story is visible to its author, to the author's followers when the
  audience is ``everyone``, and only to the author's close friends when the
  audience is ``close``; an expired story is visible to nobody;
- a note is visible to its author and the author's followers until it expires;
- a chat and its messages are visible only to its current members.

Anything not visible is a natural 404 with no existence leak.
"""

import uuid
from collections.abc import Iterable
from typing import Any, TypeVar

from sqlalchemy import ColumnElement, and_, exists, or_
from sqlmodel import col, func, select

from app.modules.iam.users.models import User
from app.modules.profile.models import UserProfile
from app.modules.social.models import (
    Chat,
    ChatMember,
    CloseFriend,
    Follow,
    Note,
    Post,
    SocialProfile,
    Story,
)
from app.modules.social.schema import PersonBrief
from app.shared.context import Ctx
from app.shared.domain import not_found
from app.shared.owned import OwnedRow

R = TypeVar("R", bound=OwnedRow)


def in_tenant(ctx: Ctx, model: type[R], row_id: uuid.UUID) -> R | None:
    """A live row of the caller's tenant, whoever owns it."""
    return ctx.session.exec(
        select(model).where(
            model.id == row_id,
            model.tenant_id == ctx.tenant_id,
            col(model.deleted_at).is_(None),
        )
    ).first()


# ---------------------------------------------------------------- people


def person(ctx: Ctx, user_id: uuid.UUID) -> User:
    """An active user of the caller's tenant; 404 ``person_not_found``."""
    user = ctx.session.exec(
        select(User).where(
            User.id == user_id,
            User.tenant_id == ctx.tenant_id,
            col(User.is_active).is_(True),
            col(User.deleted_at).is_(None),
        )
    ).first()
    if user is None:
        raise not_found("person")
    return user


def tenant_user_ids(ctx: Ctx, ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
    wanted = set(ids)
    if not wanted:
        return set()
    rows = ctx.session.exec(
        select(User.id).where(
            col(User.id).in_(wanted),
            User.tenant_id == ctx.tenant_id,
            col(User.is_active).is_(True),
            col(User.deleted_at).is_(None),
        )
    ).all()
    return set(rows)


def social_profile(ctx: Ctx, user_id: uuid.UUID) -> SocialProfile | None:
    return ctx.session.exec(
        select(SocialProfile).where(
            SocialProfile.owner_id == user_id,
            SocialProfile.tenant_id == ctx.tenant_id,
        )
    ).first()


def my_social_profile(ctx: Ctx) -> SocialProfile:
    """The caller's social profile, created with defaults on first write."""
    row = social_profile(ctx, ctx.user_id)
    if row is None:
        row = SocialProfile(**ctx.owned())
        ctx.session.add(row)
        ctx.session.flush()
    elif row.deleted_at is not None:
        row.deleted_at = None
        ctx.session.add(row)
        ctx.session.flush()
    return row


def briefs(ctx: Ctx, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, PersonBrief]:
    """Name, handle and look of each person, in one query."""
    wanted = set(ids)
    if not wanted:
        return {}
    rows = ctx.session.exec(
        select(User, UserProfile, SocialProfile)
        .join(
            UserProfile,
            and_(
                col(UserProfile.owner_id) == User.id,
                col(UserProfile.deleted_at).is_(None),
            ),
            isouter=True,
        )
        .join(
            SocialProfile,
            and_(
                col(SocialProfile.owner_id) == User.id,
                col(SocialProfile.deleted_at).is_(None),
            ),
            isouter=True,
        )
        .where(col(User.id).in_(wanted), User.tenant_id == ctx.tenant_id)
    ).all()
    out: dict[uuid.UUID, PersonBrief] = {}
    for user, prof, soc in rows:
        name = (prof.name if prof else "") or user.full_name or ""
        out[user.id] = PersonBrief(
            id=user.id,
            name=name,
            handle=(prof.handle or None) if prof else None,
            accent=soc.accent if soc else "primary",  # type: ignore[arg-type]
            photo_media_id=prof.photo_media_id if prof else None,
            verified=soc.verified if soc else False,
        )
    return out


def brief(ctx: Ctx, user_id: uuid.UUID) -> PersonBrief:
    found = briefs(ctx, [user_id])
    if user_id not in found:
        raise not_found("person")
    return found[user_id]


def user_ids_by_handle(ctx: Ctx, handles: Iterable[str]) -> dict[str, uuid.UUID]:
    """Lower-cased handle (without ``@``) -> user, inside the tenant."""
    wanted = {h for h in handles if h}
    if not wanted:
        return {}
    norm = func.lower(func.ltrim(col(UserProfile.handle), "@"))
    rows = ctx.session.exec(
        select(norm, UserProfile.owner_id)
        .join(User, col(User.id) == UserProfile.owner_id)
        .where(
            UserProfile.tenant_id == ctx.tenant_id,
            col(UserProfile.deleted_at).is_(None),
            col(User.is_active).is_(True),
            norm.in_(wanted),
        )
    ).all()
    return dict(rows)


def search_people(
    ctx: Ctx, query: str, *, skip: int, limit: int
) -> tuple[list[uuid.UUID], int]:
    """People whose name or handle contains ``query`` (case-insensitive)."""
    q = query.strip().lstrip("@").lower()
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    match = or_(
        func.lower(col(UserProfile.name)).like(pattern, escape="\\"),
        func.lower(func.coalesce(col(UserProfile.handle), "")).like(
            pattern, escape="\\"
        ),
        func.lower(func.coalesce(col(User.full_name), "")).like(pattern, escape="\\"),
    )
    base = (
        select(User.id)
        .join(
            UserProfile,
            and_(
                col(UserProfile.owner_id) == User.id,
                col(UserProfile.deleted_at).is_(None),
            ),
            isouter=True,
        )
        .where(
            User.tenant_id == ctx.tenant_id,
            col(User.is_active).is_(True),
            match,
        )
    )
    count = ctx.session.exec(select(func.count()).select_from(base.subquery())).one()
    ids = ctx.session.exec(
        base.order_by(col(UserProfile.name), col(User.id)).offset(skip).limit(limit)
    ).all()
    return list(ids), int(count)


# ---------------------------------------------------------------- the graph


def follow_row(ctx: Ctx, follower: uuid.UUID, followee: uuid.UUID) -> Follow | None:
    """The follow edge, tombstoned or not."""
    return ctx.session.exec(
        select(Follow).where(
            Follow.owner_id == follower,
            Follow.followee_id == followee,
            Follow.tenant_id == ctx.tenant_id,
        )
    ).first()


def follows(ctx: Ctx, follower: uuid.UUID, followee: uuid.UUID) -> bool:
    row = follow_row(ctx, follower, followee)
    return row is not None and row.deleted_at is None


def following_ids(ctx: Ctx, follower: uuid.UUID) -> set[uuid.UUID]:
    rows = ctx.session.exec(
        select(Follow.followee_id).where(
            Follow.owner_id == follower,
            Follow.tenant_id == ctx.tenant_id,
            col(Follow.deleted_at).is_(None),
        )
    ).all()
    return set(rows)


def follower_ids(ctx: Ctx, followee: uuid.UUID) -> list[uuid.UUID]:
    rows = ctx.session.exec(
        select(Follow.owner_id).where(
            Follow.followee_id == followee,
            Follow.tenant_id == ctx.tenant_id,
            col(Follow.deleted_at).is_(None),
        )
    ).all()
    return list(rows)


def close_friend_row(
    ctx: Ctx, owner: uuid.UUID, friend: uuid.UUID
) -> CloseFriend | None:
    return ctx.session.exec(
        select(CloseFriend).where(
            CloseFriend.owner_id == owner,
            CloseFriend.friend_id == friend,
            CloseFriend.tenant_id == ctx.tenant_id,
        )
    ).first()


def is_close_friend(ctx: Ctx, owner: uuid.UUID, friend: uuid.UUID) -> bool:
    row = close_friend_row(ctx, owner, friend)
    return row is not None and row.deleted_at is None


def close_friend_ids(ctx: Ctx, owner: uuid.UUID) -> list[uuid.UUID]:
    rows = ctx.session.exec(
        select(CloseFriend.friend_id).where(
            CloseFriend.owner_id == owner,
            CloseFriend.tenant_id == ctx.tenant_id,
            col(CloseFriend.deleted_at).is_(None),
        )
    ).all()
    return list(rows)


def graph_counts(ctx: Ctx, user_id: uuid.UUID) -> tuple[int, int]:
    """``(followers, following)`` of a person."""
    live = (Follow.tenant_id == ctx.tenant_id, col(Follow.deleted_at).is_(None))
    followers = ctx.session.exec(
        select(func.count())
        .select_from(Follow)
        .where(Follow.followee_id == user_id, *live)
    ).one()
    following = ctx.session.exec(
        select(func.count())
        .select_from(Follow)
        .where(Follow.owner_id == user_id, *live)
    ).one()
    return int(followers), int(following)


def graph_page(
    ctx: Ctx, user_id: uuid.UUID, *, direction: str, skip: int, limit: int
) -> tuple[list[uuid.UUID], int]:
    """Followers of (``direction="followers"``) or people followed by a
    person, newest edge first."""
    if direction == "followers":
        pick: Any = Follow.owner_id
        where: ColumnElement[bool] = col(Follow.followee_id) == user_id
    else:
        pick = Follow.followee_id
        where = col(Follow.owner_id) == user_id
    base = (Follow.tenant_id == ctx.tenant_id, col(Follow.deleted_at).is_(None), where)
    count = ctx.session.exec(
        select(func.count()).select_from(Follow).where(*base)
    ).one()
    ids = ctx.session.exec(
        select(pick)
        .where(*base)
        .order_by(col(Follow.created_at).desc(), col(Follow.id))
        .offset(skip)
        .limit(limit)
    ).all()
    return list(ids), int(count)


# ---------------------------------------------------------------- visibility


def visible_post(ctx: Ctx, post_id: uuid.UUID) -> Post:
    post = in_tenant(ctx, Post, post_id)
    if post is None:
        raise not_found("post")
    return post


def story_visible_clause(ctx: Ctx) -> ColumnElement[bool]:
    """SQL: the caller may see this story row (expiry checked separately)."""
    me = ctx.user_id
    followed = exists().where(
        col(Follow.owner_id) == me,
        col(Follow.followee_id) == Story.owner_id,
        col(Follow.deleted_at).is_(None),
    )
    on_close_list = exists().where(
        col(CloseFriend.owner_id) == Story.owner_id,
        col(CloseFriend.friend_id) == me,
        col(CloseFriend.deleted_at).is_(None),
    )
    return or_(
        col(Story.owner_id) == me,
        and_(col(Story.audience) == "everyone", followed),
        and_(col(Story.audience) == "close", on_close_list),
    )


def live_story_clause(ctx: Ctx) -> list[ColumnElement[bool]]:
    return [
        col(Story.tenant_id) == ctx.tenant_id,
        col(Story.deleted_at).is_(None),
        col(Story.expires_at) > ctx.now,
        story_visible_clause(ctx),
    ]


def visible_story(ctx: Ctx, story_id: uuid.UUID) -> Story:
    story = ctx.session.exec(
        select(Story).where(col(Story.id) == story_id, *live_story_clause(ctx))
    ).first()
    if story is None:
        raise not_found("story")
    return story


def visible_note(ctx: Ctx, note_id: uuid.UUID) -> Note:
    note = in_tenant(ctx, Note, note_id)
    if (
        note is None
        or note.expires_at <= ctx.now
        or (
            note.owner_id != ctx.user_id
            and not follows(ctx, ctx.user_id, note.owner_id)
        )
    ):
        raise not_found("note")
    return note


def membership(
    ctx: Ctx, chat_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> ChatMember | None:
    """The member row (live or tombstoned, left or not)."""
    return ctx.session.exec(
        select(ChatMember).where(
            ChatMember.chat_id == chat_id,
            ChatMember.owner_id == (user_id or ctx.user_id),
            ChatMember.tenant_id == ctx.tenant_id,
        )
    ).first()


def member_chat(ctx: Ctx, chat_id: uuid.UUID) -> tuple[Chat, ChatMember]:
    """The chat and the caller's membership; 404 ``chat_not_found`` unless the
    caller is a current member. A member who hid the chat is still one."""
    chat = in_tenant(ctx, Chat, chat_id)
    member = membership(ctx, chat_id) if chat else None
    if chat is None or member is None or member.left_at is not None:
        raise not_found("chat")
    return chat, member


def member_ids(ctx: Ctx, chat_id: uuid.UUID) -> list[uuid.UUID]:
    """Current members of a chat (hidden-by-member included)."""
    rows = ctx.session.exec(
        select(ChatMember.owner_id)
        .where(
            ChatMember.chat_id == chat_id,
            ChatMember.tenant_id == ctx.tenant_id,
            col(ChatMember.left_at).is_(None),
        )
        .order_by(col(ChatMember.created_at), col(ChatMember.owner_id))
    ).all()
    return list(rows)


def members(ctx: Ctx, chat_id: uuid.UUID) -> list[ChatMember]:
    return list(
        ctx.session.exec(
            select(ChatMember).where(
                ChatMember.chat_id == chat_id,
                ChatMember.tenant_id == ctx.tenant_id,
                col(ChatMember.left_at).is_(None),
            )
        ).all()
    )
