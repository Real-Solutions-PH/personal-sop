"""Service-level tests at chosen instants: run timing and abandonment across
days, the stats contributor and the cross-module ``public.py`` contract."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, col, select

from app.modules.habits import public, reads
from app.modules.habits import services as svc
from app.modules.habits.models import Habit, HabitLog, RoutineStepResult
from app.modules.habits.schema import HabitCreate, RoutineCreate, StepIn
from app.modules.habits.stats import contributor
from app.modules.stats.contract import Window
from app.modules.stats.models import DailyModuleStat
from app.modules.stats.public import DIRTY_KEY
from app.shared.ids import derived_id
from tests.utils.mobile import ctx_for, signed_in

# Noon in Manila today, so every offset below stays clear of the 04:00 rollover.
_now = datetime.now(timezone.utc)
NOON = _now.replace(hour=4, minute=0, second=0, microsecond=0)
if NOON > _now:
    NOON -= timedelta(days=1)


def _backdate(session: Session, habit_id: uuid.UUID, days: int) -> None:
    row = session.get(Habit, habit_id)
    assert row is not None
    row.created_at = NOON - timedelta(days=days)
    session.add(row)
    session.commit()


def test_step_time_excludes_pauses_and_logs_minutes(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user, now=NOON) as ctx:
        h = svc.create_habit(
            ctx, data=HabitCreate(name="Stretch", type="duration", target=5)
        )
        r = svc.create_routine(
            ctx,
            data=RoutineCreate(name="AM", steps=[StepIn(habit_id=h.id, minutes=5)]),
        )
        run = svc.start_routine(ctx, routine_id=r.id)
        run_id, hid, rid = run.id, h.id, r.id
    with ctx_for(user, now=NOON + timedelta(minutes=2)) as ctx:
        svc.toggle_run_pause(ctx, run_id=run_id)
    with ctx_for(user, now=NOON + timedelta(minutes=5)) as ctx:
        svc.toggle_run_pause(ctx, run_id=run_id)
    with ctx_for(user, now=NOON + timedelta(minutes=9, seconds=40)) as ctx:
        state = reads.player(ctx, routine_id=rid)
        assert state is not None
        assert state.step_elapsed_sec == 6 * 60 + 40
        done = svc.step_done(ctx, run_id=run_id)
        assert done.state == "completed"
        res = ctx.session.exec(
            select(RoutineStepResult).where(RoutineStepResult.run_id == run_id)
        ).one()
        assert (res.status, res.actual_sec) == ("done", 400)
        log = ctx.session.exec(select(HabitLog).where(HabitLog.habit_id == hid)).one()
        # 400 s -> round(6.67) = 7 minutes: done against the 5-minute target.
        assert (log.value, log.status, log.source) == (7, "done", "routine")


def test_unfinished_run_reads_abandoned_next_day_and_is_settled_on_start(
    db: Session,
) -> None:
    user, _ = signed_in(db)
    yesterday = NOON - timedelta(days=1)
    with ctx_for(user, now=yesterday) as ctx:
        a = svc.create_habit(ctx, data=HabitCreate(name="A"))
        b = svc.create_habit(ctx, data=HabitCreate(name="B"))
        steps = [StepIn(habit_id=a.id, minutes=1), StepIn(habit_id=b.id, minutes=1)]
        r1 = svc.create_routine(ctx, data=RoutineCreate(name="One", steps=steps))
        r2 = svc.create_routine(ctx, data=RoutineCreate(name="Two", steps=steps))
        run = svc.start_routine(ctx, routine_id=r1.id)
        svc.step_done(ctx, run_id=run.id)
        svc.exit_routine(ctx, run_id=run.id)
        run_id, r2_id = run.id, r2.id
    with ctx_for(user, now=NOON) as ctx:
        summary = reads.run_summary(ctx, run_id=run_id)
        assert summary.state == "abandoned"
        window = Window(first=ctx.today - timedelta(days=1), last=ctx.today)
        misses = contributor.misses(ctx, window)
        assert [m.title for m in misses if m.kind == "abandoned"] == [
            "One abandoned at 1/2"
        ]
        svc.start_routine(ctx, routine_id=r2_id)
        rows = ctx.session.exec(
            select(RoutineStepResult)
            .where(RoutineStepResult.run_id == run_id)
            .order_by(col(RoutineStepResult.position))
        ).all()
        assert [(x.position, x.status) for x in rows] == [
            (0, "done"),
            (1, "not_reached"),
        ]
        assert reads.run_summary(ctx, run_id=run_id).run.state == "abandoned"


def test_stats_contributor(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user, now=NOON) as ctx:
        h = svc.create_habit(ctx, data=HabitCreate(name="Walk", icon="🚶"))
        other = svc.create_habit(ctx, data=HabitCreate(name="Floss"))
        hid, oid = h.id, other.id
        _backdate(ctx.session, hid, 10)
        _backdate(ctx.session, oid, 10)
        today = ctx.today
        for i in range(8):  # 8 straight days ending today
            svc.check_habit(ctx, habit_id=hid, day=today - timedelta(days=i))
        svc.skip_habit(ctx, habit_id=oid, day=today - timedelta(days=1))
        svc.check_habit(ctx, habit_id=oid, day=today)
        # Each write marked the day dirty; the stats module drained the marks
        # after commit into the daily rollup.
        rollup = ctx.session.exec(
            select(DailyModuleStat).where(
                DailyModuleStat.owner_id == ctx.user_id,
                DailyModuleStat.module == "habits",
                DailyModuleStat.day == today,
            )
        ).first()
        assert rollup is not None and rollup.done >= 2
        assert not ctx.session.info.get(DIRTY_KEY)

        week = Window(first=today - timedelta(days=6), last=today)
        prev = Window(first=today - timedelta(days=13), last=today - timedelta(days=7))
        # This week: Walk 7 done of 7; Floss 5 missed, 1 skipped, 1 done, so
        # 6 count. Rate = 8 / 13, skip rate = 1 / 14.
        assert contributor.area_rate(ctx, week) == 8 / 13
        progress = contributor.day_progress(ctx, [today, today - timedelta(days=1)])
        assert (progress[today].due, progress[today].done) == (2, 2)
        y = progress[today - timedelta(days=1)]
        assert (y.due, y.done) == (1, 1)  # the skipped Floss is not due

        metrics = {m.key: m for m in contributor.metrics(ctx, week, prev)}
        assert list(metrics) == [
            "habits.rate",
            "habits.streak",
            "habits.perfect",
            "habits.time",
            "habits.skip",
        ]
        assert metrics["habits.rate"].value == "62%"
        assert metrics["habits.streak"].value == "8-day"
        assert metrics["habits.streak"].label == "Top streak · Walk"
        assert metrics["habits.skip"].value == "7%"

        cal = contributor.calendar(ctx, Window(first=today, last=today))
        assert {(c.title, c.done) for c in cal} == {
            ("🚶 Walk", True),
            ("✅ Floss", True),
        }

        missed = contributor.misses(ctx, week)
        assert len([m for m in missed if m.kind == "missed"]) == 5

        ach = {a.id: a for a in contributor.achievements(ctx)}
        assert ach["habits-streak-7"].earned is True
        assert ach["habits-streak-7"].day == today - timedelta(days=1)
        assert ach["habits-streak-30"].earned is False
        assert ach["habits-streak-30"].progress_text == "8/30"

        facets = {f.key: f for f in contributor.facets(ctx, week, prev)}
        assert facets["habits"].value == 8 / 13
        assert facets["routines"].off is True


def test_public_contract(db: Session) -> None:
    user, _ = signed_in(db)
    workout_id = uuid.uuid4()
    with ctx_for(user, now=NOON) as ctx:
        gym = public.create_habit(ctx, name="Gym", days=[1, 3, 5], time="06:00")
        gym.link_workout = True
        lift = public.create_habit(ctx, name="Lift heavy", type="count", target=3)
        lift.link_workout = True
        public.create_habit(ctx, name="Read")
        ctx.session.commit()
        assert gym.schedule == [{"days": [1, 3, 5], "time": "06:00"}]

        assert [h.name for h in public.find_habits(ctx, "gym")] == ["Gym"]
        assert [h.name for h in public.find_habits(ctx, "lift heavy weights")] == [
            "Lift heavy"
        ]
        assert public.find_habits(ctx, "  ") == []

        logs = public.auto_check_workout_habits(
            ctx, day=ctx.today, workout_id=workout_id
        )
        assert {lg.id for lg in logs} == {
            derived_id("workout-habit", workout_id, str(gym.id)),
            derived_id("workout-habit", workout_id, str(lift.id)),
        }
        assert {(lg.status, lg.source, lg.value) for lg in logs} == {
            ("done", "workout", None),
            ("done", "workout", 3),
        }
        # Already done: a second workout leaves them alone.
        assert (
            public.auto_check_workout_habits(
                ctx, day=ctx.today, workout_id=uuid.uuid4()
            )
            == []
        )
        ctx.session.commit()

        r = svc.create_routine(ctx, data=RoutineCreate(name="Morning stack"))
        assert [x.name for x in public.find_routines(ctx, "morning")] == [
            "Morning stack"
        ]
        run = public.start_routine(ctx, routine_id=r.id)
        assert run.state == "completed"  # no steps: nothing to play

        log = public.log_habit(
            ctx, habit_id=lift.id, day=ctx.today, value=1, add=True, source="capture"
        )
        assert (log.value, log.status) == (4, "done")
        public.delete_log(ctx, log_id=log.id)
        restored = public.restore_log(ctx, log_id=log.id)
        assert restored.deleted_at is None
