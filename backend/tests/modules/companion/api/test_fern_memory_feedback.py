"""Fern's memory shapes its answers, and it hears and learns from feedback.

Seen live (2026-10-30/31): "I always use zero-calorie sugar at De-Stresso",
said while logging a drink, was never kept (a turn that logged anything was
never read for facts), and the next estimate had 24 g of sugar; "JUST
FICKING GIVE ME THE PORTION…" was recorded nowhere.
"""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import BaseMessage, SystemMessage
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.companion import feedback, memory, services
from app.modules.companion.models import (
    CompanionMessage,
    FernFeedback,
    FernRule,
    FernRuleVote,
    Memory,
)
from tests.modules.capture.api.helpers import Api, install, parse_agui, say, user
from tests.utils.mobile import ctx_for


@pytest.fixture(autouse=True)
def _no_shared_rules() -> Any:
    """Shared rules are app-wide (no owner to clean up with the user): each
    test starts and ends without any."""
    from sqlalchemy import delete

    def wipe() -> None:
        with Session(db_engine) as s:
            s.exec(delete(FernRule))  # type: ignore[call-overload]
            s.commit()

    wipe()
    yield
    wipe()


def tool(name: str, /, **args: Any) -> dict[str, Any]:
    return {"name": name, "args": args, "id": f"call-{uuid.uuid4().hex[:8]}"}


def ask(api: Api, client: TestClient, text: str, thread: str) -> dict[str, Any]:
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": text, "thread_id": thread},
    )
    assert r.status_code == 200
    reply: dict[str, Any] = parse_agui(r.text)[-1]["result"]["messages"][1]
    return reply


def system_of(messages: list[BaseMessage]) -> str:
    return str(next(m for m in messages if isinstance(m, SystemMessage)).content)


def _calls_with(model: Any, prompt: str) -> list[list[BaseMessage]]:
    return [m for m in model.seen if system_of(m).startswith(prompt[:40])]


# ---------------------------------------------------------------- memory


def test_a_habit_said_while_logging_is_kept_as_inferred(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        say(
            "",
            tool(
                "log_meal",
                description="Iced latte",
                items=[
                    {
                        "name": "iced latte",
                        "qty": 1,
                        "kcal": 90,
                        "protein": 5,
                        "carbs": 9,
                        "fat": 3.5,
                        "grams": 350,
                    }
                ],
            ),
        ),
        say("Logged the latte."),
        # The pass after the reply reads the message although it logged.
        say(
            "",
            tool(
                "remember_fact",
                fact="Uses zero-calorie sugar in drinks at De-Stresso",
                kind="preference",
            ),
        ),
        say(""),
    )
    ask(
        api,
        client,
        "Had an iced latte for a snack at De-Stresso, I always use zero-cal sugar there",
        str(uuid.uuid4()),
    )
    assert _calls_with(model, services.LEARN)
    with ctx_for(api.user) as ctx:
        (m,) = memory.live(ctx)
    assert (m.text, m.source) == (
        "Uses zero-calorie sugar in drinks at De-Stresso",
        "inferred",
    )


def test_an_asked_for_memory_is_labelled_said(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", tool("remember_fact", fact="Allergic to shrimp", kind="health")),
        say(""),
        say("Noted, no shrimp."),
    )
    ask(api, client, "remember I'm allergic to shrimp", str(uuid.uuid4()))
    with ctx_for(api.user) as ctx:
        (m,) = memory.live(ctx)
    assert m.source == "said"


