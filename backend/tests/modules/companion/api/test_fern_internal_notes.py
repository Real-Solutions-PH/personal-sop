"""A reply never carries the internal record of what a turn did, and never
points at a Confirm that isn't there.

Seen live on 2026-10-30: a reply ended with a literal
"[Done this turn: Dropped meal: …; Logged meal: … (waiting for your OK)]"
copied from the history's format, and said "tap Confirm" after a turn whose
only write was dropping the earlier meal, with nothing left to confirm.
"""

import json
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.capture.models import RecordCard
from app.modules.companion import services
from app.modules.companion.turn import Step, TurnStream
from app.shared.context import Ctx
from tests.modules.capture.api.helpers import Api, call, install, parse_agui, say, user

NOTE = "[Done this turn: Dropped meal: Matcha; Logged meal: Buko pandan (waiting for your OK)]"


def stream(api: Api, client: TestClient, text: str) -> list[dict[str, Any]]:
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": text})
    assert r.status_code == 200
    return parse_agui(r.text)


def reply_of(events: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = events[-1]["result"]["messages"][1]
    return out


def streamed(events: list[dict[str, Any]]) -> str:
    return "".join(
        e["delta"] for e in events if e.get("type") == "TEXT_MESSAGE_CONTENT"
    )


def earlier_section(messages: list[BaseMessage]) -> str:
    system = next(m for m in messages if isinstance(m, SystemMessage))
    text = str(system.content)
    return text[text.index("WHAT YOUR EARLIER REPLIES TODAY DID") :]


def meal_cards(api: Api) -> list[RecordCard]:
    with Session(db_engine) as s:
        rows = s.exec(
            select(RecordCard)
            .where(RecordCard.owner_id == api.user.id)  # type: ignore[attr-defined]
            .where(RecordCard.kind == "meal")
            .order_by(RecordCard.created_at)  # type: ignore[arg-type]
        ).all()
        return list(rows)


def meal(name: str, kcal: float = 200) -> dict[str, Any]:
    # Confidence under 0.7: the meal waits for the person's OK.
    return {
        "description": name,
        "items": [
            {
                "name": name,
                "kcal": kcal,
                "carbs": kcal / 4,
                "sugar": 0,
                "sodium": 0,
                "grams": 100,
            }
        ],
        "confidence": 0.5,
    }


# ------------------------------------------------------------ strip_internal


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (f"Buko pandan is logged.\n{NOTE}", "Buko pandan is logged."),
        (f"Logged it. {NOTE} Anything else?", "Logged it.  Anything else?"),
        ("[Already done: Searched the web]\nHere it is.", "Here it is."),
        ("Marked it [urgent] like you said.", "Marked it [urgent] like you said."),
        ("(about 200 kcal) and done.", "(about 200 kcal) and done."),
        (NOTE, ""),
    ],
)
def test_strip_internal_removes_only_the_internal_note(
    text: str, expected: str
) -> None:
    assert services.strip_internal(text) == expected


def test_a_reply_that_is_only_the_note_and_did_nothing_stores_no_text(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say(NOTE))
    events = stream(api, client, "hello")
    assert reply_of(events)["text"] is None


# ------------------------------------------------------------ streaming


