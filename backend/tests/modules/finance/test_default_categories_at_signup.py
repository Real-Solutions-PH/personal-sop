"""The default categories exist from sign-up completion, so a brand-new
user's first ``/sync/pull`` carries them (before any finance request).

Live E2E: a user who opened Finance -> Categories first, through sync only,
saw an empty list: the defaults were seeded only by finance's first-touch
settings bootstrap, which runs on a finance REST call.
"""

import threading
import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.modules.finance import public as finance_public
from app.modules.finance.models import Category, FinanceSettings
from app.modules.iam.users.models import User
from app.shared.context import make_ctx
from tests.utils.mobile import signed_in

PROFILE = f"{settings.API_V1_STR}/profile"
FINANCE = f"{settings.API_V1_STR}/finance"
SYNC = f"{settings.API_V1_STR}/sync"

# Written out here rather than read from the module under test: the device
# mints these ids with uuid.v5 over the same namespace (app/shared/ids.py).
NAMESPACE = uuid.UUID("6f1d7c2a-4b8e-5a3c-9d10-2e7f40b1c9a5")
SLUGS = (
    "food dining coffee groceries transport grab commute bills electricity "
    "internet phone rent subs shopping entertainment health personal gifts "
    "fees adjust salary freelance interest other-in"
).split()


def cat_id(user_id: uuid.UUID, slug: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"category:{user_id}:{slug}"))


def pull_all(client: TestClient, h: dict[str, str]) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    cursor = 0
    while True:
        r = client.get(f"{SYNC}/pull?cursor={cursor}&limit=200", headers=h)
        assert r.status_code == 200, r.text
        page = r.json()
        changes += page["changes"]
        cursor = page["cursor"]
        if not page["truncated"]:
            return changes


def complete_signup(client: TestClient, h: dict[str, str], handle: str) -> None:
    r = client.post(
        f"{PROFILE}/complete-signup",
        headers=h,
        json={"name": "New User", "handle": handle},
    )
    assert r.status_code == 200, r.text


def live_categories(client: TestClient, h: dict[str, str]) -> dict[str, dict[str, Any]]:
    return {
        c["id"]: c
        for c in pull_all(client, h)
        if c["entity"] == "category" and not c["deleted"]
    }


def owned_categories(db: Session, user_id: uuid.UUID) -> list[Category]:
    db.expire_all()
    return list(db.exec(select(Category).where(Category.owner_id == user_id)).all())


def _handle() -> str:
    return f"u{uuid.uuid4().hex[:12]}"


def test_first_pull_after_signup_carries_the_defaults(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    assert live_categories(client, h) == {}, "nothing seeds before sign-up completes"

    complete_signup(client, h, _handle())

    cats = live_categories(client, h)
    assert set(cats) == {cat_id(user.id, s) for s in SLUGS}
    dining = cats[cat_id(user.id, "dining")]["row"]
    assert dining["name"] == "Dining out"
    assert dining["parent_id"] == cat_id(user.id, "food")
    # Only the categories: finance's settings singleton is still created by
    # finance on first touch, not by sign-up.
    db.expire_all()
    assert (
        db.exec(
            select(FinanceSettings).where(FinanceSettings.owner_id == user.id)
        ).first()
        is None
    )


def test_seeding_twice_creates_no_duplicates(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    handle = _handle()
    complete_signup(client, h, handle)
    complete_signup(client, h, handle)
    # Finance's own first-touch bootstrap (settings_row) seeds again.
    r = client.get(f"{FINANCE}/categories", headers=h)
    assert r.status_code == 200, r.text

    rows = owned_categories(db, user.id)
    assert sorted(str(c.id) for c in rows) == sorted(cat_id(user.id, s) for s in SLUGS)


def test_a_deleted_default_is_not_brought_back(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    handle = _handle()
    complete_signup(client, h, handle)
    coffee = cat_id(user.id, "coffee")
    r = client.post(
        f"{SYNC}/push",
        headers=h,
        json={
            "ops": [
                {
                    "op_id": str(uuid.uuid4()),
                    "kind": "delete",
                    "name": "category",
                    "id": coffee,
                    "data": {},
                }
            ]
        },
    )
    assert r.status_code == 200 and r.json()["results"][0]["status"] == "applied"

    complete_signup(client, h, handle)
    assert client.get(f"{FINANCE}/categories", headers=h).status_code == 200

    assert coffee not in live_categories(client, h)
    rows = {str(c.id): c for c in owned_categories(db, user.id)}
    assert rows[coffee].deleted_at is not None
    assert len(rows) == len(SLUGS)


def test_concurrent_seeding_reads_the_winners_rows(db: Session) -> None:
    """Sign-up completion and the first finance request can seed at once.
    The second seeder must wait on the first's rows, then skip them, not
    fail with a duplicate key."""
    user, _ = signed_in(db)
    uid = user.id
    db.commit()

    first = Session(engine)
    second = Session(engine)
    try:
        finance_public.seed_default_categories(
            make_ctx(first, first.get(User, uid))  # type: ignore[arg-type]
        )
        # ``first`` holds the uncommitted inserts; start the second now.
        result: dict[str, object] = {}

        def race() -> None:
            try:
                ctx = make_ctx(second, second.get(User, uid))  # type: ignore[arg-type]
                finance_public.seed_default_categories(ctx)
                second.commit()
            except Exception as exc:  # noqa: BLE001 - surfaced by the assert
                result["error"] = exc

        t = threading.Thread(target=race)
        t.start()
        t.join(1.5)
        assert t.is_alive(), "the second seeder should wait on the first"
        first.commit()
        t.join(15)
        assert not t.is_alive()
        assert "error" not in result, result.get("error")
    finally:
        first.close()
        second.close()

    with Session(engine) as check:
        ids = check.exec(select(Category.id).where(col(Category.owner_id) == uid)).all()
        assert sorted(str(i) for i in ids) == sorted(cat_id(uid, s) for s in SLUGS)
