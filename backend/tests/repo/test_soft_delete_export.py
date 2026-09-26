"""Soft-delete convention, GDPR export, and MCP write-only config.

Service/repo level so the checks don't depend on minting GoTrue tokens.
"""

from sqlmodel import Session

from app.db.models import Item, MCPServer
from app.modules.ai.mcp import services as mcp_service
from app.modules.ai.mcp.schema import MCPServerCreate, MCPServerPublic
from app.modules.iam.users import services as user_service
from app.modules.items import repo as item_repo
from tests.utils.user import create_random_user
from tests.utils.utils import random_lower_string

_MCP_URL = "https://mcp.example.com/sse"


def _new_item(db: Session, owner, title: str) -> Item:
    return item_repo.create(
        session=db,
        item=Item(title=title, owner_id=owner.id, tenant_id=owner.tenant_id),
    )


def test_soft_deleted_item_disappears_from_reads(db: Session) -> None:
    owner = create_random_user(db)
    item = _new_item(db, owner, "keep-then-hide")

    assert item_repo.get_by_id(session=db, item_id=item.id, tenant_id=None) is not None

    item_repo.soft_delete(session=db, item=item)

    # invisible to point reads and listings...
    assert item_repo.get_by_id(session=db, item_id=item.id, tenant_id=None) is None
    listed, count = item_repo.get_multi(session=db, tenant_id=None, owner_id=owner.id)
    assert item.id not in {i.id for i in listed}
    # ...but the row is retained and still reachable for export.
    assert item.id in {
        i.id for i in item_repo.list_all_by_owner(session=db, owner_id=owner.id)
    }


def test_soft_delete_user_deactivates_and_marks(db: Session) -> None:
    user = create_random_user(db)
    assert user.deleted_at is None
    assert user.is_active is True

    updated = user_service.soft_delete_user(session=db, user=user)

    assert updated.deleted_at is not None
    assert updated.is_active is False  # blocks auth via the existing is_active gate


def test_export_user_data_includes_profile_and_all_items(db: Session) -> None:
    user = create_random_user(db, full_name="Export Me")
    _new_item(db, user, "live-item")
    gone = _new_item(db, user, "deleted-item")
    item_repo.soft_delete(session=db, item=gone)

    export = user_service.export_user_data(session=db, user_id=user.id)

    assert export["user"]["email"] == user.email
    assert export["user"]["full_name"] == "Export Me"
    # data-portability export returns retained soft-deleted rows too
    titles = {i["title"] for i in export["items"]}
    assert titles == {"live-item", "deleted-item"}


def test_mcp_config_is_write_only_but_retained(db: Session) -> None:
    """Typed config: known + extra secret keys are accepted and stored, yet
    never appear on the public representation."""
    server = mcp_service.create_mcp_server(
        session=db,
        mcp_in=MCPServerCreate(
            name=f"wo-{random_lower_string()[:8]}",
            url=_MCP_URL,
            config={"auth_token": "tok", "custom_secret": "x"},
        ),
    )

    public = MCPServerPublic.model_validate(server).model_dump()
    assert "config" not in public

    stored = db.get(MCPServer, server.id)
    assert stored is not None
    # secrets are retained write-only (typed field + arbitrary extra key)
    assert stored.config["auth_token"] == "tok"
    assert stored.config["custom_secret"] == "x"