def test_a_copied_note_is_neither_streamed_nor_stored(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    # Long enough to stream past the hold at the start of a reply; the
    # scripted model sends it word by word, so the note's "[Done this turn"
    # arrives split across three deltas.
    words = "The buko pandan salad is about 180 kcal for a cup. " * 6
    install(monkeypatch, say(f"{words.strip()}\n{NOTE}"))
    events = stream(api, client, "how much is a cup of buko pandan salad")
    assert "[Done this turn" not in streamed(events)
    assert "Done this turn" not in (reply_of(events)["text"] or "")
    assert reply_of(events)["text"] == words.strip()


# Streaming text never reads the context.
NO_CTX = cast(Ctx, None)


def deltas(stream_: TurnStream, events: list[Any]) -> str:
    del stream_
    return "".join(
        getattr(e, "delta", "")
        for e in events
        if type(e).__name__ == "TextMessageContentEvent"
    )


def test_the_stream_holds_a_note_split_across_deltas() -> None:
    seen: list[Any] = []
    s = TurnStream(ctx=NO_CTX, thread_id="t", run_id="r", sink=seen.append)
    s.text("x" * 300)  # past the hold at the start of a reply
    for piece in ("Saved. [Do", "ne th", "is turn: Logged meal: X]", "\nBye (soon)."):
        s.text(piece)
    s.end_text()
    out = deltas(s, seen)
    assert "Done" not in out and "Logged meal" not in out
    assert out.endswith("Saved. \nBye (soon).")


def test_a_bracket_of_the_persons_own_streams_unchanged() -> None:
    seen: list[Any] = []
    s = TurnStream(ctx=NO_CTX, thread_id="t", run_id="r", sink=seen.append)
    s.text("x" * 300)
    for piece in ("Tagged it [ur", "gent] (as", "ked)."):
        s.text(piece)
    s.end_text()
    assert deltas(s, seen).endswith("Tagged it [urgent] (asked).")


def test_a_note_still_open_when_the_text_ends_is_dropped() -> None:
    seen: list[Any] = []
    s = TurnStream(ctx=NO_CTX, thread_id="t", run_id="r", sink=seen.append)
    s.text("y" * 300 + " ok [Done this turn: Logged")
    s.end_text()
    assert deltas(s, seen) == "y" * 300 + " ok "


# ------------------------------------------------------------ unbacked_claim


def step(name: str, *, ok: bool = True, summary: str = "x") -> Step:
    return Step(call_id=name, name=name, label=name, ok=ok, summary=summary)


@pytest.mark.parametrize("wrote", [True, False])
def test_pointing_at_confirm_is_backed_only_by_a_card_still_waiting(
    wrote: bool,
) -> None:
    steps = [step("discard_pending", summary="Dropped: meal: Matcha")] if wrote else []
    for answer in (
        "Buko pandan is waiting for your OK — tap Confirm.",
        'Just say "confirm" and it is saved.',
        "It's ready to confirm.",
    ):
        assert services.unbacked_claim("less sweet", answer, steps, waiting=False)
        assert not services.unbacked_claim("less sweet", answer, steps, waiting=True)


@pytest.mark.parametrize("waiting", [True, False])
def test_a_claimed_write_is_unbacked_only_when_nothing_was_written(
    waiting: bool,
) -> None:
    asked = "log 62.4 kg today"
    assert services.unbacked_claim(asked, "Logged your weigh-in.", [], waiting=waiting)
    assert not services.unbacked_claim(
        asked, "Logged your weigh-in.", [step("log_weigh_in")], waiting=waiting
    )


def test_the_time_you_proposed_is_not_pointing_at_confirm() -> None:
    answer = "I moved it to the time you proposed."
    assert not services._POINTS_AT_CONFIRM.search(answer)
    assert not services.unbacked_claim(
        "move my walk to 6pm", answer, [step("edit_task")], waiting=False
    )


def test_drop_confirm_talk_keeps_what_was_done() -> None:
    out = services.drop_confirm_talk(
        "Dropped the matcha. Buko pandan is waiting for your OK — tap Confirm.\n"
        "It has about 180 kcal."
    )
    assert out == (
        "Dropped the matcha.\nIt has about 180 kcal.\n\n" + services.NOTHING_TO_CONFIRM
    )


# ------------------------------------------------------------ the turn


def test_a_drop_does_not_back_tap_confirm(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_meal", **meal("Matcha soft-serve"))),
        say("The matcha is waiting for your OK."),
    )
    stream(api, client, "log this matcha soft-serve")
    model = install(
        monkeypatch,
        say("", call("discard_pending")),
        say("Dropped the matcha. Buko pandan is waiting for your OK — tap Confirm."),
        say("Dropped the matcha. Tap Confirm to save the buko pandan."),
    )
    events = stream(api, client, "actually drop that, buko pandan salad instead")
    # The corrective pass ran (a third model call), and its reply still
    # pointed at a Confirm: those sentences go, the drop stays.
    assert len(model.seen) == 3
    assert reply_of(events)["text"] == (
        "Dropped the matcha.\n\n" + services.NOTHING_TO_CONFIRM
    )
    assert [c.state for c in meal_cards(api)] == ["discarded"]


def test_a_meal_waiting_from_this_reply_backs_tap_confirm(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    answer = "The matcha soft-serve is waiting for your OK — tap Confirm."
    model = install(
        monkeypatch,
        say("", call("log_meal", **meal("Matcha soft-serve"))),
        say(answer),
    )
    events = stream(api, client, "log this matcha soft-serve")
    assert len(model.seen) == 2  # no corrective pass
    assert reply_of(events)["text"] == answer


def test_a_write_with_nothing_waiting_may_say_proposed(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    answer = "I set it up at the time you proposed."
    model = install(
        monkeypatch,
        say(
            "",
            {
                "name": "create_habit",
                "args": {"name": "Walk", "icon": "🚶"},
                "id": "call-habit",
            },
        ),
        say(answer),
    )
    events = stream(api, client, "add a walk habit at 6pm")
    assert len(model.seen) == 2
    assert reply_of(events)["text"] == answer


@pytest.mark.parametrize(
    "answer",
    ['Nothing new. Just say "confirm" to save it.', "It's ready to confirm."],
)
def test_confirm_talk_with_nothing_waiting_gets_corrected(
    answer: str,
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say(answer), say(answer))
    events = stream(api, client, "what's on today")
    # A question turn keeps its words; only the Confirm talk goes.
    assert reply_of(events)["text"] == services.drop_confirm_talk(answer)
    assert "confirm" not in services.drop_confirm_talk(answer).split("\n")[0].lower()


# ------------------------------------------------------------ this turn's cards


def test_discard_pending_leaves_the_meal_this_reply_made(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_meal", **meal("Matcha soft-serve"))),
        say("The matcha is waiting for your OK."),
    )
    stream(api, client, "log this matcha soft-serve")
    install(
        monkeypatch,
        say(
            "",
            call("log_meal", **meal("Buko pandan salad")),
            call("discard_pending"),
        ),
        say("Dropped the matcha; the buko pandan is waiting for your OK."),
    )
    events = stream(api, client, "I ate buko pandan salad instead")
    old, new = meal_cards(api)
    assert (old.state, new.state) == ("discarded", "proposed")
    items = reply_of(events)["blocks"][0]["items"]
    logged = next(i for i in items if i["tool"] == "log_meal")
    assert logged["state"] == "proposed"
    assert logged["card_id"] == str(new.id)
    assert logged["capture_id"] == str(new.capture_id)
    assert events[-1]["result"]["capture"]["id"] == str(new.capture_id)


def test_confirm_pending_saves_only_what_earlier_replies_left(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_meal", **meal("Matcha soft-serve"))),
        say("The matcha is waiting for your OK."),
    )
    stream(api, client, "log this matcha soft-serve")
    install(
        monkeypatch,
        say(
            "",
            call("log_meal", **meal("Buko pandan salad")),
            call("confirm_pending"),
        ),
        say("Saved the matcha; the buko pandan is waiting for your OK."),
    )
    stream(api, client, "confirm the matcha, and I also ate buko pandan salad")
    old, new = meal_cards(api)
    assert (old.state, new.state) == ("saved", "proposed")


def test_typing_confirm_saves_the_meal_left_waiting(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_meal", **meal("Matcha soft-serve"))),
        say("The matcha is waiting for your OK."),
    )
    stream(api, client, "log this matcha soft-serve")
    install(monkeypatch, say("", call("confirm_pending")), say("Saved the matcha."))
    events = stream(api, client, "confirm")
    assert [c.state for c in meal_cards(api)] == ["saved"]
    s = reply_of(events)["blocks"][0]["items"][0]
    assert s["summary"] == "Saved: meal: Matcha soft-serve"


# ------------------------------------------------------------ the record


def test_earlier_actions_say_what_each_waiting_card_came_to(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_meal", **meal("Matcha soft-serve"))),
        say("The matcha is waiting for your OK."),
    )
    stream(api, client, "log this matcha soft-serve")
    model = install(monkeypatch, say("Sure."))
    stream(api, client, "anything else?")
    section = earlier_section(model.seen[0])
    assert 'answering "log this matcha soft-serve": ' in section
    assert "Logged meal: Matcha soft-serve (waiting for your OK)" in section
    assert "WAITING FOR THEIR OK NOW: meal: Matcha soft-serve" in section

    install(monkeypatch, say("", call("confirm_pending")), say("Saved."))
    stream(api, client, "confirm")
    model = install(monkeypatch, say("Sure."))
    stream(api, client, "and now?")
    section = earlier_section(model.seen[0])
    assert "Logged meal: Matcha soft-serve (saved since)" in section
    assert "(waiting for your OK)" not in section
    assert "WAITING FOR THEIR OK NOW: (nothing)" in section
    # Nothing in the history's replies carries the record.
    assert not any(
        "[Done this turn" in str(m.content)
        for m in model.seen[0]
        if isinstance(m, AIMessage)
    )


def test_a_dropped_card_reads_dropped_since(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_meal", **meal("Matcha soft-serve"))),
        say("The matcha is waiting for your OK."),
    )
    stream(api, client, "log this matcha soft-serve")
    install(monkeypatch, say("", call("discard_pending")), say("Dropped."))
    stream(api, client, "drop it")
    model = install(monkeypatch, say("Sure."))
    stream(api, client, "ok")
    section = earlier_section(model.seen[0])
    assert "Logged meal: Matcha soft-serve (dropped since)" in section
    assert "Dropped: meal: Matcha soft-serve" in section


def test_step_results_carry_the_capture(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_meal", **meal("Matcha soft-serve"))),
        say("The matcha is waiting for your OK."),
    )
    events = stream(api, client, "log this matcha soft-serve")
    result = next(
        json.loads(e["content"])
        for e in events
        if e.get("type") == "TOOL_CALL_RESULT" and "card_id" in e["content"]
    )
    assert result["capture_id"] == events[-1]["result"]["capture"]["id"]
