"""RLS enforcement tests — direct SQL as a non-owner role.

The app engine (table owner) bypasses RLS, so these tests provision the
``app_user`` role with LOGIN and connect as it. Tenant claims are injected
exactly the way Supabase PostgREST does: a transaction-local
``set_config('request.jwt.claims', ..., true)``.

Includes the regression test for the verified gotcha: after a
transaction-local set_config, the GUC reads back as EMPTY STRING (not NULL)
on that session — without the ``NULLIF(..., '')`` in ``app_tenant_id()`` a
claim-less transaction on the same pooled connection would error (or worse,
leak) instead of seeing zero rows.
"""

import json
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from sqlalchemy import Connection, Engine, text
from sqlalchemy.exc import ProgrammingError
from sqlmodel import Session

from app.db.models import Conversation, Item, Message, Tenant, User
from tests.utils.utils import random_email, random_lower_string

# The app_user role's LOGIN is provisioned once per session by the shared
# ``app_user_engine`` fixture (tests/conftest.py); these tests consume it.


def _set_claims(conn: Connection, tenant_id: uuid.UUID) -> None:
    """Set the tenant claim exactly like Supabase PostgREST (txn-local)."""
    conn.execute(
        text("SELECT set_config('request.jwt.claims', :claims, true)"),
        {"claims": json.dumps({"tenant_id": str(tenant_id)})},
    )


@pytest.fixture(scope="module")
def fixture_rows(db: Session) -> Generator[dict[str, Any], None, None]:
    """Two tenants with a user, an item, and a conversation+message each.

    Created through the owner engine, which bypasses RLS.
    """
    made: dict[str, Any] = {}
    for label in ("a", "b"):
        tenant = Tenant(
            name=f"RLS tenant {label.upper()}",
            slug=f"rls-{label}-{random_lower_string()[:8]}",
        )
        db.add(tenant)
        db.commit()
        user = User(email=random_email(), tenant_id=tenant.id)
        db.add(user)
        db.commit()
        item = Item(title=f"rls item {label}", owner_id=user.id, tenant_id=tenant.id)
        conversation = Conversation(user_id=user.id, tenant_id=tenant.id)
        db.add(item)
        db.add(conversation)
        db.commit()
        message = Message(
            conversation_id=conversation.id,
            role="user",
            content=f"rls message {label}",
        )
        db.add(message)
        db.commit()
        made[label] = {
            "tenant_id": tenant.id,
            "user_id": user.id,
            "item_id": item.id,
            "conversation_id": conversation.id,
            "message_id": message.id,
        }

    yield made

    for label in ("a", "b"):
        ids = made[label]
        db.execute(
            text("DELETE FROM message WHERE id = :id"), {"id": ids["message_id"]}
        )
        db.execute(
            text("DELETE FROM conversation WHERE id = :id"),
            {"id": ids["conversation_id"]},
        )
        db.execute(text("DELETE FROM item WHERE id = :id"), {"id": ids["item_id"]})
        db.execute(text('DELETE FROM "user" WHERE id = :id'), {"id": ids["user_id"]})
        db.execute(text("DELETE FROM tenant WHERE id = :id"), {"id": ids["tenant_id"]})
    db.commit()


def test_app_user_does_not_bypass_rls(app_user_engine: Engine) -> None:
    with app_user_engine.connect() as conn:
        bypasses = conn.execute(
            text(
                "SELECT rolbypassrls OR rolsuper FROM pg_roles"
                " WHERE rolname = current_user"
            )
        ).scalar()
    assert bypasses is False


def test_tenant_a_sees_only_its_own_rows(
    app_user_engine: Engine, fixture_rows: dict[str, Any]
) -> None:
    a, b = fixture_rows["a"], fixture_rows["b"]
    with app_user_engine.connect() as conn:
        _set_claims(conn, a["tenant_id"])
        item_ids = {r[0] for r in conn.execute(text("SELECT id FROM item"))}
        user_ids = {r[0] for r in conn.execute(text('SELECT id FROM "user"'))}
        tenant_ids = {r[0] for r in conn.execute(text("SELECT id FROM tenant"))}
        conn.rollback()

    assert a["item_id"] in item_ids
    assert b["item_id"] not in item_ids
    assert a["user_id"] in user_ids
    assert b["user_id"] not in user_ids
    assert tenant_ids == {a["tenant_id"]}


