"""``GET /events/stream``: the per-user server-sent event stream.

Frames: ``id: <redis stream id>``, ``event: <type>``, ``data: <json>``. A
comment heartbeat every ``EVENTS_HEARTBEAT_SECONDS`` keeps proxies from
closing an idle stream. Resume with the standard ``Last-Event-ID`` header.
"""

from collections.abc import AsyncIterator

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import StreamingResponse

from app.core.config import settings
from app.modules.iam.deps import CurrentUser, require_permission
from app.shared.events import stream_key

router = APIRouter(prefix="/events", tags=["events"])


def sse_frame(event_id: str, type_: str, data: str) -> str:
    lines = [f"id: {event_id}", f"event: {type_}"]
    lines += [f"data: {line}" for line in data.split("\n")]
    return "\n".join(lines) + "\n\n"


async def _tail(request: Request, key: str, last_id: str) -> AsyncIterator[str]:
    client = aioredis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        yield "retry: 3000\n\n"
        cursor = last_id
        if cursor == "$":
            # Pin "now" to a concrete id once: re-sending "$" on every XREAD
            # would drop events published between two calls.
            newest = await client.xrevrange(key, count=1)
            cursor = newest[0][0] if newest else "0-0"
        block_ms = settings.EVENTS_HEARTBEAT_SECONDS * 1000
        while not await request.is_disconnected():
            got = await client.xread({key: cursor}, block=block_ms, count=100)
            if not got:
                yield ": ping\n\n"
                continue
            for _key, entries in got:
                for entry_id, fields in entries:
                    cursor = entry_id
                    yield sse_frame(
                        entry_id,
                        fields.get("type", "message"),
                        fields.get("data", "{}"),
                    )
    finally:
        await client.aclose()


@router.get(
    "/stream",
    dependencies=[Depends(require_permission("events:read"))],
    response_class=StreamingResponse,
)
async def stream(
    request: Request,
    current_user: CurrentUser,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    # "$" = only new events; a known id resumes after it (within the window).
    start = last_event_id if last_event_id else "$"
    return StreamingResponse(
        _tail(request, stream_key(current_user.id), start),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
