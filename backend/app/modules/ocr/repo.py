import uuid
from typing import Any

from sqlmodel import Session, col, func, select

from app.modules.ocr.models import OcrDocument


def get_by_id(
    *, session: Session, doc_id: uuid.UUID, tenant_id: uuid.UUID | None
) -> OcrDocument | None:
    """Tenant filter lives in the WHERE clause: rows outside ``tenant_id``
    are invisible (natural 404). ``tenant_id=None`` = superuser bypass."""
    query = select(OcrDocument).where(OcrDocument.id == doc_id)
    if tenant_id is not None:
        query = query.where(OcrDocument.tenant_id == tenant_id)
    return session.exec(query).first()


def get_multi(
    *,
    session: Session,
    tenant_id: uuid.UUID | None,
    owner_id: uuid.UUID | None = None,
    status: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[OcrDocument], int]:
    count_q = select(func.count()).select_from(OcrDocument)
    items_q = (
        select(OcrDocument)
        .order_by(col(OcrDocument.created_at).desc())
        .offset(skip)
        .limit(limit)
    )
    if tenant_id is not None:
        count_q = count_q.where(OcrDocument.tenant_id == tenant_id)
        items_q = items_q.where(OcrDocument.tenant_id == tenant_id)
    if owner_id is not None:
        count_q = count_q.where(OcrDocument.owner_id == owner_id)
        items_q = items_q.where(OcrDocument.owner_id == owner_id)
    if status is not None:
        count_q = count_q.where(OcrDocument.status == status)
        items_q = items_q.where(OcrDocument.status == status)
    count = session.exec(count_q).one()
    docs = session.exec(items_q).all()
    return list(docs), count


def create(*, session: Session, doc: OcrDocument) -> OcrDocument:
    session.add(doc)
    session.commit()
    session.refresh(doc)
    return doc


def update(
    *, session: Session, doc: OcrDocument, update_data: dict[str, Any]
) -> OcrDocument:
    doc.sqlmodel_update(update_data)
    session.add(doc)
    session.commit()
    session.refresh(doc)
    return doc


def delete(*, session: Session, doc: OcrDocument) -> None:
    session.delete(doc)
    session.commit()
