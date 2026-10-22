"""Exchange rates for records kept in another currency (a USD purchase on a
peso account).

Rates are the European Central Bank's daily reference rates, served by
Frankfurter (https://frankfurter.dev): free, keyless, and published each
working day around 16:00 CET, so "latest" is that day's or the last working
day's. :func:`latest` is the one seam (a test substitutes it); answers are
cached per pair for an hour, so a burst of records makes one call.

No provider text reaches a response: a failure is :class:`FxError` with a
stable code.
"""

import time
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import httpx

FX_URL = "https://api.frankfurter.dev/v1/latest"
TTL_SECONDS = 3600


class FxError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Rate:
    base: str
    quote: str
    # One unit of ``base`` in ``quote`` (1 USD = 57.92 PHP).
    rate: Decimal
    as_of: date


_cache: dict[tuple[str, str], tuple[float, Rate]] = {}


def latest(base: str, quote: str) -> Rate:
    """The latest reference rate from ``base`` to ``quote``."""
    key = (base, quote)
    hit = _cache.get(key)
    if hit is not None and time.monotonic() - hit[0] < TTL_SECONDS:
        return hit[1]
    try:
        with httpx.Client(timeout=10, trust_env=False) as c:
            r = c.get(FX_URL, params={"base": base, "symbols": quote})
    except httpx.HTTPError:
        raise FxError("fx_unreachable") from None
    if r.status_code != 200:
        raise FxError("fx_unknown_currency" if r.status_code == 404 else "fx_failed")
    try:
        body = r.json()
        value = Decimal(str(body["rates"][quote]))
        as_of = date.fromisoformat(body["date"])
    except (ValueError, KeyError, TypeError):
        raise FxError("fx_failed") from None
    rate = Rate(base, quote, value, as_of)
    _cache[key] = (time.monotonic(), rate)
    return rate


def convert_minor(amount_minor: int, rate: Decimal) -> int:
    """``amount_minor`` hundredths of the base currency in hundredths of the
    quote currency, rounded half up once."""
    return int((Decimal(amount_minor) * rate).quantize(Decimal(1), ROUND_HALF_UP))
