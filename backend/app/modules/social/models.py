"""Social (multi-user inside a tenant). ``owner_id`` is always the author or
actor; who may SEE a row is decided in ``services`` (follow graph, close
friends, chat membership), never by ownership. Social rows are served by REST
+ the event stream, not by the owner-scoped sync pull."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Float, Index, String, UniqueConstraint, text
from sqlmodel import Field

from app.shared.owned import JSONB, OwnedRow, enum_check, tstz

ACCENTS = ("hab", "tsk", "fit", "fin", "life", "primary")
STORY_KINDS = ("image", "video", "text", "progress")
ACTIVITY_KINDS = ("like", "comment", "follow", "mention", "story")
# Encouragement a post can get in place of a plain like.
CHEER_KINDS = ("keep_going", "proud", "inspired")


class SocialProfile(OwnedRow, table=True):
    __tablename__ = "social_profile"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_social_profile_owner"),
        enum_check("accent", ACCENTS, name="ck_social_profile_accent"),
    )

    bio: str = Field(default="", max_length=280)
    accent: str = Field(default="primary", sa_type=String(8))  # type: ignore
    show_scores: bool = True
    verified: bool = False
    activity_read_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore


class Follow(OwnedRow, table=True):
    """``owner_id`` follows ``followee_id``."""

    __tablename__ = "follow"
    __table_args__ = (
        UniqueConstraint("owner_id", "followee_id", name="uq_follow"),
        CheckConstraint("owner_id <> followee_id", name="ck_follow_self"),
    )

    followee_id: uuid.UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", index=True
    )


class CloseFriend(OwnedRow, table=True):
    __tablename__ = "close_friend"
    __table_args__ = (
        UniqueConstraint("owner_id", "friend_id", name="uq_close_friend"),
        CheckConstraint("owner_id <> friend_id", name="ck_close_friend_self"),
    )

    friend_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE", index=True)


class Post(OwnedRow, table=True):
    __tablename__ = "post"
    __table_args__ = (
        Index(
            "ix_post_feed",
            "tenant_id",
            text("created_at DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    caption: str = Field(default="", max_length=2200)
    # A live progress attachment snapshot ({accent, kind, title, stats, ...}).
    progress: dict[str, object] | None = Field(default=None, sa_type=JSONB)
    location: str | None = Field(default=None, max_length=80)
    tags: list[str] = Field(default_factory=list, sa_type=JSONB)


class PostMedia(OwnedRow, table=True):
    __tablename__ = "post_media"
    __table_args__ = (
        UniqueConstraint("post_id", "position", name="uq_post_media_pos"),
        enum_check("kind", ("image", "video"), name="ck_post_media_kind"),
    )

    post_id: uuid.UUID = Field(foreign_key="post.id", ondelete="CASCADE", index=True)
    position: int
    media_id: uuid.UUID = Field(foreign_key="media_object.id", ondelete="CASCADE")
    kind: str = Field(sa_type=String(5))  # type: ignore
    ratio: float | None = Field(default=None, sa_type=Float)


class PostLike(OwnedRow, table=True):
    """A cheer on a post: one per person, of one ``CHEER_KINDS`` kind."""

    __tablename__ = "post_like"
    __table_args__ = (
        UniqueConstraint("owner_id", "post_id", name="uq_post_like"),
        enum_check("kind", CHEER_KINDS, name="ck_post_like_kind"),
    )

    post_id: uuid.UUID = Field(foreign_key="post.id", ondelete="CASCADE", index=True)
    kind: str = Field(
        default="keep_going",
        sa_type=String(10),  # type: ignore
        sa_column_kwargs={"server_default": "keep_going"},
    )


class PostSave(OwnedRow, table=True):
    __tablename__ = "post_save"
    __table_args__ = (UniqueConstraint("owner_id", "post_id", name="uq_post_save"),)

    post_id: uuid.UUID = Field(foreign_key="post.id", ondelete="CASCADE", index=True)


class Comment(OwnedRow, table=True):
    __tablename__ = "comment"

    post_id: uuid.UUID = Field(foreign_key="post.id", ondelete="CASCADE", index=True)
    text: str = Field(max_length=2200)
    reply_to_id: uuid.UUID | None = Field(
        default=None, foreign_key="comment.id", ondelete="CASCADE"
    )


class CommentLike(OwnedRow, table=True):
    __tablename__ = "comment_like"
    __table_args__ = (
        UniqueConstraint("owner_id", "comment_id", name="uq_comment_like"),
    )

    comment_id: uuid.UUID = Field(
        foreign_key="comment.id", ondelete="CASCADE", index=True
    )


class Story(OwnedRow, table=True):
    """Visible until ``expires_at`` (24 h); ``audience`` close = close friends."""

    __tablename__ = "story"
    __table_args__ = (
        enum_check("kind", STORY_KINDS, name="ck_story_kind"),
        enum_check("audience", ("everyone", "close"), name="ck_story_audience"),
    )

    kind: str = Field(sa_type=String(8))  # type: ignore
    media_id: uuid.UUID | None = Field(
        default=None, foreign_key="media_object.id", ondelete="CASCADE"
    )
    text: str | None = Field(default=None, max_length=500)
    bg: list[str] | None = Field(default=None, sa_type=JSONB)
    progress: dict[str, object] | None = Field(default=None, sa_type=JSONB)
    audience: str = Field(default="everyone", sa_type=String(8))  # type: ignore
    expires_at: datetime = Field(sa_type=tstz(), index=True)  # type: ignore


class StoryLike(OwnedRow, table=True):
    __tablename__ = "story_like"
    __table_args__ = (UniqueConstraint("owner_id", "story_id", name="uq_story_like"),)

    story_id: uuid.UUID = Field(foreign_key="story.id", ondelete="CASCADE", index=True)


class StorySeen(OwnedRow, table=True):
    __tablename__ = "story_seen"
    __table_args__ = (UniqueConstraint("owner_id", "story_id", name="uq_story_seen"),)

    story_id: uuid.UUID = Field(foreign_key="story.id", ondelete="CASCADE", index=True)


class Note(OwnedRow, table=True):
    """The inbox "note" bubble: one live note per user, 24 h."""

    __tablename__ = "note"
    __table_args__ = (UniqueConstraint("owner_id", name="uq_note_owner"),)

    text: str = Field(max_length=60)
    expires_at: datetime = Field(sa_type=tstz())  # type: ignore


class NoteLike(OwnedRow, table=True):
    __tablename__ = "note_like"
    __table_args__ = (UniqueConstraint("owner_id", "note_id", name="uq_note_like"),)

    note_id: uuid.UUID = Field(foreign_key="note.id", ondelete="CASCADE", index=True)


class Chat(OwnedRow, table=True):
    """``owner_id`` is the creator. A direct chat has exactly two members and
    ``direct_key`` (sorted member ids) so a second "message" reuses it."""

    __tablename__ = "chat"
    __table_args__ = (
        UniqueConstraint("tenant_id", "direct_key", name="uq_chat_direct"),
    )

    name: str | None = Field(default=None, max_length=80)
    is_group: bool = False
    direct_key: str | None = Field(default=None, max_length=80)
    last_message_at: datetime | None = Field(default=None, sa_type=tstz(), index=True)  # type: ignore


class ChatMember(OwnedRow, table=True):
    """``owner_id`` is the member; per-member mute/pin/read state."""

    __tablename__ = "chat_member"
    __table_args__ = (UniqueConstraint("chat_id", "owner_id", name="uq_chat_member"),)

    chat_id: uuid.UUID = Field(foreign_key="chat.id", ondelete="CASCADE", index=True)
    muted: bool = False
    pinned: bool = False
    read_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    left_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore


class ChatMessage(OwnedRow, table=True):
    """``owner_id`` is the sender. Unsend is a soft delete."""

    __tablename__ = "chat_message"
    __table_args__ = (Index("ix_chat_message_chat_at", "chat_id", text("at DESC")),)

    chat_id: uuid.UUID = Field(foreign_key="chat.id", ondelete="CASCADE", index=True)
    at: datetime = Field(sa_type=tstz(), index=True)  # type: ignore
    text: str | None = Field(default=None, max_length=4000)
    media_id: uuid.UUID | None = Field(
        default=None, foreign_key="media_object.id", ondelete="SET NULL"
    )
    post_id: uuid.UUID | None = Field(
        default=None, foreign_key="post.id", ondelete="SET NULL"
    )
    story_id: uuid.UUID | None = Field(
        default=None, foreign_key="story.id", ondelete="SET NULL"
    )
    reply_to_id: uuid.UUID | None = Field(
        default=None, foreign_key="chat_message.id", ondelete="SET NULL"
    )
    system: bool = False


class MessageReaction(OwnedRow, table=True):
    __tablename__ = "message_reaction"
    __table_args__ = (
        UniqueConstraint("owner_id", "message_id", name="uq_message_reaction"),
    )

    message_id: uuid.UUID = Field(
        foreign_key="chat_message.id", ondelete="CASCADE", index=True
    )
    emoji: str = Field(max_length=16)


class Activity(OwnedRow, table=True):
    """A notification in the social activity feed. ``owner_id`` is the
    RECIPIENT; ``actor_id`` who caused it."""

    __tablename__ = "activity"
    __table_args__ = (enum_check("kind", ACTIVITY_KINDS, name="ck_activity_kind"),)

    actor_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE")
    kind: str = Field(sa_type=String(8))  # type: ignore
    at: datetime = Field(sa_type=tstz(), index=True)  # type: ignore
    post_id: uuid.UUID | None = Field(
        default=None, foreign_key="post.id", ondelete="CASCADE"
    )
    text: str | None = Field(default=None, max_length=280)


class SocialDraft(OwnedRow, table=True):
    __tablename__ = "social_draft"
    __table_args__ = (
        UniqueConstraint("owner_id", "kind", name="uq_social_draft_kind"),
        enum_check("kind", ("post", "story"), name="ck_social_draft_kind"),
    )

    kind: str = Field(sa_type=String(5))  # type: ignore
    body: dict[str, object] = Field(default_factory=dict, sa_type=JSONB)
