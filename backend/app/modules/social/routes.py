"""REST routes of the social module: one endpoint per screen action of
``mobile/src/prototype/social``. Social does not sync through the owner pull
(ADR-0011); the device uses these routes plus ``GET /events/stream``.

Likes, saves, follows and close friends are idempotent ``PUT`` (on) and
``DELETE`` (off) pairs, so a double tap or a replayed request is harmless.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status

from app.modules.iam.deps import require_permission
from app.modules.social import services
from app.modules.social.schema import (
    ActivitiesPublic,
    Badges,
    ChatPublic,
    ChatRename,
    ChatsPublic,
    CheerKind,
    CloseFriendIn,
    CommentCreate,
    CommentPublic,
    CommentsPublic,
    DirectIn,
    DraftIn,
    DraftKind,
    DraftPublic,
    ExplorePublic,
    FeedTab,
    GroupCreate,
    LeaderboardPublic,
    MemberSettings,
    MembersIn,
    MessageCreate,
    MessagePublic,
    MessagesPublic,
    NoteIn,
    NotePublic,
    NotesPublic,
    PeoplePublic,
    PersonPublic,
    PostCreate,
    PostPublic,
    PostsPublic,
    PostUpdate,
    ReactionIn,
    ScorecardPublic,
    SocialProfileUpdate,
    StoryCreate,
    StoryPublic,
    StoryTray,
    TodayPublic,
)
from app.shared.context import CtxDep
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited

router = APIRouter(prefix="/social", tags=["social"])

READ = [Depends(require_permission("social:read"))]
WRITE = [rate_limited("social"), Depends(require_permission("social:write"))]
TYPING = [rate_limited("social_typing"), Depends(require_permission("social:write"))]
NO_CONTENT = status.HTTP_204_NO_CONTENT

Cursor = Annotated[str | None, Query(max_length=200)]
SearchQ = Annotated[str, Query(max_length=100)]


# ================================================================ me, people


@router.get("/me", response_model=PersonPublic, dependencies=READ)
def read_me(ctx: CtxDep) -> Any:
    """My social profile, with my follower counts."""
    return services.me(ctx)


@router.patch("/me", response_model=PersonPublic, dependencies=WRITE)
def update_me(ctx: CtxDep, body: SocialProfileUpdate) -> Any:
    """Bio, accent and the "show my scores to followers" switch."""
    return services.update_me(ctx, body=body)


@router.get("/badges", response_model=Badges, dependencies=READ)
def read_badges(ctx: CtxDep) -> Any:
    """Unread activity and unread (unmuted) chats: the header dots."""
    return services.badges(ctx)


@router.get("/today", response_model=TodayPublic, dependencies=READ)
def read_today(ctx: CtxDep) -> Any:
    """The Today screen's community card."""
    return services.today(ctx)


@router.get("/explore", response_model=ExplorePublic, dependencies=READ)
def read_explore(ctx: CtxDep) -> Any:
    """Suggested people and the popular mosaic."""
    return services.explore(ctx)


@router.get("/leaderboard", response_model=LeaderboardPublic, dependencies=READ)
def read_leaderboard(ctx: CtxDep) -> Any:
    """Me and the people I follow who share scores, by 30-day Life Score."""
    return services.leaderboard(ctx)


@router.get("/search/people", response_model=PeoplePublic, dependencies=READ)
def search_people(ctx: CtxDep, page: PaginationDep, q: SearchQ = "") -> Any:
    """Explore search by name or handle."""
    return services.search_people(ctx, q=q, skip=page.skip, limit=page.limit)


@router.get("/search/tags", response_model=PostsPublic, dependencies=READ)
def search_tags(ctx: CtxDep, page: PaginationDep, q: SearchQ = "") -> Any:
    """Explore ``#tag`` search over posts, newest first."""
    return services.tag_posts(ctx, q=q, skip=page.skip, limit=page.limit)


@router.get("/close-friends", response_model=PeoplePublic, dependencies=READ)
def read_close_friends(ctx: CtxDep) -> Any:
    """My close-friends list."""
    return services.close_friends(ctx)


