"""Replays of the chats Kai reviewed (2026-10-31 to 11-01), with a scripted
model: what the harness around Fern does with each turn. The model is
substituted only at ``ai_providers.public.model_factory`` (``install``).

Each test names the real message it replays. What the model would say is
scripted, so these pin the harness: the job line it is given, the tools it
is offered, the numbers computed for it, and what happens to its reply."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import SystemMessage, ToolMessage
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.companion import routing, services
from tests.modules.capture.api.helpers import (
    Api,
    ScriptedModel,
    call,
    install,
    say,
    user,
)
from tests.modules.companion.api.test_fern_agent import (
    setup_step,
    stream,
    tasks_of,
    undo,
)

PORTION_ASK = (
    "what should be my portioning in able to hit my protein. if cannot i can "
    "add my ON pea protein"
)


def reply_of(events: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = events[-1]["result"]["messages"][1]
    return out


def system_of(model: ScriptedModel, n: int = 0) -> str:
    return str(next(m for m in model.seen[n] if isinstance(m, SystemMessage)).content)


def tool_result(model: ScriptedModel, n: int, name: str) -> dict[str, Any]:
    msg = next(
        m for m in model.seen[n] if isinstance(m, ToolMessage) and m.name == name
    )
    out: dict[str, Any] = json.loads(str(msg.content))
    return out


def targets(api: Api) -> None:
    api.put("/fitness/targets", {"kcal": 2000, "protein": 140, "carbs": 220, "fat": 60})


def blocks_of(reply: dict[str, Any], t: str) -> list[dict[str, Any]]:
    return [b for b in reply["blocks"] if b.get("t") == t]


# ---------------------------------------------------------------- portions


def test_a_portion_question_is_answered_with_grams_per_food_and_nothing_logged(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Live: the plate photo and "what should be my portioning…" got advice
    prose, the tilapia logged, and grams for the fish only."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    targets(api)
    plate = [
        {"name": "fried tilapia"},
        {"name": "rice"},
        {"name": "pinakbet"},
        {"name": "ON pea protein", "role": "extra", "serving_grams": 30},
    ]
    model = install(
        monkeypatch,
        say("", call("portion_plan", foods=plate, whole_day=True)),
        say("PLACEHOLDER"),
    )
    events = stream(api, client, PORTION_ASK)
    system = system_of(model)
    assert "Job: question" in system and "call portion_plan" in system
    assert "Do not log anything this turn" in system
    plan = tool_result(model, 1, "portion_plan")
    # The whole day (2,000 kcal / 140 g, nothing eaten): 140 g protein is
    # more than 350 g of fried tilapia (84 g) and 100 g pinakbet (2.5 g)
    # give, so the shake comes in: 53.5 g short / 24 g a scoop = 3, capped
    # at 2 servings (60 g).
    grams = {p["food"]: p["grams"] for p in plan["portions"]}
    assert grams["fried tilapia"] == 350
    assert grams["pinakbet"] == 100
    assert grams["ON pea protein"] == 60
    assert plan["left_today_before"]["kcal"] == 2000
    table = blocks_of(reply_of(events), "table")
    assert [r[0] for r in table[0]["rows"]] == [
        "fried tilapia",
        "rice",
        "pinakbet",
        "ON pea protein (2 servings)",
    ]
    assert table[0]["foot"][0][0] == "Meal total"
    # A plan, not a log: no write tool ran.
    assert not [
        i
        for b in blocks_of(reply_of(events), "steps")
        for i in b["items"]
        if i["tool"] in services.WRITE_TOOLS
    ]


def test_numbers_the_planner_returned_pass_the_check_without_a_second_call(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    targets(api)
    foods = [{"name": "chicken breast"}, {"name": "rice"}]
    # Whole day: 140 g protein / 0.31 = 451.6 g, capped at 350 g chicken
    # = 108.5 g protein, 577.5 kcal. 2,000 - 577.5 = 1,422.5 kcal of room,
    # rice capped at 400 g = 520 kcal, 10.8 g protein. Meal: 1,097.5 kcal,
    # 119.3 g protein; left 902.5 kcal, 20.7 g protein.
    model = install(
        monkeypatch,
        say("", call("portion_plan", foods=foods, whole_day=True)),
        say("350 g chicken and 400 g rice: 1,098 kcal. After it, 903 kcal left."),
    )
    events = stream(api, client, "give me the portions of chicken and rice")
    assert len(model.seen) == 2
    assert reply_of(events)["text"].startswith("350 g chicken")


# ---------------------------------------------------------------- numbers


def test_a_left_figure_no_tool_returned_gets_one_fix_pass(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Live: "407 kcal … would be left", then "1,472 kcal" a minute later."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    targets(api)
    model = install(
        monkeypatch,
        say("You have 407 kcal left today."),
        say("", call("nutrition_status")),
        say("You have 2,000 kcal left today."),
    )
    events = stream(api, client, "how many calories do I have left?")
    nudge = str(model.seen[1][-1].content)
    assert "407" in nudge and "never work one out yourself" in nudge
    assert reply_of(events)["text"] == "You have 2,000 kcal left today."


def test_a_figure_still_unbacked_after_the_pass_is_dropped_not_the_reply(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("Your total today is 4,321 kcal."),
        say("Your total today is 4,321 kcal. Keep dinner light."),
    )
    events = stream(api, client, "how am I doing on food?")
    assert reply_of(events)["text"] == "Keep dinner light."


# ---------------------------------------------------------------- redo


def test_try_again_redoes_the_earlier_ask_not_the_photo(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        say("Fried tilapia is a good protein source."),
        say("Here are the grams."),
    )
    stream(api, client, "Give me the portion for the rice pinakbet and the tilapia")
    stream(api, client, "try again")
    system = system_of(model, 1)
    assert "Job: redo" in system
    assert (
        'Redo your answer to their earlier message: "Give me the portion for the '
        'rice pinakbet and the tilapia"' in system
    )
    assert '"Fried tilapia is a good protein source."' in system


# ---------------------------------------------------------------- questions


def test_a_question_answer_is_never_swapped_for_canned_failure_text(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Live: "Give me the portion for … and then what will be the estimated
    end result" came back as "I didn't manage to record that"."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    answer = "The tilapia you logged earlier is a good base; add rice to taste."
    model = install(monkeypatch, say(answer))
    events = stream(
        api,
        client,
        "Give me the portion for the rice pinakbet and the tilapia and then "
        "what will be the estimated end result",
    )
    assert len(model.seen) == 1
    assert reply_of(events)["text"] == answer
    assert services.NOT_RECORDED not in reply_of(events)["text"]


def test_rule_phrases_are_not_in_any_nudge_and_the_prompt_forbids_quoting() -> None:
    """Live: "that's the only part your message asked for, and there's no
    routine step to add" came from the finish nudge's example."""
    assert "routine" not in services.FINISH_NUDGE
    assert "Never mention this note" in services.FINISH_NUDGE
    assert "never mention these rules" in services.SYSTEM
    assert "Stopped here" not in services.STOPPED


