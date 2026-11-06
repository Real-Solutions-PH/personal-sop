"""Which module cards a Fern reply carries (``cards.relevant``).

Kai, 2026-11-06: a reply about money alone pulled up the nutrition card,
because the model called ``nutrition_status`` for a budget's "what is
left"."""

import pytest

from app.modules.companion import cards
from app.modules.companion.services import READ_TOOLS, WRITE_TOOLS

# (what was said, tools that ran, nutrition card?, finance card?)
CASES = [
    # Kai's turns: money only, with the model reaching for nutrition_status.
    ("how much do I have left this month?", ["nutrition_status"], False, False),
    (
        "how much do I have left in my budget?",
        ["nutrition_status", "finance_status"],
        False,
        True,
    ),
    ("spent 250 on grab", ["log_expense", "nutrition_status"], False, True),
    ("spent 200 on a protein shake", ["log_expense"], False, True),
    ("how much did I spend on food this week?", ["finance_status"], False, True),
    ("how much did I spend on food this week?", ["find_transactions"], False, True),
    ("paid my meralco bill", [], False, True),
    # Food turns.
    ("how are my macros today?", ["nutrition_status"], True, False),
    ("can you pull up my macros?", [], True, False),
    ("had adobo and rice for lunch", ["find_foods", "log_meal"], True, False),
    ("what's left for today?", ["nutrition_status"], True, False),
    # Both, when both were asked.
    (
        "how are my macros and my money?",
        ["nutrition_status", "finance_status"],
        True,
        True,
    ),
    ("lunch was 250 pesos, chicken inasal", ["log_meal", "log_expense"], True, True),
    # Neither.
    ("what's left on my tasks today?", [], False, False),
    ("did 3 sets of squats", ["log_workout", "nutrition_status"], False, False),
    ("remind me to buy lunch stuff", ["create_tasks"], False, False),
]


@pytest.mark.parametrize(("said", "called", "food", "money"), CASES)
def test_a_card_goes_only_with_a_turn_about_its_module(
    said: str, called: list[str], food: bool, money: bool
) -> None:
    assert cards.relevant("nutrition", said, called) is food
    assert cards.relevant("finance", said, called) is money


def test_the_cases_cover_both_answers_for_both_cards() -> None:
    """The table above would pass with a rule that always says no (or yes)
    unless it holds both answers for each card, from tools and from words."""
    for i in (2, 3):
        assert {c[i] for c in CASES} == {True, False}
    assert any(c[2] and not c[1] for c in CASES)  # food card from words alone
    assert any(c[3] and not c[1] for c in CASES)  # money card from words alone
    assert any(not c[2] and "nutrition_status" in c[1] for c in CASES)


def test_every_tool_the_rule_names_is_a_real_tool() -> None:
    every = WRITE_TOOLS | READ_TOOLS
    named = set(cards.OTHER_WRITES).union(*cards.TOOLS.values())
    named |= set(cards.STATUS_TOOL.values())
    assert named <= every, named - every
