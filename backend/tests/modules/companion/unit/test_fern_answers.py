"""The pure parts of how Fern answers: the job step, the portion planner,
the number check, the reply shaping and the period compare. Expected values
are worked out by hand in the comments, never by the code under test."""

from datetime import date

import pytest

from app.modules.companion import intent, numbers, portions, records, reply_format
from app.modules.companion.services import drop_confirm_how

# ---------------------------------------------------------------- the job


@pytest.mark.parametrize(
    ("said", "kind", "wants_portions"),
    [
        # The real messages from 2026-10-31 / 11-01.
        (
            "what should be my portioning in able to hit my protein. if cannot "
            "i can add my ON pea protein",
            "question",
            True,
        ),
        (
            "Give me the portion for the rice pinakbet and the tilapia and then "
            "what will be the estimated end result",
            "question",
            True,
        ),
        ("try again", "redo", False),
        ("answer?", "redo", False),
        ("that's wrong", "redo", False),
        ("you didn't answer my question", "redo", False),
        ("It is breakfast", "edit", False),
        ("yes log it ti note and push it tomorrow", "edit", False),
        ("how much protein do I have left?", "question", False),
        ("spent 250 on lunch at jollibee", "log", False),
        ("what should I eat for dinner", "plan", False),
        ("thanks", "chat", False),
    ],
)
def test_the_job_is_read_from_their_words(
    said: str, kind: str, wants_portions: bool
) -> None:
    job = intent.classify(said)
    assert job.kind == kind
    assert job.portions is wants_portions


def test_a_redo_names_the_message_it_redoes_and_the_answer_that_missed() -> None:
    note = intent.turn_note(
        intent.classify("try again"),
        previous_ask="Give me the portion for the rice and the tilapia",
        previous_answer="I logged the tilapia.",
    )
    assert "Job: redo" in note
    assert '"Give me the portion for the rice and the tilapia"' in note
    assert '"I logged the tilapia."' in note and "Do not repeat it" in note


def test_a_question_says_not_to_log_and_the_last_suggestion_is_not_repeated() -> None:
    note = intent.turn_note(
        intent.classify("how is my protein today?"),
        previous_answer="Logged.\nTry steamed chicken breast for dinner.",
    )
    assert "Do not log anything" in note
    assert '"Try steamed chicken breast for dinner."' in note


def test_a_photo_reading_does_not_change_the_job() -> None:
    said = "try again\n\n[Photo 1: fried tilapia, rice, pinakbet]"
    assert intent.classify(said).kind == "redo"


# ---------------------------------------------------------------- portions


def food(name: str, role: portions.Role | None = None) -> portions.Food:
    ref = portions.reference(name)
    assert ref is not None
    per100 = ref[1]
    return portions.Food(
        name=name,
        per100=per100,
        source="standard values",
        role=role or portions.infer_role(per100),
        serving_grams=30.0 if role == "extra" else None,
    )


def test_the_plate_is_sized_to_the_meal_budget() -> None:
    # Budget 600 kcal / 50 g protein. Pinakbet (75 kcal, 2.5 g P per 100 g)
    # is a side: 100 g. Protein still needed 47.5 g; fried tilapia has 24 g
    # per 100 g, so 197.9 g, rounded to 200 g = 360 kcal, 48 g P. Calories
    # left 600 - 75 - 360 = 165; rice has 1.3 kcal/g, so 126.9 g, rounded
    # to 125 g = 162.5 kcal, 3.375 g P.
    plate = [food("fried tilapia"), food("rice"), food("pinakbet")]
    p = portions.plan(plate, {"kcal": 600, "protein": 50})
    grams = {x.food.name: x.grams for x in p.portions}
    assert grams == {"fried tilapia": 200, "rice": 125, "pinakbet": 100}
    out = portions.result(
        p,
        budget={"kcal": 600, "protein": 50},
        left_before={"kcal": 1000, "protein": 60, "carbs": 150, "fat": 40},
    )
    # 360 + 162.5 + 75 = 597.5 kcal; 48 + 3.375 + 2.5 = 53.875 g protein.
    assert out["meal_total"]["kcal"] == 597.5
    assert out["meal_total"]["protein"] == 53.9
    # 1000 - 597.5 = 402.5; 60 - 53.875 = 6.125.
    assert out["left_today_after"]["kcal"] == 402.5
    assert out["left_today_after"]["protein"] == 6.1


