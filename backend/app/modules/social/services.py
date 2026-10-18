"""Social use cases: one function per screen action, each ending with
:func:`notify.commit` (commit, then the queued events and pushes).

``owner_id`` is the author or actor; who may see a row is decided in
:mod:`app.modules.social.repo`. A route that takes a parent and a child id
asserts the child belongs to the parent here, never in the route.
"""

import json
import uuid
from collections import defaultdict
from collections.abc import Callable
from datetime import datetime
from typing import Any, TypeVar

import redis
from redis.exceptions import RedisError
from sqlalchemy import and_, case, literal, or_, tuple_
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, func, select

from app.core.config import settings
from app.modules.iam.users.models import User
from app.modules.media import public as media
from app.modules.social import logic, notify, repo, views
from app.modules.social.models import (
    Activity,
    Chat,
    ChatMember,
    ChatMessage,
    CloseFriend,
    Comment,
    CommentLike,
    Follow,
    MessageReaction,
    Note,
    NoteLike,
    Post,
    PostLike,
    PostMedia,
    PostSave,
    SocialDraft,
    SocialProfile,
    Story,
    StoryLike,
    StorySeen,
)
from app.modules.social.schema import (
    ActivitiesPublic,
    ActivityPublic,
    AreaRatePublic,
    Badges,
    ChatPublic,
    ChatsPublic,
    CommentCreate,
    CommentPublic,
    CommentsPublic,
    DraftKind,
    DraftPublic,
    ExplorePublic,
    FeedTab,
    GroupCreate,
    LeaderboardPublic,
    LeaderRow,
    MemberSettings,
    MessageCreate,
    MessagePublic,
    MessagesPublic,
    NotePublic,
    NotesPublic,
    PeoplePublic,
    PersonPublic,
    PostCreate,
    PostPublic,
    PostsPublic,
    ProgressStat,
    ScorecardPublic,
    SocialProfileUpdate,
    StoryCreate,
    StoryGroup,
    StoryPublic,
    StoryTray,
    TodayPublic,
    TrophyPublic,
)
from app.modules.stats import contract as stats_contract
from app.modules.stats import public as stats
from app.shared import events, owned_repo
from app.shared.context import Ctx, make_ctx
from app.shared.domain import conflict, domain_error, invalid, not_found
from app.shared.ids import derived_id
from app.shared.owned import OwnedRow

R = TypeVar("R", bound=OwnedRow)

MAX_DRAFT_BYTES = 64_000
SCORE_DAYS = 30
TROPHIES_ON_CARD = 8
STATS_ON_CARD = 3


def forbidden(code: str, message: str) -> Exception:
    return domain_error(403, code, message)


def _insert(ctx: Ctx, row: OwnedRow) -> None:
    """Insert in a SAVEPOINT: an id already taken (by anyone) is a 409, not a
    500, and the rest of the transaction survives."""
    try:
        with ctx.session.begin_nested():
            ctx.session.add(row)
            ctx.session.flush()
    except IntegrityError:
        raise conflict("id_conflict", "That id is already in use") from None


def _replay(ctx: Ctx, model: type[R], row_id: uuid.UUID | None) -> R | None:
    """The caller's own row with a client-minted id: a create replayed."""
    if row_id is None:
        return None
    return owned_repo.get(ctx, model, row_id, include_deleted=True)


def _set_edge(
    ctx: Ctx, model: type[R], field: str, target: uuid.UUID, kind: str, *, on: bool
) -> bool:
    """Idempotently turn one of the caller's edges (a like, a save, a seen
    mark, a follow) on or off. Returns True when the state changed."""
    current = owned_repo.find_one(
        ctx, model, getattr(model, field) == target, include_deleted=True
    )
    live = current is not None and current.deleted_at is None
    if on == live:
        return False
    if on:
        owned_repo.upsert(
            ctx,
            model,
            current.id if current else derived_id(kind, target, str(ctx.user_id)),
            {field: target},
            natural_key=(field,),
        )
    elif current is not None:
        owned_repo.soft_delete(ctx, current)
    return True


def _mention_ids(ctx: Ctx, text: str) -> list[uuid.UUID]:
    found = repo.user_ids_by_handle(ctx, logic.parse_mentions(text))
    return [u for u in found.values() if u != ctx.user_id]


def _mention(
    ctx: Ctx, recipients: list[uuid.UUID], *, key: str, post_id: uuid.UUID, text: str
) -> None:
    for uid in recipients:
        notify.record(
            ctx, recipient=uid, kind="mention", key=key, post_id=post_id, text=text
        )
    if recipients:
        me = repo.brief(ctx, ctx.user_id)
        notify.push(
            ctx,
            recipients,
            title=me.name or "Someone",
            body=f"Mentioned you: {text[:100]}",
            data={"href": f"/social/post/{post_id}", "post_id": str(post_id)},
        )


def _clear_drafts(ctx: Ctx) -> None:
    for d in owned_repo.list_rows(ctx, SocialDraft):
        owned_repo.soft_delete(ctx, d)


# ================================================================ people


def _persons(ctx: Ctx, ids: list[uuid.UUID]) -> list[PersonPublic]:
    """Profiles with counts and the viewer's own state, in a fixed number of
    queries."""
    if not ids:
        return []
    briefs = repo.briefs(ctx, ids)
    live = (Follow.tenant_id == ctx.tenant_id, col(Follow.deleted_at).is_(None))
    followers = dict(
        ctx.session.exec(
            select(Follow.followee_id, func.count())
            .where(col(Follow.followee_id).in_(ids), *live)
            .group_by(col(Follow.followee_id))
        ).all()
    )
    following = dict(
        ctx.session.exec(
            select(Follow.owner_id, func.count())
            .where(col(Follow.owner_id).in_(ids), *live)
            .group_by(col(Follow.owner_id))
        ).all()
    )
    mine = repo.following_ids(ctx, ctx.user_id)
    close = set(repo.close_friend_ids(ctx, ctx.user_id))
    profiles = {
        p.owner_id: p
        for p in ctx.session.exec(
            select(SocialProfile).where(
                col(SocialProfile.owner_id).in_(ids),
                SocialProfile.tenant_id == ctx.tenant_id,
                col(SocialProfile.deleted_at).is_(None),
            )
        ).all()
    }
    out: list[PersonPublic] = []
    for uid in ids:
        if uid not in briefs:
            continue
        prof = profiles.get(uid)
        show = prof.show_scores if prof else True
        is_me = uid == ctx.user_id
        out.append(
            PersonPublic(
                **briefs[uid].model_dump(),
                bio=prof.bio if prof else "",
                followers=int(followers.get(uid, 0)),
                following=int(following.get(uid, 0)),
                is_me=is_me,
                is_following=uid in mine,
                close_friend=uid in close,
                scores_visible=is_me or (show and uid in mine),
            )
        )
    return out


def get_person(ctx: Ctx, *, user_id: uuid.UUID) -> PersonPublic:
    repo.person(ctx, user_id)
    return _persons(ctx, [user_id])[0]


def me(ctx: Ctx) -> PersonPublic:
    return get_person(ctx, user_id=ctx.user_id)


def update_me(ctx: Ctx, *, body: SocialProfileUpdate) -> PersonPublic:
    prof = repo.my_social_profile(ctx)
    owned_repo.apply(prof, body.model_dump(exclude_unset=True, exclude_none=True))
    ctx.session.add(prof)
    notify.commit(ctx)
    return me(ctx)


