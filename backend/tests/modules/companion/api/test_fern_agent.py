"""Fern as one multi-step agent (ADR-0015): a request to add something
reaches the write tool in the same run, every step streams as an AG-UI
event, and a reply that only answers writes nothing.

The model is substituted only at ``ai_providers.public.model_factory`` (the
scripted model in the capture helpers)."""

from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.capture.models import Capture
from app.modules.companion import services
from app.modules.tasks.models import Task
from tests.modules.capture.api.helpers import (
    Api,
    call,
    install,
    parse_agui,
    say,
    user,
)


def stream(api: Api, client: TestClient, text: str) -> list[dict[str, Any]]:
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": text})
    assert r.status_code == 200
    return parse_agui(r.text)


def tasks_of(api: Api) -> list[Task]:
    with Session(db_engine) as s:
        return list(
            s.exec(select(Task).where(Task.owner_id == api.user.id)).all()  # type: ignore[attr-defined]
        )


def captures_of(api: Api) -> list[Capture]:
    with Session(db_engine) as s:
        return list(
            s.exec(select(Capture).where(Capture.owner_id == api.user.id)).all()  # type: ignore[attr-defined]
        )


def test_a_task_request_creates_the_task_in_the_same_run(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    install(
        monkeypatch,
        say(
            "",
            call(
                "create_tasks",
                tasks=[
                    {"title": "Buy milk", "due_date": tomorrow, "due_time": "17:00"}
                ],
            ),
        ),
        say("Added it: buy milk tomorrow at 5 PM."),
    )
    events = stream(api, client, "add a task to buy milk tomorrow at 5pm")

    made = tasks_of(api)
    assert [(t.title, str(t.due_date), t.due_time) for t in made] == [
        ("Buy milk", tomorrow, "17:00")
    ]
    result = next(e for e in events if e["type"] == "TOOL_CALL_RESULT")
    assert '"summary": "Added task: Buy milk' in result["content"]
    assert f"{tomorrow} 17:00" in result["content"]
    done = events[-1]["result"]
    steps = done["messages"][1]["blocks"][0]
    assert steps["t"] == "steps"
    assert steps["items"][0]["tool"] == "create_tasks" and steps["items"][0]["ok"]
    caps = captures_of(api)
    assert [(c.source, c.status) for c in caps] == [("chat", "done")]
    assert done["capture"]["id"] == str(caps[0].id)


def test_steps_stream_in_order_across_several_model_calls(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Look something up, act on it, then answer: three model calls, each a
    step, with the tool steps between them and the text last."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("stats_overview", days=7)),
        say("", call("create_tasks", tasks=[{"title": "Walk 20 min"}])),
        say("Your week is light on training, so I added a walk."),
    )
    events = stream(api, client, "how's my week? add something to help")
    seq = [
        (e["type"], e.get("stepName") or e.get("toolCallName") or e.get("name"))
        for e in events
        if e["type"]
        in (
            "RUN_STARTED",
            "STEP_STARTED",
            "STEP_FINISHED",
            "TOOL_CALL_START",
            "TEXT_MESSAGE_START",
            "RUN_FINISHED",
        )
    ]
    assert seq == [
        ("RUN_STARTED", None),
        ("STEP_STARTED", "think:1"),
        ("STEP_FINISHED", "think:1"),
        ("STEP_STARTED", "tool:stats_overview"),
        ("TOOL_CALL_START", "stats_overview"),
        ("STEP_FINISHED", "tool:stats_overview"),
        ("STEP_STARTED", "think:2"),
        ("STEP_FINISHED", "think:2"),
        ("STEP_STARTED", "tool:create_tasks"),
        ("TOOL_CALL_START", "create_tasks"),
        ("STEP_FINISHED", "tool:create_tasks"),
        ("STEP_STARTED", "think:3"),
        ("TEXT_MESSAGE_START", None),
        ("STEP_FINISHED", "think:3"),
        ("RUN_FINISHED", None),
    ]
    assert [t.title for t in tasks_of(api)] == ["Walk 20 min"]


def test_a_reply_that_only_answers_writes_no_capture(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say("", call("plan_day")), say("Nothing is due today."))
    events = stream(api, client, "what's on today?")
    done = events[-1]["result"]
    assert done["capture"] is None
    assert captures_of(api) == [] and tasks_of(api) == []
    assert done["messages"][1]["blocks"][0]["items"][0]["summary"] == (
        "Planned your day"
    )


def test_a_write_waiting_for_the_user_says_so(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A reminder is a confirm-tier card: it waits, and the step says so."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "",
            call(
                "create_tasks",
                tasks=[{"title": "Call mom", "due_time": "19:00", "remind": True}],
            ),
        ),
        say("I set it up; confirm it in the card."),
    )
    events = stream(api, client, "remind me to call mom at 7pm")
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    assert step["state"] == "proposed" and step["summary"].endswith(
        "(waiting for your OK)"
    )
    assert tasks_of(api) == []


def test_a_write_waiting_on_a_question_asks_it_instead_of_an_ok(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An expense with no category can't be confirmed until it has one, so
    the step names the question rather than "waiting for your OK"."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_expense", amount=275, payee="7-Eleven")),
        say("What was it for?"),
    )
    events = stream(api, client, "log 275 at 7-Eleven")
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    assert step["state"] == "needs_input"
    assert step["summary"].endswith("275 for?)"), step["summary"]
    assert "waiting for your OK" not in step["summary"]


