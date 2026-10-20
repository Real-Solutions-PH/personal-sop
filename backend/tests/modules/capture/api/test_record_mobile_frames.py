"""Records real SSE frames, REST answers and sync rows for the mobile live
capture tests (``mobile/src/live/__tests__/capture-recorded.json``).

Skipped unless ``RECORD_MOBILE_FIXTURES=1``: it rewrites a fixture another
suite reads. Ids, instants, versions and cursors are normalised so two runs
write the same file; seeded categories keep the ids the device derives for
the fixed user ``U``. ``test_mobile_wire.py`` checks the recorded frames
still match the schemas on every run.
"""

import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.shared.ids import derived_id
from tests.modules.capture.api.helpers import call, install, parse_sse, say, user

OUT = (
    Path(__file__).resolve().parents[5]
    / "mobile/src/live/__tests__/fixtures/capture-recorded.json"
)
U = uuid.UUID("8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
INSTANT = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})"
)
DAY = re.compile(r'"(\d{4}-\d{2}-\d{2})"')


def _stream(api: Any, path: str, body: dict[str, Any]) -> dict[str, Any]:
    r = api.c.post(f"/api/v1{path}", headers=api.h, json=body)
    out: dict[str, Any] = {"status": r.status_code}
    if r.headers.get("content-type", "").startswith("text/event-stream"):
        out["frames"] = [[e, d] for e, d in parse_sse(r.text)]
    else:
        out["body"] = r.json()
    return out


