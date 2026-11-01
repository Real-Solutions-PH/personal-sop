"""Expo push delivery through one seam (ADR-0013).

``push_sender`` is the only thing that talks to Expo; jobs call
:func:`send_push`, tests replace ``push_sender``. Tickets with
``DeviceNotRegistered`` disable the token.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.config import settings


@dataclass(frozen=True)
class PushMessage:
    token: str
    title: str
    body: str
    data: dict[str, Any] = field(default_factory=dict)
    # Collapse key: a newer push with the same thread replaces the older.
    thread: str | None = None


@dataclass(frozen=True)
class PushTicket:
    token: str
    ok: bool
    error: str | None = None
    ticket_id: str | None = None


PushSender = Callable[[list[PushMessage]], list[PushTicket]]


# The app's own notification sound, bundled by the expo-notifications config
# plugin (mobile/app.json). A build without it plays the system default.
SOUND = "unfurl.wav"
# Android plays a channel's sound, not the message's; the app creates this
# channel with ``SOUND`` (mobile local-reminders.ts).
ANDROID_CHANNEL = "reminders"


def expo_message(m: PushMessage) -> dict[str, Any]:
    """One Expo push request body for ``m``."""
    return {
        "to": m.token,
        "title": m.title,
        "body": m.body,
        "data": m.data,
        "sound": SOUND,
        "channelId": ANDROID_CHANNEL,
        **({"threadId": m.thread, "collapseId": m.thread} if m.thread else {}),
    }


def _expo_sender(messages: list[PushMessage]) -> list[PushTicket]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.EXPO_ACCESS_TOKEN:
        headers["Authorization"] = (
            f"Bearer {settings.EXPO_ACCESS_TOKEN.get_secret_value()}"
        )
    body = [expo_message(m) for m in messages]
    resp = httpx.post(settings.EXPO_PUSH_URL, json=body, headers=headers, timeout=15)
    resp.raise_for_status()
    tickets: list[PushTicket] = []
    for msg, t in zip(messages, resp.json().get("data", []), strict=False):
        if t.get("status") == "ok":
            tickets.append(PushTicket(token=msg.token, ok=True, ticket_id=t.get("id")))
        else:
            err = (t.get("details") or {}).get("error") or "unknown"
            tickets.append(PushTicket(token=msg.token, ok=False, error=str(err)))
    return tickets


push_sender: PushSender = _expo_sender


def send_push(messages: list[PushMessage]) -> list[PushTicket]:
    if not settings.PUSH_ENABLED or not messages:
        return []
    out: list[PushTicket] = []
    for i in range(0, len(messages), 100):  # Expo accepts 100 per request
        out.extend(push_sender(messages[i : i + 100]))
    return out