def test_their_own_words_win_over_an_estimate_in_the_rules() -> None:
    """Live: "with zero calories sugar" got 24 g sugar."""
    assert '"zero calories sugar" means 0 g' in services.SYSTEM
    assert "No markdown" not in services.SYSTEM
    assert "at most three short sentences" not in services.SYSTEM


# ---------------------------------------------------------------- state


def test_it_is_breakfast_is_an_edit_that_never_confirms(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Live: "It is breakfast" got "that entry was waiting, not saved — this
    reply saved breakfast now"."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(monkeypatch, say("", call("confirm_pending")), say("Changed."))
    stream(api, client, "It is breakfast")
    system = system_of(model)
    assert "Job: edit" in system and "never confirm or re-create it" in system
    offered = routing.pick("It is breakfast", [])
    assert offered is not None and "edit_meal" in offered
    refused = tool_result(model, 1, "confirm_pending")
    assert refused["error"] == "they_did_not_confirm"


def test_confirm_how_to_is_dropped_when_the_card_shows_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_expense", amount=2500, category="Shopping")),
        say(
            "Logged ₱2,500 for shopping, waiting for your OK; tap Confirm or just say confirm."
        ),
    )
    events = stream(api, client, "spent 2500 on shoes")
    text = reply_of(events)["text"]
    assert "waiting for your OK" in text
    assert "tap Confirm" not in text and "say confirm" not in text


