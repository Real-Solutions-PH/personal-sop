"""Fern's replay eval (ADR-0029): every case in ``cases/`` replayed against
the real chat model, checked and judged.

Runs only with ``FERN_EVAL=1`` and a ``NEBIUS_API_KEY`` (``make fern-eval``,
and the ``Fern eval`` CI job on changes to the chat agent). Each case's
result goes to ``FERN_EVAL_OUT`` (default ``backend/fern-eval-out``) as
JSON; ``report.py`` turns them into the score table.

A case passes when all its deterministic checks pass. Every guard case
must pass here. Failure cases are reported, not failed one by one (the
model is not deterministic: about a tenth of them flip between two runs of
the same code); ``report.py --gate`` holds the whole run to
``baseline.json`` instead.
"""

import json
import os
import signal
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.modules.iam.users.models import User
from tests.utils.tenant import fresh_tenant
from tests.utils.user import create_auth_user

from . import harness
from .judge import JUDGE_MODEL, judge

LIVE = os.environ.get("FERN_EVAL") == "1" and bool(settings.NEBIUS_API_KEY)
OUT = Path(os.environ.get("FERN_EVAL_OUT", Path(__file__).parents[3] / "fern-eval-out"))
ONLY = {c for c in os.environ.get("FERN_EVAL_CASES", "").split(",") if c}
JUDGE = os.environ.get("FERN_EVAL_JUDGE", "1") == "1"
REPEATS = int(os.environ.get("FERN_EVAL_REPEATS", "1"))
# The model under test: the server's provider ("nebius" or "openrouter"),
# its model id, and a reasoning effort sent as OpenRouter's
# ``reasoning: {effort}`` ("" leaves the provider's default). Unset, the
# run uses the server's own defaults, as production does.
PROVIDER = os.environ.get("FERN_EVAL_PROVIDER", "")
MODEL = os.environ.get("FERN_EVAL_MODEL", "")
EFFORT = os.environ.get("FERN_EVAL_REASONING_EFFORT", "")
# "1" asks the provider to cache the prompt prefix: a top-level
# ``cache_control: {type: ephemeral}``, which OpenRouter passes to Anthropic
# as automatic caching (measured 2026-11-12: the second identical call read
# the whole prefix from cache). Providers that cache on their own (Nebius)
# need nothing.
CACHE = os.environ.get("FERN_EVAL_CACHE") == "1"
# A case still running after this many seconds is stopped and recorded as
# errored, so one hung model call cannot stall the whole run.
CASE_TIMEOUT = int(os.environ.get("FERN_EVAL_CASE_TIMEOUT", "600"))

pytestmark = pytest.mark.skipif(
    not LIVE, reason="Fern eval: set FERN_EVAL=1 and NEBIUS_API_KEY"
)

CASES = [c for c in harness.load_cases() if not ONLY or c.id in ONLY]


def _model_name() -> str:
    if settings.DEFAULT_LLM_PROVIDER == "openrouter":
        return settings.OPENROUTER_MODEL
    return settings.NEBIUS_MODEL


def _use_model(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.modules.ai_providers import public as ai_public

    if PROVIDER:
        monkeypatch.setattr(settings, "DEFAULT_LLM_PROVIDER", PROVIDER)
    if MODEL:
        field = "OPENROUTER_MODEL" if PROVIDER == "openrouter" else "NEBIUS_MODEL"
        monkeypatch.setattr(settings, field, MODEL)
    extra: dict[str, Any] = {}
    if EFFORT:
        extra["reasoning"] = {"effort": EFFORT}
    if CACHE:
        extra["cache_control"] = {"type": "ephemeral"}
    if extra:
        build = ai_public.model_factory

        def with_extra(resolved: Any) -> Any:
            m: Any = build(resolved)
            return m.model_copy(
                update={"extra_body": {**(m.extra_body or {}), **extra}}
            )

        monkeypatch.setattr(ai_public, "model_factory", with_extra)


def _keep_cache_reads(monkeypatch: pytest.MonkeyPatch) -> None:
    """The loop's per-call usage keeps only input and output tokens; the
    eval also wants the prompt-cache reads the provider reported (the
    largest figure across a call's chunks, as for the other counts)."""
    from app.modules.capture import agent

    plain = agent._stream_usage

    def with_cache(chunks_usage: list[dict[str, Any]]) -> dict[str, Any] | None:
        usage = plain(chunks_usage)
        if usage is None:
            return None
        read = max(
            int((u.get("input_token_details") or {}).get("cache_read") or 0)
            for u in chunks_usage
        )
        return {**usage, "input_token_details": {"cache_read": read}}

    monkeypatch.setattr(agent, "_stream_usage", with_cache)


def _run_with_timeout(
    session: Session, user: User, case: harness.Case
) -> harness.Trace:
    def stop(signum: int, frame: Any) -> None:  # noqa: ARG001
        raise TimeoutError(f"case ran past {CASE_TIMEOUT} s")

    previous = signal.signal(signal.SIGALRM, stop)
    signal.alarm(CASE_TIMEOUT)
    try:
        # run_case records the TimeoutError as the trace's error.
        return harness.run_case(session, user, case)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


@pytest.mark.parametrize("case", CASES, ids=[c.id for c in CASES])
def test_replay(
    case: harness.Case,
    client: TestClient,  # noqa: ARG001 - the app (and its settings) loaded
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The server's key answers, as it does for Kai in production.
    monkeypatch.setattr(settings, "AI_SERVER_FALLBACK", True)
    _use_model(monkeypatch)
    _keep_cache_reads(monkeypatch)
    runs = []
    for n in range(REPEATS):
        # Each case in its own tenant: the food library is unique per tenant.
        made, _ = create_auth_user(db, tenant_id=fresh_tenant(db))
        user_id = made.id
        # End the fixture session's transaction: a case waits minutes on the
        # model, and an idle-in-transaction connection holds back the
        # cluster's xmin for every other database on the server.
        db.rollback()
        with Session(engine) as session:
            user = session.get_one(User, user_id)
            trace = _run_with_timeout(session, user, case)
        checks = harness.check(case, trace)
        # Judged here, or later over the saved results (report.py --judge).
        verdict = judge(case, trace.public()) if JUDGE else None
        runs.append(
            {
                "run": n,
                "passed": all(c.ok for c in checks),
                "checks": [c.__dict__ for c in checks],
                "judge": verdict,
                "trace": trace.public(),
            }
        )
    passed = sum(r["passed"] for r in runs) * 2 > len(runs)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{case.id}.json").write_text(
        json.dumps(
            {
                "id": case.id,
                "kind": case.kind,
                "title": case.title,
                "criteria": case.criteria,
                "severity": case.severity,
                "model": _model_name(),
                "provider": settings.DEFAULT_LLM_PROVIDER,
                "reasoning_effort": EFFORT or None,
                "prompt_cache": CACHE,
                "judge_model": JUDGE_MODEL,
                "arch": os.environ.get("FERN_ARCH", "baseline"),
                "passed": passed,
                "runs": runs,
            },
            ensure_ascii=False,
            indent=1,
            default=str,
        )
    )
    failed = [c.name + ": " + c.detail for c in harness.check(case, trace) if not c.ok]
    if case.kind == "guard":
        assert passed, f"{case.id} regressed: {failed}"
