"""Fern's review of a range (the way back, a week): wins first, at most two
gaps, each with a tiny suggestion. Every point must cite a fact it was
given, nothing about weight or the body gets through, a dismissed or
existing title is never suggested again, and the answer is kept per range
until the facts change. The model is substituted only through
``ai_providers.public.model_factory`` (``install``)."""

import json
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.fitness import public as fitness_public
from app.modules.habits import public as habits_public
from app.modules.tasks import public as tasks_public
from tests.modules.capture.api.helpers import Api, install, say
from tests.utils.mobile import ctx_for, signed_in

REVIEW = "/companion/review"


def api(client: TestClient, db: Session) -> Api:
    u, h = signed_in(db)
    a = Api(client, h)
    a.user = u  # type: ignore[attr-defined]
    return a


def _today(a: Api) -> date:
    with ctx_for(a.user) as ctx:  # type: ignore[attr-defined]
        return ctx.today


def _seed(a: Api) -> None:
    """Two daily habits made 6 days back: Read done on two days, Walk never;
    one task finished yesterday."""
    now = datetime.now(UTC)
    with ctx_for(a.user, now=now) as ctx:  # type: ignore[attr-defined]
        for name in ("Read", "Walk"):
            h = habits_public.create_habit(ctx, name=name, habit_id=uuid.uuid4())
            h.created_at = now - timedelta(days=6)
            ctx.session.add(h)
            if name == "Read":
                for back in (2, 3):
                    habits_public.log_habit(
                        ctx, habit_id=h.id, day=ctx.today - timedelta(days=back)
                    )
        ctx.commit()
    with ctx_for(a.user, now=now) as ctx:  # type: ignore[attr-defined]
        tid = uuid.uuid4()
        tasks_public.create_tasks(
            ctx, [tasks_public.TaskDraft(title="File taxes", task_id=tid)]
        )
        tasks_public.complete_task(ctx, task_id=tid)
        ctx.commit()


def _body(a: Api, **over: Any) -> dict[str, Any]:
    t = _today(a)
    return {
        "kind": "way_back",
        "from_day": (t - timedelta(days=5)).isoformat(),
        "to_day": (t - timedelta(days=1)).isoformat(),
        "dismissed": [],
        **over,
    }


def _answer(wins: list[Any], gaps: list[Any]) -> str:
    return json.dumps({"wins": wins, "gaps": gaps})


def _gap(title: str, kind: str = "habit", cite: str = "f1") -> dict[str, Any]:
    return {
        "text": f"{title} slipped.",
        "how": "Start smaller.",
        "suggestion": {"kind": kind, "title": title, "days_per_week": 3},
        "fact_ids": [cite],
    }


WIN = {"text": "You read on two days.", "fact_ids": ["f1"]}


