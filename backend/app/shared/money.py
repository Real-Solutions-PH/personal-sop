"""Money as integer minor units (centavos).

Every amount is stored and computed as an ``int`` count of centavos. Pesos
appear only at the edge: :func:`to_minor` parses what a person or a model
wrote, :func:`to_major` renders for a reader. One rounding, at the end, with
banker's rounding avoided in favour of half-up (what a receipt does).
"""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

# Bound both sides: a peso amount beyond a trillion is a parse error, not money.
MAX_MINOR = 100_000_000_000_000  # ₱1 trillion in centavos
MIN_MINOR = -MAX_MINOR


def to_minor(value: str | int | float | Decimal) -> int:
    """Pesos -> centavos. Rejects NaN, infinities and out-of-range amounts."""
    if isinstance(value, bool):
        raise ValueError("boolean is not an amount")
    try:
        text = str(value).replace(",", "").replace("₱", "").strip()
        dec = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("not an amount") from exc
    if not dec.is_finite():
        raise ValueError("amount must be finite")
    minor = int((dec * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    check_minor(minor)
    return minor


def to_major(minor: int) -> Decimal:
    """Centavos -> pesos as an exact Decimal with two places."""
    return (Decimal(minor) / 100).quantize(Decimal("0.01"))


def check_minor(minor: int) -> int:
    if not MIN_MINOR <= minor <= MAX_MINOR:
        raise ValueError("amount out of range")
    return minor


def ratio(numerator: int, denominator: int) -> float | None:
    """A share of two integer amounts; ``None`` when the denominator is zero."""
    return None if denominator == 0 else numerator / denominator
