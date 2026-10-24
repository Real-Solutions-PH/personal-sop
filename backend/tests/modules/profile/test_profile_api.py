import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.profile import public
from tests.utils.mobile import ctx_for, signed_in

API = f"{settings.API_V1_STR}/profile"


def _handle() -> str:
    return f"u{uuid.uuid4().hex[:10]}"


def test_first_read_creates_defaults(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    r = client.get(API, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    p = body["profile"]
    assert (p["timezone"], p["day_start_hour"], p["target_threshold"]) == (
        "Asia/Manila",
        4,
        0.8,
    )
    assert {m["module"]: m["weight"] for m in body["modules"]} == {
        "habits": 3,
        "tasks": 2,
        "fitness": 3,
        "nutrition": 2,
        "finance": 2,
    }
    assert body["identities"] == [] and body["live"] is None
    assert p["version"] > 0


def test_update_profile_validates_and_unions_trophies(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    ok = client.patch(
        API,
        headers=h,
        json={
            "evening_start": "19:30",
            "seen_trophies": ["a", "b"],
            "privacy_hidden": True,
        },
    )
    assert ok.status_code == 200, ok.text
    again = client.patch(API, headers=h, json={"seen_trophies": ["c"]}).json()
    assert again["seen_trophies"] == ["a", "b", "c"]
    assert again["privacy_hidden"] is True
    for bad in (
        {"evening_start": "7pm"},
        {"day_start_hour": 24},
        {"timezone": "Mars/Base"},
        {"target_threshold": 0},
        {"handle": "Has Caps"},
        {"appearance": "neon"},
    ):
        r = client.patch(API, headers=h, json=bad)
        assert r.status_code == 422, bad
        # the envelope never echoes a submitted string value
        value = next(iter(bad.values()))
        if isinstance(value, str):
            assert value not in r.text


def test_handle_claim_is_unique_and_reserved_names_are_taken(
    client: TestClient, db: Session
) -> None:
    _, alice = signed_in(db)
    _, bob = signed_in(db)
    handle = _handle()
    assert (
        client.get(f"{API}/handle-available?handle={handle}", headers=bob).json()[
            "status"
        ]
        == "available"
    )
    r = client.post(
        f"{API}/complete-signup",
        headers=alice,
        json={"name": "Alice", "handle": handle},
    )
    assert r.status_code == 200 and r.json()["handle"] == handle
    assert (
        client.get(f"{API}/handle-available?handle={handle}", headers=bob).json()[
            "status"
        ]
        == "taken"
    )
    # owner re-checking their own handle sees it available to them
    assert (
        client.get(f"{API}/handle-available?handle={handle}", headers=alice).json()[
            "status"
        ]
        == "available"
    )
    clash = client.patch(API, headers=bob, json={"handle": handle})
    assert clash.status_code == 409 and clash.json()["code"] == "handle_taken"
    assert (
        client.get(f"{API}/handle-available?handle=admin", headers=bob).json()["status"]
        == "taken"
    )
    assert (
        client.get(f"{API}/handle-available?handle=a", headers=bob).json()["status"]
        == "invalid"
    )


def test_module_switches_and_weights(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    r = client.patch(
        f"{API}/modules/finance", headers=h, json={"enabled": False, "weight": 5}
    )
    assert r.status_code == 200
    mods = {m["module"]: m for m in r.json()}
    assert (mods["finance"]["enabled"], mods["finance"]["weight"]) == (False, 5)
    assert (
        client.patch(
            f"{API}/modules/finance", headers=h, json={"weight": 11}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"{API}/modules/journal", headers=h, json={"weight": 1}
        ).status_code
        == 404
    )
    reset = {
        m["module"]: m
        for m in client.post(f"{API}/modules/reset-weights", headers=h).json()
    }
    assert reset["finance"]["weight"] == 2 and reset["finance"]["enabled"] is False


def test_identities_are_replaced_in_order_and_capped(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    first = client.put(
        f"{API}/identities", headers=h, json=[{"text": "I lift"}, {"text": "I save"}]
    ).json()
    assert [i["text"] for i in first] == ["I lift", "I save"]
    keep = first[1]["id"]
    second = client.put(
        f"{API}/identities",
        headers=h,
        json=[{"id": keep, "text": "I save first"}, {"text": "I read"}],
    ).json()
    assert [i["text"] for i in second] == ["I save first", "I read"]
    assert second[0]["id"] == keep
    four = [{"text": f"x{i}"} for i in range(4)]
    r = client.put(f"{API}/identities", headers=h, json=four)
    assert r.status_code == 422 and r.json()["code"] == "too_many_identities"


def test_setup_skips_are_idempotent(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    assert client.post(f"{API}/setup-skips/fitness", headers=h).json() == ["fitness"]
    assert client.post(f"{API}/setup-skips/fitness", headers=h).json() == ["fitness"]
    assert client.post(f"{API}/setup-skips/tasks", headers=h).json() == [
        "fitness",
        "tasks",
    ]


def test_live_bar_is_single_and_pausable(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ref = uuid.uuid4()
    with ctx_for(user) as ctx:
        public.start_live(
            ctx, kind="timer", label="Meditate", href="/habits/x/timer", ref_id=ref
        )
        # same thing again is a no-op, something else is refused
        public.start_live(
            ctx, kind="timer", label="Meditate", href="/habits/x/timer", ref_id=ref
        )
        with pytest.raises(Exception) as exc:
            public.start_live(
                ctx,
                kind="workout",
                label="Push",
                href="/fitness/workout",
                ref_id=uuid.uuid4(),
            )
        assert getattr(exc.value, "status_code", None) == 409
        ctx.session.commit()
    live = client.get(f"{API}/live", headers=h).json()["live"]
    assert live["kind"] == "timer" and live["paused_at"] is None
    assert client.post(f"{API}/live/pause", headers=h).json()["live"]["paused_at"]
    assert (
        client.post(f"{API}/live/resume", headers=h).json()["live"]["paused_at"] is None
    )
    with ctx_for(user) as ctx:
        public.end_live(ctx, kind="timer", ref_id=uuid.uuid4())  # not the holder
        assert public.get_live(ctx) is not None
        public.end_live(ctx, kind="timer", ref_id=ref)
        assert public.get_live(ctx) is None
        # the single row is revived for the next session
        public.start_live(
            ctx, kind="workout", label="Pull", href="/fitness/workout", ref_id=ref
        )
        ctx.session.commit()
    assert client.get(f"{API}/live", headers=h).json()["live"]["kind"] == "workout"


def test_push_devices_follow_the_token(client: TestClient, db: Session) -> None:
    _, alice = signed_in(db)
    _, bob = signed_in(db)
    token = f"ExponentPushToken[{uuid.uuid4().hex}]"
    assert (
        client.post(
            f"{API}/push-devices",
            headers=alice,
            json={"token": token, "platform": "ios"},
        ).status_code
        == 200
    )
    again = client.post(
        f"{API}/push-devices", headers=alice, json={"token": token, "platform": "ios"}
    )
    assert len(client.get(f"{API}/push-devices", headers=alice).json()) == 1
    # same phone, other account: the token moves
    moved = client.post(
        f"{API}/push-devices", headers=bob, json={"token": token, "platform": "ios"}
    )
    assert moved.status_code == 200
    assert client.get(f"{API}/push-devices", headers=alice).json() == []
    assert (
        client.delete(
            f"{API}/push-devices/{again.json()['id']}", headers=bob
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"{API}/push-devices/{moved.json()['id']}", headers=bob
        ).status_code
        == 200
    )
    bad = client.post(
        f"{API}/push-devices",
        headers=bob,
        json={"token": "not-a-token-xx", "platform": "ios"},
    )
    assert bad.status_code == 422


def test_profile_and_modules_sync(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ops = [
        {
            "op_id": str(uuid.uuid4()),
            "kind": "upsert",
            "name": "profile",
            "id": str(uuid.uuid4()),
            "data": {"appearance": "dark"},
        },
        {
            "op_id": str(uuid.uuid4()),
            "kind": "upsert",
            "name": "module_pref",
            "id": str(uuid.uuid4()),
            "data": {"module": "tasks", "weight": 4},
        },
        {
            "op_id": str(uuid.uuid4()),
            "kind": "upsert",
            "name": "identity",
            "id": str(uuid.uuid4()),
            "data": {"text": "I ship"},
        },
    ]
    res = client.post(
        f"{settings.API_V1_STR}/sync/push", headers=h, json={"ops": ops}
    ).json()["results"]
    assert [r["status"] for r in res] == ["applied", "applied", "applied"], res
    me = client.get(API, headers=h).json()
    assert me["profile"]["appearance"] == "dark"
    assert {m["module"]: m["weight"] for m in me["modules"]}["tasks"] == 4
    pulled = client.get(f"{settings.API_V1_STR}/sync/pull", headers=h).json()["changes"]
    assert {"profile", "module_pref", "identity"} <= {c["entity"] for c in pulled}


def test_unauthenticated_is_401(client: TestClient) -> None:
    assert client.get(API).status_code == 401