def test_an_expense_with_an_unknown_category_is_sent_back_to_pick_one(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live 2026-10-29: "pre-workout" matched no category, so the
    expense asked what it was for though the person had just said. The
    model is handed their categories and saves it on the retry."""
    from app.modules.finance.models import FinRecord

    api = user(client, db)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_expense", amount=240, category="pre-workout")),
        say("", call("log_expense", amount=240, category="Food", note="pre-workout")),
        say("Logged ₱240 for your pre-workout."),
    )
    events = stream(api, client, "spent 240 at 7-Eleven for my pre-workout")
    first, second = events[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert not first["ok"]
    assert first["summary"] == "Couldn't finish: unknown category"
    assert second["ok"] and second["state"] != "needs_input"
    assert len(live(rows_of(api, FinRecord))) == 1


def test_tool_calls_past_the_reply_cap_are_refused(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    monkeypatch.setattr(services, "MAX_TOOL_CALLS", 2)
    install(
        monkeypatch,
        say("", call("create_tasks", tasks=[{"title": "One"}])),
        say("", call("create_tasks", tasks=[{"title": "Two"}])),
        say("", call("create_tasks", tasks=[{"title": "Three"}])),
        say("Done."),
    )
    events = stream(api, client, "add three tasks one at a time")
    items = events[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert [i["ok"] for i in items] == [True, True, False]
    assert sorted(t.title for t in tasks_of(api)) == ["One", "Two"]


def test_a_reminder_does_not_hold_back_the_plain_tasks_beside_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live on 2026-10-22: one call with a task and a reminder made one
    confirm-tier card, so the plain task waited too. They are two cards now:
    the task saves, the reminder waits."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    install(
        monkeypatch,
        say(
            "",
            call(
                "create_tasks",
                tasks=[
                    {"title": "Buy milk", "due_date": tomorrow, "due_time": "17:00"},
                    {"title": "Call mom", "due_time": "20:00", "remind": True},
                ],
            ),
        ),
        say("Buy milk is added; the call reminder waits for your OK below."),
    )
    events = stream(api, client, "buy milk tomorrow 5pm, remind me to call mom 8pm")
    assert [t.title for t in tasks_of(api)] == ["Buy milk"]
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    assert [(c["label"], c["state"]) for c in step["cards"]] == [
        ("Buy milk", "saved"),
        ("Call mom", "proposed"),
    ]
    assert (
        step["summary"] == "Added 2 tasks: Buy milk, Call mom (1 waiting for your OK)"
    )


def test_the_model_knows_the_local_time_not_only_the_business_day(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live at 02:53 on 2026-10-22 (before the 04:00 rollover): told only
    "Today is 2026-10-21", the model filed "tonight at 9pm" on the 21st, in
    the past. It now gets the local date and time and the next-time rule."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(monkeypatch, say("Okay."))
    stream(api, client, "remind me to stretch tonight at 9pm")
    system = str(model.seen[0][0].content)
    now = datetime.now(ZoneInfo("Asia/Manila"))
    assert f"it is {now:%A %Y-%m-%d}" in system
    assert "their day rolls over at 04:00" in system
    assert "Never schedule something in the past" in system


def test_a_claimed_write_with_no_tool_gets_one_corrective_pass(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live on 2026-10-22: asked to remind, the model answered "has
    been added as a reminder" without calling a tool. The reply is checked
    against the turn's writes; the model is told nothing was saved, once."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        say("Drink water has been added as a reminder for 9 PM."),
        say(
            "",
            call(
                "create_tasks",
                tasks=[{"title": "Drink water", "due_time": "21:00"}],
            ),
        ),
        say("Added: drink water at 9 PM."),
    )
    events = stream(api, client, "add a task to drink water at 9pm")
    assert [t.title for t in tasks_of(api)] == ["Drink water"]
    nudge = str(model.seen[1][-1].content)
    assert (
        "no tool in this reply" in nudge
        and '"add a task to drink water at 9pm"' in nudge
    )
    assert "do not repeat them" in nudge
    sol = events[-1]["result"]["messages"][1]
    assert sol["text"] == "Added: drink water at 9 PM."
    assert sol["blocks"][0]["items"][0]["tool"] == "create_tasks"


def test_a_claim_still_unbacked_after_the_retry_is_replaced_by_the_truth(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("I've added it to your tasks."),
        say("It's been added and saved."),
    )
    events = stream(api, client, "add a task to buy bread")
    assert tasks_of(api) == []
    assert events[-1]["result"]["messages"][1]["text"] == services.NOT_RECORDED


def test_an_answer_that_only_mentions_logging_is_left_alone(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No write was asked for, so "you logged" describing the past is not a
    claim to check, and the model is called once."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(monkeypatch, say("You logged 3 workouts this week."))
    events = stream(api, client, "how many workouts this week?")
    assert len(model.seen) == 1
    text = events[-1]["result"]["messages"][1]["text"]
    assert text == "You logged 3 workouts this week."


def weigh_ins_of(api: Api) -> list[Any]:
    from app.modules.fitness.models import WeighIn

    with Session(db_engine) as s:
        return list(
            s.exec(select(WeighIn).where(WeighIn.owner_id == api.user.id)).all()  # type: ignore[attr-defined]
        )


def test_data_with_no_verb_and_a_phantom_confirm_gets_the_corrective_pass(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live on 2026-10-22: "62.4 kg and 20.0% body fat for today's
    weigh" got "I've logged your weigh-in… Tap Confirm below" with no tool
    run. Numbers with units are a record to make, and a reply pointing at a
    Confirm button nothing in the turn left waiting is checked."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        say(
            "I've logged your weigh-in: 62.4 kg. The entry is proposed and "
            "needs confirmation. Tap Confirm below to finalize it."
        ),
        say("", call("log_weigh_in", kg=62.4)),
        say("Logged 62.4 kg for today."),
    )
    events = stream(api, client, "62.4 kg and 20.0% body fat for today's weigh")
    assert len(model.seen) == 3
    nudge = str(model.seen[1][-1].content)
    assert "no Confirm button" in nudge and "confirm_pending" in nudge
    assert [float(w.weight_kg) for w in weigh_ins_of(api)] == [62.4]
    sol = events[-1]["result"]["messages"][1]
    assert sol["text"] == "Logged 62.4 kg for today."


def test_pointing_at_a_confirm_button_that_does_not_exist_is_corrected(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Also live: "I am not seeing anything to confirm" (no write verb)
    got "saved but not yet confirmed. Tap Confirm below" with no tool. When
    the retry still claims it, the reply becomes the truth."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("The weigh-in is saved but not yet confirmed. Tap Confirm below."),
        say("It is waiting for your confirmation below."),
    )
    events = stream(api, client, "I am not seeing anything to confirm")
    assert events[-1]["result"]["messages"][1]["text"] == services.NOT_RECORDED
    assert weigh_ins_of(api) == []


def test_saying_confirm_saves_what_an_earlier_turn_left_waiting(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "",
            call(
                "create_tasks",
                tasks=[{"title": "Call mom", "due_time": "19:00", "remind": True}],
            ),
        ),
        say("Call mom at 7 PM is waiting; tap Confirm on it or say confirm."),
        say("", call("confirm_pending")),
        say("Saved: call mom at 7 PM."),
    )
    stream(api, client, "remind me to call mom at 7pm")
    assert tasks_of(api) == []
    events = stream(api, client, "Confirm")
    assert [t.title for t in tasks_of(api)] == ["Call mom"]
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    assert step["tool"] == "confirm_pending" and step["ok"]
    assert step["summary"] == "Saved: task: Call mom"


def test_confirm_reports_what_still_cannot_be_saved_and_why(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An expense with no account stays waiting; confirming says why
    instead of claiming it saved."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_expense", amount=250, category="Food", note="Lunch")),
        say("Lunch ₱250 is waiting for an account."),
        say("", call("confirm_pending")),
        say("Lunch can't be saved until you add an account."),
    )
    stream(api, client, "spent 250 on lunch")
    events = stream(api, client, "confirm it")
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    assert step["tool"] == "confirm_pending" and not step["ok"]
    assert step["summary"].startswith(
        "Not saved: expense ₱250 · Lunch (Add an account first)"
    )


def test_a_question_with_numbers_is_not_a_request_to_record() -> None:
    assert not services.unbacked_claim(
        "did I hit 60 kg this week?", "You logged 62 kg on Monday.", [], waiting=False
    )
    assert services.unbacked_claim(
        "62.4 kg and 20% body fat today", "Logged your weigh-in.", [], waiting=False
    )


def test_a_question_about_kept_records_without_a_question_mark_is_not_a_write() -> None:
    """Seen live 2026-10-30: both of these were answered with "nothing was
    saved", hiding a reply that described meals logged earlier."""
    for asked in (
        "check my meals for today in why there are no records for sat fat sugar",
        "there are no sugar and sat fat for the two meals that i have this day",
        "what meals did i have today",
    ):
        assert not services.unbacked_claim(
            asked, "Both meals were logged with calories only.", [], waiting=False
        ), asked
    # A list or numbers given stay a record to make, whatever words they hold.
    for asked in (
        "log my lunch: 1 cup rice",
        "my tasks for today: check the staging deploy, email Jack",
        "₱1500 dentist check-up",
        "62.4 kg this morning, scale isn't calibrated",
        "Do laundry and pay rent, those are my to-dos",
        "What a day: 5 km in 32 mins",
    ):
        assert services.unbacked_claim(asked, "Logged it.", [], waiting=False), asked


TASK_LIST = (
    "So these are my tasks, list them out: refinement on the inventory "
    "management system for Jack, deploying the staging environment in AWS via "
    "terraform, upgrade the pH workflow based on feedback from last Saturday"
)


def test_described_tasks_claimed_but_not_created_get_the_corrective_pass(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live on 2026-10-22: a list of tasks with no "add" got "I've
    created your tasks" and a bullet list, with no tool. Described things to
    keep are a record to make, so the claim is checked and corrected."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        say("I've created your tasks:\n- Inventory refinement\n- Staging deploy"),
        say(
            "",
            call(
                "create_tasks",
                tasks=[
                    {"title": "Refine inventory system for Jack"},
                    {"title": "Deploy staging in AWS via Terraform"},
                    {"title": "Upgrade the pH workflow"},
                ],
            ),
        ),
        say("Added 3 tasks."),
    )
    events = stream(api, client, TASK_LIST)
    assert len(model.seen) == 3
    assert sorted(t.title for t in tasks_of(api)) == [
        "Deploy staging in AWS via Terraform",
        "Refine inventory system for Jack",
        "Upgrade the pH workflow",
    ]
    assert events[-1]["result"]["messages"][1]["text"] == "Added 3 tasks."


def test_a_task_list_still_unrecorded_after_the_retry_says_so(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("I've created your tasks."),
        say("Your tasks are created."),
    )
    events = stream(api, client, TASK_LIST)
    assert tasks_of(api) == []
    assert events[-1]["result"]["messages"][1]["text"] == services.NOT_RECORDED


def test_tasks_with_no_day_named_get_no_invented_due_date(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Also live: the model gave every task today at 23:59 though no date
    was said ("last Saturday" is the past). The date and time are dropped."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    today = date.today().isoformat()
    install(
        monkeypatch,
        say(
            "",
            call(
                "create_tasks",
                tasks=[
                    {
                        "title": "Upgrade the pH workflow",
                        "due_date": today,
                        "due_time": "23:59",
                    }
                ],
            ),
        ),
        say("Added it."),
    )
    stream(api, client, TASK_LIST)
    assert [(t.title, t.due_date, t.due_time) for t in tasks_of(api)] == [
        ("Upgrade the pH workflow", None, None)
    ]


def test_register_those_keeps_the_day_named_just_before(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ "Register those" leans on the message before it: a day named there
    still counts, and no time is invented."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    install(
        monkeypatch,
        say("Pay rent and call the landlord tomorrow, got it."),
        # After that reply, the message is read for lasting facts: none.
        say(""),
        say(
            "",
            call(
                "create_tasks",
                tasks=[
                    {"title": "Pay rent", "due_date": tomorrow, "due_time": "23:59"}
                ],
            ),
        ),
        say("Added: pay rent tomorrow."),
    )
    stream(api, client, "I need to pay rent tomorrow")
    stream(api, client, "Register those as a task")
    assert [(t.title, str(t.due_date), t.due_time) for t in tasks_of(api)] == [
        ("Pay rent", tomorrow, None)
    ]


def test_weight_and_body_fat_are_saved_together(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live on 2026-10-22: "62.4 kg and 20.0% body fat" kept the
    weight and silently dropped the body fat: the tool took kilograms only."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_weigh_in", kg=62.4, body_fat_pct=20.0)),
        say("Logged 62.4 kg and 20% body fat."),
    )
    stream(api, client, "62.4 kg and 20% body fat today")
    [w] = weigh_ins_of(api)
    assert (w.weight_kg, w.body_fat_pct) == (62.4, 20.0)


