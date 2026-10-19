"""The reads and the delete capture makes through habits' ``public.py``,
called inside a caller's use case (they flush, the caller commits)."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlmodel import Session

from app.modules.habits import logic, public
from app.modules.habits import services as svc
from app.modules.habits.schema import RoutineCreate, StepIn
from tests.utils.mobile import ctx_for, signed_in

# Noon in Manila today, so every offset below stays clear of the 04:00 rollover.
_now = datetime.now(timezone.utc)
NOON = _now.replace(hour=4, minute=0, second=0, microsecond=0)
if NOON > _now:
    NOON -= timedelta(days=1)


def test_lists_logs_streak_and_world(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user, now=NOON) as ctx:
        assert public.list_habits(ctx) == []
        assert public.list_routines(ctx) == []
        read = public.create_habit(ctx, name="Read")
        run = public.create_habit(ctx, name="Run", type="count", target=3)
        routine = svc.create_routine(
            ctx,
            data=RoutineCreate(name="AM", steps=[StepIn(habit_id=read.id, minutes=5)]),
        )
        ids = (read.id, run.id, routine.id)
        ctx.session.commit()
    read_id, run_id, routine_id = ids
    with ctx_for(user, now=NOON) as ctx:
        assert [h.id for h in public.list_habits(ctx)] == [read_id, run_id]
        assert [r.id for r in public.list_routines(ctx)] == [routine_id]

        assert public.get_log(ctx, habit_id=run_id, day=ctx.today) is None
        lg = public.log_habit(ctx, habit_id=run_id, day=ctx.today, value=2)
        got = public.get_log(ctx, habit_id=run_id, day=ctx.today)
        assert got is not None and got.id == lg.id
        assert (got.value, got.status) == (2, "partial")
        # Another day of the same habit is a different log.
        yesterday = ctx.today - timedelta(days=1)
        assert public.get_log(ctx, habit_id=run_id, day=yesterday) is None

        assert public.current_streak(ctx, habit_id=read_id) == 0
        public.log_habit(ctx, habit_id=read_id, day=ctx.today)
        assert public.current_streak(ctx, habit_id=read_id) == 1
        assert public.current_streak(ctx, habit_id=uuid.uuid4()) == 0

        w = public.load_world(ctx, since=ctx.today)
        assert set(w.views) == {read_id, run_id}
        assert w.idx[(str(read_id), ctx.today)].status == "done"
        assert public.logic is logic


def test_delete_habit_flushes_only(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user, now=NOON) as ctx:
        h = public.create_habit(ctx, name="Floss")
        public.log_habit(ctx, habit_id=h.id, day=ctx.today)
        hid = h.id
        ctx.session.commit()
    with ctx_for(user, now=NOON) as ctx:
        public.delete_habit(ctx, habit_id=hid)
        assert public.list_habits(ctx) == []
        assert public.get_log(ctx, habit_id=hid, day=ctx.today) is None
        ctx.session.rollback()  # the caller decides: nothing was committed
    with ctx_for(user, now=NOON) as ctx:
        assert [x.id for x in public.list_habits(ctx)] == [hid]
        public.delete_habit(ctx, habit_id=hid)
        ctx.session.commit()
    with ctx_for(user, now=NOON) as ctx:
        assert public.list_habits(ctx) == []
