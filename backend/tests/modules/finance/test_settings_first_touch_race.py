"""Two first requests for a new user race to create the settings row.

The row id is derived, so both insert the same primary key. The second
inserter blocks on the first's transaction; when the first commits it must
read the winner's row, not fail with a duplicate key (a capture sent right
after sign-in ended ``interpret_failed`` this way).
"""

import threading

from sqlmodel import Session, select

from app.core.db import engine
from app.modules.finance import repo
from app.modules.finance.models import Category, FinanceSettings
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
        a = repo.settings_row(make_ctx(first, first.get(User, uid)))  # type: ignore[arg-type]
        # ``first`` holds the uncommitted insert; start the second now.
        result: dict[str, object] = {}

        def race() -> None:
            try:
                ctx = make_ctx(second, second.get(User, uid))  # type: ignore[arg-type]
                result["row"] = repo.settings_row(ctx)
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
        assert isinstance(row, FinanceSettings) and row.id == a.id
    finally:
        first.close()
        second.close()

    with Session(engine) as check:
        assert (
            len(
                check.exec(
                    select(FinanceSettings).where(FinanceSettings.owner_id == uid)
                ).all()
            )
            == 1
        )
        cats = check.exec(select(Category).where(Category.owner_id == uid)).all()
        names = [c.name for c in cats]
        assert names and len(names) == len(set(names)), "default categories seeded once"