def test_a_shake_tops_up_protein_only_when_the_food_cannot() -> None:
    # 120 g protein: tilapia caps at 350 g = 84 g P; pinakbet 2.5 g; short
    # 33.5 g. Pea protein: 30 g serving at 80 g/100 g = 24 g, so 2 servings.
    plate = [food("fried tilapia"), food("pinakbet"), food("pea protein", "extra")]
    p = portions.plan(plate, {"kcal": 2000, "protein": 120})
    shake = next(x for x in p.portions if x.food.name == "pea protein")
    assert (shake.grams, shake.servings) == (60, 2)
    # With enough fish the shake is left out and said so.
    p = portions.plan(plate, {"kcal": 2000, "protein": 50})
    assert all(x.food.name != "pea protein" for x in p.portions)
    assert "pea protein not needed: protein is covered" in p.notes


def test_no_calories_left_means_no_rice_and_it_says_so() -> None:
    plate = [food("fried tilapia"), food("rice")]
    p = portions.plan(plate, {"kcal": 100, "protein": 30})
    assert [x.food.name for x in p.portions] == ["fried tilapia"]
    assert "no calories left for rice" in p.notes


def test_unknown_foods_are_named_and_a_powder_is_an_extra() -> None:
    foods, unknown = portions.resolve(
        [
            {"name": "mystery stew"},
            {"name": "ON pea protein"},
            {"name": "laing", "kcal_per_100g": 150, "protein_per_100g": 4},
        ],
        lambda name: None,
    )
    assert unknown == ["mystery stew"]
    assert [(f.name, f.role, f.source) for f in foods] == [
        ("ON pea protein", "extra", "standard values"),
        ("laing", "carb", "estimate"),
    ]


def test_the_table_carries_every_food_the_total_and_what_is_left() -> None:
    p = portions.plan([food("chicken breast")], {"kcal": 500, "protein": 31})
    out = portions.result(
        p,
        budget={"kcal": 500, "protein": 31},
        left_before={"kcal": 2000, "protein": 31},
    )
    t = portions.table(out)
    # 31 g protein / 0.31 g per g = 100 g; 165 kcal, 31 g P, 0 g C, 3.6 g F.
    assert t["rows"] == [["chicken breast", "100 g", "165", "31", "0", "4"]]
    assert t["foot"][0] == ["Meal total", "", "165", "31", "0", "4"]
    # 2000 - 165 = 1,835 kcal; 31 - 31 = 0 g protein.
    assert t["foot"][1][:4] == ["Left today after", "", "1,835", "0"]


# ---------------------------------------------------------------- numbers


def test_a_left_figure_no_tool_returned_is_caught() -> None:
    # Live: "407 kcal and 116 g protein would be left" while the day said
    # 1,472 kcal and 116 g.
    tool = {"left": {"kcal": 1472.4, "protein": 115.6}}
    assert numbers.unmatched("407 kcal and 116 g protein would be left.", [tool]) == [
        407.0
    ]
    assert numbers.unmatched("1,472 kcal and 116 g protein left.", [tool]) == []


def test_a_near_figure_is_not_close_enough() -> None:
    assert numbers.unmatched(
        "948 eaten, 1,002 left.", [{"eaten": 948, "left": 999}]
    ) == [1002.0]
    # Rounding to tens is how people say it.
    assert numbers.unmatched("About 1,000 left.", [{"left": 999}]) == []


def test_suggestions_dates_and_small_counts_are_not_checked() -> None:
    answer = (
        "Try 150 g chicken breast with a cup of rice. "
        "On 2026-11-01 at 19:30 you logged 3 meals."
    )
    assert numbers.unmatched(answer, []) == []


