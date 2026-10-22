"""Which tools a turn offers the model.

Every tool's schema is sent with every model call, and a reply takes two to
four calls, so 37 schemas (about 5,000 tokens) were most of each call's
input. A turn now offers the core tools plus the groups its words point to:
the message itself and the person's two messages before it, so "do it"
still reaches the tools of the turn it answers. A long message that names
no group, or one with photos, gets every tool, as does the corrective pass.
"""

import re

CORE = frozenset(
    {
        "show_chart",
        "show_insights",
        "coach",
        "plan_day",
        "track",
        "remember_fact",
        "recall_memories",
        "forget_fact",
        "show_memories",
        "suggest",
        "lookup",
        "web_search",
        "stats_overview",
        "confirm_pending",
        "discard_pending",
        "edit_last",
        "delete_last",
    }
)

GROUPS: dict[str, tuple[frozenset[str], re.Pattern[str]]] = {
    "money": (
        frozenset(
            {
                "log_expense",
                "log_income",
                "log_transfer",
                "add_planned",
                "create_account",
                "set_account_balance",
                "create_budget",
                "find_transactions",
                "edit_transaction",
                "list_scheduled",
                "edit_scheduled",
                "edit_account",
                "edit_budget",
                "remove_item",
            }
        ),
        re.compile(
            r"[₱$€]|\b(php|pesos?|usd|dollars?|paid|pay|payment|spent|spend|"
            r"bought|buy|cost|price|salary|income|earned|budget|accounts?|"
            r"gcash|maya|bank|bpi|bdo|transfer|bills?|balance|money|card|cash|"
            r"loan|owe|fee|subscription|expenses?|savings?)\b",
            re.I,
        ),
    ),
    "tasks": (
        frozenset(
            {
                "create_tasks",
                "complete_task",
                "create_task_list",
                "edit_task",
                "remove_item",
            }
        ),
        re.compile(
            r"\b(tasks?|to-?dos?|remind(er)?s?|list|deadline|due|meeting|"
            r"appointment|call|email|errands?|groceries|shopping|projects?|"
            r"schedule|tomorrow|tonight|later|next week|finish(ed)?|done)\b",
            re.I,
        ),
    ),
    "habits": (
        frozenset(
            {
                "log_habit",
                "create_habit",
                "update_habit",
                "create_routine",
                "update_routine",
                "start_routine",
                "remove_item",
            }
        ),
        re.compile(
            r"\b(habits?|routines?|meditat\w*|stretch\w*|streak|water|sleep|"
            r"woke|wake|morning|evening|daily|every day|check(ed)? off|did my)\b",
            re.I,
        ),
    ),
    "fitness": (
        frozenset(
            {
                "log_workout",
                "log_weigh_in",
                "log_meal",
                "create_workout_template",
                "nutrition_status",
                "find_fitness_logs",
                "remove_item",
                "save_food",
                "find_foods",
            }
        ),
        re.compile(
            r"\b(label|nutrition facts?|serving size|per serving|per 100 ?g|"
            r"ate|eat|eaten|eating|meals?|breakfast|lunch|dinner|snacks?|"
            r"food|kcal|calories?|protein|carbs?|fats?|fiber|sugar|sodium|"
            r"macros?|nutrition|workouts?|gym|run|ran|walk(ed)?|bike|swim|"
            r"lift(ed)?|bench|squat|deadlift|press|sets?|reps?|kg|lbs?|weigh\w*|"
            r"weight|body ?fat|train(ing)?|exercise|cardio|steps|drank|drink|"
            r"coffee|rice)\b",
            re.I,
        ),
    ),
    # Changing or removing something that exists, whatever its module:
    # the finders and every edit, so "fix that" or "delete the last one"
    # reaches them even when no module word is said.
    "manage": (
        frozenset(
            {
                "find_transactions",
                "edit_transaction",
                "list_scheduled",
                "edit_scheduled",
                "edit_account",
                "edit_budget",
                "edit_task",
                "update_habit",
                "update_routine",
                "find_fitness_logs",
                "remove_item",
            }
        ),
        re.compile(
            r"\b(edit|change|changed|update|move|moved|rename|fix|correct|wrong|"
            r"mistake|delete|remove|archive|cancel|undo|replace|switch|reassign|"
            r"palitan|burahin|ilipat|instead|actually|should (?:be|have been)|"
            r"not \d[\d,.]*)\b",
            re.I,
        ),
    ),
    "journal": (
        frozenset({"save_journal"}),
        re.compile(
            r"\b(journal|diary|feel|felt|feeling|mood|grateful|reflect\w*|"
            r"today was)\b",
            re.I,
        ),
    ),
}

# A message this long that names no group is likely about something the
# words above miss: offer everything rather than leave a tool out.
SHORT_WORDS = 10
# A request to write something that names no group ("add something to
# help") may need any write tool.
ASKS_TO_WRITE = re.compile(
    r"\b(add|create|log|record|set ?up|make|put|save|schedule|remind|track|"
    r"start|plan)\b",
    re.I,
)


def pick(text: str, earlier: list[str], *, photos: bool = False) -> set[str] | None:
    """The tool names this turn offers, or None for every tool."""
    if photos:
        return None
    said = " ".join([*earlier[-2:], text])
    names = set(CORE)
    hit = False
    for tools, words in GROUPS.values():
        if words.search(said):
            names |= tools
            hit = True
    if not hit and (len(text.split()) > SHORT_WORDS or ASKS_TO_WRITE.search(text)):
        return None
    return names
