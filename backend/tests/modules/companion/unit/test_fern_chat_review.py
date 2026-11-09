"""Fixes from the review of Sam's Fern chats of 2026-11-04 to 11-08. Each
input below is the real message or reply that went wrong (scrubbed), and
each expected value is read off that chat by hand, never from the code
under test."""

from typing import Any

import pytest
from pydantic import ValidationError

from app.modules.capture import agent, fitness_tools
from app.modules.companion import intent, loop, services
from app.modules.fitness import nutrient_check

# ------------------------------------------------- refused tool arguments

# The assumption Fern sent on 2026-11-08 for "100g pinoy spag": 143
# characters, so log_meal was refused twice as "invalid arguments".
LONG_ASSUMPTION = (
    "100 g · estimate, USDA 'Restaurant, family style, spaghetti and "
    "meatballs' as the last time you logged pinoy spag (sweet tomato sauce, "
    "no meat)"
)


def test_the_long_assumption_really_is_over_the_limit() -> None:
    # The fixture must exceed the limit, or the clip tests below prove nothing.
    assert len(LONG_ASSUMPTION) > fitness_tools.ASSUMPTION_MAX


@pytest.mark.parametrize("model", [agent.MealItemArgs, fitness_tools.ItemArgs])
def test_an_over_long_assumption_is_cut_not_refused(model: Any) -> None:
    item = model(name="Spaghetti", kcal=170, assumption=LONG_ASSUMPTION)
    assert item.assumption == LONG_ASSUMPTION[:120].rstrip()


def test_a_refused_call_says_which_field_and_why_without_the_values() -> None:
    secret = "my mother's ice cream"
    with pytest.raises(ValidationError) as exc:
        agent.JournalArgs(body=secret, area="work")  # type: ignore[arg-type]
    out = agent.invalid_arguments(exc.value)
    assert out["error"] == "invalid_arguments"
    assert [f["field"] for f in out["fix"]] == ["area"]
    assert out["fix"][0]["problem"] == "literal_error"
    # What the person said never goes back in the error.
    assert secret not in str(out) and "'work'" not in str(out)


def test_a_nested_field_names_its_path() -> None:
    with pytest.raises(ValidationError) as exc:
        agent.MealArgs(  # type: ignore[call-arg]
            description="Lunch", items=[{"name": "Rice", "kcal": -5}]
        )
    fields = [f["field"] for f in agent.invalid_arguments(exc.value)["fix"]]
    assert fields == ["items.0.kcal"]


def test_the_workflow_names_every_nutrient_log_meal_sends_back_for() -> None:
    # log_meal refused 8 meals in four days for soluble and insoluble fiber,
    # which the rules never listed.
    rules = " ".join(loop.WORKFLOW.split())
    for key in nutrient_check.DETAILS:
        word = nutrient_check.DETAIL_WORDS[key].removesuffix(" fiber")
        assert word in rules, key


# ----------------------------------------- saved, while it is still waiting

SPOTIFY = (
    "The Spotify recurring bill is now set on Maya for the 7th of every month "
    "(₱85, saved).\n\nSummary:\n• Today's Spotify ₱85 expense — logged on "
    "Maya.\n• Monthly Spotify ₱85 bill on the 7th — recurring, now assigned "
    "to Maya.\n\nAll set."
)
BOTH_SAVED = (
    "Both meals saved: lunch (pakbet, chicken breast, rice) and dinner "
    "(spaghetti, pancit with chicken, peaches, cheese pizza)."
)


@pytest.mark.parametrize("answer", [SPOTIFY, BOTH_SAVED])
def test_saved_over_cards_that_all_wait_is_caught(answer: str) -> None:
    assert services.saved_while_waiting(answer, {"a": "proposed", "b": "proposed"})


@pytest.mark.parametrize(
    ("answer", "states"),
    [
        # A card of this turn really saved.
        (BOTH_SAVED, {"a": "saved", "b": "proposed"}),
        # Nothing made this turn.
        (BOTH_SAVED, {}),
        # Says it is not saved yet.
        ("Logged, waiting for your OK before it's saved.", {"a": "proposed"}),
        ("Not saved yet: tap Confirm.", {"a": "proposed"}),
        ("It saves once you confirm.", {"a": "proposed"}),
    ],
)
def test_true_or_hedged_saves_are_left_alone(
    answer: str, states: dict[str, str]
) -> None:
    assert not services.saved_while_waiting(answer, states)


def test_the_save_claim_goes_and_the_wait_is_said() -> None:
    out = services.say_waiting(SPOTIFY)
    assert "saved" not in out and "All set" not in out
    assert "Today's Spotify ₱85 expense — logged on Maya." in out
    assert out.endswith(services.SAYS_WAITING)


# --------------------------------------- canned "nothing was saved" answers


def test_a_why_question_that_says_what_was_paid_is_not_a_write() -> None:
    # 2026-11-06: the answer was replaced by "I didn't manage to record that".
    asked = (
        "i already paid it why is still planned for today and why is there "
        "two planned payment now for netflix"
    )
    answer = "Netflix ₱449 was logged as today's expense and scheduled monthly."
    assert not services.unbacked_claim(asked, answer, [], waiting=False)


