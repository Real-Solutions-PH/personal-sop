"""Every nudge template: no loss-aversion copy, no emoji, a deep link
(docs/26-retention-algorithms.md §6)."""

import itertools
import re

from app.modules.retention.copy import Item, Message, render
from app.modules.retention.logic import LADDER

BANNED = (
    "at risk",
    "lose",
    "lost",
    "about to end",
    "don't break",
    "dont break",
    "you missed again",
    "missed again",
    "streak is at risk",
)
EMOJI = re.compile("[\U0001f000-\U0001faff☀-➿⬀-⯿️]")

ITEMS = (
    None,
    Item("habit", "3f2a", "Read 10 pages"),
    Item("task", "9c1d", "Call the dentist"),
    Item("habit", "77aa", "x" * 200),
)
KINDS = ("best_time", *LADDER.values())


def catalogue() -> list[Message]:
    out = []
    for kind, item, rest, way in itertools.product(
        KINDS, ITEMS, (False, True), (False, True)
    ):
        m = render(kind, name="Fern", item=item, rest_ready=rest, way_back_ready=way)
        if m is not None:
            out.append(m)
    return out


def test_the_catalogue_covers_every_kind() -> None:
    assert len(catalogue()) >= len(KINDS) * 4


def test_no_banned_word_or_emoji_in_any_template() -> None:
    for m in catalogue():
        text = f"{m.title} {m.body}".lower()
        for word in BANNED:
            assert word not in text, (word, m)
        assert not EMOJI.search(text), m


def test_banned_list_and_emoji_check_bite() -> None:
    """The sweep would catch the copy it replaces."""
    old = "🔥 Your 5-day streak is at risk"
    assert any(w in old.lower() for w in BANNED)
    assert EMOJI.search(old)


def test_every_template_has_a_deep_link() -> None:
    for m in catalogue():
        assert m.href.startswith("/"), m
        assert len(m.title) <= 120 and len(m.body) <= 500


def test_links_point_at_the_item() -> None:
    habit, task = ITEMS[1], ITEMS[2]
    assert render("best_time", name="Fern", item=habit).href == "/habits/3f2a"  # type: ignore[union-attr]
    assert render("ladder_3", name="Fern", item=task).href == "/tasks/task/9c1d"  # type: ignore[union-attr]
    assert render("ladder_14", name="Fern", item=None).href == "/me/settings"  # type: ignore[union-attr]


def test_uses_the_companions_current_name() -> None:
    assert render("ladder_14", name="Sprout", item=None).title == "Sprout"  # type: ignore[union-attr]


def test_needs_something_to_point_at() -> None:
    assert render("best_time", name="Fern", item=None) is None
    assert render("ladder_3", name="Fern", item=None) is None


def test_rest_day_and_way_back_lines_only_when_true() -> None:
    habit = ITEMS[1]
    on = render("best_time", name="Fern", item=habit, rest_ready=True)
    off = render("best_time", name="Fern", item=habit, rest_ready=False)
    assert on is not None and "Rest day ready" in on.body
    assert off is not None and "Rest day" not in off.body
    w = render("ladder_7", name="Fern", item=habit, way_back_ready=True)
    assert w is not None and "pause" in w.body
    n = render("ladder_7", name="Fern", item=habit, way_back_ready=False)
    assert n is not None and "pause" not in n.body
