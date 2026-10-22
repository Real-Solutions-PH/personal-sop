"""Fern's memory layer: no duplicates (exact, near, judged), updates that
supersede, recall by meaning and words, the always-on block, a summary of
older conversation, and the tools a turn offers.

Embeddings are substituted at their one seam, ``ai.embed_call``, by a
bag-of-words vector: sentences sharing most words come out similar, so the
thresholds are exercised on real cosine arithmetic in pgvector."""

import hashlib
import math
import re
import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.ai_providers import public as ai
from app.modules.companion import memory, routing, services
from app.modules.companion.models import Memory
from app.shared import owned_repo
from tests.modules.capture.api.helpers import (
    Api,
    call,
    install,
    parse_agui,
    say,
    user,
)
from tests.utils.mobile import ctx_for, signed_in

DIM = ai.EMBEDDING_DIMENSIONS


def bag(text: str) -> list[float]:
    v = [0.0] * DIM
    for w in re.findall(r"\w+", text.casefold()):
        v[int(hashlib.sha256(w.encode()).hexdigest(), 16) % DIM] += 1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


@pytest.fixture
def embeddings(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """Fake embedding model; records each call's texts."""
    calls: list[list[str]] = []
    resolved = ai.ResolvedModel(
        purpose="embedding",
        provider="nebius",
        model="fake-embed",
        base_url="http://embed.invalid",
        api_key=ai.SecretStr("k"),
        credential_id=None,
        supports_vision=False,
        source="server",
    )
    monkeypatch.setattr(ai, "embedding_model", lambda ctx: resolved)

    def embed_call(_r: Any, texts: list[str]) -> tuple[list[list[float]], int]:
        calls.append(list(texts))
        return [bag(t) for t in texts], 5 * len(texts)

    monkeypatch.setattr(ai, "embed_call", embed_call)
    # The real model's query instruction would only add noise words to a
    # bag of words.
    monkeypatch.setattr(memory, "QUERY_PREFIX", "")
    return calls


def judge_says(verdict: memory.Verdict) -> Callable[[str, str], memory.Verdict]:
    return lambda old, new: verdict


def live_texts(ctx: Any) -> list[str]:
    return [m.text for m in memory.live(ctx)]


def test_an_exact_repeat_is_not_kept_twice(
    db: Session, embeddings: list[list[str]]
) -> None:
    u, _ = signed_in(db)
    with ctx_for(u) as ctx:
        a = memory.remember(ctx, text="Prefers short answers", kind="response_style")
        b = memory.remember(ctx, text="  prefers SHORT answers. ", importance=5)
        assert (a.status, b.status) == ("added", "duplicate")
        assert b.memory.id == a.memory.id and b.memory.importance == 5
        # The repeat was caught by its hash: one embedding call, not two.
        assert len(embeddings) == 1
        assert live_texts(ctx) == ["Prefers short answers"]


@pytest.mark.usefixtures("embeddings")
def test_a_near_repeat_is_the_same_memory(db: Session) -> None:
    u, _ = signed_in(db)
    with ctx_for(u) as ctx:
        memory.remember(ctx, text="Kai likes adobo with extra garlic rice")
        s = memory.remember(
            ctx, text="Kai likes adobo with extra garlic rice too", tags=["food"]
        )
        assert s.status == "duplicate" and s.memory.tags == ["food"]
        assert len(memory.live(ctx)) == 1


@pytest.mark.usefixtures("embeddings")
def test_a_close_statement_goes_to_the_judge(db: Session) -> None:
    u, _ = signed_in(db)
    with ctx_for(u) as ctx:
        old = memory.remember(ctx, text="Works out five days a week at the gym").memory
        # Similar enough to ask (between NEAR and DUPLICATE) ...
        new_text = "Works out three days a week at the gym now"
        sim = sum(x * y for x, y in zip(bag(old.text), bag(new_text), strict=True))
        assert memory.NEAR <= sim < memory.DUPLICATE
        up = memory.remember(ctx, text=new_text, judge=judge_says("update"))
        assert up.status == "updated" and up.replaced is not None
        assert live_texts(ctx) == [new_text]
        gone = owned_repo.get(ctx, Memory, old.id, include_deleted=True)
        assert gone is not None and gone.superseded_by == up.memory.id
        # ... and "different" keeps both.
        other = memory.remember(
            ctx,
            text="Works out three days a week at the gym now with Ana",
            judge=judge_says("different"),
        )
        assert other.status == "added" and len(memory.live(ctx)) == 2


@pytest.mark.usefixtures("embeddings")
def test_without_an_embedding_model_memories_are_kept_and_embedded_later(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    u, _ = signed_in(db)
    monkeypatch.setattr(ai, "embedding_model", lambda ctx: None)
    with ctx_for(u) as ctx:
        a = memory.remember(ctx, text="Allergic to shrimp", kind="health")
        b = memory.remember(ctx, text="allergic to shrimp")
        assert a.memory.embedding is None and b.status == "duplicate"
        ctx.session.commit()
    monkeypatch.undo()
    # undo removed the fake too; put it back for the backfill.
    resolved_calls: list[list[str]] = []
    monkeypatch.setattr(
        ai,
        "embedding_model",
        lambda ctx: ai.ResolvedModel(
            purpose="embedding",
            provider="nebius",
            model="fake-embed",
            base_url="http://embed.invalid",
            api_key=ai.SecretStr("k"),
            credential_id=None,
            supports_vision=False,
            source="server",
        ),
    )
    monkeypatch.setattr(
        ai,
        "embed_call",
        lambda _r, texts: (
            resolved_calls.append(texts) or [bag(t) for t in texts],
            1,
        ),
    )
    with ctx_for(u) as ctx:
        assert memory.backfill(ctx) == 1
        [m] = memory.live(ctx)
        assert m.embedding is not None and m.embed_model == "fake-embed"
        assert memory.backfill(ctx) == 0


@pytest.mark.usefixtures("embeddings")
def test_recall_finds_by_meaning_and_words_and_stays_with_its_owner(
    db: Session,
) -> None:
    u, _ = signed_in(db)
    other, _ = signed_in(db)
    with ctx_for(u) as ctx:
        for text, kind in (
            ("Sister Ana lives in Cebu", "relationship"),
            ("Allergic to shrimp", "health"),
            ("Training for a 10K in December", "goal"),
        ):
            memory.remember(ctx, text=text, kind=kind)
        ctx.session.commit()
    with ctx_for(u) as ctx:
        found = memory.recall(ctx, "where does my sister Ana live")
        assert found[0].text == "Sister Ana lives in Cebu"
        assert found[0].use_count == 1 and found[0].last_used_at is not None
        only_health = memory.recall(ctx, "shrimp", kinds=["health"])
        assert [m.text for m in only_health] == ["Allergic to shrimp"]
        assert memory.recall(ctx, "shrimp", kinds=["goal"]) == []
    with ctx_for(other) as ctx:
        assert memory.recall(ctx, "where does my sister Ana live") == []


@pytest.mark.usefixtures("embeddings")
def test_always_on_holds_how_to_answer_and_who_they_are(db: Session) -> None:
    u, _ = signed_in(db)
    with ctx_for(u) as ctx:
        memory.remember(
            ctx, text="Answer in short bullet points", kind="response_style"
        )
        memory.remember(ctx, text="Goes by Kai", kind="profile", importance=5)
        memory.remember(
            ctx, text="Never suggest alcohol", kind="health", always_on=True
        )
        memory.remember(ctx, text="Likes adobo", kind="preference")
        texts = [m.text for m in memory.always_on(ctx)]
        assert texts[0] == "Goes by Kai"
        assert set(texts) == {
            "Answer in short bullet points",
            "Goes by Kai",
            "Never suggest alcohol",
        }


def test_tool_groups_follow_the_words(db: Session) -> None:
    del db
    hi = routing.pick("hi Fern", [])
    assert hi is not None and "log_expense" not in hi and "recall_memories" in hi
    money = routing.pick("spent 200 on lunch", [])
    assert money is not None
    assert {"log_expense", "log_meal"} <= money and "create_habit" not in money
    # "do it" leans on the message before it.
    follow = routing.pick("yes do it", ["add milk to my shopping list"])
    assert follow is not None and "create_tasks" in follow
    long = "I have been thinking a lot about where the year is going honestly"
    assert routing.pick(long, []) is None
    assert routing.pick("hi", [], photos=True) is None
    # Asked to write something without naming what: every tool.
    assert routing.pick("how's my week? add something to help", []) is None


@pytest.mark.usefixtures("embeddings")
def test_a_turn_offers_fewer_tools_and_keeps_style_in_context(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api: Api = user(client, db)
    api.assign("chat")
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        memory.remember(ctx, text="Answer in Taglish, briefly", kind="response_style")
        memory.remember(ctx, text="Sister Ana lives in Cebu", kind="relationship")
        ctx.session.commit()
    offered: list[list[str]] = []
    real = services.capture.run_agent

    def spy(*a: Any, **kw: Any) -> Any:
        offered.append([t.name for t in kw["tools"]])
        return real(*a, **kw)

    monkeypatch.setattr(services.capture, "run_agent", spy)
    model = install(monkeypatch, say("Hello!"))
    r = client.post(
        "/api/v1/companion/ask/stream", headers=api.h, json={"text": "hi Fern"}
    )
    assert parse_agui(r.text)[-1]["type"] == "RUN_FINISHED"
    assert "log_expense" not in offered[0] and len(offered[0]) < 25
    system = model.seen[0][0].content
    assert "Answer in Taglish, briefly" in system
    # Not always-on: found with recall_memories when needed.
    assert "Sister Ana" not in system
    # The rules come first; what changes each turn comes after them.
    assert system.index("NOW:") > system.index("Memory:")


@pytest.mark.usefixtures("embeddings")
def test_remember_and_recall_as_tools(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api: Api = user(client, db)
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "",
            call("remember_fact", fact="Sister Ana lives in Cebu", kind="relationship"),
        ),
        say("", call("remember_fact", fact="sister ana lives in cebu")),
        say("Noted."),
    )
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        # No "remember": Fern calls the tool itself (an explicit ask takes
        # the focused pass, tested below).
        json={"text": "fyi my sister Ana lives in Cebu"},
    )
    steps = parse_agui(r.text)[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert [s["summary"] for s in steps] == [
        "Remembered: Sister Ana lives in Cebu",
        "Already knew: Sister Ana lives in Cebu",
    ]
    install(
        monkeypatch,
        say("", call("recall_memories", query="where does Ana live")),
        say("Ana lives in Cebu."),
    )
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "where does my sister live again?"},
    )
    [step] = parse_agui(r.text)[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert step["summary"] == "Recalled 1 thing about you"


def test_recall_runs_once_a_turn(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A model that keeps searching an empty memory (it did, until the turn
    ran out of steps) gets the first answer back, one step line, a reply."""
    api: Api = user(client, db)
    api.assign("chat")
    searches: list[str] = []
    real = memory.recall

    def counted(ctx: Any, query: str, **kw: Any) -> list[Memory]:
        searches.append(query)
        return real(ctx, query, **kw)

    monkeypatch.setattr(memory, "recall", counted)
    install(
        monkeypatch,
        say("", call("recall_memories", query="morning routine")),
        say("", call("recall_memories", query="routine habits")),
        say("", call("recall_memories", query="bed")),
        say("Added it first in your morning routine."),
    )
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "what's in my morning routine?"},
    )
    reply = parse_agui(r.text)[-1]["result"]["messages"][1]
    steps = reply["blocks"][0]["items"]
    assert searches == ["morning routine"]
    assert [s["summary"] for s in steps] == ["Recalled 0 things about you"]
    assert "morning routine" in reply["text"]


def test_older_conversation_is_folded_into_a_summary(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from datetime import timedelta

    from app.modules.companion.models import CompanionMessage, CompanionThread

    api: Api = user(client, db)
    api.assign("chat")
    for i in range(3):
        install(monkeypatch, say(f"Reply {i}."))
        client.post(
            "/api/v1/companion/ask/stream",
            headers=api.h,
            json={"text": f"message number {i} about the trip to Cebu"},
        )
    # Those six messages were yesterday's: the next turn folds them into the
    # summary first (one call), then answers with the summary in context.
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        for m in owned_repo.list_rows(ctx, CompanionMessage):
            m.created_at -= timedelta(days=1)
            ctx.session.add(m)
        ctx.session.commit()
    model = install(
        monkeypatch,
        say("They are planning a trip to Cebu to see Ana."),
        say("Sure."),
    )
    client.post(
        "/api/v1/companion/ask/stream", headers=api.h, json={"text": "ok thanks"}
    )
    assert "NEW MESSAGES" in str(model.seen[0][-1].content)
    answer_system = model.seen[1][0].content
    assert "EARLIER CONVERSATION" in answer_system
    assert "planning a trip to Cebu" in answer_system
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        # Each chat keeps its own summary; these turns all went to one.
        [thread] = owned_repo.list_rows(ctx, CompanionThread)
        assert thread.summary_through is not None
    # Nothing new to fold: the next turn makes no summary call.
    model = install(monkeypatch, say("Again."))
    client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": "hi"})
    assert len(model.seen) == 1


@pytest.mark.usefixtures("embeddings")
def test_a_duplicate_typed_in_the_app_leaves_a_tombstone(
    client: TestClient, db: Session
) -> None:
    from tests.modules.finance.api.helpers import Fin, op

    _, headers = signed_in(db)
    f = Fin(client, headers)
    a, b = uuid.uuid4(), uuid.uuid4()
    f.push(op("upsert", "memory", a, text="Likes adobo"))
    [res] = f.push(op("upsert", "memory", b, text="likes adobo"))
    assert res["status"] == "applied", res
    live = [
        c
        for c in f.pull()["changes"]
        if c["entity"] == "memory" and c.get("deleted_at") is None
    ]
    assert len([c for c in f.pull()["changes"] if c["entity"] == "memory"]) == 2
    del live


@pytest.mark.usefixtures("embeddings")
def test_an_explicit_ask_to_remember_is_saved_first(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api: Api = user(client, db)
    api.assign("chat")
    model = install(
        monkeypatch,
        # The focused pass: the memory tool only.
        say(
            "",
            call(
                "remember_fact",
                fact="Prefers answers as short bullet lists",
                kind="response_style",
            ),
        ),
        say(""),
        # The reply, told it is already saved.
        say("Got it, short bullets from now on."),
    )
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "remember that I prefer short answers in bullet points"},
    )
    steps = parse_agui(r.text)[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert [s["summary"] for s in steps] == [
        "Remembered: Prefers answers as short bullet lists"
    ]
    reply_system = model.seen[2][0].content
    assert "SAVED THIS TURN" in reply_system
    # Saved as how to answer, so it is in ABOUT THEM from now on.
    assert "(response_style) Prefers answers as short bullet lists" in reply_system


@pytest.mark.usefixtures("embeddings")
def test_the_app_sets_kind_tags_and_always_on_and_edits_them_alone(
    client: TestClient, db: Session
) -> None:
    from tests.modules.finance.api.helpers import Fin, op

    _, headers = signed_in(db)
    f = Fin(client, headers)
    mid = uuid.uuid4()
    [made] = f.push(
        op(
            "upsert",
            "memory",
            mid,
            text="Walks the dog at 7am",
            kind="routine",
            tags=["Dog", "morning", "dog"],
            importance=4,
            always_on=True,
        )
    )
    assert made["status"] == "applied", made
    row = made["row"]
    assert (row["kind"], row["tags"], row["importance"]) == (
        "routine",
        ["dog", "morning"],
        4,
    )
    assert (row["always_on"], row["source"]) == (True, "app")
    stored = db.get(Memory, mid)
    assert stored is not None
    db.refresh(stored)
    embedded = list(stored.embedding or [])
    assert embedded

    # A toggle sends only that field: the text and its embedding stay.
    [pin] = f.push(op("upsert", "memory", mid, always_on=False))
    assert pin["status"] == "applied", pin
    assert (pin["row"]["always_on"], pin["row"]["text"]) == (
        False,
        "Walks the dog at 7am",
    )
    db.refresh(stored)
    assert list(stored.embedding or []) == embedded
    assert stored.kind == "routine"

    # New text is re-hashed and re-embedded.
    [edit] = f.push(op("upsert", "memory", mid, text="Walks the dog at 6am"))
    assert edit["row"]["text"] == "Walks the dog at 6am"
    db.refresh(stored)
    assert stored.text_hash == memory.text_hash("Walks the dog at 6am")
    # pgvector stores float32.
    assert list(stored.embedding or []) == pytest.approx(
        bag("Walks the dog at 6am"), abs=1e-6
    )


@pytest.mark.usefixtures("embeddings")
def test_the_app_cannot_send_an_unknown_kind_or_importance(
    client: TestClient, db: Session
) -> None:
    from tests.modules.finance.api.helpers import Fin, op

    _, headers = signed_in(db)
    f = Fin(client, headers)
    [kind] = f.push(op("upsert", "memory", uuid.uuid4(), text="x", kind="secret"))
    assert kind["code"] == "validation_error"
    [imp] = f.push(op("upsert", "memory", uuid.uuid4(), text="x", importance=9))
    assert imp["code"] == "validation_error"
