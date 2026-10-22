"""Pure social rules: no database, no clock of their own.

Ported from ``mobile/src/prototype/social/{store,feed,explore}.ts(x)``:
tag and mention parsing, the direct-chat key, the for-you ranking, the story
tray order and the keyset cursor of the following feed.
"""

import base64
import re
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

STORY_TTL = timedelta(hours=24)
NOTE_TTL = timedelta(hours=24)
# How long after a post delete the author may still undo it. The device shows
# a few seconds of toast; the server allows for a slow round trip on top.
POST_UNDO_WINDOW = timedelta(seconds=60)
# The for-you candidate window: the tenant's posts from the last two weeks.
FOR_YOU_WINDOW = timedelta(days=14)
FOR_YOU_CANDIDATES = 500

MAX_TAGS = 30
MAX_TAG_LEN = 50
MAX_MENTIONS = 20

# ``#legday``: letters, digits and underscore (Unicode letters included).
_TAG = re.compile(r"#(\w+)")
# ``@ana.lifts``: handle characters; a trailing dot is sentence punctuation.
_MENTION = re.compile(r"(?<![\w@])@([A-Za-z0-9_.]+)")


def parse_tags(text: str) -> list[str]:
    """Lower-cased ``#tags`` of a caption, first occurrence order, unique."""
    out: list[str] = []
    for m in _TAG.finditer(text or ""):
        tag = m.group(1).lower()[:MAX_TAG_LEN]
        if tag not in out:
            out.append(tag)
        if len(out) == MAX_TAGS:
            break
    return out


def normalize_tag(query: str) -> str | None:
    """``"#LegDay "`` -> ``"legday"``; None when nothing tag-like is left."""
    tags = parse_tags("#" + query.strip().lstrip("#"))
    return tags[0] if tags else None


def normalize_handle(handle: str | None) -> str:
    return (handle or "").strip().lstrip("@").lower()


def parse_mentions(text: str) -> list[str]:
    """Lower-cased ``@handles`` of a text, first occurrence order, unique.
    An e-mail address (``a@b.com``) is not a mention."""
    out: list[str] = []
    for m in _MENTION.finditer(text or ""):
        handle = m.group(1).rstrip(".").lower()
        if handle and handle not in out:
            out.append(handle)
        if len(out) == MAX_MENTIONS:
            break
    return out


def direct_key(a: uuid.UUID, b: uuid.UUID) -> str:
    """The order-independent key of the 1:1 chat between two people."""
    if a == b:
        raise ValueError("a direct chat needs two different people")
    lo, hi = sorted((str(a), str(b)))
    return f"{lo}:{hi}"


@dataclass(frozen=True)
class Rankable:
    id: uuid.UUID
    created_at: datetime


def rank_for_you(posts: Iterable[Rankable]) -> list[Rankable]:
    """The "everyone" tab (``foryou`` on the wire): newest first.

    Community is about progress, not reach, so cheers never lift a post above
    newer ones; the id is the deterministic tiebreak.
    """
    return sorted(posts, key=lambda p: (-p.created_at.timestamp(), str(p.id)))


@dataclass(frozen=True)
class TrayGroup:
    owner_id: uuid.UUID
    unseen: bool
    latest: datetime


def order_tray(groups: Sequence[TrayGroup], *, me: uuid.UUID) -> list[TrayGroup]:
    """Story tray order: me first, then people with unseen stories, then the
    most recently posted (``storyGroups`` in the prototype)."""
    return sorted(
        groups,
        key=lambda g: (
            g.owner_id != me,
            not g.unseen,
            -g.latest.timestamp(),
            str(g.owner_id),
        ),
    )


def encode_cursor(at: datetime, row_id: uuid.UUID) -> str:
    raw = f"{at.isoformat()}|{row_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID] | None:
    """The ``(created_at, id)`` a page continues after; None when malformed."""
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        at_s, id_s = base64.urlsafe_b64decode(padded).decode().split("|", 1)
        at = datetime.fromisoformat(at_s)
        if at.tzinfo is None:
            return None
        return at, uuid.UUID(id_s)
    except (ValueError, UnicodeDecodeError):
        return None


def message_preview(
    *, text: str | None, has_media: bool, has_post: bool, has_story: bool
) -> str:
    """The push body for a chat message."""
    if text:
        return text if len(text) <= 120 else text[:119] + "…"
    if has_media:
        return "Sent a photo"
    if has_post:
        return "Shared a post"
    if has_story:
        return "Replied to your story"
    return "New message"