def test_cross_tenant_select_by_id_returns_nothing(
    app_user_engine: Engine, fixture_rows: dict[str, Any]
) -> None:
    a, b = fixture_rows["a"], fixture_rows["b"]
    with app_user_engine.connect() as conn:
        _set_claims(conn, a["tenant_id"])
        row = conn.execute(
            text("SELECT id FROM item WHERE id = :id"), {"id": b["item_id"]}
        ).first()
        conn.rollback()
    assert row is None


def test_cross_tenant_insert_is_blocked(
    app_user_engine: Engine, fixture_rows: dict[str, Any]
) -> None:
    a, b = fixture_rows["a"], fixture_rows["b"]
    with app_user_engine.connect() as conn:
        _set_claims(conn, a["tenant_id"])
        with pytest.raises(ProgrammingError, match="row-level security"):
            conn.execute(
                text(
                    "INSERT INTO item (id, title, owner_id, tenant_id)"
                    " VALUES (:id, 'smuggled', :owner_id, :tenant_id)"
                ),
                {
                    "id": uuid.uuid4(),
                    "owner_id": b["user_id"],
                    "tenant_id": b["tenant_id"],
                },
            )
        conn.rollback()


def test_claimless_transaction_sees_zero_rows_not_an_error(
    app_user_engine: Engine, fixture_rows: dict[str, Any]
) -> None:
    """Regression for the ''-vs-NULL gotcha.

    After a transaction-local set_config the GUC resets to EMPTY STRING on
    the session. The pool holds exactly one connection, so the second
    transaction reuses it; without NULLIF in app_tenant_id() the ''::json
    cast would blow up here.
    """
    a = fixture_rows["a"]
    with app_user_engine.connect() as conn:
        _set_claims(conn, a["tenant_id"])
        count = conn.execute(text("SELECT count(*) FROM item")).scalar()
        assert count is not None and count >= 1
        conn.rollback()

    with app_user_engine.connect() as conn:
        guc = conn.execute(
            text("SELECT current_setting('request.jwt.claims', true)")
        ).scalar()
        assert guc == "", "precondition: GUC must be '' (the gotcha) not NULL"
        assert conn.execute(text("SELECT count(*) FROM item")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM tenant")).scalar() == 0
        conn.rollback()


def test_cross_tenant_message_insert_is_blocked(
    app_user_engine: Engine, fixture_rows: dict[str, Any]
) -> None:
    """The message policy is transitive (EXISTS over conversation) — the one
    policy whose WITH CHECK rests on nested RLS evaluation, so pin it."""
    a, b = fixture_rows["a"], fixture_rows["b"]
    with app_user_engine.connect() as conn:
        _set_claims(conn, a["tenant_id"])
        with pytest.raises(ProgrammingError, match="row-level security"):
            conn.execute(
                text(
                    "INSERT INTO message (id, conversation_id, role, content)"
                    " VALUES (:id, :conversation_id, 'user', 'smuggled')"
                ),
                {"id": uuid.uuid4(), "conversation_id": b["conversation_id"]},
            )
        conn.rollback()


def test_message_visibility_follows_conversation_tenancy(
    app_user_engine: Engine, fixture_rows: dict[str, Any]
) -> None:
    a, b = fixture_rows["a"], fixture_rows["b"]
    with app_user_engine.connect() as conn:
        _set_claims(conn, a["tenant_id"])
        message_ids = {r[0] for r in conn.execute(text("SELECT id FROM message"))}
        conn.rollback()

        _set_claims(conn, b["tenant_id"])
        b_message_ids = {r[0] for r in conn.execute(text("SELECT id FROM message"))}
        conn.rollback()

    assert a["message_id"] in message_ids
    assert b["message_id"] not in message_ids
    assert b["message_id"] in b_message_ids
    assert a["message_id"] not in b_message_ids
