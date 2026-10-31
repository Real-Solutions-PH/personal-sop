"""Load test: N users open the app at once, then all of them talk to Fern.

Each simulated user:

1. holds the app's live event stream (``/events/stream``) open throughout,
   as the phone does while the app is in front;
2. opens the app: the reads the phone fires together on launch (taken from
   a week of production access logs), all at once;
3. sends Fern one message and reads the streamed reply to the end, and
   while it streams, opens the app again (a tab switch).

Users start spread over ``--ramp`` seconds. A request counts as an error on a
non-2xx status, a transport failure, or a response slower than the phone's
own 15 s timeout (the phone would have given up). Tokens are signed with the
stub's key (``stub.py``) for users the API provisions on first sight; each
user sends its own client address so the per-address limits see N phones.

While it runs, it samples ``pg_stat_activity`` by ``application_name`` and
reports the peak connections per pool.

Run inside the backend image, next to the stub:
``python scripts/load_test/run.py --api http://api:8000 --users 100``.
"""

import argparse
import asyncio
import json
import statistics
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import jwt
import psycopg

PHONE_TIMEOUT = 15.0
APP_OPEN = [
    "/dashboard/today",
    "/stats/overview?range=7d",
    "/stats/overview?range=30d",
    "/stats/overview?range=90d",
    "/stats/overview?range=1y",
    "/stats/achievements",
    "/social/stories",
    "/social/notes",
    "/social/drafts/post",
    "/social/drafts/story",
    "/social/activity?limit=50",
    "/social/me",
    "/social/chats?limit=50",
    "/capture/settings",
    "/sync/pull?cursor=0&limit=500",
]


@dataclass
class Results:
    times: dict[str, list[float]] = field(default_factory=lambda: defaultdict(list))
    errors: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))
    first_byte: list[float] = field(default_factory=list)
    peak_connections: dict[str, int] = field(default_factory=dict)
    peak_total: int = 0

    def record(self, name: str, seconds: float, error: str | None) -> None:
        self.times[name].append(seconds)
        if error is None and seconds > PHONE_TIMEOUT:
            error = "slower than the phone's 15 s timeout"
        if error:
            self.errors[name].append(error)


def token(key: Any, issuer: str, user_id: uuid.UUID) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": str(user_id),
            "email": f"load-{user_id.hex[:12]}@example.com",
            "aud": "authenticated",
            "role": "authenticated",
            "iss": issuer,
            "iat": now,
            "exp": now + 3600,
        },
        key,
        algorithm="ES256",
        headers={"kid": "load-test"},
    )


async def get(
    client: httpx.AsyncClient,
    path: str,
    res: Results,
    label: str,
    timeout: float = 60,
) -> None:
    start = time.perf_counter()
    error = None
    try:
        r = await client.get(path, timeout=timeout)
        if r.status_code >= 400:
            error = f"HTTP {r.status_code}"
    except httpx.HTTPError as exc:
        error = type(exc).__name__
    res.record(label, time.perf_counter() - start, error)


async def app_open(client: httpx.AsyncClient, res: Results, tag: str) -> None:
    start = time.perf_counter()
    await asyncio.gather(*(get(client, p, res, f"{tag} {p}") for p in APP_OPEN))
    res.record(f"{tag} (whole burst)", time.perf_counter() - start, None)


async def events(client: httpx.AsyncClient, stop: asyncio.Event, res: Results) -> None:
    try:
        async with client.stream("GET", "/events/stream", timeout=None) as r:
            if r.status_code >= 400:
                res.record("events stream open", 0, f"HTTP {r.status_code}")
                return
            res.record("events stream open", 0, None)
            async for _ in r.aiter_raw():
                if stop.is_set():
                    return
    except httpx.HTTPError as exc:
        if not stop.is_set():
            res.record("events stream open", 0, type(exc).__name__)


async def chat(client: httpx.AsyncClient, res: Results) -> None:
    start = time.perf_counter()
    first = None
    error = None
    finished = False
    try:
        async with client.stream(
            "POST",
            "/companion/ask/stream",
            json={
                "text": "I had 2 eggs and rice for breakfast",
                "id": str(uuid.uuid4()),
            },
            timeout=180,
        ) as r:
            if r.status_code >= 400:
                error = f"HTTP {r.status_code}"
            else:
                async for line in r.aiter_lines():
                    if first is None and line.startswith("data:"):
                        first = time.perf_counter() - start
                    if '"RUN_FINISHED"' in line:
                        finished = True
                    if '"RUN_ERROR"' in line:
                        error = "RUN_ERROR " + line[:160]
                if not finished and error is None:
                    error = "stream ended without RUN_FINISHED"
    except httpx.HTTPError as exc:
        error = type(exc).__name__
    if first is not None:
        res.first_byte.append(first)
    # A streamed reply is not held to the 15 s timeout: the phone keeps the
    # stream while events arrive. Only failures count.
    res.times["fern reply (whole stream)"].append(time.perf_counter() - start)
    if error:
        res.errors["fern reply (whole stream)"].append(error)