@router.get("/people/{user_id}", response_model=PersonPublic, dependencies=READ)
def read_person(ctx: CtxDep, user_id: uuid.UUID) -> Any:
    """A profile: name, handle, bio, counts and my state towards them."""
    return services.get_person(ctx, user_id=user_id)


@router.get(
    "/people/{user_id}/scorecard", response_model=ScorecardPublic, dependencies=READ
)
def read_scorecard(ctx: CtxDep, user_id: uuid.UUID) -> Any:
    """The followers-only scorecard (404 when not visible to me)."""
    return services.scorecard(ctx, user_id=user_id)


@router.get(
    "/people/{user_id}/followers", response_model=PeoplePublic, dependencies=READ
)
def read_followers(ctx: CtxDep, user_id: uuid.UUID, page: PaginationDep) -> Any:
    return services.graph(
        ctx, user_id=user_id, direction="followers", skip=page.skip, limit=page.limit
    )


@router.get(
    "/people/{user_id}/following", response_model=PeoplePublic, dependencies=READ
)
def read_following(ctx: CtxDep, user_id: uuid.UUID, page: PaginationDep) -> Any:
    return services.graph(
        ctx, user_id=user_id, direction="following", skip=page.skip, limit=page.limit
    )


@router.get("/people/{user_id}/posts", response_model=PostsPublic, dependencies=READ)
def read_person_posts(ctx: CtxDep, user_id: uuid.UUID, page: PaginationDep) -> Any:
    """A profile's post grid, newest first."""
    return services.person_posts(ctx, user_id=user_id, skip=page.skip, limit=page.limit)


@router.put("/people/{user_id}/follow", response_model=PersonPublic, dependencies=WRITE)
def follow(ctx: CtxDep, user_id: uuid.UUID) -> Any:
    return services.follow(ctx, user_id=user_id)


@router.delete(
    "/people/{user_id}/follow", response_model=PersonPublic, dependencies=WRITE
)
def unfollow(ctx: CtxDep, user_id: uuid.UUID) -> Any:
    return services.unfollow(ctx, user_id=user_id)


@router.put(
    "/people/{user_id}/close-friend", response_model=PersonPublic, dependencies=WRITE
)
def set_close_friend(ctx: CtxDep, user_id: uuid.UUID, body: CloseFriendIn) -> Any:
    return services.set_close_friend(ctx, user_id=user_id, on=body.close_friend)


# ================================================================ posts


@router.get("/feed", response_model=PostsPublic, dependencies=READ)
def read_feed(
    ctx: CtxDep,
    page: PaginationDep,
    tab: FeedTab = "following",
    cursor: Cursor = None,
) -> Any:
    """Following (keyset: pass ``next_cursor`` back as ``cursor``) or
    for-you (ranked; ``skip``/``limit``)."""
    return services.feed(ctx, tab=tab, cursor=cursor, skip=page.skip, limit=page.limit)


@router.get("/saved", response_model=PostsPublic, dependencies=READ)
def read_saved(ctx: CtxDep, page: PaginationDep) -> Any:
    return services.saved_posts(ctx, skip=page.skip, limit=page.limit)


@router.post("/posts", response_model=PostPublic, dependencies=WRITE)
def create_post(ctx: CtxDep, body: PostCreate) -> Any:
    return services.create_post(ctx, body=body)


@router.get("/posts/{post_id}", response_model=PostPublic, dependencies=READ)
def read_post(ctx: CtxDep, post_id: uuid.UUID) -> Any:
    """Post detail, with up to 50 ``liked_by``."""
    return services.get_post(ctx, post_id=post_id)


@router.patch("/posts/{post_id}", response_model=PostPublic, dependencies=WRITE)
def update_post(ctx: CtxDep, post_id: uuid.UUID, body: PostUpdate) -> Any:
    """Edit the caption (author only)."""
    return services.update_caption(ctx, post_id=post_id, caption=body.caption)


@router.delete("/posts/{post_id}", status_code=NO_CONTENT, dependencies=WRITE)
def delete_post(ctx: CtxDep, post_id: uuid.UUID) -> None:
    """Soft delete; ``POST …/restore`` undoes it for a short window."""
    services.delete_post(ctx, post_id=post_id)