@pytest.mark.skipif(
    not os.environ.get("RECORD_MOBILE_FIXTURES"),
    reason="rewrites the mobile fixture; set RECORD_MOBILE_FIXTURES=1",
)
def test_record(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    cats = api.cats()
    rec: dict[str, Any] = {}
    cursor = api.get("/sync/pull", cursor=0, limit=500)["cursor"]

    # 1. rules read: an auto-saved expense, a weigh-in and the fallback card
    cid = str(uuid.uuid4())
    rec["stream_rules"] = {
        "request": {
            "id": cid,
            "client_uuid": str(uuid.uuid4()),
            "text": "coffee 165 at tims, weighed 72.6",
        },
    }
    rec["stream_rules"].update(
        _stream(api, "/capture/stream", rec["stream_rules"]["request"])
    )

    # 2. a follow-up question
    aid = str(uuid.uuid4())
    req = {"id": aid, "client_uuid": str(uuid.uuid4()), "text": "paid 1500"}
    rec["stream_ask"] = {"request": req, **_stream(api, "/capture/stream", req)}
    ask_card = next(
        d
        for e, d in rec["stream_ask"]["frames"]
        if e == "card" and d.get("t") == "record"
    )
    rec["answer"] = api.post(
        f"/capture/cards/{ask_card['id']}/answer", {"value": cats["groceries"]}
    )

    # card decisions on the expense of (1)
    done = rec["stream_rules"]["frames"][-1][1]
    exp = next(c for c in done["cards"] if c["kind"] == "expense")
    rec["undo"] = api.post(f"/capture/cards/{exp['id']}/undo")
    rec["redo"] = api.post(f"/capture/cards/{exp['id']}/redo")
    weigh = next(c for c in done["cards"] if c["kind"] == "weighIn")
    rec["edit"] = api.patch(
        f"/capture/cards/{weigh['id']}", {"payload": {"kind": "weighIn", "kg": 72.4}}
    )

    # 3. a proposed card (above the money threshold) and confirm-all
    req = {
        "id": str(uuid.uuid4()),
        "client_uuid": str(uuid.uuid4()),
        "text": "groceries 2500",
    }
    rec["stream_confirm"] = {"request": req, **_stream(api, "/capture/stream", req)}
    rec["confirm_all"] = api.post(f"/capture/{req['id']}/confirm-all")

    # 4. offline replay: a queued capture pushed through sync, then pulled
    qid = str(uuid.uuid4())
    push = {
        "ops": [
            {
                "op_id": str(uuid.uuid4()),
                "kind": "upsert",
                "name": "capture",
                "id": qid,
                "data": {
                    "client_uuid": str(uuid.uuid4()),
                    "at": "2026-10-19T03:00:00.000Z",
                    "source": "text",
                    "text": "spent 250 on grab",
                },
            }
        ]
    }
    rec["push"] = {"request": push, "response": api.post("/sync/push", push)}
    page = api.get("/sync/pull", cursor=cursor, limit=500)
    keep = {
        "capture",
        "record_card",
        "card_write_log",
        "reply_item",
        "journal_entry",
        "ai_settings",
    }
    rec["pull"] = [
        c
        for c in page["changes"]
        if c["entity"] in keep
        and (c["entity"] != "capture" or c["id"] == qid)
        and (
            c["entity"] not in ("record_card", "reply_item")
            or (c["row"] or {}).get("capture_id") == qid
        )
    ]
    qcards = {c["id"] for c in rec["pull"] if c["entity"] == "record_card"}
    rec["pull"] = [
        c
        for c in rec["pull"]
        if c["entity"] != "card_write_log" or (c["row"] or {}).get("card_id") in qcards
    ]

    # 5. refusal before the stream: AI switched off
    api.patch("/capture/settings", {"ai_enabled": False})
    rid = str(uuid.uuid4())
    req = {"id": rid, "client_uuid": str(uuid.uuid4()), "text": "spent 90 on jeep"}
    rec["refused"] = {"request": req, **_stream(api, "/capture/stream", req)}
    rec["refused"]["detail"] = api.get(f"/capture/{rid}")
    api.patch("/capture/settings", {"ai_enabled": True})

    # 6. The companion, rules: a reply with blocks, and a log handed to capture
    mid = str(uuid.uuid4())
    req = {"text": "how am I doing?", "id": mid}
    rec["ask_reply"] = {"request": req, **_stream(api, "/companion/ask/stream", req)}
    req = {"text": "spent 120 on lunch", "id": str(uuid.uuid4())}
    rec["ask_capture"] = {"request": req, **_stream(api, "/companion/ask/stream", req)}

    # 7. The companion, AI: streamed text, blocks and a nested capture
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "",
            call("show_chart", metric="workouts", days=30),
            call("track", metric="workouts", goal=4, direction="above"),
            call("log_to_capture", text="ran 5k 32 min"),
        ),
        say("Nice run. Here's your month and I'll watch your sessions."),
    )
    req = {"text": "ran 5k today, how's my training?", "id": str(uuid.uuid4())}
    rec["ask_ai"] = {"request": req, **_stream(api, "/companion/ask/stream", req)}

    # 8. capture, AI: cards first, then the streamed reply text
    api.assign("capture")
    install(
        monkeypatch,
        say(
            "",
            call("log_expense", amount=250, category="grab", payee="Grab"),
            call(
                "create_tasks",
                tasks=[{"title": "Pay rent", "due_date": "2026-10-30", "remind": True}],
            ),
        ),
        say("Logged your ride and the rent reminder."),
    )
    req = {
        "id": str(uuid.uuid4()),
        "client_uuid": str(uuid.uuid4()),
        "text": "spent 250 on grab, remind me to pay rent on the 30th",
    }
    rec["stream_ai"] = {"request": req, **_stream(api, "/capture/stream", req)}

    text = json.dumps(rec, indent=2, ensure_ascii=False)
    # Deterministic: the user becomes U, seeded categories keep the ids the
    # device derives for U, every other UUID is numbered by first appearance
    # and every instant is fixed.
    real_user = str(api.user.id)  # type: ignore[attr-defined]
    keep_ids: dict[str, str] = {real_user: str(U)}
    for slug, cid_ in cats.items():
        keep_ids[cid_] = str(derived_id("category", U, slug))
    seen: dict[str, str] = {}

    def sub(m: re.Match[str]) -> str:
        u = m.group(0)
        if u in keep_ids:
            return keep_ids[u]
        if u not in seen:
            seen[u] = f"00000000-0000-4000-8000-{len(seen) + 1:012x}"
        return seen[u]

    text = UUID.sub(sub, text)
    text = INSTANT.sub("2026-10-19T04:00:00.000000Z", text)
    text = re.sub(r'"version": \d+', '"version": 1', text)
    text = re.sub(r'"cursor": \d+', '"cursor": 1', text)
    OUT.write_text(text + "\n")
