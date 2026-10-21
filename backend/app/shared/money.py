"""Money as integer minor units: hundredths of the user's currency.

Every amount is stored and computed as an ``int`` count of hundredths
(centavos for PHP, cents for USD). Major units appear only at the edge:
:func:`to_minor` parses what a person or a model wrote, :func:`to_major`
renders for a reader. One rounding, at the end, with banker's rounding
avoided in favour of half-up (what a receipt does).

The factor is 100 for EVERY currency, including zero-decimal ones such as
JPY (¥1,000 is 100000): a currency's ISO 4217 exponent is for display only
(:mod:`app.shared.currency`), so a column keeps one meaning across users and
across a user switching currency. Three-decimal currencies are not offered.
"""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from app.shared.currency import strip_money_marks

# Bound both sides: an amount beyond a trillion is a parse error, not money.
MAX_MINOR = 100_000_000_000_000  # 1 trillion in hundredths
MIN_MINOR = -MAX_MINOR


def to_minor(value: str | int | float | Decimal) -> int:
    """Major units -> hundredths. Rejects NaN, infinities and out-of-range
    amounts; any supported currency symbol or code is ignored."""
    if isinstance(value, bool):
        raise ValueError("boolean is not an amount")
    try:
        text = strip_money_marks(str(value)).replace(",", "").strip()
        dec = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("not an amount") from exc
    if not dec.is_finite():
        raise ValueError("amount must be finite")
    minor = int((dec * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    check_minor(minor)
    return minor


def to_major(minor: int) -> Decimal:
    """Hundredths -> major units as an exact Decimal with two places."""
    return (Decimal(minor) / 100).quantize(Decimal("0.01"))


def check_minor(minor: int) -> int:
    if not MIN_MINOR <= minor <= MAX_MINOR:
        raise ValueError("amount out of range")
    return minor


def ratio(numerator: int, denominator: int) -> float | None:
    """A share of two integer amounts; ``None`` when the denominator is zero."""
    return None if denominator == 0 else numerator / denominator
