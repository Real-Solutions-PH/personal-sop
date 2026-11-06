"""Which module cards (nutrition, finance) a Fern reply carries.

Kai, 2026-11-06: a reply about money alone pulled up the nutrition card.
The model calls ``nutrition_status`` whenever a question reads like "what is
left" (a budget's left reads the same as the day's macros), and every call
drew the card. A card now goes with a reply only when the turn is about its
module:

- a tool of that module ran (it logged, edited or looked up meals or money):
  always;
- otherwise the person's words name the module, and the turn used no tool of
  another module ("spent 200 on a protein shake" is money, not food), nor
  only another module's status tool;
- otherwise only the module's own status tool ran (``nutrition_status``,
  ``finance_status``), and neither the words nor any tool of the turn point
  at another module.

Pure: the caller passes what was said and the names of the tools that ran.
"""

import re
from collections.abc import Iterable
from typing import Literal

Card = Literal["nutrition", "finance"]

# Tools that show the turn is about the module (writes and its own reads),
# leaving out the status tool that draws the card itself.
TOOLS: dict[Card, frozenset[str]] = {
    "nutrition": frozenset(
        {
            "log_meal",
            "edit_meal",
            "copy_meal",
            "save_food",
            "edit_food",
            "find_foods",
            "portion_plan",
            "set_macro_target",
        }
    ),
    "finance": frozenset(
        {
            "log_expense",
            "log_income",
            "log_transfer",
            "add_planned",
            "create_account",
            "set_account_balance",
            "create_budget",
            "create_category",
            "edit_transaction",
            "edit_scheduled",
            "edit_account",
            "edit_budget",
            "find_transactions",
            "list_scheduled",
        }
    ),
}
STATUS_TOOL: dict[Card, str] = {
    "nutrition": "nutrition_status",
    "finance": "finance_status",
}
# Writes into the other modules: a turn that made one is about that module.
OTHER_WRITES = frozenset(
    {
        "create_tasks",
        "complete_task",
        "edit_task",
        "create_task_list",
        "log_habit",
        "create_habit",
        "update_habit",
        "create_routine",
        "update_routine",
        "start_routine",
        "create_workout_template",
        "edit_workout_template",
        "log_workout",
        "edit_workout",
        "start_workout",
        "create_exercise",
        "edit_exercise",
        "log_weigh_in",
        "edit_weigh_in",
        "fitness_settings",
        "save_journal",
        "start_focus",
        "focus_control",
        "stop_focus",
    }
)

# The day's food: macros, calories, nutrition, what is left to eat, meals.
ABOUT: dict[Card, re.Pattern[str]] = {
    "nutrition": re.compile(
        r"\b(macros?|calories|kcal|protein|carbs|nutrition(al)?|"
        r"sat(urated)? fat|sodium|fiber|left to eat|meals?|food|"
        r"ate|eat(en|ing)?|breakfast|lunch|dinner|snacks?)\b",
        re.I,
    ),
    "finance": re.compile(
        r"(₱|\b(php|pesos?|money|spen[dt]|spending|budgets?|expenses?|"
        r"income|salary|sweldo|bills?|pa(y|id)|payments?|owe|debts?|loans?|"
        r"savings?|balances?|accounts?|net worth|cash|wallet|bank|gcash|"
        r"maya|transfer(red)?|bought|purchases?|gastos|bayad|pera|afford|"
        # Food is counted by the day; a month's "left" is the budget's.
        r"(this|per|a|the) month|monthly)\b)",
        re.I,
    ),
}


def _others(card: Card) -> list[Card]:
    return [c for c in TOOLS if c != card]


def relevant(card: Card, said: str, called: Iterable[str]) -> bool:
    """Whether this turn is about ``card``'s module (module docstring)."""
    ran = set(called)
    if ran & TOOLS[card]:
        return True
    other_tools = set(OTHER_WRITES).union(*(TOOLS[c] for c in _others(card)))
    if ran & other_tools:
        return False
    own_status = STATUS_TOOL[card] in ran
    other_status = {STATUS_TOOL[c] for c in _others(card)}
    if ABOUT[card].search(said):
        # "How much did I spend on food?" answered from finance_status
        # alone: the food is the money's category, not the day's macros.
        return own_status or not ran & other_status
    if not own_status:
        return False
    return not (ran & other_status or any(ABOUT[c].search(said) for c in _others(card)))
