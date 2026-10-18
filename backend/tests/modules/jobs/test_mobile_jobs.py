"""The scheduled runners call each module's job body for the right users."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.jobs import mobile
from tests.modules.finance.api.test_planning import _fin, _weekly


def test_finance_auto_log_runner_logs_once(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("GCash")
    _weekly(f, a, type="income", auto=True, cat=cats["salary"], amount=500_000)
    # Other users' auto-log items may be due too; this user's three are in it.
    assert mobile.run_finance_auto_log() >= 3
    assert f.balances()[a] == 1_500_000
    mobile.run_finance_auto_log()
    assert f.balances()[a] == 1_500_000  # idempotent across runs


def test_task_runners_run_without_error() -> None:
    assert mobile.run_task_reminders() >= 0
    assert mobile.run_task_digests() >= 0
