from sqlmodel import Session

from app.modules.funnel.models import FunnelEvent
from app.modules.funnel.schema import FunnelBatch


def record(session: Session, batch: FunnelBatch) -> int:
    """Insert one row per event; the whole batch or none."""
    session.add_all(
        FunnelEvent(
            install_id=batch.install_id,
            event=e.event,
            step=e.step,
            module=e.module,
            turned_on=e.turned_on,
            at=e.at,
        )
        for e in batch.events
    )
    session.commit()
    return len(batch.events)
