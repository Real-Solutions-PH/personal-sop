"""Response builders. Each takes a page of rows and resolves everything the
page needs (authors, counts, the viewer's own likes) in a fixed number of
queries, never one per row."""

import uuid
from collections import defaultdict
from collections.abc import Sequence

from sqlmodel import col, func, select

from app.modules.media import public as media
from app.modules.social import repo
from app.modules.social.models import (
    ChatMessage,
    Comment,
    CommentLike,
    MessageReaction,
    Post,
    PostLike,
    PostMedia,
    PostSave,
    Story,
    StoryLike,
    StorySeen,
)
from app.modules.social.schema import (
    CommentPublic,
    MediaPublic,
    MessagePublic,
    PersonBrief,
    PostPublic,
    StoryPublic,
)
from app.shared.context import Ctx

LIKED_BY_CARD = 3
LIKED_BY_DETAIL = 50


def media_url(ctx: Ctx, media_id: uuid.UUID) -> str | None:
    """A presigned GET for media the caller may see (visibility is already
    checked by the caller). None until the media module is merged."""
    try:
        return media.visible_download_url(ctx, media_id)
    except NotImplementedError:
        return None


def _media(
    ctx: Ctx, media_id: uuid.UUID, kind: str, ratio: float | None
) -> MediaPublic:
    return MediaPublic(
        media_id=media_id,
        kind=kind,  # type: ignore[arg-type]
        ratio=ratio,
        url=media_url(ctx, media_id),
    )


