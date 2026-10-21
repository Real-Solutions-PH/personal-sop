"""Request and response schemas of the social module (never table models)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

Accent = Literal["hab", "tsk", "fit", "fin", "life", "primary"]
StoryKind = Literal["image", "video", "text", "progress"]
Audience = Literal["everyone", "close"]
ActivityKind = Literal["like", "comment", "follow", "mention", "story"]
DraftKind = Literal["post", "story"]
FeedTab = Literal["following", "foryou"]


# ---------------------------------------------------------------- people


class PersonBrief(BaseModel):
    id: uuid.UUID
    name: str
    handle: str | None
    accent: Accent
    photo_media_id: uuid.UUID | None
    verified: bool


class PersonPublic(PersonBrief):
    bio: str
    followers: int
    following: int
    is_me: bool
    # The viewer follows this person / this person is on the viewer's list.
    is_following: bool
    close_friend: bool
    # Whether the viewer may open this person's scorecard.
    scores_visible: bool


class PeoplePublic(BaseModel):
    data: list[PersonPublic]
    count: int


class SocialProfileUpdate(BaseModel):
    bio: str | None = Field(default=None, max_length=280)
    accent: Accent | None = None
    show_scores: bool | None = None


class CloseFriendIn(BaseModel):
    close_friend: bool


class ProgressStat(BaseModel):
    label: str
    value: str
    unit: str | None = None


class TrophyPublic(BaseModel):
    type: Literal["pr", "streak", "best", "goal", "first"]
    title: str
    value: str


class AreaRatePublic(BaseModel):
    module: str
    rate: float | None


class ScorecardPublic(BaseModel):
    person_id: uuid.UUID
    life: int | None
    level: str | None
    delta: int | None
    streak: int
    best: int
    rates: list[AreaRatePublic]
    stats: list[ProgressStat]
    trophies: list[TrophyPublic]


class LeaderRow(BaseModel):
    rank: int
    person: PersonBrief
    life: int | None
    streak: int


class LeaderboardPublic(BaseModel):
    data: list[LeaderRow]
    count: int


# ---------------------------------------------------------------- posts


class MediaIn(BaseModel):
    media_id: uuid.UUID
    kind: Literal["image", "video"] = "image"
    ratio: float | None = Field(default=None, gt=0, le=10)


class MediaPublic(BaseModel):
    media_id: uuid.UUID
    kind: Literal["image", "video"]
    ratio: float | None
    url: str | None


class ProgressIn(BaseModel):
    """A live progress attachment snapshot (the share card a post carries)."""

    accent: str = Field(max_length=16)
    kind: str = Field(max_length=40)
    title: str = Field(max_length=120)
    subtitle: str | None = Field(default=None, max_length=120)
    stats: list[ProgressStat] = Field(default_factory=list, max_length=6)
    spark: list[float] | None = Field(default=None, max_length=120)


class PostCreate(BaseModel):
    id: uuid.UUID | None = None
    caption: str = Field(default="", max_length=2200)
    media: list[MediaIn] = Field(default_factory=list, max_length=10)
    progress: ProgressIn | None = None
    location: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def _not_empty(self) -> "PostCreate":
        if not self.media and self.progress is None and not self.caption.strip():
            raise ValueError("A post needs media, a progress card or a caption")
        return self


class PostUpdate(BaseModel):
    caption: str = Field(max_length=2200)


class PostPublic(BaseModel):
    id: uuid.UUID
    author: PersonBrief
    created_at: datetime
    caption: str
    media: list[MediaPublic]
    progress: dict[str, object] | None
    location: str | None
    tags: list[str]
    likes: int
    liked: bool
    saved: bool
    comments: int
    liked_by: list[PersonBrief]


class PostsPublic(BaseModel):
    data: list[PostPublic]
    count: int
    # Keyset continuation of the following feed; None on the last page.
    next_cursor: str | None = None


class CommentCreate(BaseModel):
    id: uuid.UUID | None = None
    text: str = Field(min_length=1, max_length=2200)
    reply_to_id: uuid.UUID | None = None


class CommentPublic(BaseModel):
    id: uuid.UUID
    post_id: uuid.UUID
    author: PersonBrief
    text: str
    created_at: datetime
    likes: int
    liked: bool
    reply_to_id: uuid.UUID | None


class CommentsPublic(BaseModel):
    data: list[CommentPublic]
    count: int


# ---------------------------------------------------------------- stories, notes


class StoryCreate(BaseModel):
    id: uuid.UUID | None = None
    kind: StoryKind
    media_id: uuid.UUID | None = None
    text: str | None = Field(default=None, max_length=500)
    bg: list[str] | None = Field(default=None, min_length=2, max_length=2)
    progress: ProgressIn | None = None
    audience: Audience = "everyone"

    @model_validator(mode="after")
    def _payload_matches_kind(self) -> "StoryCreate":
        if self.kind in ("image", "video") and self.media_id is None:
            raise ValueError("A photo or video story needs media")
        if self.kind == "text" and not (self.text or "").strip():
            raise ValueError("A text story needs text")
        if self.kind == "progress" and self.progress is None:
            raise ValueError("A progress story needs a progress card")
        return self


class StoryPublic(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    created_at: datetime
    expires_at: datetime
    kind: StoryKind
    media: MediaPublic | None
    text: str | None
    bg: list[str] | None
    progress: dict[str, object] | None
    audience: Audience
    seen: bool
    liked: bool
    # Only the author sees how many liked their story.
    likes: int | None


class StoryGroup(BaseModel):
    person: PersonBrief
    unseen: bool
    close: bool
    latest: datetime
    items: list[StoryPublic]


class StoryTray(BaseModel):
    data: list[StoryGroup]
    count: int


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=60)


class NotePublic(BaseModel):
    id: uuid.UUID
    person: PersonBrief
    text: str
    created_at: datetime
    expires_at: datetime
    liked: bool


class NotesPublic(BaseModel):
    data: list[NotePublic]
    count: int


# ---------------------------------------------------------------- chats


class DirectIn(BaseModel):
    user_id: uuid.UUID
    id: uuid.UUID | None = None


class GroupCreate(BaseModel):
    id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=80)
    member_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)


class ChatRename(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class MembersIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)


class MemberSettings(BaseModel):
    muted: bool | None = None
    pinned: bool | None = None


class MessageCreate(BaseModel):
    id: uuid.UUID | None = None
    text: str | None = Field(default=None, max_length=4000)
    media_id: uuid.UUID | None = None
    post_id: uuid.UUID | None = None
    story_id: uuid.UUID | None = None
    reply_to_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _has_content(self) -> "MessageCreate":
        if not ((self.text or "").strip() or self.media_id or self.post_id):
            raise ValueError("A message needs text, media or a shared post")
        return self


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class MessagePublic(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    sender_id: uuid.UUID
    at: datetime
    text: str | None
    media: MediaPublic | None
    post_id: uuid.UUID | None
    story_id: uuid.UUID | None
    reply_to_id: uuid.UUID | None
    system: bool
    # member id -> emoji
    reactions: dict[str, str]


class MessagesPublic(BaseModel):
    data: list[MessagePublic]
    count: int
    next_cursor: str | None = None


class ChatPublic(BaseModel):
    id: uuid.UUID
    name: str | None
    is_group: bool
    members: list[PersonBrief]
    muted: bool
    pinned: bool
    read_at: datetime | None
    unread: int
    last_message: MessagePublic | None
    last_message_at: datetime | None


class ChatsPublic(BaseModel):
    data: list[ChatPublic]
    count: int


# ---------------------------------------------------------------- activity, drafts


class ActivityPublic(BaseModel):
    id: uuid.UUID
    kind: ActivityKind
    actor: PersonBrief
    at: datetime
    post_id: uuid.UUID | None
    text: str | None
    unread: bool


class ActivitiesPublic(BaseModel):
    data: list[ActivityPublic]
    count: int
    unread: int


class Badges(BaseModel):
    activity_unread: int
    # Chats with unread messages, muted ones excluded (the header dot).
    chats_unread: int


class TodayPublic(Badges):
    """The Today screen's community card."""

    unseen_story_people: list[PersonBrief]
    latest_post: PostPublic | None


class ExplorePublic(BaseModel):
    suggested: list[PersonBrief]
    popular: list[PostPublic]


class DraftIn(BaseModel):
    body: dict[str, object] = Field(default_factory=dict)


class DraftPublic(BaseModel):
    kind: DraftKind
    body: dict[str, object]
    updated_at: datetime | None
