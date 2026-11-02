"""The replay dataset itself, in every test run (no model key needed):
each case loads, holds no personal detail from the chats it was built
from, seeds cleanly and runs through the harness with a scripted model."""

import hashlib
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.db import engine
from tests.modules.capture.api.helpers import install, say
from tests.utils.tenant import fresh_tenant
from tests.utils.user import create_auth_user

from . import harness

CASES = harness.load_cases()
DENY = {
    line.strip()
    for line in (Path(__file__).parent / "scrub_denylist.sha256")
    .read_text()
    .splitlines()
    if line.strip() and not line.startswith("#")
}


def test_the_dataset_covers_failures_and_guards() -> None:
    kinds = {c.kind for c in CASES}
    assert kinds == {"failure", "guard"}
    assert len({c.id for c in CASES}) == len(CASES)
    for c in CASES:
        assert set(c.criteria) <= set(harness.CRITERIA), c.id
        assert c.turn, c.id
        stamps = [m.at for m in c.history] + [s.at for s in c.turn]
        assert stamps == sorted(stamps), f"{c.id}: out of order"
        assert all(s.tzinfo is not None for s in stamps), c.id


def _grams(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9@.]+", text.lower())
    return {
        " ".join(words[i : i + n]) for n in (1, 2, 3) for i in range(len(words) - n + 1)
    }


def test_no_case_holds_a_scrubbed_term() -> None:
    """The denylist is hashes of the names, places, employers and health
    details scrubbed from the source chats (the terms themselves never
    enter the repository)."""
    assert DENY
    for p in sorted(harness.CASES.glob("*.json")):
        hits = [
            g
            for g in _grams(p.read_text())
            if hashlib.sha256(g.encode()).hexdigest() in DENY
        ]
        assert not hits, f"{p.name} holds a scrubbed term"


@pytest.mark.parametrize("case", CASES, ids=[c.id for c in CASES])
def test_each_case_seeds_and_replays(
    case: harness.Case,
    client: TestClient,  # noqa: ARG001
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The plumbing, with a model that only answers: every record seeds,
    every message is sent at its moment, and the checks evaluate."""
    from app.modules.ai_providers import public as ai_public

    install(monkeypatch, *[say("Okay.") for _ in range(20)])
    # Each case in its own tenant: the food library is unique per tenant.
    user, _ = create_auth_user(db, tenant_id=fresh_tenant(db))
    # Any chat model will do for the scripted run: assign one.
    monkeypatch.setattr(ai_public.settings, "AI_SERVER_FALLBACK", True)
    monkeypatch.setattr(ai_public.settings, "NEBIUS_API_KEY", "sk-scripted")
    monkeypatch.setattr(ai_public.settings, "DEFAULT_LLM_PROVIDER", "nebius")
    with Session(engine) as session:
        trace = harness.run_case(session, user, case)
    assert trace.error is None, trace.error
    assert len([r for r in trace.replies if r]) >= 1
    checks = harness.check(case, trace)
    assert checks or not case.expect.model_dump(exclude_defaults=True)