def test_review_wins_first_and_two_gaps_max(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    a.assign("chat")
    _seed(a)
    gaps = [_gap("10-minute walk after lunch"), _gap("Stretch"), _gap("Journal")]
    install(monkeypatch, say(_answer([WIN], gaps)))
    out = a.post(REVIEW, _body(a))
    assert out["source"] == "ai"
    assert [w["text"] for w in out["wins"]] == ["You read on two days."]
    assert len(out["gaps"]) == 2
    s = out["gaps"][0]["suggestion"]
    assert s == {
        "kind": "habit",
        "title": "10-minute walk after lunch",
        "days_per_week": 3,
    }
    assert "fact_ids" not in out["wins"][0]


def test_review_drops_item_citing_unknown_fact(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    a.assign("chat")
    _seed(a)
    made_up = {"text": "You ran a marathon.", "fact_ids": ["f999"]}
    uncited = {"text": "Great week.", "fact_ids": []}
    install(
        monkeypatch,
        say(_answer([WIN, made_up, uncited], [_gap("Stretch", cite="f999")])),
    )
    out = a.post(REVIEW, _body(a))
    assert [w["text"] for w in out["wins"]] == ["You read on two days."]
    assert out["gaps"] == []


def test_review_drops_body_suggestion(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    a.assign("chat")
    _seed(a)
    body = {
        "text": "Your weight crept up.",
        "how": "Eat less.",
        "suggestion": {"kind": "habit", "title": "Lose 2 kg"},
        "fact_ids": ["f1"],
    }
    install(monkeypatch, say(_answer([WIN], [body, _gap("Stretch")])))
    out = a.post(REVIEW, _body(a))
    assert [g["suggestion"]["title"] for g in out["gaps"]] == ["Stretch"]


def test_review_drops_dismissed_and_existing_titles(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    a.assign("chat")
    _seed(a)
    install(
        monkeypatch,
        say(_answer([WIN], [_gap("read"), _gap("Stretch"), _gap("Journal")])),
    )
    out = a.post(REVIEW, _body(a, dismissed=["stretch"]))
    assert [g["suggestion"]["title"] for g in out["gaps"]] == ["Journal"]


def test_review_never_reads_weigh_ins(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    a.assign("chat")
    _seed(a)
    with ctx_for(a.user) as ctx:  # type: ignore[attr-defined]
        fitness_public.log_weigh_in(ctx, kg=87.3)
        ctx.commit()
    model = install(monkeypatch, say(_answer([WIN], [])))
    a.post(REVIEW, _body(a))
    prompt = " ".join(str(m.content) for m in model.seen[0])
    data = prompt.split("Facts:", 1)[1]
    assert "87.3" not in data and "weigh" not in data.lower()
    assert '"type": "habit"' in data  # the facts are there; weight is not


def test_review_cached_by_fingerprint(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    a.assign("chat")
    _seed(a)
    model = install(
        monkeypatch, say(_answer([WIN], [])), say(_answer([WIN], [_gap("Stretch")]))
    )
    first = a.post(REVIEW, _body(a))
    again = a.post(REVIEW, _body(a))
    assert again == first and len(model.seen) == 1
    # A new record in the range changes the facts: asked again.
    with ctx_for(a.user) as ctx:  # type: ignore[attr-defined]
        walk = habits_public.find_habits(ctx, "Walk")[0]
        habits_public.log_habit(
            ctx, habit_id=walk.id, day=ctx.today - timedelta(days=2)
        )
        ctx.commit()
    third = a.post(REVIEW, _body(a))
    assert len(model.seen) == 2 and len(third["gaps"]) == 1


def test_review_rules_when_ai_off(client: TestClient, db: Session) -> None:
    a = api(client, db)
    _seed(a)
    out = a.post(REVIEW, _body(a))
    assert out["source"] == "rules"
    assert out["wins"]
    assert len(out["gaps"]) <= 2
    titles = [g["suggestion"]["title"] for g in out["gaps"]]
    assert "Plan when to do Walk this week" in titles
    assert all(g["suggestion"]["kind"] in ("habit", "task") for g in out["gaps"])


def test_review_503_on_provider_failure(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = api(client, db)
    a.assign("chat")
    _seed(a)
    install(monkeypatch, fail=True)
    r = a.post(REVIEW, _body(a), status=503)
    assert r["code"] == "review_failed"


def test_review_range_over_31_days_is_422(client: TestClient, db: Session) -> None:
    a = api(client, db)
    t = _today(a)
    a.post(
        REVIEW,
        _body(a, from_day=(t - timedelta(days=40)).isoformat()),
        status=422,
    )


def test_review_cache_ignores_a_tick_outside_the_range(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A habit ticked today (after the range) moves its live streak, but the
    range's facts are the same: the kept review stands, no second call."""
    a = api(client, db)
    a.assign("chat")
    _seed(a)
    model = install(
        monkeypatch, say(_answer([WIN], [])), say(_answer([WIN], [_gap("Stretch")]))
    )
    first = a.post(REVIEW, _body(a))
    with ctx_for(a.user) as ctx:  # type: ignore[attr-defined]
        read = habits_public.find_habits(ctx, "Read")[0]
        habits_public.log_habit(ctx, habit_id=read.id, day=ctx.today)
        ctx.commit()
    assert a.post(REVIEW, _body(a)) == first
    assert len(model.seen) == 1
