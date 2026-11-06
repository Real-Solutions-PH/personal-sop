"""Fern's loop guards (Kai, 2026-11-05): a reply that looped on web searches
until the step cap ended as a list of its searches, and "continue" searched
the same foods again because nothing the reply looked up was kept.

- a reply whose steps run out answers once, without tools, instead of
  stopping mid-search;
- what a reply looked up is stored with it (never sent to the app) and the
  next turn is told, so "continue" picks up;
- a read repeated with the same arguments, or a food searched again in
  other words, gets the first answer back instead of running again."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from sqlmodel import Session, col, select

from app.core.config import settings
from app.modules.companion import loop, services, turn, web
from app.modules.companion.models import CompanionMessage
from tests.modules.capture.api.helpers import call, install, parse_agui, say, user


def ask(client: TestClient, api: Any, text: str) -> list[dict[str, Any]]:
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": text})
    assert r.status_code == 200, r.text
    return parse_agui(r.text)


def _searches(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    monkeypatch.setattr(settings, "BRAVE_API_KEY", "brave-test")
    searched: list[str] = []

    def fake(query: str, **_: Any) -> list[dict[str, Any]]:
        searched.append(query)
        return [
            {
                "title": f"{query} nutrition",
                "url": "https://example.com/oat-latte",
                "snippet": "Oat latte 240 ml: 130 kcal, 3 g protein, 17 g carbs",
            }
        ]

    monkeypatch.setattr(web, "search", fake)
    return searched


def _replies(db: Session) -> list[CompanionMessage]:
    db.expire_all()
    return list(
        db.exec(
            select(CompanionMessage)
            .where(CompanionMessage.role == "sol")
            .order_by(col(CompanionMessage.created_at))
        )
    )


def test_a_reply_out_of_steps_answers_instead_of_listing_its_searches(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    _searches(monkeypatch)
    foods = [
        "oat latte",
        "cream puff",
        "red bean sandwich",
        "royal bar",
        "mochi cup",
        "tuna salad",
        "milkfish",
        "chicken roll",
        "egg pie",
        "rice cake",
    ]
    model = install(
        monkeypatch,
        *[say("", call("web_search", query=f"{f} label")) for f in foods],
        say("Found the oat latte at 130 kcal; the rest have no label yet."),
    )
    events = ask(client, api, "log my breakfast")
    # Every step asked for a tool, then one more call, told to answer.
    told = [
        i
        for i, seen in enumerate(model.seen)
        if isinstance(seen[-1], HumanMessage) and seen[-1].content == services.LAST_WORD
    ]
    assert told == [loop.STEPS]
    last = model.seen[told[0]]
    assert isinstance(last[-1], HumanMessage)
    assert last[-1].content == services.LAST_WORD
    # The calls it still asked for are answered as not run.
    assert any(
        isinstance(m, ToolMessage) and "not_run_step_budget_spent" in str(m.content)
        for m in last
    )
    text = "".join(
        e.get("delta", "") for e in events if e["type"] == "TEXT_MESSAGE_CONTENT"
    )
    assert "130 kcal" in text
    reply = _replies(db)[-1]
    assert reply.text == "Found the oat latte at 130 kcal; the rest have no label yet."
    assert "Searched the web" not in (reply.text or "")


def test_continue_is_told_what_the_last_reply_looked_up(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    _searches(monkeypatch)
    model = install(
        monkeypatch,
        say("", call("web_search", query="Oatside coffee latte")),
        say("Which size was it, 240 or 330 ml?"),
        say("Logging it."),
    )
    ask(client, api, "oat latte for breakfast")
    reply = _replies(db)[-1]
    assert reply.tool_log and reply.tool_log[0]["tool"] == "web_search"
    assert "130 kcal" in str(reply.tool_log[0]["result"])
    # The app never gets it.
    r = client.get("/api/v1/companion/messages", headers=api.h)
    assert r.status_code == 200, r.text
    assert "tool_log" not in r.text
    ask(client, api, "continue")
    system = model.seen[2][0]
    assert isinstance(system, SystemMessage)
    assert "LOOKED UP BY YOUR LAST REPLIES" in str(system.content)
    assert "Oat latte 240 ml: 130 kcal" in str(system.content)


def test_a_food_searched_again_in_other_words_gets_the_first_results(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    searched = _searches(monkeypatch)
    model = install(
        monkeypatch,
        say(
            "", call("web_search", query="Oatside Coffee Latte bottled nutrition facts")
        ),
        say(
            "", call("web_search", query="Oatside coffee latte 330ml calories protein")
        ),
        say("130 kcal."),
    )
    ask(client, api, "how many calories in an oatside latte")
    assert len(searched) == 1
    second = [m for m in model.seen[2] if isinstance(m, ToolMessage)][-1]
    assert '"same_as"' in str(second.content)
    assert "130 kcal" in str(second.content)


def test_the_same_read_twice_is_answered_from_the_first(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    model = install(
        monkeypatch,
        say("", call("find_foods", query="oats")),
        say("", call("find_foods", query="oats")),
        say("No oats in your library."),
    )
    ask(client, api, "are oats in my library")
    second = [m for m in model.seen[2] if isinstance(m, ToolMessage)][-1]
    assert '"repeat"' in str(second.content)


def test_same_search_compares_the_food_words_only() -> None:
    earlier = [
        {"query": "Selecta Cream Puff ice cream nutrition facts", "results": [1]},
        {"query": "Magnum Royal ice cream calories", "results": [1]},
    ]
    assert services.same_search("Selecta Cream Puff Philippines kcal", earlier)
    assert services.same_search("Magnum Royal ice cream bar 150ml", earlier)
    # Same brand, another product: a new search.
    assert not services.same_search("Selecta Sandwich Royale red bean", earlier)
    # A search that found nothing is no answer to repeat.
    assert not services.same_search(
        "Oatside latte label", [{"query": "Oatside latte", "results": []}]
    )


def test_after_a_failed_web_search_the_reply_stops_searching(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live 2026-11-06: Brave refused every call (out of credit) and one
    reply searched 16 times, each failing, until the tool-call cap."""
    api = user(client, db)
    api.assign("chat")
    monkeypatch.setattr(settings, "BRAVE_API_KEY", "brave-test")
    searched: list[str] = []

    def refused(query: str, **_: Any) -> list[dict[str, Any]]:
        searched.append(query)
        raise web.WebSearchError("web_search_failed")

    monkeypatch.setattr(web, "search", refused)
    foods = ["oat latte", "cream puff", "red bean sandwich", "royal bar"]
    model = install(
        monkeypatch,
        *[say("", call("web_search", query=f"{f} label")) for f in foods],
        say("The web lookup didn't work, so these are estimates."),
    )
    events = ask(client, api, "log my breakfast")
    assert searched == ["oat latte label"]
    # The model's last look at the reply: every tool result, in order.
    results = [m for m in max(model.seen, key=len) if isinstance(m, ToolMessage)]
    assert len(results) == len(foods)
    assert '"web_search_failed"' in str(results[0].content)
    assert "do not search again" in str(results[0].content)
    for later in results[1:]:
        assert '"web_lookup_not_working"' in str(later.content)
        assert "do not search again" in str(later.content)
    # The finished reply shows the failure once, in plain words.
    blocks = [b for b in (_replies(db)[-1].blocks or []) if b.get("t") == "steps"]
    steps: list[dict[str, Any]] = blocks[-1]["items"]  # type: ignore[assignment]
    assert [s["tool"] for s in steps] == ["web_search"]
    assert steps[0]["summary"] == turn.WEB_FAILED_SAYS
    assert "Couldn't finish" not in str(steps)
    assert any(e["type"] == "TEXT_MESSAGE_CONTENT" for e in events)


def test_working_searches_still_run_up_to_the_cap(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    searched = _searches(monkeypatch)
    foods = [
        "Oatside latte",
        "Selecta cream puff",
        "Gardenia red bean",
        "Magnum royal",
        "Nissin cup noodles",
        "Lucky Me pancit canton",
    ]
    model = install(
        monkeypatch,
        *[say("", call("web_search", query=f)) for f in foods],
        say("Done."),
    )
    ask(client, api, "log my snacks")
    assert searched == foods[: services.WEB_SEARCHES]
    last = [m for m in max(model.seen, key=len) if isinstance(m, ToolMessage)][-1]
    assert '"search_limit_reached"' in str(last.content)