def client(i: int, args: argparse.Namespace, key: Any) -> httpx.AsyncClient:
    uid = uuid.uuid5(uuid.NAMESPACE_URL, f"load-test-{args.seed}-{i}")
    headers = {
        "Authorization": f"Bearer {token(key, args.issuer, uid)}",
        "X-Load-Client-IP": f"10.{i // 250}.{i % 250}.7",
    }
    base = args.api_list[i % len(args.api_list)] + "/api/v1"
    limits = httpx.Limits(max_connections=40, max_keepalive_connections=40)
    return httpx.AsyncClient(base_url=base, headers=headers, limits=limits)


async def provision(args: argparse.Namespace, key: Any) -> None:
    """First sight provisions each user; done before the clock starts, a few
    at a time, so the measured run starts from users who already exist."""
    gate = asyncio.Semaphore(5)
    warm = Results()

    async def one(i: int) -> None:
        async with gate, client(i, args, key) as c:
            await get(c, "/social/me", warm, "warm-up", timeout=300)

    await asyncio.gather(*(one(i) for i in range(args.users)))
    failed = [e for e in warm.errors.get("warm-up", []) if "15 s" not in e]
    if failed:
        raise SystemExit(f"provisioning failed for {len(failed)} users: {failed[:3]}")


async def user(
    i: int, args: argparse.Namespace, key: Any, res: Results, stop: asyncio.Event
) -> None:
    async with client(i, args, key) as c:
        await asyncio.sleep(args.ramp * i / args.users)
        stream = asyncio.create_task(events(c, stop, res))
        await app_open(c, res, "open")
        await asyncio.sleep(args.think)
        reply = asyncio.create_task(chat(c, res))
        await asyncio.sleep(2)
        await app_open(c, res, "reopen during chat")
        await reply
        await stop.wait()
        stream.cancel()


async def sample(dsn: str, stop: asyncio.Event, res: Results) -> None:
    async with await psycopg.AsyncConnection.connect(dsn, autocommit=True) as conn:
        while not stop.is_set():
            rows = await (
                await conn.execute(
                    "SELECT coalesce(nullif(application_name, ''), usename::text),"
                    " count(*) FROM pg_stat_activity WHERE datname IS NOT NULL"
                    " AND pid <> pg_backend_pid() GROUP BY 1"
                )
            ).fetchall()
            total = 0
            for name, n in rows:
                res.peak_connections[name] = max(res.peak_connections.get(name, 0), n)
                total += n
            res.peak_total = max(res.peak_total, total)
            await asyncio.sleep(0.25)


def pct(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    if len(xs) == 1:
        return xs[0]
    return statistics.quantiles(xs, n=100, method="inclusive")[int(p) - 1]


def summarise(res: Results, wall: float) -> dict[str, Any]:
    rows = []
    for name in sorted(res.times):
        xs = res.times[name]
        rows.append(
            {
                "name": name,
                "n": len(xs),
                "p50": round(pct(xs, 50), 2),
                "p95": round(pct(xs, 95), 2),
                "max": round(max(xs), 2) if xs else 0,
                "errors": len(res.errors.get(name, [])),
                "error_kinds": sorted(set(res.errors.get(name, [])))[:3],
            }
        )
    reads = [
        x
        for k, v in res.times.items()
        if k.startswith(("open /", "reopen during chat /"))
        for x in v
    ]
    read_errors = sum(
        len(v)
        for k, v in res.errors.items()
        if k.startswith(("open /", "reopen during chat /"))
    )
    return {
        "wall_seconds": round(wall, 1),
        "reads": {
            "n": len(reads),
            "p50": round(pct(reads, 50), 2),
            "p95": round(pct(reads, 95), 2),
            "max": round(max(reads), 2) if reads else 0,
            "errors": read_errors,
        },
        "fern_first_byte_p95": round(pct(res.first_byte, 95), 2),
        "peak_db_connections": res.peak_total,
        "peak_by_pool": res.peak_connections,
        "rows": rows,
    }


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--api", required=True, help="comma-separated API base URLs")
    p.add_argument("--users", type=int, default=100)
    p.add_argument("--ramp", type=float, default=10.0)
    p.add_argument("--think", type=float, default=3.0)
    p.add_argument("--issuer", default="http://stub:9000/auth/v1")
    p.add_argument("--key", default="/keys/key.pem")
    p.add_argument("--dsn", default="postgresql://postgres:loadtest@pg:5432/app")
    p.add_argument("--seed", default="a")
    p.add_argument("--out", default="")
    args = p.parse_args()
    args.api_list = args.api.split(",")
    key = Path(args.key).read_text()

    await provision(args, key)
    res = Results()
    stop = asyncio.Event()
    sampler = asyncio.create_task(sample(args.dsn, stop, res))
    start = time.perf_counter()
    users = [
        asyncio.create_task(user(i, args, key, res, stop)) for i in range(args.users)
    ]

    async def finish_when_done() -> None:
        # Every user's reply is in once each has only the stream left.
        while (
            sum(len(v) for k, v in res.times.items() if k.startswith("fern"))
            < args.users
        ):
            await asyncio.sleep(0.5)
        stop.set()

    await finish_when_done()
    wall = time.perf_counter() - start
    await asyncio.gather(*users, return_exceptions=True)
    sampler.cancel()
    out = summarise(res, wall)
    text = json.dumps(out, indent=2)
    print(text)  # noqa: T201 - the report is the output
    if args.out:
        Path(args.out).write_text(text)


if __name__ == "__main__":
    asyncio.run(main())
