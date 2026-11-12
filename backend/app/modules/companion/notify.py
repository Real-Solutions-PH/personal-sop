"""The "<name> replied" push for a streamed reply that finished while the
person was away from the app.

The turn runs on its own thread and session, so it finishes after the phone
drops the stream (the app went to the background or closed). At the end it
pushes to every device of the person, unless they have a live event stream:
the app keeps that stream open only while it is in the foreground, and a
person in the app sees the reply arrive. The tap opens the chat
(``data.href``); a newer reply in the same chat replaces the older banner.

The person's settings hold: no push when they denied notifications, and in
their quiet hours (Tasks settings) only a reply to a message sent in the
last ``FRESH_ASK`` is pushed: they are up, they just asked. A message typed
offline hours ago and answered in the night waits in the chat. A reply is
the answer to the person's own message, not an engagement nudge: it is not
counted against the nudge budget.
"""

import logging
import re
from datetime import datetime, timedelta

from sqlmodel import col, select

from app.modules.companion.defaults import COMPANION_NAME
from app.modules.companion.models import Companion
from app.modules.companion.schema import AskOut
from app.modules.profile.models import PushDevice, UserProfile
from app.modules.realtime import public as realtime
from app.shared.context import Ctx
from app.shared.push import PushMessage, send_push

log = logging.getLogger(__name__)

KIND = "companion.reply"
# A reply to a message sent this recently is pushed even in quiet hours.
FRESH_ASK = timedelta(minutes=10)
PREVIEW_CHARS = 120
# Markdown marks the chat renders and a banner would show as-is.
_MARKS = re.compile(r"[*_`#>~]+|\[([^\]]*)\]\([^)]*\)")


def preview(text: str, limit: int = PREVIEW_CHARS) -> str:
    """The reply as one plain line, cut at a word with an ellipsis."""
    plain = " ".join(_MARKS.sub(lambda m: m.group(1) or "", text).split())
    if len(plain) <= limit:
        return plain
    cut = plain[: limit - 1].rsplit(" ", 1)[0].rstrip(" ,;:.-")
    return f"{cut}…"


def _held_back(ctx: Ctx, asked_at: datetime | None) -> bool:
    """Whether the person's settings hold this push back."""
    from app.modules.tasks.jobs import in_quiet_hours
    from app.modules.tasks.repo import settings_or_default

    permission = ctx.session.exec(
        select(UserProfile.push_permission).where(UserProfile.owner_id == ctx.user_id)
    ).first()
    if permission == "denied":
        return True
    if asked_at is not None and ctx.now - asked_at <= FRESH_ASK:
        return False
    quiet = settings_or_default(ctx)
    local = ctx.now.astimezone(ctx.clock.zone)
    return in_quiet_hours(f"{local:%H:%M}", quiet.quiet_start, quiet.quiet_end)


def reply_pushed(ctx: Ctx, out: AskOut, *, asked_at: datetime | None = None) -> bool:
    """Push the reply in ``out`` to the person's devices when they are not
    in the app and their settings allow it (``asked_at``: when the message
    was sent). Never raises: the reply is stored whatever Expo says."""
    reply = next((m for m in out.messages if m.role == "sol" and m.text), None)
    if reply is None or reply.thread_id is None:
        return False
    try:
        if realtime.is_live(ctx.user_id):
            return False
        if _held_back(ctx, asked_at):
            return False
        tokens = ctx.session.exec(
            select(PushDevice.token).where(
                PushDevice.owner_id == ctx.user_id,
                PushDevice.tenant_id == ctx.tenant_id,
                col(PushDevice.deleted_at).is_(None),
                col(PushDevice.disabled_at).is_(None),
            )
        ).all()
        if not tokens:
            return False
        name = (
            ctx.session.exec(
                select(Companion.name).where(Companion.owner_id == ctx.user_id)
            ).first()
            or COMPANION_NAME
        )
        thread = str(reply.thread_id)
        messages = [
            PushMessage(
                token=t,
                title=f"{name} replied",
                body=preview(reply.text or ""),
                data={
                    "href": f"/capture?thread={thread}",
                    "thread_id": thread,
                    "kind": KIND,
                },
                thread=f"companion:{thread}",
            )
            for t in dict.fromkeys(tokens)
        ]
        return bool(send_push(messages))
    except Exception as exc:  # noqa: BLE001 - a push never fails the reply
        log.warning("companion reply push failed: %s", type(exc).__name__)
        return False
