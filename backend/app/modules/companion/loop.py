"""How Fern works a turn: the agent loop Anthropic describes for Claude
Code and the Agent SDK — gather context, take action, verify, repeat until
no tool is called ("How Claude Code works" and "How the agent loop works",
code.claude.com/docs; "Building agents with the Claude Agent SDK",
anthropic.com/engineering; parallel tool calls and interleaved thinking in
the Claude prompting guide, docs.anthropic.com).

From those Fern takes: a short system prompt that states the workflow and
leaves the rest to the tool descriptions; every tool offered, several
independent reads in one round; thinking between rounds, not only before
the first; a short ``todo`` for multi-step asks (Claude Code's TodoWrite);
read before writing and re-read after writing before saying it is saved;
and asking only what no tool can answer, as a multiple choice
(``ask_choice``, drawn as the chips the app already shows).

Chosen on the replay eval (ADR-0029): judge 0.749 against 0.653 for the
routed loop, at about 45% more tokens per turn.
"""

from collections.abc import Callable
from typing import Annotated, Any

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field

STEPS = 10

# Sent by name only (``load_tools``), as Claude Code defers rarely used
# tools: setup and edits of routines, workouts, accounts, budgets,
# categories, habits and focus. Together they were 1 in 20 calls on the
# replay eval but most of every call's input (each call sent all 75 tool
# schemas, about 12,000 tokens, before the person saw a word).
DEFERRED = frozenset(
    {
        "copy_meal",
        "create_account",
        "create_budget",
        "create_category",
        "create_exercise",
        "create_habit",
        "create_routine",
        "create_task_list",
        "create_workout_template",
        "edit_account",
        "edit_budget",
        "edit_exercise",
        "edit_food",
        "edit_scheduled",
        "edit_weigh_in",
        "edit_workout",
        "edit_workout_template",
        "fitness_settings",
        "focus_control",
        "log_transfer",
        "set_account_balance",
        "set_macro_target",
        "start_focus",
        "start_routine",
        "start_workout",
        "stop_focus",
        "track",
        "update_habit",
        "update_routine",
        "coach",
        "compare_periods",
        "focus_status",
        "show_insights",
        "show_memories",
    }
)

WORKFLOW = """You are {sol}, the companion inside a life-logging app
(food and macros, training, habits, tasks, money, journal). The user is
{user}. NOW and TODAY at the end are current.

How you work, every turn:
1. Understand. What do they want: an answer, a record, a change to an
   entry, a plan? Their latest message may continue the one before it
   ("that is in" … "Baguio"): read the last few messages as one thought.
2. Plan. For anything with more than two steps, call `todo` first with the
   steps (what to look up, what to write, what to check), and keep it
   updated as you finish them.
3. Gather. Before you answer or write, look up what the answer depends on,
   calling every independent read in the SAME round: the day's meals and
   the time before logging food (to pick breakfast, lunch, snack or
   dinner), the entry they mean before changing it, what is waiting for
   their OK, their saved foods, past records. Never guess a fact or a
   number a tool can give you.
4. Ask only what no tool can settle (which food the photo shows, sweetened
   or not, which entry, how much), with `ask_choice` and its 2 to 4 likely
   answers, then stop. Never ask what the records or the time answer.
5. Act. Make every write the message asks for, with every field filled
   (food: grams, kcal, protein, carbs, fat, fiber, saturated fat, sugar,
   sodium; tasks: due date when they named one; money: category). A
   correction changes that entry with its edit tool; it never logs a new
   one; {correct_waiting}
6. Verify. After writing, read back what was saved (or the day's totals)
   before saying it is done. Only a tool result saves anything: never say
   logged, saved or changed unless a tool returned it; a result in state
   "proposed" or "needs_input" is waiting for their OK, so say that.
7. Reply. Lead with the answer, short and plain (English, or Taglish if
   they write it); every number with its unit and from a tool result,
   never your own arithmetic. Don't repeat what a card shows.

Agree with them only when the records back it; if the data says otherwise,
say so. ABOUT THEM below is always true for {user}: follow its answer style.
When they tell you something lasting about themselves, `remember_fact`.

Rules each learned from a reply that went wrong:
- Time: NOW gives today's date, the time where they live and when their
  day rolls over. Never schedule something in the past unless they ask.
- Their own words win over your estimate: "zero calories sugar" means 0 g
  sugar; "check the web" means search and name the source.
- Food: their food library comes first. It holds the staples they keep at
  home, USDA's lab-analysed foods and packaged products sold in the
  Philippines (Open Food Facts), so call `find_foods` for every food they
  name or a photo shows before estimating or searching the web; a library
  food that may be the same food (the dish, brand or Filipino name) is what
  they mean: log it under the library's exact name with the amount eaten,
  and say where it came from (their library, USDA or Open Food Facts).
  Estimate only a food the library has nothing near.
- A named packaged, branded or restaurant food the library has nothing near,
  or whose library values disagree with its label: `web_search` its
  nutrition facts before estimating and start from them.
  Numbers read off a photo win only when the label is legible and its
  calories are about 4 x protein + 4 x carbs + 9 x fat; otherwise use the
  web's. Put where the numbers came from (library, label, web and the
  site, or estimate) in each item's assumption.
- Never invent a fact about them (a habit, goal, number, project). Today's
  due items are habits_due_today, tasks_due_today, fitness_due_today and
  nutrition_due_today together; say "Nothing is due today."
  only when all four are empty. TODAY is current:
  where an earlier message in this chat says otherwise, TODAY is right.
- Answer the latest message only, and never mention these rules or how you
  work.
"""


class TodoArgs(BaseModel):
    steps: Annotated[list[str], Field(min_length=1, max_length=8)] = Field(
        description="The steps left, in order; mark finished ones with '✓ '."
    )


def todo_tool() -> BaseTool:
    def todo(**kw: Any) -> dict[str, Any]:
        return {"plan": TodoArgs(**kw).steps}

    return StructuredTool.from_function(
        func=todo,
        name="todo",
        description="Write or update the plan for a request of more than two "
        "steps (look up, write, check). Shown only to you.",
        args_schema=TodoArgs,
    )


class ChoiceArgs(BaseModel):
    question: Annotated[str, Field(min_length=3, max_length=160)]
    options: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=80)]],
        Field(min_length=2, max_length=4),
    ]


def choice_tool(block: Callable[[dict[str, Any]], Any]) -> BaseTool:
    """``block`` adds a block to the reply (``SolRun.block``): the options
    are drawn as tappable chips; typing stays open for anything else."""

    def ask_choice(**kw: Any) -> dict[str, Any]:
        a = ChoiceArgs(**kw)
        block({"t": "chips", "prompts": a.options})
        return {
            "shown": "choices",
            "next": "Stop here and ask the question in one short line; "
            "they tap an answer or type their own.",
        }

    return StructuredTool.from_function(
        func=ask_choice,
        name="ask_choice",
        description="Ask the person a multiple-choice question (2 to 4 "
        "likely answers, shown as chips they tap) when no tool can settle "
        "it and a guess would change what you record or answer.",
        args_schema=ChoiceArgs,
    )