def test_relevant_memories_reach_the_reply_without_a_tool_call(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    with ctx_for(api.user) as ctx:
        memory.remember(
            ctx,
            text="Uses zero-calorie sugar in drinks at De-Stresso",
            kind="preference",
        )
        memory.remember(ctx, text="Sister Ana studies nursing", kind="relationship")
        ctx.commit()
    model = install(monkeypatch, say("About 90 kcal, no sugar."))
    ask(
        api,
        client,
        "how much sugar is in an iced latte at De-Stresso",
        str(uuid.uuid4()),
    )
    system = system_of(model.seen[0])
    relevant = system[system.index("RELEVANT TO THIS MESSAGE") :]
    assert "zero-calorie sugar in drinks at De-Stresso" in relevant
    assert "Ana" not in relevant
    with ctx_for(api.user) as ctx:
        used = {m.text: m.use_count for m in memory.live(ctx)}
    assert used["Uses zero-calorie sugar in drinks at De-Stresso"] == 1


def test_recall_prefers_the_memory_used_more_among_equals(
    client: TestClient, db: Session
) -> None:
    api = user(client, db, accounts=False)
    with ctx_for(api.user) as ctx:
        a = memory.remember(
            ctx, text="Drinks oat milk lattes", kind="preference"
        ).memory
        b = memory.remember(
            ctx, text="Drinks soy milk lattes", kind="preference"
        ).memory
        b.use_count, b.last_used_at = 12, ctx.now
        ctx.session.add(b)
        ctx.session.flush()
        found = memory.recall(ctx, "lattes", k=2)
        assert [m.id for m in found] == [b.id, a.id]


# ---------------------------------------------------------------- thumbs


def _first_reply(
    api: Api, client: TestClient, monkeypatch: pytest.MonkeyPatch, thread: str
) -> str:
    install(monkeypatch, say("Rice is about 200 kcal a cup."))
    return str(ask(api, client, "how many calories in rice", thread)["id"])


def test_a_thumb_is_set_changed_and_cleared(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    reply = _first_reply(api, client, monkeypatch, str(uuid.uuid4()))
    up = api.put(f"/companion/messages/{reply}/feedback", {"rating": "up"})
    assert (up["rating"], up["reason"]) == ("up", None)
    down = api.put(
        f"/companion/messages/{reply}/feedback",
        {"rating": "down", "reason": "too_long", "note": "just the number please"},
    )
    assert (down["rating"], down["reason"], down["note"]) == (
        "down",
        "too_long",
        "just the number please",
    )
    with Session(db_engine) as s:
        rows = s.exec(
            select(FernFeedback).where(FernFeedback.owner_id == api.user.id)
        ).all()  # type: ignore[attr-defined]
        assert [(r.kind, r.rating, r.digested) for r in rows] == [
            ("thumb", "down", False)
        ]
    assert api.put(f"/companion/messages/{reply}/feedback", {"rating": None}) is None
    with Session(db_engine) as s:
        assert not s.exec(
            select(FernFeedback).where(FernFeedback.owner_id == api.user.id)
        ).all()  # type: ignore[attr-defined]


def test_only_a_fern_reply_takes_a_thumb(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    thread = str(uuid.uuid4())
    _first_reply(api, client, monkeypatch, thread)
    with Session(db_engine) as s:
        mine = s.exec(
            select(CompanionMessage).where(
                CompanionMessage.owner_id == api.user.id,  # type: ignore[attr-defined]
                CompanionMessage.role == "me",
            )
        ).one()
    api.put(f"/companion/messages/{mine.id}/feedback", {"rating": "up"}, status=404)
    other = user(client, db, accounts=False)
    reply = _first_reply(api, client, monkeypatch, thread)
    other.put(f"/companion/messages/{reply}/feedback", {"rating": "up"}, status=404)


# ---------------------------------------------------------------- implicit


@pytest.mark.parametrize(
    ("text", "signal"),
    [
        ("JUST FICKING GIVE ME THE PORTION", "frustration"),
        ("wtf that's not it", "frustration"),
        ("that's wrong, try again", "correction"),
        ("No, I said 2 cups", "correction"),
        ("mali yan", "correction"),
        ("what's for dinner?", None),
        ("I had 2 cups of rice", None),
        ("OK", None),
    ],
)
def test_pushback_is_read_from_words(text: str, signal: str | None) -> None:
    assert feedback.classify(text) == signal


def test_frustration_is_recorded_on_the_reply_and_its_wish_kept(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    thread = str(uuid.uuid4())
    first = _first_reply(api, client, monkeypatch, thread)
    model = install(
        monkeypatch,
        say("200 g rice, 150 g chicken."),
        say(
            "",
            tool(
                "remember_fact",
                fact="Wants portions given directly in grams per food, no preamble",
                kind="response_style",
            ),
        ),
        say(""),
    )
    ask(api, client, "JUST FICKING GIVE ME THE PORTION", thread)
    # The learn pass: its first call (the second only ends it).
    learned = _calls_with(model, services.LEARN)[0]
    # The learn pass saw the reply it pushes back on.
    assert "Rice is about 200 kcal" in str(learned[-1].content)
    with Session(db_engine) as s:
        (fb,) = s.exec(
            select(FernFeedback).where(FernFeedback.owner_id == api.user.id)
        ).all()  # type: ignore[attr-defined]
        assert (str(fb.message_id), fb.kind, fb.rating) == (
            first,
            "frustration",
            "down",
        )
    with ctx_for(api.user) as ctx:
        (m,) = memory.live(ctx)
    assert (m.kind, m.source) == ("response_style", "inferred")


def test_an_undone_card_counts_against_its_reply(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    thread = str(uuid.uuid4())
    install(
        monkeypatch,
        say("", tool("log_expense", amount=150, payee="De-Stresso", category="dining")),
        say("Logged ₱150 at De-Stresso."),
    )
    reply = ask(api, client, "spent 150 at de-stresso", thread)
    card = next(
        i["card_id"]
        for b in reply["blocks"]
        if b["t"] == "steps"
        for i in b["items"]
        if i.get("card_id")
    )
    # Saved at once (an expense needs no Confirm): taking it back is Undo.
    api.post(f"/capture/cards/{card}/undo")
    install(monkeypatch, say("Sure."))
    ask(api, client, "ok thanks", thread)
    with Session(db_engine) as s:
        (fb,) = s.exec(
            select(FernFeedback).where(FernFeedback.owner_id == api.user.id)
        ).all()  # type: ignore[attr-defined]
        assert (str(fb.message_id), fb.kind) == (reply["id"], "undo")


# ---------------------------------------------------------------- shared rules

RULE = "When asked for a portion, give grams per food first, then the macros left."


@pytest.mark.parametrize(
    ("rule", "kept"),
    [
        (RULE, True),
        ("Keep answers to two sentences unless asked for detail.", True),
        ("NONE", False),
        ("Give 200 g portions.", False),  # a number
        ("When Kai asks, answer in grams.", False),  # a name
        ("Always assume zero-calorie sugar at cafés.", False),  # their words
        ("Mention the latte sugar first when asked.", False),  # their word
        ("Email answers to them.", False),  # too short
    ],
)
def test_a_rule_holds_nothing_about_the_person(rule: str, kept: bool) -> None:
    private = "Kai kai@example.com Had a latte at De-Stresso with zero-calorie sugar"
    assert (feedback.deidentified(rule, private=private) is not None) is kept


def _superuser(api: Api) -> None:
    # A first request syncs the user row from the auth provider; flip the
    # flag after it, or the sync puts it back.
    api.get("/companion/")
    # The test's own user object too: ctx_for merges it back into the row.
    api.user.is_superuser = True  # type: ignore[attr-defined]
    with Session(db_engine) as s:
        u = s.merge(api.user)  # type: ignore[attr-defined]
        u.is_superuser = True
        s.add(u)
        s.commit()


def test_a_thumbs_down_note_proposes_a_rule_applied_only_once_approved(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    thread = str(uuid.uuid4())
    reply = _first_reply(api, client, monkeypatch, thread)
    api.put(
        f"/companion/messages/{reply}/feedback",
        {"rating": "down", "reason": "too_long", "note": "just give me the grams"},
    )
    model = install(
        monkeypatch,
        say("Sure, 180 g."),
        # After the reply: the note read for the person (pushback), then
        # generalised for every Fern.
        say(
            "",
            tool("remember_fact", fact="Wants grams, not prose", kind="response_style"),
        ),
        say(""),
        say(RULE),
    )
    ask(api, client, "and for chicken breast?", thread)
    assert _calls_with(model, feedback.GENERALISE)
    with Session(db_engine) as s:
        (rule,) = s.exec(select(FernRule)).all()
        assert (rule.text, rule.status, rule.evidence, rule.users) == (
            RULE,
            "proposed",
            1,
            1,
        )
        (vote,) = s.exec(select(FernRuleVote)).all()
        # Who voted is a keyed hash, not the user id.
        assert str(api.user.id) not in vote.voter  # type: ignore[attr-defined]
        (fb,) = s.exec(
            select(FernFeedback).where(FernFeedback.owner_id == api.user.id)
        ).all()  # type: ignore[attr-defined]
        assert fb.digested
    # Proposed: not yet in anyone's context.
    model = install(monkeypatch, say("Fine."))
    ask(api, client, "thanks", thread)
    assert "HOW TO ANSWER" not in system_of(model.seen[0])

    api.get("/companion/fern-rules", status=403)
    _superuser(api)
    (listed,) = api.get("/companion/fern-rules")
    assert listed["status"] == "proposed"
    api.patch(f"/companion/fern-rules/{listed['id']}", {"status": "approved"})
    other = user(client, db, accounts=False)
    other.assign("chat")
    model = install(monkeypatch, say("Fine."))
    ask(other, client, "how much rice should I eat", str(uuid.uuid4()))
    system = system_of(model.seen[0])
    assert RULE in system[system.index("HOW TO ANSWER") :]


def test_a_rewording_must_stay_general(client: TestClient, db: Session) -> None:
    api = user(client, db, accounts=False)
    _superuser(api)
    with ctx_for(api.user) as ctx:
        rule = feedback.add_support(ctx, RULE)
        ctx.commit()
        rid = rule.id
    api.patch(
        f"/companion/fern-rules/{rid}",
        {"status": "approved", "text": "Give Kai 200 g portions every time."},
        status=422,
    )


def test_enough_people_make_a_rule_apply_without_approval(
    client: TestClient, db: Session
) -> None:
    api = user(client, db, accounts=False)
    with ctx_for(api.user) as ctx:
        rule = feedback.add_support(ctx, RULE)
        rule.users, rule.evidence = feedback.AUTO_USERS - 1, feedback.AUTO_EVIDENCE
        ctx.session.add(rule)
        ctx.commit()
        assert RULE not in feedback.active_rules(ctx)
        rule.users = feedback.AUTO_USERS
        ctx.session.add(rule)
        ctx.commit()
        assert RULE in feedback.active_rules(ctx)
        rule.status = "rejected"
        ctx.session.add(rule)
        ctx.commit()
        assert RULE not in feedback.active_rules(ctx)
        ctx.session.delete(rule)
        ctx.commit()


def test_memory_rows_are_untouched_by_rules(client: TestClient, db: Session) -> None:
    """A shared rule never becomes anyone's memory row."""
    api = user(client, db, accounts=False)
    with ctx_for(api.user) as ctx:
        rule = feedback.add_support(ctx, RULE)
        ctx.commit()
        assert not ctx.session.exec(
            select(Memory).where(Memory.owner_id == ctx.user_id)
        ).all()
        ctx.session.delete(rule)
        ctx.commit()
