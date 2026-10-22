"""Records kept in another currency: the amount as spent and the rate are
kept, and ``amount_minor`` is the user's-currency amount the totals use.
The rate source is substituted at its one seam, ``fx.latest``."""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.finance import fx
from tests.modules.finance.api.helpers import Fin, op
from tests.utils.mobile import signed_in

RATE = Decimal("57.92")


def _fin(client: TestClient, db: Session) -> Fin:
    _, headers = signed_in(db)
    return Fin(client, headers)


@pytest.fixture
def rates(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    asked: list[tuple[str, str]] = []

    def latest(base: str, quote: str) -> fx.Rate:
        asked.append((base, quote))
        if base == "XXX":
            raise fx.FxError("fx_unknown_currency")
        return fx.Rate(base, quote, RATE, date(2026, 10, 21))

    monkeypatch.setattr(fx, "latest", latest)
    return asked


def test_convert_rounds_half_up_once() -> None:
    assert fx.convert_minor(10000, RATE) == 579200  # $100.00 -> P5,792.00
    assert fx.convert_minor(1, Decimal("57.925")) == 58  # 57.925 -> 58
    assert fx.convert_minor(199, Decimal("0.5")) == 100  # 99.5 -> 100


def test_the_rate_route_gives_the_latest_to_the_users_currency(
    client: TestClient, db: Session, rates: list[tuple[str, str]]
) -> None:
    f = _fin(client, db)
    out = f.get("/fx", base="USD")
    assert out == {
        "base": "USD",
        "quote": "PHP",
        "rate": "57.92",
        "as_of": "2026-10-21",
    }
    assert rates == [("USD", "PHP")]
    bad = f.get("/fx", status=422, base="XXX")
    assert bad["code"] == "fx_unknown_currency"


def test_a_usd_expense_is_kept_in_dollars_and_counted_in_pesos(
    client: TestClient, db: Session, rates: list[tuple[str, str]]
) -> None:
    f = _fin(client, db)
    acct = f.account("GCash", opening=1_000_000)
    rec = f.expense(acct, 1, orig_currency="USD", orig_amount_minor=10000)
    # The amount the device sent is replaced by the conversion.
    assert rec["amount_minor"] == 579200
    assert (rec["orig_currency"], rec["orig_amount_minor"]) == ("USD", 10000)
    assert Decimal(rec["fx_rate"]) == RATE
    assert f.balances()[acct] == 1_000_000 - 579200

    # The device's own rate (from /fx) is kept as sent.
    rec2 = f.expense(
        acct, 1, orig_currency="USD", orig_amount_minor=2000, fx_rate="58.10"
    )
    assert rec2["amount_minor"] == 116200
    assert len(rates) == 1

    # Editing the dollars converts again; switching to pesos clears it all.
    out = f.patch(f"/records/{rec['id']}", {"orig_amount_minor": 5000})
    assert out["amount_minor"] == 289600
    out = f.patch(
        f"/records/{rec['id']}", {"orig_currency": None, "amount_minor": 30000}
    )
    assert out["amount_minor"] == 30000
    assert out["orig_currency"] is None and out["fx_rate"] is None


def test_the_users_own_currency_keeps_no_rate(
    client: TestClient, db: Session, rates: list[tuple[str, str]]
) -> None:
    f = _fin(client, db)
    acct = f.account("Cash", "cash")
    rec = f.expense(acct, 12000, orig_currency="PHP", orig_amount_minor=12000)
    assert rec["amount_minor"] == 12000 and rec["orig_currency"] is None
    assert rates == []


def test_a_synced_usd_record_is_converted_the_same_way(
    client: TestClient, db: Session, rates: list[tuple[str, str]]
) -> None:
    f = _fin(client, db)
    # The device's rate is used as sent: no lookup.
    acct = f.account("GCash")
    rid = uuid.uuid4()
    [res] = f.push(
        op(
            "upsert",
            "fin_record",
            rid,
            type="expense",
            amount_minor=579200,
            account_id=acct,
            orig_currency="USD",
            orig_amount_minor=10000,
            fx_rate="57.92",
        )
    )
    assert res["status"] == "applied", res
    row = f.get(f"/records/{rid}")
    assert (row["amount_minor"], row["orig_currency"]) == (579200, "USD")
    assert rates == []


@pytest.mark.parametrize(
    ("said", "code"),
    [
        ("USD", "USD"),
        ("usd", "USD"),
        ("$", "USD"),
        ("US dollars", "USD"),
        ("PHP (₱)", "PHP"),
        ("₱", "PHP"),
        (None, None),
        ("", None),
    ],
)
def test_a_currency_written_loosely_reads_as_its_code(
    said: str | None, code: str | None
) -> None:
    from app.modules.capture.agent import ExpenseArgs

    assert ExpenseArgs(amount=20, currency=said).currency == code


def test_an_unreadable_currency_is_refused() -> None:
    from pydantic import ValidationError

    from app.modules.capture.agent import ExpenseArgs

    with pytest.raises(ValidationError):
        ExpenseArgs(amount=20, currency="moon coins")
