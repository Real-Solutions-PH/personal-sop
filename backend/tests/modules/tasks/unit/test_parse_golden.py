"""``parse.py`` against the prototype's parser over a phrase grid."""

from typing import Any

import pytest

from app.modules.tasks.parse import parse_task, split_capture, valid_day
from tests.modules.tasks.golden import load

DATA = load("tasks-parse")["data"]


@pytest.mark.parametrize("case", DATA["parse"], ids=lambda c: f"{c['tk']}:{c['text']}")
def test_parse_task(case: dict[str, Any]) -> None:
    got = parse_task(case["text"], case["tk"])
    want = case["parsed"]
    assert {
        "title": got.title,
        "dueDate": got.due_date,
        "dueTime": got.due_time,
        "recurrence": got.recurrence,
        "matched": got.matched,
    } == want


@pytest.mark.parametrize(
    "case", DATA["split"], ids=lambda c: f"{c['text'][:30]}|{','.join(c['lists'])}"
)
def test_split_capture(case: dict[str, Any]) -> None:
    # The prototype parses each part against the real today; the fixture was
    # recorded at the frozen clock.
    got = split_capture(case["text"], "2026-10-18", "capture-voice", case["lists"])
    assert [
        {
            "title": d.title,
            "dueDate": d.due_date,
            "dueTime": d.due_time,
            "recurrence": d.recurrence,
            "matched": d.matched,
            "listId": d.list_key,
            "source": d.source,
            "vague": d.vague,
        }
        for d in got
    ] == case["drafts"]


def test_impossible_dates_are_not_stored() -> None:
    assert valid_day("2026-11-45") is None
    assert valid_day(None) is None
    assert valid_day("2028-02-29") is not None