@router.post("/posts/{post_id}/restore", response_model=PostPublic, dependencies=WRITE)
def restore_post(ctx: CtxDep, post_id: uuid.UUID) -> Any:
    return services.restore_post(ctx, post_id=post_id)


@router.put("/posts/{post_id}/like", response_model=PostPublic, dependencies=WRITE)
def like_post(ctx: CtxDep, post_id: uuid.UUID, kind: CheerKind | None = None) -> Any:
    """Cheer, and the double-tap cheer (idempotent). ``kind`` picks or
    switches the cheer; without it a new cheer is ``keep_going``."""
    return services.like_post(ctx, post_id=post_id, on=True, kind=kind)


@router.delete("/posts/{post_id}/like", response_model=PostPublic, dependencies=WRITE)
def unlike_post(ctx: CtxDep, post_id: uuid.UUID) -> Any:
    return services.like_post(ctx, post_id=post_id, on=False)


@router.put("/posts/{post_id}/save", response_model=PostPublic, dependencies=WRITE)
def save_post(ctx: CtxDep, post_id: uuid.UUID) -> Any:
    return services.save_post(ctx, post_id=post_id, on=True)


@router.delete("/posts/{post_id}/save", response_model=PostPublic, dependencies=WRITE)
def unsave_post(ctx: CtxDep, post_id: uuid.UUID) -> Any:
    return services.save_post(ctx, post_id=post_id, on=False)


# ---------------------------------------------------------------- comments


@router.get(
    "/posts/{post_id}/comments", response_model=CommentsPublic, dependencies=READ
)
def read_comments(ctx: CtxDep, post_id: uuid.UUID, page: PaginationDep) -> Any:
    return services.list_comments(
        ctx, post_id=post_id, skip=page.skip, limit=page.limit
    )


@router.post(
    "/posts/{post_id}/comments", response_model=CommentPublic, dependencies=WRITE
)
def add_comment(ctx: CtxDep, post_id: uuid.UUID, body: CommentCreate) -> Any:
    """Comment or reply (``reply_to_id`` must be a comment on this post)."""
    return services.add_comment(ctx, post_id=post_id, body=body)


@router.put(
    "/posts/{post_id}/comments/{comment_id}/like",
    response_model=CommentPublic,
    dependencies=WRITE,
)
def like_comment(ctx: CtxDep, post_id: uuid.UUID, comment_id: uuid.UUID) -> Any:
    return services.like_comment(ctx, post_id=post_id, comment_id=comment_id, on=True)


@router.delete(
    "/posts/{post_id}/comments/{comment_id}/like",
    response_model=CommentPublic,
    dependencies=WRITE,
)
def unlike_comment(ctx: CtxDep, post_id: uuid.UUID, comment_id: uuid.UUID) -> Any:
    return services.like_comment(ctx, post_id=post_id, comment_id=comment_id, on=False)


@router.delete(
    "/posts/{post_id}/comments/{comment_id}",
    status_code=NO_CONTENT,
    dependencies=WRITE,
)
def delete_comment(ctx: CtxDep, post_id: uuid.UUID, comment_id: uuid.UUID) -> None:
    """By the comment's author or the post's owner."""
    services.delete_comment(ctx, post_id=post_id, comment_id=comment_id)


# ================================================================ stories, notes


@router.get("/stories", response_model=StoryTray, dependencies=READ)
def read_tray(ctx: CtxDep) -> Any:
    """The story tray: me first, then unseen, then most recent."""
    return services.story_tray(ctx)


@router.post("/stories", response_model=StoryPublic, dependencies=WRITE)
def create_story(ctx: CtxDep, body: StoryCreate) -> Any:
    return services.create_story(ctx, body=body)


@router.get("/stories/{story_id}", response_model=StoryPublic, dependencies=READ)
def read_story(ctx: CtxDep, story_id: uuid.UUID) -> Any:
    return services.get_story(ctx, story_id=story_id)


@router.put("/stories/{story_id}/seen", response_model=StoryPublic, dependencies=WRITE)
def mark_seen(ctx: CtxDep, story_id: uuid.UUID) -> Any:
    return services.mark_story_seen(ctx, story_id=story_id)