def follow(ctx: Ctx, *, user_id: uuid.UUID) -> PersonPublic:
    if user_id == ctx.user_id:
        raise invalid("self_follow", "You cannot follow yourself")
    repo.person(ctx, user_id)
    if _set_edge(ctx, Follow, "followee_id", user_id, "follow", on=True):
        notify.record(ctx, recipient=user_id, kind="follow", key=str(user_id))
    notify.commit(ctx)
    return get_person(ctx, user_id=user_id)


def unfollow(ctx: Ctx, *, user_id: uuid.UUID) -> PersonPublic:
    repo.person(ctx, user_id)
    if _set_edge(ctx, Follow, "followee_id", user_id, "follow", on=False):
        notify.retract(ctx, recipient=user_id, kind="follow", key=str(user_id))
    notify.commit(ctx)
    return get_person(ctx, user_id=user_id)


def set_close_friend(ctx: Ctx, *, user_id: uuid.UUID, on: bool) -> PersonPublic:
    if user_id == ctx.user_id:
        raise invalid("self_close_friend", "You are always on your own list")
    repo.person(ctx, user_id)
    _set_edge(ctx, CloseFriend, "friend_id", user_id, "close-friend", on=on)
    notify.commit(ctx)
    return get_person(ctx, user_id=user_id)


def close_friends(ctx: Ctx) -> PeoplePublic:
    ids = repo.close_friend_ids(ctx, ctx.user_id)
    data = _persons(ctx, ids)
    return PeoplePublic(data=data, count=len(data))


def graph(
    ctx: Ctx, *, user_id: uuid.UUID, direction: str, skip: int, limit: int
) -> PeoplePublic:
    repo.person(ctx, user_id)
    ids, count = repo.graph_page(
        ctx, user_id, direction=direction, skip=skip, limit=limit
    )
    return PeoplePublic(data=_persons(ctx, ids), count=count)


def search_people(ctx: Ctx, *, q: str, skip: int, limit: int) -> PeoplePublic:
    if not q.strip().lstrip("@"):
        return PeoplePublic(data=[], count=0)
    ids, count = repo.search_people(ctx, q, skip=skip, limit=limit)
    return PeoplePublic(data=_persons(ctx, ids), count=count)


# ---------------------------------------------------------------- scores


def _ctx_of(ctx: Ctx, user_id: uuid.UUID) -> Ctx:
    return make_ctx(ctx.session, repo.person(ctx, user_id), now=ctx.now)


def _shows_scores(ctx: Ctx, user_id: uuid.UUID) -> bool:
    prof = repo.social_profile(ctx, user_id)
    return prof is None or prof.deleted_at is not None or prof.show_scores


def scorecard(ctx: Ctx, *, user_id: uuid.UUID) -> ScorecardPublic:
    """The followers-only scorecard. 404 ``scorecard_not_found`` for a viewer
    who does not follow the person, or when the person hides their scores."""
    repo.person(ctx, user_id)
    if user_id != ctx.user_id and not (
        repo.follows(ctx, ctx.user_id, user_id) and _shows_scores(ctx, user_id)
    ):
        raise not_found("scorecard")
    theirs = _ctx_of(ctx, user_id)
    ov = stats.overview(theirs, days=SCORE_DAYS)
    stats_rows = [
        ProgressStat(
            label=str(m.get("label", "")),
            value=str(m.get("value", "")),
            unit=str(m["unit"]) if m.get("unit") else None,
        )
        for m in ov.metrics
        if m.get("shareable", True)
    ][:STATS_ON_CARD]
    earned = [
        a
        for c in stats_contract.contributors().values()
        for a in c.achievements(theirs)
        if a.earned
    ]
    earned.sort(key=lambda a: (a.day is None, -(a.day.toordinal() if a.day else 0)))
    return ScorecardPublic(
        person_id=user_id,
        life=ov.life_score,
        level=ov.level,
        delta=ov.delta,
        streak=ov.streak,
        best=ov.best_streak,
        rates=[AreaRatePublic(module=a.module, rate=a.rate) for a in ov.areas],
        stats=stats_rows,
        trophies=[
            TrophyPublic(type=a.type, title=a.title, value=a.value)
            for a in earned[:TROPHIES_ON_CARD]
        ],
    )


def leaderboard(ctx: Ctx) -> LeaderboardPublic:
    """Me and the people I follow who show their scores, by Life Score."""
    ids = [ctx.user_id] + sorted(repo.following_ids(ctx, ctx.user_id), key=str)
    shown = [u for u in ids if u == ctx.user_id or _shows_scores(ctx, u)]
    briefs = repo.briefs(ctx, shown)
    rows: list[tuple[uuid.UUID, int | None, int]] = []
    for uid in shown:
        if uid not in briefs:
            continue
        ov = stats.overview(_ctx_of(ctx, uid), days=SCORE_DAYS)
        rows.append((uid, ov.life_score, ov.streak))
    rows.sort(key=lambda r: (r[1] is None, -(r[1] or 0), -r[2], str(r[0])))
    data = [
        LeaderRow(rank=i + 1, person=briefs[uid], life=life, streak=streak)
        for i, (uid, life, streak) in enumerate(rows)
    ]
    return LeaderboardPublic(data=data, count=len(data))


# ================================================================ posts


def _live_posts() -> tuple[Any, ...]:
    return (col(Post.deleted_at).is_(None),)


