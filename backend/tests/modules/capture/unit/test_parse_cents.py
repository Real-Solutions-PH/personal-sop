"""A typed amount is read to the cent: "1,708.64" read as 1,708 and "158.82"
as 159, one cut short and one rounded up."""

import pytest

from app.modules.capture.parse import parse_amount


@pytest.mark.parametrize(
    ("text", "amount", "minor"),
    [
        ("spent 1,708.64 at SM", 1708.64, 170864),
        ("coffee 158.82", 158.82, 15882),
        ("grab 1,708", 1708, 170800),
        ("lunch 250", 250, 25000),
        ("laptop 2k", 2000, 200000),
        ("bonus 1.5k", 1500, 150000),
        ("rent ₱12,000.50", 12000.5, 1200050),
    ],
)
def test_amounts_keep_their_cents(text: str, amount: float, minor: int) -> None:
    a = parse_amount(text)
    assert a is not None
    assert a.amount == amount
    assert a.minor == minor


def test_a_whole_amount_stays_an_int() -> None:
    a = parse_amount("lunch 250")
    assert a is not None and isinstance(a.amount, int)