@pytest.mark.parametrize(
    "asked",
    [
        # Still a write when it says to write, or tells what was spent.
        "why didn't you log it? log my lunch",
        "spent 250 on lunch at jollibee",
    ],
)
def test_a_write_ask_with_no_write_is_still_caught(asked: str) -> None:
    assert services.unbacked_claim(asked, "Logged it.", [], waiting=False)


# ------------------------------------------------------------ confirmations


def test_record_this_confirms_what_waits() -> None:
    # 2026-11-05, right after the dinner was laid out: refused, and the reply
    # said nothing was waiting.
    assert services.said_confirm("record this for yesterdays dinner")
    assert services.said_confirm("log that")


def test_record_this_with_a_photo_means_the_photo() -> None:
    assert not services.said_confirm(
        "record this also\n[1 photo attached. What they show:\nPhoto 1 — receipt"
    )


# ------------------------------------------------------- thinking aloud

LEAKED = (
    "The Nov 5 pakbet record is just 75 kcal, 2.5 g protein per serving — that "
    "seems to be a small portion log, not a 150g reference. Let me skip the "
    "full macro math on pakbet and focus directly on the question: should he "
    "cut or add rice to make room for cake.\n\n"
    "Let me use the portion planner to give exact numbers. Current left: "
    "1121.8 kcal, 90.4g protein.\n\n"
    "Let me give a direct answer.\n\n"
    "Short answer: don't touch the rice — the bottleneck for cake is fat and "
    "sugar, not carbs.\n\n"
    "If you want the numbers for a specific slice, tell me and I'll size it. "
    "Let me know."
)


def test_working_notes_leave_the_reply_and_the_answer_stays() -> None:
    out = services.strip_internal(LEAKED)
    assert out == (
        "Short answer: don't touch the rice — the bottleneck for cake is fat "
        "and sugar, not carbs.\n\n"
        "If you want the numbers for a specific slice, tell me and I'll size "
        "it. Let me know."
    )


def test_a_reply_without_working_notes_is_unchanged() -> None:
    text = "Let me know which pizza it was.\n\nLogged: 34 g pizza, 113 kcal."
    assert services.strip_internal(text) == text


# --------------------------------------------------------------- memories


@pytest.mark.parametrize(
    "fact",
    [
        "I don't have enough context here — this refers to an edit task I "
        "don't have details on.",
        "I'm not sure what they meant.",
        "The message refers to a second dinner.",
    ],
)
def test_a_memory_about_the_assistant_is_not_about_them(fact: str) -> None:
    assert not services.about_them(fact)


@pytest.mark.parametrize(
    "fact",
    [
        "Protein is the highest priority in their diet every single day.",
        "Categorizes food-related gym expenses under a specific Gym Food category.",
        "Is in the gym most mornings.",
    ],
)
def test_a_memory_about_them_passes(fact: str) -> None:
    assert services.about_them(fact)


# -------------------------------------------------------- portion budget


def _plan(**kw: Any) -> services.PortionPlanArgs:
    return services.PortionPlanArgs(foods=[{"name": "Rice", "role": "carb"}], **kw)


def test_their_calorie_margin_widens_the_calories_only() -> None:
    # 2026-11-08 19:50: 185 kcal and 13.7 g protein left; Sam keeps "protein
    # first, about 200 kcal over at most". 185 + 200 = 385.
    left = {"kcal": 185, "protein": 13.7}
    budget = services.plan_budget(
        _plan(whole_day=True, kcal_over_ok=200), left, share=1
    )
    assert budget == {"kcal": 385, "protein": 13.7}


def test_without_a_margin_the_budget_is_what_is_left() -> None:
    left = {"kcal": 185, "protein": 13.7}
    assert services.plan_budget(_plan(whole_day=True), left, share=1) == {
        "kcal": 185,
        "protein": 13.7,
    }


def test_a_named_calorie_target_is_not_widened() -> None:
    budget = services.plan_budget(
        _plan(kcal=500, kcal_over_ok=200), {"kcal": 185, "protein": 10}, share=1
    )
    assert budget["kcal"] == 500


# --------------------------------------------------- one bill, planned once


def test_the_same_bill_is_one_plan() -> None:
    # Netflix ₱449 asked for as recurring on 2026-11-06, added twice.
    assert agent.same_plan("Netflix", 44900, ("netflix ", 44900))
    assert agent.same_plan("Netflix  monthly", 44900, ("Netflix monthly", 44900))


def test_another_amount_or_name_is_another_plan() -> None:
    assert not agent.same_plan("Netflix", 44900, ("Netflix", 54900))
    assert not agent.same_plan("Netflix", 44900, ("Spotify", 44900))


# ------------------------------------------------------------ the job


@pytest.mark.parametrize(
    "said",
    [
        # 2026-11-07: read as a portions question, so the reply's claim of
        # an edit no tool made was never checked.
        "Hey Fern, add 36 g of fried laptop tilapia the hundred grams of "
        "peaches that I have eaten eaten yesterday",
        "log 100 grams of rice for lunch",
    ],
)
def test_an_amount_in_grams_is_a_log_not_a_portions_question(said: str) -> None:
    job = intent.classify(said)
    assert job.kind == "log" and not job.portions


def test_asking_for_grams_is_still_a_portions_question() -> None:
    assert intent.classify("grams of rice for dinner to hit my protein").portions
