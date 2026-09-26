"""Append-only audit trail for privileged/mutating actions.

Driven at the service layer (where the audit inserts live) rather than
through HTTP, so the checks don't depend on minting real GoTrue tokens.
"""

import json
import uuid

from sqlmodel import Session, col, func, select

from app.db.models import AuditLog
from app.modules.ai.mcp import services as mcp_service
from app.modules.ai.mcp.schema import MCPServerCreate, MCPServerUpdate
from app.modules.ai.tools import services as tool_service
from app.modules.ai.tools.schema import ToolCreate
from app.modules.audit import services as audit
from app.modules.iam.users import services as user_service
from tests.utils.user import create_random_user
from tests.utils.utils import random_lower_string

_MCP_URL = "https://mcp.example.com/sse"


def _count(db: Session, action: str) -> int:
    return db.exec(
        select(func.count()).select_from(AuditLog).where(AuditLog.action == action)
    ).one()


def _last(db: Session, action: str, target_id: object) -> AuditLog:
    row = db.exec(
        select(AuditLog)
        .where(AuditLog.action == action, AuditLog.target_id == str(target_id))
        .order_by(col(AuditLog.created_at).desc())
    ).first()
    assert row is not None
    return row


def test_record_writes_append_only_row(db: Session) -> None:
    actor = uuid.uuid4()
    entry = audit.record(
        session=db,
        actor_id=actor,
        action="test.action",
        target_type="thing",
        target_id="abc-123",
        before={"a": 1},
        after={"a": 2},
    )
    got = db.get(AuditLog, entry.id)
    assert got is not None
    assert got.actor_id == actor
    assert got.action == "test.action"
    assert got.target_type == "thing"
    assert got.target_id == "abc-123"
    assert got.before == {"a": 1}
    assert got.after == {"a": 2}
    assert got.created_at is not None


def test_snapshot_is_json_safe_and_field_scoped(db: Session) -> None:
    user = create_random_user(db)
    snap = audit.snapshot(user, ("id", "email", "is_superuser"))
    assert snap == {
        "id": str(user.id),
        "email": user.email,
        "is_superuser": user.is_superuser,
    }
    # everything must be JSON-serializable (uuid -> str)
    json.dumps(snap)


def test_mcp_crud_is_audited_without_leaking_config(db: Session) -> None:
    name = f"srv-{random_lower_string()[:10]}"
    created = _count(db, "mcp_server.create")

    server = mcp_service.create_mcp_server(
        session=db,
        mcp_in=MCPServerCreate(
            name=name, url=_MCP_URL, config={"auth_token": "S3CR3T", "extra": "x"}
        ),
    )
    assert _count(db, "mcp_server.create") == created + 1
    create_row = _last(db, "mcp_server.create", server.id)
    # snapshot carries the non-secret fields and NOTHING from config
    assert create_row.after == {
        "id": str(server.id),
        "name": name,
        "url": _MCP_URL,
        "is_active": True,
    }
    assert "S3CR3T" not in json.dumps(create_row.after)

    mcp_service.update_mcp_server(
        session=db, mcp_id=server.id, mcp_in=MCPServerUpdate(is_active=False)
    )
    update_row = _last(db, "mcp_server.update", server.id)
    assert update_row.before is not None and update_row.before["is_active"] is True
    assert update_row.after is not None and update_row.after["is_active"] is False

    mcp_service.delete_mcp_server(session=db, mcp_id=server.id)
    delete_row = _last(db, "mcp_server.delete", server.id)
    assert delete_row.before is not None and delete_row.before["id"] == str(server.id)


def test_tool_create_is_audited(db: Session) -> None:
    name = f"tool-{random_lower_string()[:10]}"
    created = _count(db, "tool.create")
    tool = tool_service.create_tool(
        session=db,
        tool_in=ToolCreate(
            name=name, tool_type="brave_search", config={"api_key": "SEKRET-VALUE"}
        ),
    )
    assert _count(db, "tool.create") == created + 1
    row = _last(db, "tool.create", tool.id)
    assert row.after is not None
    # tool config can hold provider keys — it must never reach the audit row
    dumped = json.dumps(row.after)
    assert "SEKRET-VALUE" not in dumped
    assert "api_key" not in dumped


def test_removing_unassigned_tool_is_not_audited(db: Session) -> None:
    """A no-op removal (the link never existed) must not write a row claiming
    a removal happened."""
    agent_id = uuid.uuid4()
    tool_id = uuid.uuid4()
    before = _count(db, "tool.remove_from_agent")
    tool_service.remove_tool_from_agent(session=db, agent_id=agent_id, tool_id=tool_id)
    assert _count(db, "tool.remove_from_agent") == before


def test_actor_id_recorded_when_available(db: Session) -> None:
    """delete flows already have the acting user, so 'who' is captured."""
    actor = create_random_user(db)
    target = create_random_user(db)
    user_service.delete_user(session=db, current_user=actor, user_id=target.id)
    row = _last(db, "user.delete", target.id)
    assert row.actor_id == actor.id