@router.put("/stories/{story_id}/like", response_model=StoryPublic, dependencies=WRITE)
def like_story(ctx: CtxDep, story_id: uuid.UUID) -> Any:
    return services.like_story(ctx, story_id=story_id, on=True)


@router.delete(
    "/stories/{story_id}/like", response_model=StoryPublic, dependencies=WRITE
)
def unlike_story(ctx: CtxDep, story_id: uuid.UUID) -> Any:
    return services.like_story(ctx, story_id=story_id, on=False)


@router.delete("/stories/{story_id}", status_code=NO_CONTENT, dependencies=WRITE)
def delete_story(ctx: CtxDep, story_id: uuid.UUID) -> None:
    services.delete_story(ctx, story_id=story_id)


@router.get("/notes", response_model=NotesPublic, dependencies=READ)
def read_notes(ctx: CtxDep) -> Any:
    """My note and the notes of people I follow."""
    return services.notes(ctx)


@router.put("/notes/me", response_model=NotePublic, dependencies=WRITE)
def set_note(ctx: CtxDep, body: NoteIn) -> Any:
    """Set my one live note (24 hours)."""
    return services.set_note(ctx, text=body.text)


@router.delete("/notes/me", status_code=NO_CONTENT, dependencies=WRITE)
def clear_note(ctx: CtxDep) -> None:
    services.clear_note(ctx)


@router.put("/notes/{note_id}/like", response_model=NotePublic, dependencies=WRITE)
def like_note(ctx: CtxDep, note_id: uuid.UUID) -> Any:
    return services.like_note(ctx, note_id=note_id, on=True)


@router.delete("/notes/{note_id}/like", response_model=NotePublic, dependencies=WRITE)
def unlike_note(ctx: CtxDep, note_id: uuid.UUID) -> Any:
    return services.like_note(ctx, note_id=note_id, on=False)


# ================================================================ chats


@router.get("/chats", response_model=ChatsPublic, dependencies=READ)
def read_chats(ctx: CtxDep, page: PaginationDep) -> Any:
    """My inbox: pinned first, then the most recent."""
    return services.list_chats(ctx, skip=page.skip, limit=page.limit)


@router.post("/chats/direct", response_model=ChatPublic, dependencies=WRITE)
def open_direct(ctx: CtxDep, body: DirectIn) -> Any:
    """Open (or create) the 1:1 chat with a person."""
    return services.open_direct(ctx, user_id=body.user_id, chat_id=body.id)


@router.post("/chats/groups", response_model=ChatPublic, dependencies=WRITE)
def create_group(ctx: CtxDep, body: GroupCreate) -> Any:
    return services.create_group(ctx, body=body)


@router.get("/chats/{chat_id}", response_model=ChatPublic, dependencies=READ)
def read_chat(ctx: CtxDep, chat_id: uuid.UUID) -> Any:
    return services.get_chat(ctx, chat_id=chat_id)


@router.patch("/chats/{chat_id}", response_model=ChatPublic, dependencies=WRITE)
def rename_chat(ctx: CtxDep, chat_id: uuid.UUID, body: ChatRename) -> Any:
    """Rename a group."""
    return services.rename_chat(ctx, chat_id=chat_id, name=body.name)


@router.delete("/chats/{chat_id}", status_code=NO_CONTENT, dependencies=WRITE)
def hide_chat(ctx: CtxDep, chat_id: uuid.UUID) -> None:
    """Delete the chat from my inbox only."""
    services.hide_chat(ctx, chat_id=chat_id)


@router.post("/chats/{chat_id}/restore", response_model=ChatPublic, dependencies=WRITE)
def unhide_chat(ctx: CtxDep, chat_id: uuid.UUID) -> Any:
    """Undo a delete from my inbox."""
    return services.unhide_chat(ctx, chat_id=chat_id)


@router.patch("/chats/{chat_id}/me", response_model=ChatPublic, dependencies=WRITE)
def update_membership(ctx: CtxDep, chat_id: uuid.UUID, body: MemberSettings) -> Any:
    """Mute or pin, for me."""
    return services.update_membership(ctx, chat_id=chat_id, body=body)


