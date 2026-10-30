"""The currency table and money text, against Intl's own data."""

import json
from pathlib import Path

import pytest

from app.shared.currency import (
    CURRENCIES,
    contains_money,
    currency,
    money,
    money_marks,
    strip_money_marks,
)

GOLDEN = Path(__file__).parents[1] / "golden" / "currency.json"


def test_the_table_matches_intl() -> None:
    # Emitted by scripts/golden/currency.golden.test.ts from Intl itself
    # ("en", currencyDisplay "symbol"), never from either table.
    intl = json.loads(GOLDEN.read_text())["data"]["intl"]
    assert {
        c.code: {"symbol": c.symbol, "digits": c.digits, "name": c.name}
        for c in CURRENCIES.values()
    } == intl


def test_every_supported_currency_fits_hundredths() -> None:
    assert all(c.digits <= 2 for c in CURRENCIES.values())


def test_money_text() -> None:
    assert money(124_050) == "₱1,240.50"
    assert money(124_000) == "₱1,240"
    assert money(-500) == "₱-5"
    assert money(124_050, currency("USD")) == "$1,240.50"
    assert money(100_000, currency("JPY")) == "¥1,000"
    assert money(250_000, currency("CHF")) == "CHF 2,500"
    # 158.82 once read as 158 and 1,708.64 as 1,709. Same strings as
    # the device's money() for the same amounts.
    assert money(15_882) == "₱158.82"
    assert money(170_864) == "₱1,708.64"
    assert money(-550) == "₱-5.50"
    assert money(250_075, currency("JPY")) == "¥2,501"
    with pytest.raises(ValueError):
        currency("XXX")


def test_share_card_marks_and_parsing() -> None:
    for s in ("₱1,200", "$5", "€3", "PHP 200", "CHF 10", "price 10 USD", "A$5"):
        assert contains_money(s), s
    for s in ("85%", "1,234", "3/4", "SARAH", "PENDING", "12-day"):
        assert not contains_money(s), s
    assert strip_money_marks("PHP1,000").strip() == "1,000"
    assert strip_money_marks("$12.50") == "12.50"
    assert money_marks(currency("PHP")) == "₱|php"
    assert money_marks(currency("USD")) == r"₱|php|\$|usd"
