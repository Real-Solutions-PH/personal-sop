"""The grace-day run walk, a port of ``shared/prototype/lib/grace.ts``.

``True`` extends the run, ``None`` is neutral, ``False`` is a miss. A lone
miss is a grace day (bridged, not counted) when the next scored day is a hit,
or has not come yet; two misses in a row, or a second lone miss within
``GRACE_GAP_DAYS`` of the run's last grace day, end the run on that day.
``broken`` keeps ended runs of three days or more.
"""

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date

# Days a second grace day must wait after the first, within one run.
GRACE_GAP_DAYS = 7


@dataclass(frozen=True)
class RunWalk:
    current: int
    best: int
    broken: list[tuple[date, int]] = field(default_factory=list)
    grace_days: list[date] = field(default_factory=list)


def walk_run(
    steps: Iterable[tuple[date, bool | None]],
    on_hit: Callable[[date, int], None] | None = None,
) -> RunWalk:
    """``on_hit`` is called with each day the run grows on and its length."""
    best = 0
    run = 0
    grace: list[date] = []
    held: date | None = None
    broken: list[tuple[date, int]] = []
    for day, hit in steps:
        if hit is True:
            if held is not None:
                grace.append(held)
            held = None
            run += 1
            best = max(best, run)
            if on_hit is not None:
                on_hit(day, run)
        elif hit is False:
            last = grace[-1] if grace else None
            if (
                held is None
                and run > 0
                and (last is None or (day - last).days >= GRACE_GAP_DAYS)
            ):
                held = day
                continue
            if run >= 3:
                broken.append((day, run))
            run = 0
            grace = []
            held = None
    return RunWalk(
        current=run,
        best=best,
        broken=broken,
        grace_days=[*grace, held] if held is not None else grace,
    )


def grace_ready(current: int, grace_days: Sequence[date], today: date) -> bool:
    """A rest day is ready: a run is going and no grace day was used in the
    last ``GRACE_GAP_DAYS``, so a lone miss today would be bridged. The
    streak chip's "rest day ready"; port of ``graceReady`` in grace.ts."""
    if current <= 0:
        return False
    return not grace_days or (today - grace_days[-1]).days >= GRACE_GAP_DAYS