def test_money_written_in_a_tool_string_backs_a_figure() -> None:
    tool = {"budgets": [{"name": "Food", "left": "₱1,580.50"}]}
    assert numbers.unmatched("Food has ₱1,580.50 left this month.", [tool]) == []


def test_sentences_with_unbacked_figures_go_but_never_the_whole_reply() -> None:
    answer = "You have 4,321 kcal left. Keep the rice small."
    assert numbers.drop_sentences_with(answer, [4321.0]) == "Keep the rice small."
    only = "You have 4,321 kcal left."
    assert numbers.drop_sentences_with(only, [4321.0]) == only


# ---------------------------------------------------------------- format


def test_lists_stay_and_a_table_becomes_a_block() -> None:
    raw = (
        "## Plan\n"
        "Here is the plate:\n\n"
        "| Food | Grams | kcal |\n|---|---:|---:|\n"
        "| **Tilapia** | 150 | 270 |\n| Rice | 120 | 156 |\n\n"
        "- Eat the fish first\n* then the rice\n1) drink water"
    )
    text, blocks = reply_format.shape(raw)
    assert text == (
        "Plan\nHere is the plate:\n\n• Eat the fish first\n• then the rice\n1. drink water"
    )
    assert blocks == [
        {
            "t": "table",
            "columns": ["Food", "Grams", "kcal"],
            "rows": [["Tilapia", "150", "270"], ["Rice", "120", "156"]],
        }
    ]


def test_a_lone_star_and_snake_case_survive() -> None:
    assert reply_format.shape("5 * 3 = 15 and snake_case_word")[0] == (
        "5 * 3 = 15 and snake_case_word"
    )


@pytest.mark.parametrize(
    ("answer", "kept"),
    [
        (
            "Lunch is logged and waiting for your OK; tap Confirm or just say confirm.",
            "Lunch is logged and waiting for your OK.",
        ),
        ("Saved 62.4 kg. Tap Confirm below to save it.", "Saved 62.4 kg."),
        ("Waiting for your OK.", "Waiting for your OK."),
    ],
)
def test_how_to_confirm_is_dropped_but_the_state_stays(answer: str, kept: str) -> None:
    assert drop_confirm_how(answer) == kept


# ---------------------------------------------------------------- compare


def test_periods_are_this_week_from_monday_and_the_week_before() -> None:
    wed = date(2026, 10, 28)
    assert records.periods(wed, "week", 7) == (
        date(2026, 10, 26),
        date(2026, 10, 28),
        date(2026, 10, 19),
        date(2026, 10, 25),
    )
    assert records.periods(wed, "month", 7)[2:] == (date(2026, 9, 1), date(2026, 9, 30))
    assert records.periods(wed, "days", 3) == (
        date(2026, 10, 26),
        date(2026, 10, 28),
        date(2026, 10, 23),
        date(2026, 10, 25),
    )


def test_a_compare_is_per_calendar_day_for_amounts_and_per_record_for_levels() -> None:
    this = {
        "average_per_calendar_day": {"kcal": 1800.0},
        "per_record": {"kg": {"average": 62.0}},
    }
    prev = {
        "average_per_calendar_day": {"kcal": 2000.0},
        "per_record": {"kg": {"average": 62.5}},
    }
    out = records.compare_summaries(this, prev)
    # 1800 - 2000 = -200 (-10 %); 62.0 - 62.5 = -0.5 (-0.8 %).
    assert out["delta"] == {"kcal": -200.0, "kg": -0.5}
    assert out["pct_change"] == {"kcal": -10.0, "kg": -0.8}


def test_both_averages_say_their_denominator() -> None:
    rows = [
        {"day": "2026-10-26", "kcal": 1000.0},
        {"day": "2026-10-27", "kcal": 2000.0},
    ]
    out = records.summarize(
        rows,
        metrics=["kcal"],
        group_by="none",
        first=date(2026, 10, 26),
        last=date(2026, 10, 29),
    )
    # 3000 over the 2 logged days, and over the 4 days of the range.
    assert out["average_per_logged_day"] == {"kcal": 1500.0}
    assert out["average_per_calendar_day"] == {"kcal": 750.0}
    assert "every day in the range" in out["which_average"]