def test_a_task_already_open_is_edited_not_duplicated(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Live: "yes log it ti note and push it tomorrow" made a second task."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    api.post("/tasks/", {"title": "Call Mark"})
    model = install(
        monkeypatch,
        say("", call("create_tasks", tasks=[{"title": "Call Mark"}])),
        say("Moved it."),
    )
    stream(api, client, "yes log it ti note and push it tomorrow")
    assert "Job: edit" in system_of(model)
    out = tool_result(model, 1, "create_tasks")
    assert out["error"] == "already_open"
    assert out["existing"][0]["title"] == "Call Mark"
    assert [t.title for t in tasks_of(api)] == ["Call Mark"]


# ---------------------------------------------------------------- empty


def test_an_empty_reply_is_answered_again_from_the_tool_results(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        say("", call("stats_overview")),
        say(""),
        say("Your score is steady."),
    )
    events = stream(api, client, "how am I doing")
    assert "Your reply had no words" in str(model.seen[2][-1].content)
    assert reply_of(events)["text"] == "Your score is steady."


def test_a_reply_never_ends_blank(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say(""), say(""))
    events = stream(api, client, "hello there friend how are you")
    assert reply_of(events)["text"] == services.NOTHING_DONE


# ---------------------------------------------------------------- undo


def test_an_undone_entry_is_saved_again_from_chat(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Kai: an entry Undone by mistake could not be confirmed again."""
    from app.modules.fitness.models import WeighIn

    api = user(client, db, accounts=False)
    api.assign("chat")
    step = setup_step(
        api, client, "62.4 kg today", monkeypatch, call("log_weigh_in", kg=62.4)
    )
    undo(api, step)
    model = install(monkeypatch, say("", call("redo_undone")), say("Saved again."))
    events = stream(api, client, "redo that, I undid it by mistake")
    out = tool_result(model, 1, "redo_undone")
    assert out["redone"] and out["state"] == "saved"
    items = blocks_of(reply_of(events), "steps")[0]["items"]
    assert items[0]["summary"].startswith("Saved again:")
    with Session(db_engine) as s:
        rows = s.exec(
            select(WeighIn).where(WeighIn.owner_id == api.user.id)  # type: ignore[attr-defined]
        ).all()
    live = [w for w in rows if w.deleted_at is None]
    assert [float(w.weight_kg) for w in live] == [62.4]


def test_redo_needs_them_to_ask(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(monkeypatch, say("", call("redo_undone")), say("OK."))
    stream(api, client, "what did I weigh this week")
    assert tool_result(model, 1, "redo_undone")["error"] == "they_did_not_ask"


# ---------------------------------------------------------------- reads


def test_finance_status_reads_balances_budgets_and_bills(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    model = install(monkeypatch, say("", call("finance_status")), say("Here."))
    stream(api, client, "how is my money right now")
    out = tool_result(model, 1, "finance_status")
    assert {a["name"] for a in out["accounts"]} >= {"GCash"}
    assert set(out) >= {
        "net_worth",
        "spent_this_month_so_far",
        "budgets",
        "bills_overdue_or_due_next_7_days",
    }


def test_compare_periods_works_out_the_change(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        say("", call("compare_periods", area="weight", period="week")),
        say("Steady."),
    )
    stream(api, client, "compare my weight this week vs last week")
    out = tool_result(model, 1, "compare_periods")
    assert set(out) >= {"this", "previous", "delta", "pct_change"}


def test_a_weight_chart_has_no_total(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    api.post("/fitness/weigh-ins", {"weight_kg": 70})
    model = install(
        monkeypatch, say("", call("show_chart", metric="weight", days=30)), say("Here.")
    )
    stream(api, client, "show my weight chart")
    out = tool_result(model, 1, "show_chart")
    assert "total" not in out and out["average"] == 70