def test_body_fat_alone_rides_on_todays_weight(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live on 2026-10-22: "Record my body fat, which is 20% for today"
    ended in "I didn't manage to record that": there was no way to log it."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_weigh_in", kg=62.4)),
        say("Logged 62.4 kg."),
        say("", call("log_weigh_in", body_fat_pct=20.0)),
        say("Added 20% body fat to today's weigh-in."),
    )
    stream(api, client, "62.4 kg this morning")
    stream(api, client, "Record my body fat, which is 20% for today")
    rows = {(w.weight_kg, w.body_fat_pct) for w in weigh_ins_of(api)}
    assert rows == {(62.4, None), (62.4, 20.0)}


def test_body_fat_with_no_weight_today_asks_for_the_weight(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An older weight is never stamped onto today."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_weigh_in", body_fat_pct=20.0)),
        say("What's your weight today? I'll add the 20% body fat to it."),
    )
    events = stream(api, client, "body fat 20% today")
    assert weigh_ins_of(api) == []
    results = [e for e in events if e.get("type") == "TOOL_CALL_RESULT"]
    assert results and '"ok": false' in results[0]["content"]


# ---------------------------------------------------------------- setting up


def rows_of(api: Api, model: Any) -> list[Any]:
    """Every row of ``model`` the user owns, tombstones included."""
    with Session(db_engine) as s:
        return list(s.exec(select(model).where(model.owner_id == api.user.id)).all())  # type: ignore[attr-defined]


