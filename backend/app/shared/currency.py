"""The user's currency: the supported codes and money text for a reader.

Twin of ``shared/prototype/lib/money.ts``; ``tests/golden/currency.json``
(emitted from Intl by ``scripts/golden/currency.golden.test.ts``) pins both
tables to the same symbols and decimals.

Storage: every ``*_minor`` column holds integer HUNDREDTHS of the user's
currency, whichever currency that is, so the factor at every boundary is 100
(:mod:`app.shared.money`). A zero-decimal currency such as JPY is therefore
stored as yen x 100; its ISO 4217 minor-unit exponent (``digits``) is used for
display only. That keeps one meaning for a column across users and across a
user changing their currency (which relabels amounts and converts nothing).
Three-decimal currencies (KWD, BHD, ...) are not offered: hundredths would
drop their third place.
"""

import re
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal


@dataclass(frozen=True)
class Currency:
    code: str
    symbol: str
    digits: int
    name: str

    @property
    def prefix(self) -> str:
        """The symbol before an amount; a letter symbol ("CHF") gets a space."""
        return f"{self.symbol} " if self.symbol[-1].isalpha() else self.symbol

    @property
    def phrase(self) -> str:
        """How a model prompt names it: ``US Dollar (USD, written $)``."""
        return f"{self.name} ({self.code}, written {self.symbol})"


_ROWS = (
    ("PHP", "₱", 2, "Philippine Peso"),
    ("USD", "$", 2, "US Dollar"),
    ("EUR", "€", 2, "Euro"),
    ("GBP", "£", 2, "British Pound"),
    ("JPY", "¥", 0, "Japanese Yen"),
    ("CNY", "CN¥", 2, "Chinese Yuan"),
    ("KRW", "₩", 0, "South Korean Won"),
    ("INR", "₹", 2, "Indian Rupee"),
    ("IDR", "IDR", 2, "Indonesian Rupiah"),
    ("MYR", "MYR", 2, "Malaysian Ringgit"),
    ("SGD", "SGD", 2, "Singapore Dollar"),
    ("THB", "THB", 2, "Thai Baht"),
    ("VND", "₫", 0, "Vietnamese Dong"),
    ("HKD", "HK$", 2, "Hong Kong Dollar"),
    ("TWD", "NT$", 2, "New Taiwan Dollar"),
    ("AUD", "A$", 2, "Australian Dollar"),
    ("NZD", "NZ$", 2, "New Zealand Dollar"),
    ("CAD", "CA$", 2, "Canadian Dollar"),
    ("MXN", "MX$", 2, "Mexican Peso"),
    ("BRL", "R$", 2, "Brazilian Real"),
    ("CHF", "CHF", 2, "Swiss Franc"),
    ("SEK", "SEK", 2, "Swedish Krona"),
    ("NOK", "NOK", 2, "Norwegian Krone"),
    ("DKK", "DKK", 2, "Danish Krone"),
    ("PLN", "PLN", 2, "Polish Zloty"),
    ("ZAR", "ZAR", 2, "South African Rand"),
    ("AED", "AED", 2, "United Arab Emirates Dirham"),
    ("SAR", "SAR", 2, "Saudi Riyal"),
    ("TRY", "TRY", 2, "Turkish Lira"),
    ("NGN", "NGN", 2, "Nigerian Naira"),
    ("KES", "KES", 2, "Kenyan Shilling"),
    ("EGP", "EGP", 2, "Egyptian Pound"),
    ("ILS", "₪", 2, "Israeli New Shekel"),
    ("CZK", "CZK", 2, "Czech Koruna"),
    ("HUF", "HUF", 2, "Hungarian Forint"),
    ("PKR", "PKR", 2, "Pakistani Rupee"),
    ("BDT", "BDT", 2, "Bangladeshi Taka"),
    ("COP", "COP", 2, "Colombian Peso"),
    ("CLP", "CLP", 0, "Chilean Peso"),
    ("PEN", "PEN", 2, "Peruvian Sol"),
)

CURRENCIES: dict[str, Currency] = {r[0]: Currency(*r) for r in _ROWS}
CODES = tuple(CURRENCIES)
DEFAULT_CURRENCY = "PHP"
PHP = CURRENCIES["PHP"]


def currency(code: str) -> Currency:
    """A code's row; an unknown code is refused rather than guessed."""
    try:
        return CURRENCIES[code]
    except KeyError:
        raise ValueError(f"unsupported currency: {code!r}") from None


def check_currency(code: str) -> str:
    currency(code)
    return code


def money_marks(cur: Currency) -> str:
    """Regex alternation of the words that mark money in a capture: ``₱|php``
    (the prototype's vocabulary, kept for every user) plus the user's own
    symbol and code, lowercased (``moneyMarks`` in capture/parse.ts)."""
    marks = ["₱", "php"]
    for m in (cur.symbol.lower(), cur.code.lower()):
        if m not in marks:
            marks.append(m)
    return "|".join(re.escape(m) for m in marks)


_MARK = re.compile(
    "|".join(
        [
            # A letter mark must not sit inside a word ("SARAH" is no
            # riyal); a digit may touch it ("PHP1,000").
            rf"(?<![A-Za-z]){m}(?![A-Za-z])" if m.isalpha() else re.escape(m)
            for m in dict.fromkeys(
                x for c in CURRENCIES.values() for x in (c.symbol, c.code)
            )
        ]
        + [r"\$"]
    )
)


def contains_money(text: str) -> bool:
    """A currency symbol or code anywhere in the text (``containsMoney``)."""
    return _MARK.search(text) is not None


def strip_money_marks(text: str) -> str:
    """The text with every supported symbol and (upper-case) code removed:
    what is left of "PHP 1,250" or "$12.50" is the number."""
    return _MARK.sub("", text)


def money(minor: int | float, cur: Currency = PHP) -> str:
    """Grouped units, with the currency's decimals only when the amount has
    them, rounded half-up once: ``₱2,500``, ``₱158.82``, ``₱1,708.64``,
    ``₱2,500.40``, ``$-5`` (the sign after the symbol, as the prototype's
    ``peso`` wrote it). The device's ``money()`` writes the same string for
    the same amount, so Fern's text and the app agree to the cent."""
    step = Decimal(1).scaleb(-cur.digits)
    v = (Decimal(str(minor)) / 100).quantize(step, rounding=ROUND_HALF_UP)
    sign = "-" if v < 0 else ""
    whole, part = divmod(abs(v), 1)
    cents = f".{int(part.scaleb(cur.digits)):0{cur.digits}d}" if part else ""
    return f"{cur.prefix}{sign}{int(whole):,}{cents}"


def money_round(minor: float, cur: Currency = PHP) -> str:
    """Whole units rounded like JavaScript's ``Math.round`` (half up toward
    +infinity), for the stats series the prototype rounds that way."""
    from math import floor

    return f"{cur.prefix}{floor(minor / 100 + 0.5):,}"
