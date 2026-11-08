"""The grace-day run walk's milestone callback: each run length as it is
reached, a bridged day neither counting nor resetting."""

from datetime import date

from app.shared.grace import walk_run


def test_on_hit_reports_run_lengths_through_a_grace_day() -> None:
    hits: list[tuple[date, int]] = []
    walk_run(
        [
            (date(2026, 11, 1), True),
            (date(2026, 11, 2), True),
            (date(2026, 11, 3), False),
            (date(2026, 11, 4), True),
        ],
        on_hit=lambda d, n: hits.append((d, n)),
    )
    assert hits == [
        (date(2026, 11, 1), 1),
        (date(2026, 11, 2), 2),
        (date(2026, 11, 4), 3),
    ]