def act(tool: str, /, **args: Any) -> dict[str, Any]:
    """``call`` for a tool that itself takes a ``name`` argument."""
    return {**call(tool), "args": args}


def live(rows: list[Any]) -> list[Any]:
    return [r for r in rows if r.deleted_at is None]


def setup_step(
    api: Api,
    client: TestClient,
    text: str,
    monkeypatch: pytest.MonkeyPatch,
    *calls: Any,
) -> dict[str, Any]:
    """One turn whose single tool call sets something up; returns its step."""
    install(monkeypatch, say("", *calls), say("Done."))
    events = stream(api, client, text)
    return events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]


def undo(api: Api, step: dict[str, Any]) -> None:
    out = api.post(f"/capture/cards/{step['card_id']}/undo")
    assert out["state"] == "undone"


def test_create_account_adds_the_account_and_undo_removes_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.finance.models import Account

    api = user(client, db, accounts=False)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "add my BPI savings account, it has 5000 in it",
        monkeypatch,
        act("create_account", name="BPI Savings", type="bank", opening_balance=5000),
    )
    assert step["tool"] == "create_account" and step["ok"]
    assert step["state"] == "saved"
    assert step["summary"] == "Added account: BPI Savings · ₱5,000"
    [acc] = live(rows_of(api, Account))
    assert (acc.name, acc.type, acc.opening_minor) == ("BPI Savings", "bank", 500000)
    # The first account becomes the default, as it does from the app.
    assert api.get("/finance/settings")["default_account_id"] == str(acc.id)

    undo(api, step)
    assert live(rows_of(api, Account)) == []
    assert api.get("/finance/settings")["default_account_id"] is None


