"""A module switched off in Settings is off for Fern too.

Fern still logs what the person tells it into an off module, so nothing is
lost, but the reply carries one line saying it won't show on Today, with a
button to turn the module on. Fern's picture of today (the TODAY facts in
its prompt, and the plan) leaves an off module out, so a summary never
brings it up; asking about that module directly still reaches its tools.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.companion import grounding
from app.shared.context import make_ctx
from tests.modules.capture.api.helpers import Api, call, install, say, user
from tests.modules.companion.api.meal_items import full
from tests.modules.companion.api.test_companion_answer_quality import (
    ask,
    today_facts,
)


def turn_off(api: Api, module: str) -> None:
    api.patch(f"/profile/modules/{module}", {"enabled": False})


def reply_blocks(out: dict[str, Any]) -> list[dict[str, Any]]:
    return list(out["messages"][1]["blocks"])


def off_notes(out: dict[str, Any]) -> list[dict[str, Any]]:
    return [b for b in reply_blocks(out) if b["t"] == "module_off"]


def test_a_write_into_an_off_module_is_kept_and_offers_to_turn_it_on(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    turn_off(api, "finance")
    install(
        monkeypatch,
        say("", call("log_expense", amount=250, category="Shopping")),
        say("Logged ₱250 for shopping."),
    )
    out = ask(api, "spent 250 on socks")
    # Logged all the same: the step saved a card.
    steps = next(b for b in reply_blocks(out) if b["t"] == "steps")
    assert steps["items"][0].get("card_id")
    assert off_notes(out) == [
        {
            "t": "module_off",
            "module": "finance",
            "text": "Finance is off, so this won't show on Today. Turn it on?",
        }
    ]


def test_a_write_into_an_on_module_says_nothing_extra(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_expense", amount=250, category="Shopping")),
        say("Logged ₱250 for shopping."),
    )
    assert off_notes(ask(api, "spent 250 on socks")) == []


def test_one_line_per_off_module_however_many_writes(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    turn_off(api, "finance")
    install(
        monkeypatch,
        say(
            "",
            call("log_expense", amount=250, category="Shopping"),
            call("log_expense", amount=90, category="Shopping"),
        ),
        say("Logged both."),
    )
    assert [n["module"] for n in off_notes(ask(api, "250 socks, 90 tape"))] == [
        "finance"
    ]


def test_a_meal_is_nutrition_not_fitness(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    turn_off(api, "nutrition")
    install(
        monkeypatch,
        say(
            "",
            call(
                "log_meal",
                description="Rice",
                items=[full({"name": "Rice", "kcal": 200, "carbs": 50, "grams": 100})],
            ),
        ),
        say("Logged lunch."),
    )
    notes = off_notes(ask(api, "had rice for lunch"))
    assert [n["module"] for n in notes] == ["nutrition"]
    assert notes[0]["text"].startswith("Nutrition is off")


def test_todays_facts_leave_out_off_modules_and_name_them(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    api.post("/habits/", {"name": "Walk"})
    api.post("/tasks/", {"title": "Call Mark"})
    turn_off(api, "habits")
    turn_off(api, "tasks")
    model = install(monkeypatch, say("ok"))
    ask(api, "how's my day")
    facts = today_facts(model)
    assert facts["modules_off"] == ["Habits", "Tasks"]
    for key in (
        "habits_due_today",
        "habits_left_today",
        "tasks_overdue",
        "tasks_due_today",
        "tasks_due_today_count",
        "task_lists",
    ):
        assert key not in facts, key
    # Still there for what is on.
    assert "nutrition_due_today" in facts
    system = str(model.seen[0][0].content)
    assert "switched off" in system


def test_the_plan_leaves_out_an_off_module(client: TestClient, db: Session) -> None:
    api = user(client, db, accounts=False)
    api.post("/habits/", {"name": "Walk"})
    api.post("/tasks/", {"title": "Call Mark", "due_date": None})
    ctx = make_ctx(db, api.user)  # type: ignore[attr-defined]
    assert "Walk" in [p["what"] for p in grounding.plan(ctx)]
    turn_off(api, "habits")
    ctx = make_ctx(db, api.user)  # type: ignore[attr-defined]
    assert "Walk" not in [p["what"] for p in grounding.plan(ctx)]
