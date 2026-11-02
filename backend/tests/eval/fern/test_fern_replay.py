"""Fern's replay eval (ADR-0029): every case in ``cases/`` replayed against
the real chat model, checked and judged.

Runs only with ``FERN_EVAL=1`` and a ``NEBIUS_API_KEY`` (``make fern-eval``,
and the ``Fern eval`` CI job on changes to the chat agent). Each case's
result goes to ``FERN_EVAL_OUT`` (default ``backend/fern-eval-out``) as
JSON; ``report.py`` turns them into the score table.

A case passes when all its deterministic checks pass. The gate is
``baseline.json``: a case that passed there must still pass (a guard case
always must). A failure case that still fails is reported, not failed:
those are the known gaps the next change is meant to close.
"""

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from tests.utils.tenant import fresh_tenant
from tests.utils.user import create_auth_user

from . import harness
from .judge import JUDGE_MODEL, judge

LIVE = os.environ.get("FERN_EVAL") == "1" and bool(settings.NEBIUS_API_KEY)
OUT = Path(os.environ.get("FERN_EVAL_OUT", Path(__file__).parents[3] / "fern-eval-out"))
BASELINE = json.loads((Path(__file__).parent / "baseline.json").read_text())
ONLY = {c for c in os.environ.get("FERN_EVAL_CASES", "").split(",") if c}
REPEATS = int(os.environ.get("FERN_EVAL_REPEATS", "1"))

pytestmark = pytest.mark.skipif(
    not LIVE, reason="Fern eval: set FERN_EVAL=1 and NEBIUS_API_KEY"
)

CASES = [c for c in harness.load_cases() if not ONLY or c.id in ONLY]


@pytest.mark.parametrize("case", CASES, ids=[c.id for c in CASES])
def test_replay(
    case: harness.Case,
    client: TestClient,  # noqa: ARG001 - the app (and its settings) loaded
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The server's key answers, as it does for Kai in production.
    monkeypatch.setattr(settings, "AI_SERVER_FALLBACK", True)
    model = os.environ.get("FERN_EVAL_MODEL")
    if model:
        monkeypatch.setattr(settings, "NEBIUS_MODEL", model)
    runs = []
    for n in range(REPEATS):
        # Each case in its own tenant: the food library is unique per tenant.
        user, _ = create_auth_user(db, tenant_id=fresh_tenant(db))
        with Session(engine) as session:
            trace = harness.run_case(session, user, case)
        checks = harness.check(case, trace)
        verdict = judge(case, trace)
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
                "model": settings.NEBIUS_MODEL,
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
    was = BASELINE.get(case.id, {}).get("passed")
    failed = [c.name + ": " + c.detail for c in harness.check(case, trace) if not c.ok]
    if case.kind == "guard" or was:
        assert passed, f"{case.id} regressed: {failed}"
