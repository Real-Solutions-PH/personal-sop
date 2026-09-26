from typing import Any

from fastapi import APIRouter, Depends

from app.modules.audit import repo as audit_repo
from app.modules.audit.schema import AuditLogPublic, AuditLogsPublic
from app.modules.iam.deps import require_permission
from app.shared.deps import SessionDep
from app.shared.pagination import PaginationDep

# Reading the forensic trail is itself privileged: gated on audit:read (held by
# the dpo role; the superuser flag bypasses). The log is append-only — no write
# routes are exposed over it.
router = APIRouter(
    prefix="/audit",
    tags=["audit"],
    dependencies=[Depends(require_permission("audit:read"))],
)


@router.get("/logs", response_model=AuditLogsPublic)
def read_audit_logs(session: SessionDep, pagination: PaginationDep) -> Any:
    rows, count = audit_repo.list_logs(
        session=session, skip=pagination.skip, limit=pagination.limit
    )
    return AuditLogsPublic(
        data=[AuditLogPublic.model_validate(row) for row in rows], count=count
    )
