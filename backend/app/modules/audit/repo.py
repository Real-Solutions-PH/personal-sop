from sqlmodel import Session, col, func, select

from app.modules.audit.models import AuditLog


def list_logs(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[AuditLog], int]:
    """A page of audit rows, newest first, with the total count.

    The log is a platform-global table (not tenant-scoped), so this returns
    every actor's rows — the ``audit:read`` gate is what restricts access.
    """
    count = session.exec(select(func.count()).select_from(AuditLog)).one()
    rows = session.exec(
        select(AuditLog)
        # id is a secondary sort key so offset paging is stable when several
        # rows share a created_at (e.g. multiple audits in one request).
        .order_by(col(AuditLog.created_at).desc(), col(AuditLog.id))
        .offset(skip)
        .limit(limit)
    ).all()
    return list(rows), count