def test_an_account_name_already_taken_is_refused(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.finance.models import Account

    api = user(client, db)  # GCash, BPI Savings, Cash
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "add a gcash account",
        monkeypatch,
        act("create_account", name="gcash", type="ewallet"),
    )
    assert not step["ok"]
    assert step["summary"] == "Couldn't finish: an account with that name exists"
    assert len(live(rows_of(api, Account))) == 3


def _fern_account_color(
    api: Api, client: TestClient, monkeypatch: pytest.MonkeyPatch, name: str
) -> str:
    from app.modules.finance.models import Account

    setup_step(
        api,
        client,
        f"add my {name} account",
        monkeypatch,
        act("create_account", name=name, type="ewallet"),
    )
    [acc] = [a for a in live(rows_of(api, Account)) if a.name == name]
    return str(acc.color)


def test_a_new_account_gets_the_first_colour_no_account_uses(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Another user's colours play no part in this user's choice.
    other = user(client, db, accounts=False)
    for name, color in (("Mine", "violet"), ("Also", "orange")):
        other.post(
            "/finance/accounts",
            {"name": name, "type": "bank", "opening_minor": 0, "color": color},
        )
    api = user(client, db, accounts=False)
    api.assign("chat")
    for name, color in (("BPI", "blue"), ("Wallet", "emerald")):
        api.post(
            "/finance/accounts",
            {"name": name, "type": "bank", "opening_minor": 0, "color": color},
        )
    assert _fern_account_color(api, client, monkeypatch, "GoTyme") == "violet"


def test_with_every_colour_taken_the_count_picks_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.capture.agent import ACCOUNT_COLORS

    api = user(client, db, accounts=False)
    api.assign("chat")
    for i, color in enumerate((*ACCOUNT_COLORS, "blue")):
        api.post(
            "/finance/accounts",
            {"name": f"A{i}", "type": "bank", "opening_minor": 0, "color": color},
        )
    # Ten accounts already: the eleventh lands on 10 % 9, the second colour.
    assert _fern_account_color(api, client, monkeypatch, "GoTyme") == "emerald"


def balances(api: Api) -> dict[str, int]:
    return {a["name"]: a["balance_minor"] for a in api.get("/finance/accounts")["data"]}


def test_set_balance_on_a_fresh_account_sets_its_opening_and_undo_restores_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)  # GCash, BPI Savings, Cash: no records yet
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "add the initial balance of my gcash, 2500",
        monkeypatch,
        call("set_account_balance", account="gcash", balance=2500),
    )
    assert step["tool"] == "set_account_balance" and step["ok"]
    assert step["state"] == "saved"
    assert step["summary"] == "Balance: gcash · ₱2,500"
    assert balances(api)["GCash"] == 250000
    # The opening balance itself, not an adjustment: nothing in the history.
    assert api.get("/finance/records")["count"] == 0

    undo(api, step)
    assert balances(api)["GCash"] == 0


