"""Two first touches for a new user race to create the fitness settings row.

The app's first screens, or Fern's reads running in parallel, both find no
row and both insert one. The second inserter blocks on the first's
transaction; when the first commits it must read the winner's row, not fail
on ``uq_fitness_settings_owner`` (a Fern turn crashed this way in the replay
eval with parallel reads on).
"""

import threading

from sqlmodel import Session, select

from app.core.db import engine
from app.modules.fitness import services
from app.modules.fitness.models import Exercise, FitnessSettings
from app.modules.iam.users.models import User
from app.shared.context import make_ctx
from tests.utils.mobile import signed_in


def test_concurrent_first_touch_reads_the_winners_row(db: Session) -> None:
    user, _ = signed_in(db)
    uid = user.id
    db.commit()

    first = Session(engine)
    second = Session(engine)
    try:
        a = services.ensure_settings(make_ctx(first, first.get(User, uid)))  # type: ignore[arg-type]
        # ``first`` holds the uncommitted insert; start the second now.
        result: dict[str, object] = {}

        def race() -> None:
            try:
                ctx = make_ctx(second, second.get(User, uid))  # type: ignore[arg-type]
                result["row"] = services.ensure_settings(ctx)
                second.commit()
            except Exception as exc:  # noqa: BLE001 - surfaced by the assert
                result["error"] = exc

        t = threading.Thread(target=race)
        t.start()
        t.join(1.5)
        assert t.is_alive(), "the second insert should wait on the first"
        first.commit()
        t.join(15)
        assert not t.is_alive()
        assert "error" not in result, result.get("error")
        row = result["row"]
        assert isinstance(row, FitnessSettings) and row.id == a.id
    finally:
        first.close()
        second.close()

    with Session(engine) as check:
        rows = check.exec(
            select(FitnessSettings).where(FitnessSettings.owner_id == uid)
        ).all()
        assert len(rows) == 1
        names = [
            e.name
            for e in check.exec(
                select(Exercise).where(Exercise.tenant_id == user.tenant_id)
            ).all()
        ]
        assert names and len(names) == len(set(names)), "library seeded once"