def create_post(ctx: Ctx, *, body: PostCreate) -> PostPublic:
    existing = _replay(ctx, Post, body.id)
    if existing is not None:
        if existing.deleted_at is not None:
            raise conflict("post_deleted", "This post was deleted")
        return get_post(ctx, post_id=existing.id)
    ready = [media.require_ready(ctx, m.media_id, kinds=(m.kind,)) for m in body.media]
    post = Post(
        **ctx.owned(),
        **({"id": body.id} if body.id else {}),
        caption=body.caption,
        progress=body.progress.model_dump(exclude_none=True) if body.progress else None,
        location=body.location,
        tags=logic.parse_tags(body.caption),
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    _insert(ctx, post)
    for i, (m, obj) in enumerate(zip(body.media, ready, strict=True)):
        ctx.session.add(
            PostMedia(
                **ctx.owned(),
                post_id=post.id,
                position=i,
                media_id=obj.id,
                kind=m.kind,
                ratio=m.ratio,
            )
        )
    ctx.session.flush()
    _clear_drafts(ctx)
    _mention(
        ctx,
        _mention_ids(ctx, body.caption),
        key=f"post:{post.id}",
        post_id=post.id,
        text=body.caption,
    )
    notify.event(
        ctx,
        repo.follower_ids(ctx, ctx.user_id) + [ctx.user_id],
        "social.post",
        {"post_id": str(post.id), "author_id": str(ctx.user_id), "action": "created"},
    )
    notify.commit(ctx)
    return get_post(ctx, post_id=post.id)


def get_post(ctx: Ctx, *, post_id: uuid.UUID) -> PostPublic:
    post = repo.visible_post(ctx, post_id)
    return views.posts(ctx, [post], liked_by_limit=views.LIKED_BY_DETAIL)[0]


def update_caption(ctx: Ctx, *, post_id: uuid.UUID, caption: str) -> PostPublic:
    post = owned_repo.require(ctx, Post, post_id, what="post")
    before = set(_mention_ids(ctx, post.caption))
    post.caption = caption
    post.tags = logic.parse_tags(caption)
    post.updated_at = ctx.now
    ctx.session.add(post)
    ctx.session.flush()
    added = [u for u in _mention_ids(ctx, caption) if u not in before]
    _mention(ctx, added, key=f"post:{post.id}", post_id=post.id, text=caption)
    notify.commit(ctx)
    return get_post(ctx, post_id=post_id)


def delete_post(ctx: Ctx, *, post_id: uuid.UUID) -> None:
    post = owned_repo.require(ctx, Post, post_id, what="post")
    owned_repo.soft_delete(ctx, post)
    notify.commit(ctx)


def restore_post(ctx: Ctx, *, post_id: uuid.UUID) -> PostPublic:
    """Undo a delete inside :data:`logic.POST_UNDO_WINDOW`."""
    post = owned_repo.require(ctx, Post, post_id, what="post", include_deleted=True)
    if post.deleted_at is not None:
        if ctx.now - post.deleted_at > logic.POST_UNDO_WINDOW:
            raise conflict("undo_expired", "This post can no longer be restored")
        owned_repo.restore(ctx, post)
    notify.commit(ctx)
    return get_post(ctx, post_id=post_id)


def like_post(ctx: Ctx, *, post_id: uuid.UUID, on: bool) -> PostPublic:
    """Like (idempotent: a double-tap on a liked post changes nothing) or
    unlike. Liking your own post records no activity."""
    post = repo.visible_post(ctx, post_id)
    if _set_edge(ctx, PostLike, "post_id", post.id, "post-like", on=on):
        if on:
            notify.record(
                ctx,
                recipient=post.owner_id,
                kind="like",
                key=str(post.id),
                post_id=post.id,
            )
        else:
            notify.retract(ctx, recipient=post.owner_id, kind="like", key=str(post.id))
    notify.commit(ctx)
    return get_post(ctx, post_id=post_id)


def save_post(ctx: Ctx, *, post_id: uuid.UUID, on: bool) -> PostPublic:
    post = repo.visible_post(ctx, post_id)
    _set_edge(ctx, PostSave, "post_id", post.id, "post-save", on=on)
    notify.commit(ctx)
    return get_post(ctx, post_id=post_id)


def _page(
    ctx: Ctx, rows: list[Post], count: int, cursor: str | None = None
) -> PostsPublic:
    return PostsPublic(data=views.posts(ctx, rows), count=count, next_cursor=cursor)


def feed(
    ctx: Ctx, *, tab: FeedTab, cursor: str | None, skip: int, limit: int
) -> PostsPublic:
    if tab == "foryou":
        return _for_you(ctx, skip=skip, limit=limit)
    authors = repo.following_ids(ctx, ctx.user_id) | {ctx.user_id}
    where = (
        Post.tenant_id == ctx.tenant_id,
        col(Post.owner_id).in_(authors),
        *_live_posts(),
    )
    count = ctx.session.exec(select(func.count()).select_from(Post).where(*where)).one()
    q = select(Post).where(*where)
    if cursor:
        after = logic.decode_cursor(cursor)
        if after is None:
            raise invalid("invalid_cursor", "The page cursor is not valid")
        q = q.where(
            tuple_(col(Post.created_at), col(Post.id))
            < tuple_(literal(after[0]), literal(after[1]))
        )
    rows = list(
        ctx.session.exec(
            q.order_by(col(Post.created_at).desc(), col(Post.id).desc()).limit(
                limit + 1
            )
        ).all()
    )
    more = len(rows) > limit
    rows = rows[:limit]
    nxt = (
        logic.encode_cursor(rows[-1].created_at, rows[-1].id) if more and rows else None
    )
    return _page(ctx, rows, int(count), nxt)


def _for_you_ranked(ctx: Ctx) -> list[uuid.UUID]:
    candidates = list(
        ctx.session.exec(
            select(Post.id, Post.created_at)
            .where(
                Post.tenant_id == ctx.tenant_id,
                col(Post.created_at) >= ctx.now - logic.FOR_YOU_WINDOW,
                *_live_posts(),
            )
            .order_by(col(Post.created_at).desc())
            .limit(logic.FOR_YOU_CANDIDATES)
        ).all()
    )
    likes = views.like_counts(ctx, [pid for pid, _ in candidates])
    ranked = logic.rank_for_you(
        logic.Rankable(id=pid, created_at=at, likes=likes.get(pid, 0))
        for pid, at in candidates
    )
    return [r.id for r in ranked]


def _posts_by_ids(ctx: Ctx, ids: list[uuid.UUID]) -> list[Post]:
    if not ids:
        return []
    found = {
        p.id: p
        for p in ctx.session.exec(select(Post).where(col(Post.id).in_(ids))).all()
    }
    return [found[i] for i in ids if i in found]


def _for_you(ctx: Ctx, *, skip: int, limit: int) -> PostsPublic:
    ranked = _for_you_ranked(ctx)
    return _page(ctx, _posts_by_ids(ctx, ranked[skip : skip + limit]), len(ranked))


def person_posts(ctx: Ctx, *, user_id: uuid.UUID, skip: int, limit: int) -> PostsPublic:
    repo.person(ctx, user_id)
    where = (Post.tenant_id == ctx.tenant_id, Post.owner_id == user_id, *_live_posts())
    count = ctx.session.exec(select(func.count()).select_from(Post).where(*where)).one()
    rows = list(
        ctx.session.exec(
            select(Post)
            .where(*where)
            .order_by(col(Post.created_at).desc(), col(Post.id).desc())
            .offset(skip)
            .limit(limit)
        ).all()
    )
    return _page(ctx, rows, int(count))


def saved_posts(ctx: Ctx, *, skip: int, limit: int) -> PostsPublic:
    where = (
        PostSave.owner_id == ctx.user_id,
        col(PostSave.deleted_at).is_(None),
        Post.tenant_id == ctx.tenant_id,
        *_live_posts(),
    )
    base = select(Post).join(PostSave, col(PostSave.post_id) == Post.id).where(*where)
    count = ctx.session.exec(select(func.count()).select_from(base.subquery())).one()
    rows = list(
        ctx.session.exec(
            base.order_by(col(PostSave.created_at).desc(), col(Post.id))
            .offset(skip)
            .limit(limit)
        ).all()
    )
    return _page(ctx, rows, int(count))


def tag_posts(ctx: Ctx, *, q: str, skip: int, limit: int) -> PostsPublic:
    tag = logic.normalize_tag(q)
    if tag is None:
        return PostsPublic(data=[], count=0)
    where = (
        Post.tenant_id == ctx.tenant_id,
        col(Post.tags).contains([tag]),
        *_live_posts(),
    )
    count = ctx.session.exec(select(func.count()).select_from(Post).where(*where)).one()
    rows = list(
        ctx.session.exec(
            select(Post)
            .where(*where)
            .order_by(col(Post.created_at).desc(), col(Post.id).desc())
            .offset(skip)
            .limit(limit)
        ).all()
    )
    return _page(ctx, rows, int(count))


def explore(ctx: Ctx) -> ExplorePublic:
    """Suggested people (in the tenant, not yet followed, most followed
    first) and the popular mosaic (the top of for-you)."""
    mine = repo.following_ids(ctx, ctx.user_id) | {ctx.user_id}
    followers = (
        select(Follow.followee_id, func.count().label("n"))
        .where(Follow.tenant_id == ctx.tenant_id, col(Follow.deleted_at).is_(None))
        .group_by(col(Follow.followee_id))
        .subquery()
    )
    suggested = list(
        ctx.session.exec(
            select(User.id)
            .join(followers, followers.c.followee_id == User.id, isouter=True)
            .where(
                User.tenant_id == ctx.tenant_id,
                col(User.is_active).is_(True),
                col(User.deleted_at).is_(None),
                col(User.id).not_in(mine),
            )
            .order_by(func.coalesce(followers.c.n, 0).desc(), col(User.id))
            .limit(20)
        ).all()
    )
    popular = _posts_by_ids(ctx, _for_you_ranked(ctx)[:30])
    return ExplorePublic(
        suggested=views.people_list(ctx, suggested), popular=views.posts(ctx, popular)
    )


# ================================================================ comments


def _comment_of(ctx: Ctx, post_id: uuid.UUID, comment_id: uuid.UUID) -> Comment:
    """A live comment that belongs to ``post_id`` (parent/child assertion)."""
    c = repo.in_tenant(ctx, Comment, comment_id)
    if c is None or c.post_id != post_id:
        raise not_found("comment")
    return c


def list_comments(
    ctx: Ctx, *, post_id: uuid.UUID, skip: int, limit: int
) -> CommentsPublic:
    repo.visible_post(ctx, post_id)
    where = (col(Comment.post_id) == post_id, col(Comment.deleted_at).is_(None))
    count = ctx.session.exec(
        select(func.count()).select_from(Comment).where(*where)
    ).one()
    rows = list(
        ctx.session.exec(
            select(Comment)
            .where(*where)
            .order_by(col(Comment.created_at), col(Comment.id))
            .offset(skip)
            .limit(limit)
        ).all()
    )
    return CommentsPublic(data=views.comments(ctx, rows), count=int(count))


def _comment_recipients(
    ctx: Ctx, post: Post, comment: Comment
) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    """``(comment activity recipients, mention recipients)`` for a comment
    written by ``comment.owner_id``."""
    direct = [post.owner_id]
    if comment.reply_to_id:
        parent = ctx.session.get(Comment, comment.reply_to_id)
        if parent is not None:
            direct.append(parent.owner_id)
    direct = [u for u in dict.fromkeys(direct) if u != comment.owner_id]
    found = repo.user_ids_by_handle(ctx, logic.parse_mentions(comment.text))
    mentions = [u for u in found.values() if u != comment.owner_id]
    return direct, mentions


def add_comment(ctx: Ctx, *, post_id: uuid.UUID, body: CommentCreate) -> CommentPublic:
    post = repo.visible_post(ctx, post_id)
    existing = _replay(ctx, Comment, body.id)
    if existing is not None:
        if existing.post_id != post_id or existing.deleted_at is not None:
            raise conflict("id_conflict", "That id is already in use")
        return views.comments(ctx, [existing])[0]
    if body.reply_to_id is not None:
        _comment_of(ctx, post_id, body.reply_to_id)
    comment = Comment(
        **ctx.owned(),
        **({"id": body.id} if body.id else {}),
        post_id=post.id,
        text=body.text,
        reply_to_id=body.reply_to_id,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    _insert(ctx, comment)
    direct, mentions = _comment_recipients(ctx, post, comment)
    for uid in direct:
        notify.record(
            ctx,
            recipient=uid,
            kind="comment",
            key=f"comment:{comment.id}",
            post_id=post.id,
            text=comment.text,
        )
    _mention(
        ctx, mentions, key=f"comment:{comment.id}", post_id=post.id, text=comment.text
    )
    notify.commit(ctx)
    return views.comments(ctx, [comment])[0]


def like_comment(
    ctx: Ctx, *, post_id: uuid.UUID, comment_id: uuid.UUID, on: bool
) -> CommentPublic:
    repo.visible_post(ctx, post_id)
    c = _comment_of(ctx, post_id, comment_id)
    if _set_edge(ctx, CommentLike, "comment_id", c.id, "comment-like", on=on):
        key = f"comment-like:{c.id}"
        if on:
            notify.record(
                ctx,
                recipient=c.owner_id,
                kind="like",
                key=key,
                post_id=post_id,
                text="liked your comment",
            )
        else:
            notify.retract(ctx, recipient=c.owner_id, kind="like", key=key)
    notify.commit(ctx)
    return views.comments(ctx, [c])[0]


def _retract_comment_activity(ctx: Ctx, post: Post, comment: Comment) -> None:
    direct, mentions = _comment_recipients(ctx, post, comment)
    ids = [
        notify.activity_id(u, "comment", f"comment:{comment.id}", comment.owner_id)
        for u in direct
    ] + [
        notify.activity_id(u, "mention", f"comment:{comment.id}", comment.owner_id)
        for u in mentions
    ]
    for row_id in ids:
        row = ctx.session.get(Activity, row_id)
        if row is not None and row.deleted_at is None:
            row.deleted_at = ctx.now
            ctx.session.add(row)


def delete_comment(ctx: Ctx, *, post_id: uuid.UUID, comment_id: uuid.UUID) -> None:
    """The comment's author or the post's owner may delete it; its replies go
    with it."""
    post = repo.visible_post(ctx, post_id)
    c = _comment_of(ctx, post_id, comment_id)
    if ctx.user_id not in (c.owner_id, post.owner_id):
        raise forbidden(
            "comment_forbidden", "Only the author or the post owner can delete this"
        )
    doomed = [c]
    frontier = [c.id]
    while frontier:
        replies = list(
            ctx.session.exec(
                select(Comment).where(
                    col(Comment.reply_to_id).in_(frontier),
                    col(Comment.deleted_at).is_(None),
                )
            ).all()
        )
        doomed += replies
        frontier = [r.id for r in replies]
    for row in doomed:
        _retract_comment_activity(ctx, post, row)
        row.deleted_at = ctx.now
        ctx.session.add(row)
    ctx.session.flush()
    notify.commit(ctx)


# ================================================================ stories


def create_story(ctx: Ctx, *, body: StoryCreate) -> StoryPublic:
    existing = _replay(ctx, Story, body.id)
    if existing is not None:
        if existing.deleted_at is not None:
            raise conflict("story_deleted", "This story was deleted")
        return get_story(ctx, story_id=existing.id)
    media_id = None
    if body.media_id is not None:
        kind: media.MediaKind = "video" if body.kind == "video" else "image"
        media_id = media.require_ready(ctx, body.media_id, kinds=(kind,)).id
    story = Story(
        **ctx.owned(),
        **({"id": body.id} if body.id else {}),
        kind=body.kind,
        media_id=media_id,
        text=body.text,
        bg=body.bg,
        progress=body.progress.model_dump(exclude_none=True) if body.progress else None,
        audience=body.audience,
        expires_at=ctx.now + logic.STORY_TTL,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    _insert(ctx, story)
    _clear_drafts(ctx)
    audience = (
        repo.close_friend_ids(ctx, ctx.user_id)
        if body.audience == "close"
        else repo.follower_ids(ctx, ctx.user_id)
    )
    notify.event(
        ctx,
        audience + [ctx.user_id],
        "social.story",
        {"story_id": str(story.id), "owner_id": str(ctx.user_id), "action": "created"},
    )
    notify.commit(ctx)
    return get_story(ctx, story_id=story.id)


def get_story(ctx: Ctx, *, story_id: uuid.UUID) -> StoryPublic:
    return views.stories(ctx, [repo.visible_story(ctx, story_id)])[0]


def story_tray(ctx: Ctx) -> StoryTray:
    rows = list(
        ctx.session.exec(
            select(Story)
            .where(*repo.live_story_clause(ctx))
            .order_by(col(Story.created_at), col(Story.id))
        ).all()
    )
    items = views.stories(ctx, rows)
    by: dict[uuid.UUID, list[StoryPublic]] = defaultdict(list)
    for item in items:
        by[item.owner_id].append(item)
    groups = logic.order_tray(
        [
            logic.TrayGroup(
                owner_id=uid,
                unseen=any(not i.seen for i in its),
                latest=its[-1].created_at,
            )
            for uid, its in by.items()
        ],
        me=ctx.user_id,
    )
    people = repo.briefs(ctx, by.keys())
    data = [
        StoryGroup(
            person=people[g.owner_id],
            unseen=g.unseen,
            close=any(i.audience == "close" for i in by[g.owner_id]),
            latest=g.latest,
            items=by[g.owner_id],
        )
        for g in groups
        if g.owner_id in people
    ]
    return StoryTray(data=data, count=len(data))


def mark_story_seen(ctx: Ctx, *, story_id: uuid.UUID) -> StoryPublic:
    story = repo.visible_story(ctx, story_id)
    if story.owner_id != ctx.user_id:
        _set_edge(ctx, StorySeen, "story_id", story.id, "story-seen", on=True)
    notify.commit(ctx)
    return get_story(ctx, story_id=story_id)


def like_story(ctx: Ctx, *, story_id: uuid.UUID, on: bool) -> StoryPublic:
    story = repo.visible_story(ctx, story_id)
    if _set_edge(ctx, StoryLike, "story_id", story.id, "story-like", on=on):
        if on:
            notify.record(
                ctx,
                recipient=story.owner_id,
                kind="story",
                key=str(story.id),
                text="liked your story",
            )
        else:
            notify.retract(
                ctx, recipient=story.owner_id, kind="story", key=str(story.id)
            )
    notify.commit(ctx)
    return get_story(ctx, story_id=story_id)


def delete_story(ctx: Ctx, *, story_id: uuid.UUID) -> None:
    story = owned_repo.require(ctx, Story, story_id, what="story")
    owned_repo.soft_delete(ctx, story)
    notify.event(
        ctx,
        [ctx.user_id],
        "social.story",
        {"story_id": str(story.id), "owner_id": str(ctx.user_id), "action": "deleted"},
    )
    notify.commit(ctx)


# ================================================================ notes


def _note_public(ctx: Ctx, notes: list[Note]) -> list[NotePublic]:
    if not notes:
        return []
    ids = [n.id for n in notes]
    liked = set(
        ctx.session.exec(
            select(NoteLike.note_id).where(
                col(NoteLike.note_id).in_(ids),
                NoteLike.owner_id == ctx.user_id,
                col(NoteLike.deleted_at).is_(None),
            )
        ).all()
    )
    people = repo.briefs(ctx, {n.owner_id for n in notes})
    return [
        NotePublic(
            id=n.id,
            person=people[n.owner_id],
            text=n.text,
            created_at=n.created_at,
            expires_at=n.expires_at,
            liked=n.id in liked,
        )
        for n in notes
        if n.owner_id in people
    ]


def notes(ctx: Ctx) -> NotesPublic:
    """My live note first, then the notes of people I follow, newest first."""
    authors = repo.following_ids(ctx, ctx.user_id) | {ctx.user_id}
    rows = list(
        ctx.session.exec(
            select(Note)
            .where(
                Note.tenant_id == ctx.tenant_id,
                col(Note.owner_id).in_(authors),
                col(Note.deleted_at).is_(None),
                col(Note.expires_at) > ctx.now,
            )
            .order_by(
                case((col(Note.owner_id) == ctx.user_id, 0), else_=1),
                col(Note.created_at).desc(),
            )
        ).all()
    )
    data = _note_public(ctx, rows)
    return NotesPublic(data=data, count=len(data))


def set_note(ctx: Ctx, *, text: str) -> NotePublic:
    """One live note per person: setting a new one replaces the old one and
    its likes, and runs for another 24 hours."""
    row = owned_repo.find_one(ctx, Note, include_deleted=True)
    if row is None:
        row = Note(
            **ctx.owned(),
            text=text,
            expires_at=ctx.now + logic.NOTE_TTL,
            created_at=ctx.now,
            updated_at=ctx.now,
        )
        ctx.session.add(row)
    else:
        for like in ctx.session.exec(
            select(NoteLike).where(
                NoteLike.note_id == row.id, col(NoteLike.deleted_at).is_(None)
            )
        ).all():
            like.deleted_at = ctx.now
            ctx.session.add(like)
        row.text = text
        row.expires_at = ctx.now + logic.NOTE_TTL
        row.created_at = ctx.now
        row.updated_at = ctx.now
        row.deleted_at = None
        ctx.session.add(row)
    ctx.session.flush()
    notify.commit(ctx)
    return _note_public(ctx, [row])[0]


def clear_note(ctx: Ctx) -> None:
    row = owned_repo.find_one(ctx, Note)
    if row is not None:
        owned_repo.soft_delete(ctx, row)
    notify.commit(ctx)


def like_note(ctx: Ctx, *, note_id: uuid.UUID, on: bool) -> NotePublic:
    note = repo.visible_note(ctx, note_id)
    if _set_edge(ctx, NoteLike, "note_id", note.id, "note-like", on=on):
        key = f"note:{note.id}"
        if on:
            notify.record(
                ctx,
                recipient=note.owner_id,
                kind="like",
                key=key,
                text="liked your note",
            )
        else:
            notify.retract(ctx, recipient=note.owner_id, kind="like", key=key)
    notify.commit(ctx)
    return _note_public(ctx, [note])[0]


# ================================================================ chats


def _system_message(ctx: Ctx, chat: Chat, text: str) -> ChatMessage:
    msg = ChatMessage(
        **ctx.owned(), chat_id=chat.id, at=ctx.now, text=text[:4000], system=True
    )
    ctx.session.add(msg)
    chat.last_message_at = ctx.now
    ctx.session.add(chat)
    ctx.session.flush()
    return msg


def _join(ctx: Ctx, chat: Chat, user_id: uuid.UUID) -> bool:
    """Add (or re-add) a member. Returns True when they were not one."""
    row = repo.membership(ctx, chat.id, user_id)
    if row is None:
        ctx.session.add(
            ChatMember(
                owner_id=user_id,
                tenant_id=ctx.tenant_id,
                chat_id=chat.id,
                read_at=ctx.now if user_id == ctx.user_id else None,
            )
        )
        return True
    if row.left_at is None and row.deleted_at is None:
        return False
    was_out = row.left_at is not None
    row.left_at = None
    row.deleted_at = None
    ctx.session.add(row)
    return was_out


def _chat_event(
    ctx: Ctx,
    chat_id: uuid.UUID,
    type_: str,
    data: dict[str, Any],
    *,
    others_only: bool = False,
) -> None:
    targets = repo.member_ids(ctx, chat_id)
    if others_only:
        targets = [u for u in targets if u != ctx.user_id]
    notify.event(ctx, targets, type_, {"chat_id": str(chat_id), **data})


def open_direct(
    ctx: Ctx, *, user_id: uuid.UUID, chat_id: uuid.UUID | None = None
) -> ChatPublic:
    """The 1:1 chat with a person, reused through ``direct_key``."""
    if user_id == ctx.user_id:
        raise invalid("self_chat", "You cannot message yourself")
    repo.person(ctx, user_id)
    key = logic.direct_key(ctx.user_id, user_id)

    def find() -> Chat | None:
        return ctx.session.exec(
            select(Chat).where(Chat.tenant_id == ctx.tenant_id, Chat.direct_key == key)
        ).first()

    chat = find()
    if chat is None:
        chat = Chat(
            **ctx.owned(),
            **({"id": chat_id} if chat_id else {}),
            is_group=False,
            direct_key=key,
            created_at=ctx.now,
            updated_at=ctx.now,
        )
        try:
            with ctx.session.begin_nested():
                ctx.session.add(chat)
                ctx.session.flush()
                _join(ctx, chat, ctx.user_id)
                _join(ctx, chat, user_id)
                ctx.session.flush()
        except IntegrityError:
            # Another request created it first (or the id is taken).
            chat = find()
            if chat is None:
                raise conflict("id_conflict", "That id is already in use") from None
    me_row = repo.membership(ctx, chat.id)
    if me_row is not None and me_row.deleted_at is not None:
        me_row.deleted_at = None
        ctx.session.add(me_row)
    notify.commit(ctx)
    return get_chat(ctx, chat_id=chat.id)


def create_group(ctx: Ctx, *, body: GroupCreate) -> ChatPublic:
    existing = _replay(ctx, Chat, body.id)
    if existing is not None:
        return get_chat(ctx, chat_id=existing.id)
    wanted = set(body.member_ids) - {ctx.user_id}
    if not wanted:
        raise invalid("group_too_small", "A group needs at least one other person")
    if repo.tenant_user_ids(ctx, wanted) != wanted:
        raise not_found("person")
    chat = Chat(
        **ctx.owned(),
        **({"id": body.id} if body.id else {}),
        name=body.name,
        is_group=True,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    _insert(ctx, chat)
    for uid in [ctx.user_id, *sorted(wanted, key=str)]:
        _join(ctx, chat, uid)
    ctx.session.flush()
    msg = _system_message(ctx, chat, f'created the group "{body.name}"')
    _chat_event(ctx, chat.id, "chat.message", _msg_event(msg))
    notify.commit(ctx)
    return get_chat(ctx, chat_id=chat.id)


def _group(ctx: Ctx, chat_id: uuid.UUID) -> tuple[Chat, ChatMember]:
    chat, member = repo.member_chat(ctx, chat_id)
    if not chat.is_group:
        raise invalid("not_a_group", "Only a group chat can do this")
    return chat, member


def rename_chat(ctx: Ctx, *, chat_id: uuid.UUID, name: str) -> ChatPublic:
    chat, _ = _group(ctx, chat_id)
    if chat.name != name:
        chat.name = name
        chat.updated_at = ctx.now
        msg = _system_message(ctx, chat, f'renamed the group "{name}"')
        _chat_event(ctx, chat.id, "chat.message", _msg_event(msg))
    notify.commit(ctx)
    return get_chat(ctx, chat_id=chat_id)


def add_members(
    ctx: Ctx, *, chat_id: uuid.UUID, user_ids: list[uuid.UUID]
) -> ChatPublic:
    chat, _ = _group(ctx, chat_id)
    wanted = set(user_ids)
    if repo.tenant_user_ids(ctx, wanted) != wanted:
        raise not_found("person")
    added = [u for u in sorted(wanted, key=str) if _join(ctx, chat, u)]
    ctx.session.flush()
    if added:
        names = ", ".join(b.name or "someone" for b in views.people_list(ctx, added))
        msg = _system_message(ctx, chat, f"added {names}")
        _chat_event(ctx, chat.id, "chat.message", _msg_event(msg))
    notify.commit(ctx)
    return get_chat(ctx, chat_id=chat_id)


def leave_chat(ctx: Ctx, *, chat_id: uuid.UUID) -> None:
    chat, member = _group(ctx, chat_id)
    msg = _system_message(ctx, chat, "left the group")
    _chat_event(ctx, chat.id, "chat.message", _msg_event(msg), others_only=True)
    member.left_at = ctx.now
    ctx.session.add(member)
    ctx.session.flush()
    notify.commit(ctx)


def update_membership(
    ctx: Ctx, *, chat_id: uuid.UUID, body: MemberSettings
) -> ChatPublic:
    _, member = repo.member_chat(ctx, chat_id)
    owned_repo.apply(member, body.model_dump(exclude_unset=True, exclude_none=True))
    ctx.session.add(member)
    notify.commit(ctx)
    return get_chat(ctx, chat_id=chat_id)


def hide_chat(ctx: Ctx, *, chat_id: uuid.UUID) -> None:
    """Delete a chat from MY inbox only; a new message brings it back."""
    _, member = repo.member_chat(ctx, chat_id)
    member.deleted_at = ctx.now
    member.read_at = ctx.now
    ctx.session.add(member)
    notify.commit(ctx)


def unhide_chat(ctx: Ctx, *, chat_id: uuid.UUID) -> ChatPublic:
    _, member = repo.member_chat(ctx, chat_id)
    member.deleted_at = None
    ctx.session.add(member)
    notify.commit(ctx)
    return get_chat(ctx, chat_id=chat_id)


def _chats_public(ctx: Ctx, pairs: list[tuple[Chat, ChatMember]]) -> list[ChatPublic]:
    if not pairs:
        return []
    ids = [c.id for c, _ in pairs]
    member_rows = ctx.session.exec(
        select(ChatMember.chat_id, ChatMember.owner_id)
        .where(col(ChatMember.chat_id).in_(ids), col(ChatMember.left_at).is_(None))
        .order_by(col(ChatMember.created_at), col(ChatMember.owner_id))
    ).all()
    by_chat: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for cid, uid in member_rows:
        by_chat[cid].append(uid)
    ranked = (
        select(
            ChatMessage.id,
            func.row_number()
            .over(
                partition_by=col(ChatMessage.chat_id),
                order_by=(col(ChatMessage.at).desc(), col(ChatMessage.id).desc()),
            )
            .label("n"),
        )
        .where(col(ChatMessage.chat_id).in_(ids), col(ChatMessage.deleted_at).is_(None))
        .subquery()
    )
    last_rows = list(
        ctx.session.exec(
            select(ChatMessage)
            .join(ranked, ranked.c.id == ChatMessage.id)
            .where(ranked.c.n == 1)
        ).all()
    )
    last = {m.chat_id: m for m in views.messages(ctx, last_rows)}
    read_at = {c.id: m.read_at for c, m in pairs}
    unread_rows = ctx.session.exec(
        select(ChatMessage.chat_id, func.count())
        .join(
            ChatMember,
            and_(
                col(ChatMember.chat_id) == ChatMessage.chat_id,
                col(ChatMember.owner_id) == ctx.user_id,
            ),
        )
        .where(
            col(ChatMessage.chat_id).in_(ids),
            col(ChatMessage.deleted_at).is_(None),
            col(ChatMessage.owner_id) != ctx.user_id,
            col(ChatMessage.system).is_(False),
            or_(
                col(ChatMember.read_at).is_(None),
                col(ChatMessage.at) > col(ChatMember.read_at),
            ),
        )
        .group_by(col(ChatMessage.chat_id))
    ).all()
    unread = {cid: int(n) for cid, n in unread_rows}
    people = repo.briefs(ctx, {u for us in by_chat.values() for u in us})
    out: list[ChatPublic] = []
    for chat, member in pairs:
        ids_in = by_chat.get(chat.id, [])
        if not chat.is_group:
            ids_in = [u for u in ids_in if u != ctx.user_id]
        out.append(
            ChatPublic(
                id=chat.id,
                name=chat.name,
                is_group=chat.is_group,
                members=[people[u] for u in ids_in if u in people],
                muted=member.muted,
                pinned=member.pinned,
                read_at=read_at[chat.id],
                unread=unread.get(chat.id, 0),
                last_message=last.get(chat.id),
                last_message_at=chat.last_message_at,
            )
        )
    return out


def get_chat(ctx: Ctx, *, chat_id: uuid.UUID) -> ChatPublic:
    return _chats_public(ctx, [repo.member_chat(ctx, chat_id)])[0]


def list_chats(ctx: Ctx, *, skip: int, limit: int) -> ChatsPublic:
    where = (
        ChatMember.owner_id == ctx.user_id,
        ChatMember.tenant_id == ctx.tenant_id,
        col(ChatMember.left_at).is_(None),
        col(ChatMember.deleted_at).is_(None),
        col(Chat.deleted_at).is_(None),
    )
    base = select(Chat, ChatMember).join(ChatMember, col(ChatMember.chat_id) == Chat.id)
    count = ctx.session.exec(
        select(func.count())
        .select_from(ChatMember)
        .join(Chat, col(Chat.id) == ChatMember.chat_id)
        .where(*where)
    ).one()
    rows = ctx.session.exec(
        base.where(*where)
        .order_by(
            col(ChatMember.pinned).desc(),
            func.coalesce(col(Chat.last_message_at), col(Chat.created_at)).desc(),
            col(Chat.id),
        )
        .offset(skip)
        .limit(limit)
    ).all()
    return ChatsPublic(
        data=_chats_public(ctx, [(c, m) for c, m in rows]), count=int(count)
    )


def list_messages(
    ctx: Ctx, *, chat_id: uuid.UUID, cursor: str | None, limit: int
) -> MessagesPublic:
    """Newest first; ``next_cursor`` pages back in time."""
    repo.member_chat(ctx, chat_id)
    where = (col(ChatMessage.chat_id) == chat_id, col(ChatMessage.deleted_at).is_(None))
    count = ctx.session.exec(
        select(func.count()).select_from(ChatMessage).where(*where)
    ).one()
    q = select(ChatMessage).where(*where)
    if cursor:
        after = logic.decode_cursor(cursor)
        if after is None:
            raise invalid("invalid_cursor", "The page cursor is not valid")
        q = q.where(
            tuple_(col(ChatMessage.at), col(ChatMessage.id))
            < tuple_(literal(after[0]), literal(after[1]))
        )
    rows = list(
        ctx.session.exec(
            q.order_by(col(ChatMessage.at).desc(), col(ChatMessage.id).desc()).limit(
                limit + 1
            )
        ).all()
    )
    more = len(rows) > limit
    rows = rows[:limit]
    nxt = logic.encode_cursor(rows[-1].at, rows[-1].id) if more and rows else None
    return MessagesPublic(
        data=views.messages(ctx, rows), count=int(count), next_cursor=nxt
    )


def _msg_event(msg: ChatMessage) -> dict[str, Any]:
    return {
        "message_id": str(msg.id),
        "sender_id": str(msg.owner_id),
        "at": msg.at.isoformat(),
        "action": "created",
    }


def _message_of(ctx: Ctx, chat_id: uuid.UUID, message_id: uuid.UUID) -> ChatMessage:
    """A live message that belongs to ``chat_id`` (parent/child assertion)."""
    msg = repo.in_tenant(ctx, ChatMessage, message_id)
    if msg is None or msg.chat_id != chat_id:
        raise not_found("message")
    return msg


def send_message(ctx: Ctx, *, chat_id: uuid.UUID, body: MessageCreate) -> MessagePublic:
    chat, member = repo.member_chat(ctx, chat_id)
    existing = _replay(ctx, ChatMessage, body.id)
    if existing is not None:
        if existing.chat_id != chat_id or existing.deleted_at is not None:
            raise conflict("id_conflict", "That id is already in use")
        return views.messages(ctx, [existing])[0]
    if body.reply_to_id is not None:
        _message_of(ctx, chat_id, body.reply_to_id)
    if body.post_id is not None:
        repo.visible_post(ctx, body.post_id)
    if body.story_id is not None:
        repo.visible_story(ctx, body.story_id)
    media_id = None
    if body.media_id is not None:
        media_id = media.require_ready(ctx, body.media_id, kinds=("image", "video")).id
    msg = ChatMessage(
        **ctx.owned(),
        **({"id": body.id} if body.id else {}),
        chat_id=chat.id,
        at=ctx.now,
        text=body.text,
        media_id=media_id,
        post_id=body.post_id,
        story_id=body.story_id,
        reply_to_id=body.reply_to_id,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    _insert(ctx, msg)
    chat.last_message_at = ctx.now
    ctx.session.add(chat)
    member.read_at = ctx.now
    ctx.session.add(member)
    rows = repo.members(ctx, chat.id)
    for m in rows:  # a member who hid the chat sees it again
        if m.deleted_at is not None:
            m.deleted_at = None
            ctx.session.add(m)
    ctx.session.flush()
    notify.event(
        ctx,
        [m.owner_id for m in rows],
        "chat.message",
        {"chat_id": str(chat.id), **_msg_event(msg)},
    )
    sender = repo.brief(ctx, ctx.user_id)
    title = sender.name or "New message"
    if chat.is_group and chat.name:
        title = f"{title} · {chat.name}"
    notify.push(
        ctx,
        [m.owner_id for m in rows if not m.muted],
        title=title,
        body=logic.message_preview(
            text=body.text,
            has_media=media_id is not None,
            has_post=body.post_id is not None,
            has_story=body.story_id is not None,
        ),
        data={
            "href": f"/social/chat/{chat.id}",
            "chat_id": str(chat.id),
            "message_id": str(msg.id),
        },
        thread=f"chat:{chat.id}",
    )
    notify.commit(ctx)
    return views.messages(ctx, [msg])[0]


def react(
    ctx: Ctx, *, chat_id: uuid.UUID, message_id: uuid.UUID, emoji: str | None
) -> MessagePublic:
    """Set (or with ``emoji=None`` remove) my reaction to a message."""
    repo.member_chat(ctx, chat_id)
    msg = _message_of(ctx, chat_id, message_id)
    current = owned_repo.find_one(
        ctx,
        MessageReaction,
        col(MessageReaction.message_id) == msg.id,
        include_deleted=True,
    )
    changed = False
    if emoji is None:
        if current is not None and current.deleted_at is None:
            owned_repo.soft_delete(ctx, current)
            changed = True
    elif current is None or current.deleted_at is not None or current.emoji != emoji:
        owned_repo.upsert(
            ctx,
            MessageReaction,
            current.id if current else derived_id("reaction", msg.id, str(ctx.user_id)),
            {"message_id": msg.id, "emoji": emoji},
            natural_key=("message_id",),
        )
        changed = True
    if changed:
        _chat_event(
            ctx,
            chat_id,
            "chat.reaction",
            {"message_id": str(msg.id), "user_id": str(ctx.user_id), "emoji": emoji},
        )
    notify.commit(ctx)
    return views.messages(ctx, [msg])[0]


def unsend(ctx: Ctx, *, chat_id: uuid.UUID, message_id: uuid.UUID) -> None:
    """Only the sender may unsend; it is a soft delete everyone stops seeing."""
    repo.member_chat(ctx, chat_id)
    msg = _message_of(ctx, chat_id, message_id)
    if msg.owner_id != ctx.user_id or msg.system:
        raise forbidden("not_sender", "Only the sender can unsend this message")
    owned_repo.soft_delete(ctx, msg)
    _chat_event(
        ctx, chat_id, "chat.message", {"message_id": str(msg.id), "action": "unsent"}
    )
    notify.commit(ctx)


def mark_read(ctx: Ctx, *, chat_id: uuid.UUID) -> ChatPublic:
    _, member = repo.member_chat(ctx, chat_id)
    member.read_at = ctx.now
    ctx.session.add(member)
    _chat_event(
        ctx,
        chat_id,
        "chat.read",
        {"user_id": str(ctx.user_id), "at": ctx.now.isoformat()},
        others_only=True,
    )
    notify.commit(ctx)
    return get_chat(ctx, chat_id=chat_id)


# Typing nudges per (person, chat) at most this often; the rest are dropped.
TYPING_EVERY_SECONDS = 2


def typing(ctx: Ctx, *, chat_id: uuid.UUID) -> bool:
    """Publish an ephemeral ``chat.typing`` to the other members. Nothing is
    stored. Returns False when throttled."""
    repo.member_chat(ctx, chat_id)
    if not typing_gate(ctx.user_id, chat_id):
        return False
    others = [u for u in repo.member_ids(ctx, chat_id) if u != ctx.user_id]
    # Nothing was written, so there is nothing to wait for: publish now.
    events.publish_many(
        others, "chat.typing", {"chat_id": str(chat_id), "user_id": str(ctx.user_id)}
    )
    return True


_typing_client: redis.Redis | None = None


def _redis_typing_gate(user_id: uuid.UUID, chat_id: uuid.UUID) -> bool:
    global _typing_client
    try:
        if _typing_client is None:
            _typing_client = redis.Redis.from_url(settings.REDIS_URL)
        got = _typing_client.set(
            f"typing:{chat_id}:{user_id}", "1", nx=True, ex=TYPING_EVERY_SECONDS
        )
        return bool(got)
    except RedisError:
        return True  # fail open: a typing dot is harmless


# One named seam: tests swap the gate, never the redis client.
typing_gate: Callable[[uuid.UUID, uuid.UUID], bool] = _redis_typing_gate


# ================================================================ activity


def _read_at(ctx: Ctx) -> datetime | None:
    prof = repo.social_profile(ctx, ctx.user_id)
    return prof.activity_read_at if prof else None


def _activity_where(ctx: Ctx) -> tuple[Any, ...]:
    # Activity about a deleted post is withdrawn with it.
    post_live = or_(
        col(Activity.post_id).is_(None),
        select(Post.id)
        .where(Post.id == Activity.post_id, col(Post.deleted_at).is_(None))
        .exists(),
    )
    return (
        Activity.owner_id == ctx.user_id,
        Activity.tenant_id == ctx.tenant_id,
        col(Activity.deleted_at).is_(None),
        post_live,
    )


def _activity_unread(ctx: Ctx, read_at: datetime | None) -> int:
    where = _activity_where(ctx)
    if read_at is not None:
        where = (*where, col(Activity.at) > read_at)
    return int(
        ctx.session.exec(select(func.count()).select_from(Activity).where(*where)).one()
    )


def activity(ctx: Ctx, *, skip: int, limit: int) -> ActivitiesPublic:
    read_at = _read_at(ctx)
    where = _activity_where(ctx)
    count = ctx.session.exec(
        select(func.count()).select_from(Activity).where(*where)
    ).one()
    rows = list(
        ctx.session.exec(
            select(Activity)
            .where(*where)
            .order_by(col(Activity.at).desc(), col(Activity.id))
            .offset(skip)
            .limit(limit)
        ).all()
    )
    people = repo.briefs(ctx, {a.actor_id for a in rows})
    data = [
        ActivityPublic(
            id=a.id,
            kind=a.kind,  # type: ignore[arg-type]
            actor=people[a.actor_id],
            at=a.at,
            post_id=a.post_id,
            text=a.text,
            unread=read_at is None or a.at > read_at,
        )
        for a in rows
        if a.actor_id in people
    ]
    return ActivitiesPublic(
        data=data, count=int(count), unread=_activity_unread(ctx, read_at)
    )


def mark_activity_read(ctx: Ctx) -> Badges:
    prof = repo.my_social_profile(ctx)
    prof.activity_read_at = ctx.now
    ctx.session.add(prof)
    notify.commit(ctx)
    return badges(ctx)


def _chats_unread(ctx: Ctx) -> int:
    """Chats with unread messages, muted ones excluded."""
    q = (
        select(func.count(func.distinct(ChatMember.chat_id)))
        .select_from(ChatMember)
        .join(ChatMessage, col(ChatMessage.chat_id) == ChatMember.chat_id)
        .where(
            ChatMember.owner_id == ctx.user_id,
            ChatMember.tenant_id == ctx.tenant_id,
            col(ChatMember.left_at).is_(None),
            col(ChatMember.deleted_at).is_(None),
            col(ChatMember.muted).is_(False),
            col(ChatMessage.deleted_at).is_(None),
            col(ChatMessage.system).is_(False),
            col(ChatMessage.owner_id) != ctx.user_id,
            or_(
                col(ChatMember.read_at).is_(None),
                col(ChatMessage.at) > col(ChatMember.read_at),
            ),
        )
    )
    return int(ctx.session.exec(q).one())


def badges(ctx: Ctx) -> Badges:
    return Badges(
        activity_unread=_activity_unread(ctx, _read_at(ctx)),
        chats_unread=_chats_unread(ctx),
    )


def today(ctx: Ctx) -> TodayPublic:
    tray = story_tray(ctx)
    unseen = [g.person for g in tray.data if g.unseen and g.person.id != ctx.user_id]
    following = repo.following_ids(ctx, ctx.user_id)
    latest = None
    if following:
        row = ctx.session.exec(
            select(Post)
            .where(
                Post.tenant_id == ctx.tenant_id,
                col(Post.owner_id).in_(following),
                *_live_posts(),
            )
            .order_by(col(Post.created_at).desc(), col(Post.id).desc())
            .limit(1)
        ).first()
        latest = views.posts(ctx, [row])[0] if row else None
    b = badges(ctx)
    return TodayPublic(**b.model_dump(), unseen_story_people=unseen, latest_post=latest)


# ================================================================ drafts


def get_draft(ctx: Ctx, *, kind: DraftKind) -> DraftPublic:
    row = owned_repo.find_one(ctx, SocialDraft, col(SocialDraft.kind) == kind)
    return DraftPublic(
        kind=kind,
        body=row.body if row else {},
        updated_at=row.updated_at if row else None,
    )


def put_draft(ctx: Ctx, *, kind: DraftKind, body: dict[str, object]) -> DraftPublic:
    if len(json.dumps(body, default=str)) > MAX_DRAFT_BYTES:
        raise invalid("draft_too_large", "This draft is too large to save")
    current = owned_repo.find_one(
        ctx, SocialDraft, col(SocialDraft.kind) == kind, include_deleted=True
    )
    row, _ = owned_repo.upsert(
        ctx,
        SocialDraft,
        current.id if current else derived_id("social-draft", ctx.user_id, kind),
        {"kind": kind, "body": body},
        natural_key=("kind",),
    )
    row.updated_at = ctx.now
    ctx.session.add(row)
    notify.commit(ctx)
    return get_draft(ctx, kind=kind)


def clear_draft(ctx: Ctx, *, kind: DraftKind) -> None:
    row = owned_repo.find_one(ctx, SocialDraft, col(SocialDraft.kind) == kind)
    if row is not None:
        owned_repo.soft_delete(ctx, row)
    notify.commit(ctx)
