"""Peso text for card titles and notes (the prototype's ``peso``)."""

from decimal import ROUND_HALF_UP, Decimal


def peso(minor: int | float) -> str:
    """``₱`` + whole pesos with thousands separators, rounded half-up
    (``Intl.NumberFormat("en-PH", {maximumFractionDigits: 0})``)."""
    pesos = (Decimal(str(minor)) / 100).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    sign = "-" if pesos < 0 else ""
    return f"₱{sign}{abs(int(pesos)):,}"