@router.post("/chats/{chat_id}/members", response_model=ChatPublic, dependencies=WRITE)
def add_members(ctx: CtxDep, chat_id: uuid.UUID, body: MembersIn) -> Any:
    return services.add_members(ctx, chat_id=chat_id, user_ids=body.user_ids)


@router.post("/chats/{chat_id}/leave", status_code=NO_CONTENT, dependencies=WRITE)
def leave_chat(ctx: CtxDep, chat_id: uuid.UUID) -> None:
    services.leave_chat(ctx, chat_id=chat_id)


@router.post("/chats/{chat_id}/read", response_model=ChatPublic, dependencies=WRITE)
def mark_read(ctx: CtxDep, chat_id: uuid.UUID) -> Any:
    return services.mark_read(ctx, chat_id=chat_id)


@router.post("/chats/{chat_id}/typing", status_code=NO_CONTENT, dependencies=TYPING)
def typing(ctx: CtxDep, chat_id: uuid.UUID) -> None:
    """Ephemeral "is typing" nudge to the other members; nothing is stored."""
    services.typing(ctx, chat_id=chat_id)


@router.get(
    "/chats/{chat_id}/messages", response_model=MessagesPublic, dependencies=READ
)
def read_messages(
    ctx: CtxDep,
    chat_id: uuid.UUID,
    cursor: Cursor = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> Any:
    """Newest first; pass ``next_cursor`` back to page into the past."""
    return services.list_messages(ctx, chat_id=chat_id, cursor=cursor, limit=limit)


@router.post(
    "/chats/{chat_id}/messages", response_model=MessagePublic, dependencies=WRITE
)
def send_message(ctx: CtxDep, chat_id: uuid.UUID, body: MessageCreate) -> Any:
    return services.send_message(ctx, chat_id=chat_id, body=body)


@router.delete(
    "/chats/{chat_id}/messages/{message_id}",
    status_code=NO_CONTENT,
    dependencies=WRITE,
)
def unsend(ctx: CtxDep, chat_id: uuid.UUID, message_id: uuid.UUID) -> None:
    """Unsend (sender only)."""
    services.unsend(ctx, chat_id=chat_id, message_id=message_id)


@router.put(
    "/chats/{chat_id}/messages/{message_id}/reaction",
    response_model=MessagePublic,
    dependencies=WRITE,
)
def react(
    ctx: CtxDep, chat_id: uuid.UUID, message_id: uuid.UUID, body: ReactionIn
) -> Any:
    return services.react(ctx, chat_id=chat_id, message_id=message_id, emoji=body.emoji)


@router.delete(
    "/chats/{chat_id}/messages/{message_id}/reaction",
    response_model=MessagePublic,
    dependencies=WRITE,
)
def unreact(ctx: CtxDep, chat_id: uuid.UUID, message_id: uuid.UUID) -> Any:
    return services.react(ctx, chat_id=chat_id, message_id=message_id, emoji=None)


# ================================================================ activity, drafts


@router.get("/activity", response_model=ActivitiesPublic, dependencies=READ)
def read_activity(ctx: CtxDep, page: PaginationDep) -> Any:
    return services.activity(ctx, skip=page.skip, limit=page.limit)


@router.post("/activity/read", response_model=Badges, dependencies=WRITE)
def mark_activity_read(ctx: CtxDep) -> Any:
    return services.mark_activity_read(ctx)


@router.get("/drafts/{kind}", response_model=DraftPublic, dependencies=READ)
def read_draft(ctx: CtxDep, kind: DraftKind) -> Any:
    return services.get_draft(ctx, kind=kind)


@router.put("/drafts/{kind}", response_model=DraftPublic, dependencies=WRITE)
def put_draft(ctx: CtxDep, kind: DraftKind, body: DraftIn) -> Any:
    return services.put_draft(ctx, kind=kind, body=body.body)


@router.delete("/drafts/{kind}", status_code=NO_CONTENT, dependencies=WRITE)
def clear_draft(ctx: CtxDep, kind: DraftKind) -> None:
    services.clear_draft(ctx, kind=kind)