def test_set_balance_on_an_account_with_records_logs_an_adjustment(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    api.post(
        "/finance/records",
        {"type": "expense", "amount_minor": 30000, "account_id": api.bpi},  # type: ignore[attr-defined]
    )
    assert balances(api)["BPI Savings"] == -30000
    step = setup_step(
        api,
        client,
        "my bpi savings has 10,000 now",
        monkeypatch,
        call("set_account_balance", account="bpi savings", balance=10000),
    )
    assert step["ok"] and step["state"] == "saved"
    assert balances(api)["BPI Savings"] == 1000000
    # The past expense stays; the difference is one adjustment record.
    assert api.get("/finance/records")["count"] == 2

    undo(api, step)
    assert balances(api)["BPI Savings"] == -30000
    assert api.get("/finance/records")["count"] == 1


def test_set_balance_with_a_change_adds_to_what_the_account_holds(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live 2026-10-29: "add 100 on my bdo account" set it to 100
    instead of adding to the 1 it held."""
    api = user(client, db)
    api.assign("chat")
    api.post(
        "/finance/records",
        {"type": "income", "amount_minor": 100, "account_id": api.bpi},  # type: ignore[attr-defined]
    )
    step = setup_step(
        api,
        client,
        "add 100 to my bpi savings",
        monkeypatch,
        call("set_account_balance", account="bpi savings", change=100),
    )
    assert step["ok"] and step["state"] == "saved"
    assert step["summary"] == "Balance: bpi savings · ₱101"
    assert balances(api)["BPI Savings"] == 10100


def test_a_balance_change_repeated_in_one_reply_is_added_once(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "",
            call("set_account_balance", account="gcash", change=100),
            call("set_account_balance", account="gcash", change=100),
        ),
        say("Added ₱100 to GCash."),
    )
    events = stream(api, client, "add 100 to my gcash")
    first, second = events[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert first["ok"] and not second["ok"]
    assert balances(api)["GCash"] == 10000


def test_set_balance_refuses_both_a_balance_and_a_change(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "add 100 to my gcash",
        monkeypatch,
        call("set_account_balance", account="gcash", balance=100, change=100),
    )
    assert not step["ok"]
    assert balances(api)["GCash"] == 0


def test_set_balance_names_the_accounts_when_none_matches(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "set my maya balance to 800",
        monkeypatch,
        call("set_account_balance", account="maya", balance=800),
    )
    assert not step["ok"]
    assert balances(api) == {"GCash": 0, "BPI Savings": 0, "Cash": 0}


def test_create_routine_reuses_habits_makes_the_rest_and_undo_takes_back_its_own(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.habits.models import Habit, Routine, RoutineStep

    api = user(client, db, accounts=False)
    api.assign("chat")
    meditate = api.post("/habits/", {"name": "Meditate"})
    step = setup_step(
        api,
        client,
        "make me a morning routine: stretch 5 min then meditate 10 min at 6am",
        monkeypatch,
        act(
            "create_routine",
            name="Morning",
            icon="🌅",
            steps=[
                {"name": "Stretch", "minutes": 5},
                {"name": "meditate", "minutes": 10},
            ],
            time="06:00",
        ),
    )
    assert step["ok"] and step["state"] == "saved"
    assert step["summary"] == "Created routine: Morning · 2 steps, 15 min"
    [routine] = live(rows_of(api, Routine))
    assert routine.name == "Morning" and routine.schedule[0]["time"] == "06:00"
    steps = sorted(live(rows_of(api, RoutineStep)), key=lambda s: s.position)
    habits = {h.id: h for h in live(rows_of(api, Habit))}
    assert [(habits[s.habit_id].name, s.minutes) for s in steps] == [
        ("Stretch", 5),
        ("Meditate", 10),
    ]
    stretch = habits[steps[0].habit_id]
    assert (stretch.type, stretch.target) == ("duration", 5)
    assert str(steps[1].habit_id) == meditate["id"]

    undo(api, step)
    assert live(rows_of(api, Routine)) == []
    assert live(rows_of(api, RoutineStep)) == []
    # The habit it made goes; the one it reused stays.
    assert [h.name for h in live(rows_of(api, Habit))] == ["Meditate"]


def test_create_habit_takes_type_target_unit_and_days(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.habits.models import Habit

    api = user(client, db, accounts=False)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "new habit: drink 8 glasses of water on weekdays",
        monkeypatch,
        act(
            "create_habit",
            name="Drink water",
            icon="💧",
            type="count",
            target=8,
            unit="glasses",
            days=["mon", "tue", "wed", "thu", "fri"],
        ),
    )
    # Created at once, not left waiting for a Confirm.
    assert step["ok"] and step["state"] == "saved"
    assert step["summary"] == "Created habit: Drink water"
    [h] = live(rows_of(api, Habit))
    assert (h.name, h.icon, h.type, h.target, h.unit) == (
        "Drink water",
        "💧",
        "count",
        8,
        "glasses",
    )
    assert h.schedule[0]["days"] == [1, 2, 3, 4, 5]

    undo(api, step)
    assert live(rows_of(api, Habit)) == []


def test_create_workout_template_makes_missing_exercises_and_undo_removes_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.fitness.models import Exercise, TemplateItem, WorkoutTemplate

    api = user(client, db, accounts=False)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "set up a push day: bench press 4 sets of 6, cable fly 3 sets",
        monkeypatch,
        act(
            "create_workout_template",
            name="Push day",
            exercises=[
                {"exercise": "Bench Press", "sets": 4, "reps": 6},
                {"exercise": "Cable Fly", "sets": 3},
            ],
        ),
    )
    assert step["ok"] and step["state"] == "saved"
    assert step["summary"] == "Created workout template: Push day · 2 exercises"
    # Fitness seeds starter templates; this one is added beside them.
    [t] = [x for x in live(rows_of(api, WorkoutTemplate)) if x.name == "Push day"]
    exercises = {e.id: e for e in live(rows_of(api, Exercise))}
    items = sorted(
        (i for i in live(rows_of(api, TemplateItem)) if i.template_id == t.id),
        key=lambda i: i.position,
    )
    assert [(exercises[i.exercise_id].name, i.sets) for i in items] == [
        ("Bench Press", 4),
        ("Cable Fly", 3),
    ]
    bench = exercises[items[0].exercise_id]
    assert (bench.rep_min, bench.rep_max) == (6, 6)

    undo(api, step)
    assert [x for x in live(rows_of(api, WorkoutTemplate)) if x.id == t.id] == []
    assert [i for i in live(rows_of(api, TemplateItem)) if i.template_id == t.id] == []
    # Exercises it added stay in the library.
    assert "Bench Press" in {e.name for e in live(rows_of(api, Exercise))}


def test_create_budget_covers_the_named_categories_and_undo_removes_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.finance.models import Budget, BudgetCategory, Category

    api = user(client, db)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "budget 8000 a month for eating out",
        monkeypatch,
        act(
            "create_budget", name="Eating out", monthly_limit=8000, categories=["food"]
        ),
    )
    assert step["ok"] and step["state"] == "saved"
    assert step["summary"] == "Budget: Eating out · ₱8,000 a month"
    [b] = live(rows_of(api, Budget))
    assert (b.name, b.limit_minor) == ("Eating out", 800000)
    cats = {c.id: c for c in rows_of(api, Category)}
    assert [cats[x.category_id].slug for x in live(rows_of(api, BudgetCategory))] == [
        "food"
    ]

    undo(api, step)
    assert live(rows_of(api, Budget)) == []
    assert live(rows_of(api, BudgetCategory)) == []


def test_a_budget_naming_an_unknown_category_creates_nothing(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.finance.models import Budget

    api = user(client, db)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "budget 500 for zorblax",
        monkeypatch,
        act("create_budget", name="Zorb", monthly_limit=500, categories=["zorblax"]),
    )
    assert not step["ok"]
    assert live(rows_of(api, Budget)) == []


def test_create_task_list_with_items_and_undo_removes_both(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.tasks.models import TaskList

    api = user(client, db, accounts=False)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "make a party shopping list: chips, soda",
        monkeypatch,
        act("create_task_list", name="Party", shopping=True, items=["Chips", "Soda"]),
    )
    assert step["ok"] and step["state"] == "saved"
    assert step["summary"] == "Created list: Party · 2 items"
    [lst] = [x for x in live(rows_of(api, TaskList)) if x.name == "Party"]
    assert lst.kind == "shopping"
    assert sorted((t.title, t.list_id) for t in live(tasks_of(api))) == [
        ("Chips", lst.id),
        ("Soda", lst.id),
    ]

    undo(api, step)
    assert [x for x in live(rows_of(api, TaskList)) if x.name == "Party"] == []
    assert live(tasks_of(api)) == []


def test_an_expense_said_in_dollars_is_kept_in_dollars_and_logged_in_pesos(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from decimal import Decimal

    from app.modules.finance import fx
    from app.modules.finance.models import FinRecord

    monkeypatch.setattr(
        fx,
        "latest",
        lambda base, quote: fx.Rate(base, quote, Decimal("57.92"), date(2026, 10, 21)),
    )
    api = user(client, db)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "spent $100 on dinner",
        monkeypatch,
        call("log_expense", amount=100, currency="USD", category="food"),
    )
    assert step["ok"] and step["summary"].startswith("Logged expense: $100 (₱5,792)")
    # Over the confirm threshold in pesos, so it waits for the person's OK.
    if step["state"] == "proposed":
        api.post(f"/capture/cards/{step['card_id']}/confirm")
    [rec] = live(rows_of(api, FinRecord))
    assert (rec.amount_minor, rec.orig_currency, rec.orig_amount_minor) == (
        579200,
        "USD",
        10000,
    )
    assert rec.fx_rate == Decimal("57.92")


def test_update_routine_reorders_adds_a_step_and_undo_puts_it_back(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.habits.models import Habit, Routine, RoutineStep

    api = user(client, db, accounts=False)
    api.assign("chat")
    setup_step(
        api,
        client,
        "make a morning routine: fix bed 5, journal 15, oats 10 at 6am",
        monkeypatch,
        act(
            "create_routine",
            name="Morning",
            steps=[
                {"name": "Fix bed", "minutes": 5},
                {"name": "Journal", "minutes": 15},
                {"name": "Oats", "minutes": 10},
            ],
            time="06:00",
        ),
    )

    def order() -> list[tuple[str, int]]:
        habits = {h.id: h.name for h in live(rows_of(api, Habit))}
        steps = sorted(live(rows_of(api, RoutineStep)), key=lambda s: s.position)
        return [(habits[s.habit_id], s.minutes) for s in steps]

    step = setup_step(
        api,
        client,
        "after journaling I eat oats, then 30 min deep work; start at 5:30",
        monkeypatch,
        act(
            "update_routine",
            routine="morning",
            steps=[
                {"name": "Fix bed", "minutes": 5},
                {"name": "Journal", "minutes": 15},
                {"name": "Oats", "minutes": 10},
                {"name": "Deep work", "minutes": 30},
            ],
            time="05:30",
        ),
    )
    assert step["ok"] and step["state"] == "saved", step
    assert step["summary"] == "Updated routine: morning · 4 steps"
    assert order() == [
        ("Fix bed", 5),
        ("Journal", 15),
        ("Oats", 10),
        ("Deep work", 30),
    ]
    [routine] = live(rows_of(api, Routine))
    assert routine.schedule[0]["time"] == "05:30"

    undo(api, step)
    assert order() == [("Fix bed", 5), ("Journal", 15), ("Oats", 10)]
    [routine] = live(rows_of(api, Routine))
    assert routine.schedule[0]["time"] == "06:00"
    # The habit the edit made for its new step goes with it.
    assert "Deep work" not in [h.name for h in live(rows_of(api, Habit))]


def test_update_habit_changes_target_and_time_and_undo_restores(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.habits.models import Habit

    api = user(client, db, accounts=False)
    api.assign("chat")
    api.post(
        "/habits/",
        {"name": "Read", "type": "duration", "target": 20},
    )
    step = setup_step(
        api,
        client,
        "make my reading 30 minutes at 9pm",
        monkeypatch,
        act("update_habit", habit="read", target=30, time="21:00"),
    )
    assert step["ok"] and step["summary"] == "Updated habit: read"
    [h] = live(rows_of(api, Habit))
    assert (h.target, h.schedule[0].get("time")) == (30, "21:00")
    undo(api, step)
    [h] = live(rows_of(api, Habit))
    assert (h.target, h.schedule[0].get("time")) == (20, None)


def test_editing_a_routine_that_does_not_exist_names_the_ones_that_do(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "move my night routine to 10pm",
        monkeypatch,
        act("update_routine", routine="night", time="22:00"),
    )
    assert not step["ok"]
    assert step["summary"] == "Couldn't finish: no routine with that name"


def test_a_bill_with_a_due_date_is_planned_once_on_that_date(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.finance.models import PlannedItem

    api = user(client, db)
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "",
            act(
                "add_planned",
                name="Shopee Pay Later - Nov",
                amount=3544.18,
                due_date="2026-12-05",
            ),
            act("add_planned", name="Netflix", amount=549, day_of_month=5),
            act(
                "add_planned",
                name="Salary",
                amount=40000,
                day_of_month=15,
                type="income",
            ),
        ),
        say("Planned."),
    )
    events = stream(api, client, "plan my Shopee bill due Dec 5, netflix and salary")
    steps = events[-1]["result"]["messages"][1]["blocks"][0]["items"]
    for s in steps:
        if s.get("state") == "proposed":
            api.post(f"/capture/cards/{s['card_id']}/confirm")
    rows = {p.name: p for p in live(rows_of(api, PlannedItem))}
    bill = rows["Shopee Pay Later - Nov"]
    assert bill.schedule == {"kind": "once", "date": "2026-12-05"}
    assert (bill.amount_minor, bill.type) == (354418, "expense")
    assert rows["Netflix"].schedule["kind"] == "monthly"
    assert rows["Salary"].type == "income"


def test_a_planned_payment_needs_a_date_or_a_day(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "plan my rent",
        monkeypatch,
        act("add_planned", name="Rent", amount=15000),
    )
    assert not step["ok"]
    assert step["summary"] == "Couldn't finish: give due date or day of month"


def test_confirm_needs_the_person_to_have_said_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live: asked to log the rest of the day's meals, Fern confirmed
    everything waiting on its own, and a stale breakfast was saved."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "",
            call(
                "create_tasks",
                tasks=[{"title": "Call mom", "due_time": "19:00", "remind": True}],
            ),
        ),
        say("Call mom at 7 PM is waiting."),
        say("", call("confirm_pending")),
        say("Should I save Call mom?"),
    )
    stream(api, client, "remind me to call mom at 7pm")
    events = stream(
        api,
        client,
        "Then I also want you to record the following meals I had for the "
        "rest of the day: a protein shake for lunch and inasal for dinner",
    )
    assert tasks_of(api) == []
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    assert step["tool"] == "confirm_pending" and not step["ok"]


def test_what_counts_as_saying_confirm() -> None:
    yes = [
        "Confirm",
        "confirm it",
        "yes",
        "Ok",
        "go ahead",
        "sige",
        "save them",
        "I approve the breakfast change, please",
    ]
    no = [
        "record the following meals for lunch and dinner",
        "can I have a protein shake?",
        "yes I had rice and two eggs and a big glass of milk with some oats "
        "for breakfast this morning",
    ]
    assert all(services.said_confirm(t) for t in yes)
    assert not any(services.said_confirm(t) for t in no)


def _waiting_expenses(api: Api, *, saved: bool = False) -> list[Any]:
    from app.modules.capture.models import RecordCard

    states = ("proposed", "needs_input") + (("saved",) if saved else ())

    with Session(db_engine) as s:
        return [
            c
            for c in s.exec(
                select(RecordCard).where(RecordCard.owner_id == api.user.id)  # type: ignore[attr-defined]
            ).all()
            if c.kind == "expense" and c.state in states
        ]


def test_the_same_screenshot_sent_twice_does_not_double_the_waiting_expenses(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    receipt = say(
        "",
        call("log_expense", amount=275, payee="7-Eleven"),
        call("log_expense", amount=118, payee="7-Eleven"),
    )
    install(
        monkeypatch,
        receipt,
        say("Two 7-Eleven purchases are waiting."),
        receipt,
        say("Those are already waiting."),
    )
    stream(api, client, "log these")
    assert len(_waiting_expenses(api)) == 2
    events = stream(api, client, "log these")
    assert len(_waiting_expenses(api)) == 2
    items = events[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert [i["summary"].split(":")[0] for i in items] == [
        "Already waiting",
        "Already waiting",
    ]


def test_two_equal_purchases_on_one_receipt_are_both_kept(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "",
            call("log_expense", amount=50, payee="Jeepney"),
            call("log_expense", amount=50, payee="Jeepney"),
        ),
        say("Two fares are waiting."),
    )
    stream(api, client, "log these: spent 50 and 50 on jeepney")
    assert len(_waiting_expenses(api, saved=True)) == 2


def test_confirm_twice_in_one_reply_shows_one_step(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_expense", amount=250, category="Food", note="Lunch")),
        say("Lunch is waiting."),
        say("", call("confirm_pending"), call("confirm_pending")),
        say("Lunch can't be saved until you add an account."),
    )
    stream(api, client, "spent 250 on lunch")
    events = stream(api, client, "confirm")
    items = events[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert [i["tool"] for i in items] == ["confirm_pending"]


def test_send_now_stops_the_running_reply_before_its_tools_run(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The app's "Send now": the reply asked to stop ends at its next step,
    runs none of the tools it was about to, and says it stopped."""
    import uuid

    from app.modules.companion import gate
    from app.modules.companion.services import STOPPED

    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("create_tasks", tasks=[{"title": "Buy milk"}])),
        say("Added."),
    )
    me = uuid.uuid4()
    r = client.post(f"/api/v1/companion/messages/{me}/stop", headers=api.h, json={})
    assert r.status_code == 204
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "add a task to buy milk", "id": str(me)},
    )
    events = parse_agui(r.text)
    done = events[-1]["result"]
    assert tasks_of(api) == []
    assert done["messages"][1]["text"].endswith(STOPPED)
    # The flag is gone once the reply ended: the next reply runs in full.
    assert not gate.stop_requested(api.user.id, str(me))