def _counts(
    ctx: Ctx, model: type[PostLike] | type[PostSave], ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    rows = ctx.session.exec(
        select(model.post_id, func.count())
        .where(col(model.post_id).in_(ids), col(model.deleted_at).is_(None))
        .group_by(col(model.post_id))
    ).all()
    return {pid: int(n) for pid, n in rows}


def _mine(
    ctx: Ctx, model: type[PostLike] | type[PostSave], ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    rows = ctx.session.exec(
        select(model.post_id).where(
            col(model.post_id).in_(ids),
            model.owner_id == ctx.user_id,
            col(model.deleted_at).is_(None),
        )
    ).all()
    return set(rows)


def like_counts(ctx: Ctx, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    return _counts(ctx, PostLike, ids) if ids else {}


def posts(
    ctx: Ctx, rows: Sequence[Post], *, liked_by_limit: int = LIKED_BY_CARD
) -> list[PostPublic]:
    if not rows:
        return []
    ids = [p.id for p in rows]
    likes = _counts(ctx, PostLike, ids)
    liked = _mine(ctx, PostLike, ids)
    saved = _mine(ctx, PostSave, ids)
    comments = dict(
        ctx.session.exec(
            select(Comment.post_id, func.count())
            .where(col(Comment.post_id).in_(ids), col(Comment.deleted_at).is_(None))
            .group_by(col(Comment.post_id))
        ).all()
    )
    media_rows = ctx.session.exec(
        select(PostMedia)
        .where(col(PostMedia.post_id).in_(ids), col(PostMedia.deleted_at).is_(None))
        .order_by(col(PostMedia.post_id), col(PostMedia.position))
    ).all()
    by_post: dict[uuid.UUID, list[MediaPublic]] = defaultdict(list)
    for m in media_rows:
        by_post[m.post_id].append(_media(ctx, m.media_id, m.kind, m.ratio))
    # Most recent likers first, ``liked_by_limit`` per post.
    ranked = (
        select(
            PostLike.post_id,
            PostLike.owner_id,
            func.row_number()
            .over(
                partition_by=col(PostLike.post_id),
                order_by=(col(PostLike.created_at).desc(), col(PostLike.id)),
            )
            .label("n"),
        )
        .where(col(PostLike.post_id).in_(ids), col(PostLike.deleted_at).is_(None))
        .subquery()
    )
    liker_rows = ctx.session.exec(
        select(ranked.c.post_id, ranked.c.owner_id)
        .where(ranked.c.n <= liked_by_limit)
        .order_by(ranked.c.post_id, ranked.c.n)
    ).all()
    likers: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for pid, uid in liker_rows:
        likers[pid].append(uid)
    people = repo.briefs(
        ctx, {p.owner_id for p in rows} | {u for us in likers.values() for u in us}
    )
    out: list[PostPublic] = []
    for p in rows:
        out.append(
            PostPublic(
                id=p.id,
                author=people[p.owner_id],
                created_at=p.created_at,
                caption=p.caption,
                media=by_post.get(p.id, []),
                progress=p.progress,
                location=p.location,
                tags=list(p.tags or []),
                likes=likes.get(p.id, 0),
                liked=p.id in liked,
                saved=p.id in saved,
                comments=int(comments.get(p.id, 0)),
                liked_by=[people[u] for u in likers.get(p.id, []) if u in people],
            )
        )
    return out


def comments(ctx: Ctx, rows: Sequence[Comment]) -> list[CommentPublic]:
    if not rows:
        return []
    ids = [c.id for c in rows]
    counts = dict(
        ctx.session.exec(
            select(CommentLike.comment_id, func.count())
            .where(
                col(CommentLike.comment_id).in_(ids),
                col(CommentLike.deleted_at).is_(None),
            )
            .group_by(col(CommentLike.comment_id))
        ).all()
    )
    mine = set(
        ctx.session.exec(
            select(CommentLike.comment_id).where(
                col(CommentLike.comment_id).in_(ids),
                CommentLike.owner_id == ctx.user_id,
                col(CommentLike.deleted_at).is_(None),
            )
        ).all()
    )
    people = repo.briefs(ctx, {c.owner_id for c in rows})
    return [
        CommentPublic(
            id=c.id,
            post_id=c.post_id,
            author=people[c.owner_id],
            text=c.text,
            created_at=c.created_at,
            likes=int(counts.get(c.id, 0)),
            liked=c.id in mine,
            reply_to_id=c.reply_to_id,
        )
        for c in rows
    ]


def stories(ctx: Ctx, rows: Sequence[Story]) -> list[StoryPublic]:
    if not rows:
        return []
    ids = [s.id for s in rows]
    seen = set(
        ctx.session.exec(
            select(StorySeen.story_id).where(
                col(StorySeen.story_id).in_(ids),
                StorySeen.owner_id == ctx.user_id,
                col(StorySeen.deleted_at).is_(None),
            )
        ).all()
    )
    liked = set(
        ctx.session.exec(
            select(StoryLike.story_id).where(
                col(StoryLike.story_id).in_(ids),
                StoryLike.owner_id == ctx.user_id,
                col(StoryLike.deleted_at).is_(None),
            )
        ).all()
    )
    own = [s.id for s in rows if s.owner_id == ctx.user_id]
    counts: dict[uuid.UUID, int] = {}
    if own:
        counts = {
            sid: int(n)
            for sid, n in ctx.session.exec(
                select(StoryLike.story_id, func.count())
                .where(
                    col(StoryLike.story_id).in_(own),
                    col(StoryLike.deleted_at).is_(None),
                )
                .group_by(col(StoryLike.story_id))
            ).all()
        }
    out: list[StoryPublic] = []
    for s in rows:
        mine = s.owner_id == ctx.user_id
        out.append(
            StoryPublic(
                id=s.id,
                owner_id=s.owner_id,
                created_at=s.created_at,
                expires_at=s.expires_at,
                kind=s.kind,  # type: ignore[arg-type]
                media=(
                    _media(
                        ctx, s.media_id, "video" if s.kind == "video" else "image", None
                    )
                    if s.media_id
                    else None
                ),
                text=s.text,
                bg=s.bg,
                progress=s.progress,
                audience=s.audience,  # type: ignore[arg-type]
                # Your own story counts as seen (the prototype marks it on post).
                seen=mine or s.id in seen,
                liked=s.id in liked,
                likes=counts.get(s.id, 0) if mine else None,
            )
        )
    return out


def messages(ctx: Ctx, rows: Sequence[ChatMessage]) -> list[MessagePublic]:
    if not rows:
        return []
    ids = [m.id for m in rows]
    reactions: dict[uuid.UUID, dict[str, str]] = defaultdict(dict)
    for mid, uid, emoji in ctx.session.exec(
        select(
            MessageReaction.message_id, MessageReaction.owner_id, MessageReaction.emoji
        ).where(
            col(MessageReaction.message_id).in_(ids),
            col(MessageReaction.deleted_at).is_(None),
        )
    ).all():
        reactions[mid][str(uid)] = emoji
    return [
        MessagePublic(
            id=m.id,
            chat_id=m.chat_id,
            sender_id=m.owner_id,
            at=m.at,
            text=m.text,
            media=_media(ctx, m.media_id, "image", None) if m.media_id else None,
            post_id=m.post_id,
            story_id=m.story_id,
            reply_to_id=m.reply_to_id,
            system=m.system,
            reactions=reactions.get(m.id, {}),
        )
        for m in rows
    ]


def people_list(ctx: Ctx, ids: Sequence[uuid.UUID]) -> list[PersonBrief]:
    found = repo.briefs(ctx, ids)
    return [found[i] for i in ids if i in found]
