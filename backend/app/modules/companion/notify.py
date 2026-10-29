"""The "<name> replied" push for a streamed reply that finished while the
person was away from the app.

The turn runs on its own thread and session, so it finishes after the phone
drops the stream (the app went to the background or closed). At the end it
pushes to every device of the person, unless they have a live event stream:
the app keeps that stream open only while it is in the foreground, and a
person in the app sees the reply arrive. The tap opens the chat
(``data.href``); a newer reply in the same chat replaces the older banner.
"""

import logging
import re

from sqlmodel import col, select

from app.modules.companion.defaults import COMPANION_NAME
from app.modules.companion.models import Companion
from app.modules.companion.schema import AskOut
from app.modules.profile.models import PushDevice
from app.modules.realtime import public as realtime
from app.shared.context import Ctx
from app.shared.push import PushMessage, send_push

log = logging.getLogger(__name__)

KIND = "companion.reply"
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


def reply_pushed(ctx: Ctx, out: AskOut) -> bool:
    """Push the reply in ``out`` to the person's devices when they are not
    in the app. Never raises: the reply is stored whatever Expo says."""
    reply = next((m for m in out.messages if m.role == "sol" and m.text), None)
    if reply is None or reply.thread_id is None:
        return False
    try:
        if realtime.is_live(ctx.user_id):
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
