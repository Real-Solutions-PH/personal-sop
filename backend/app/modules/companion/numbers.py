"""The number check: a reply's figures about the person's own records must
trace to a tool result of this turn, to TODAY or to what they said.

Seen live within a minute (2026-10-31): "407 kcal and 116 g protein would be
left", then "1,472 kcal and 116 g"; a protein target of 120 g, then 140 g.
The model was doing arithmetic it is told not to do. Checked here:

- Only sentences that state a record figure are checked (left, remaining,
  target, goal, eaten, so far, total, balance, spent, budget, owe, due,
  average, net worth, streak, burned). A suggestion ("about 150 g chicken")
  is the model's estimate and is not.
- Numbers of 10 or less are skipped (counts of meals or sets; too many
  coincidental matches to mean anything), as are dates and clock times.
- A figure matches a known number within 1, or rounded to 10 (100 from
  1,000 up), so "116 g" for 115.6 passes and "1,002" for 999 does not.

:func:`unmatched` is pure; the caller collects the known numbers.
"""

import re
from collections.abc import Iterable
from typing import Any

_RECORD_WORDS = re.compile(
    r"\b(left|remaining|remain|to go|target|goal|eaten|so far|total|totals|"
    r"balance|balances|spent|spend|budget|owe|owed|due|average|avg|net worth|"
    r"streak|burned|consumed|logged|intake|you(?:'ve| have) had)\b",
    re.I,
)
# A number, with thousands separators and decimals: 1,472 · 116 · 62.4.
_NUMBER = re.compile(
    r"(?<![\w.:/-])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![\w:/-]|\.\d)"
)
_DATE_OR_TIME = re.compile(
    r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}(?:am|pm)\b", re.I
)
SKIP_AT_OR_BELOW = 10.0


def _numbers(text: str) -> list[float]:
    text = _DATE_OR_TIME.sub(" ", text)
    out = []
    for m in _NUMBER.finditer(text):
        whole = m.group(1).replace(",", "")
        out.append(float(f"{whole}.{m.group(2)}" if m.group(2) else whole))
    return out


def claimed(answer: str) -> list[float]:
    """The record figures a reply states, in order."""
    out: list[float] = []
    for sentence in re.split(r"(?<=[.!?;])\s+|\n+", answer):
        if not _RECORD_WORDS.search(sentence):
            continue
        out += [n for n in _numbers(sentence) if n > SKIP_AT_OR_BELOW]
    return out


def known(sources: Iterable[Any]) -> list[float]:
    """Every number inside tool results, facts and the person's words:
    JSON numbers, and numbers written in strings ("₱1,234.50")."""
    out: list[float] = []

    def walk(v: Any) -> None:
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, (int, float)):
            out.append(float(v))
        elif isinstance(v, str):
            out.extend(_numbers(v))
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, (list, tuple)):
            for x in v:
                walk(x)

    for s in sources:
        walk(s)
    return out


def _close(n: float, k: float) -> bool:
    """``n`` is ``k`` as a person would say it: within 1, or rounded to
    the nearest 10 (or 100 from 1,000 up). Not a percentage: "999 left"
    and "1,002 left" were the contradiction to catch."""
    d = abs(n - k)
    if d <= 1.0:
        return True
    if n % 100 == 0 and abs(k) >= 1000 and d < 50:
        return True
    return n % 10 == 0 and d < 5


def unmatched(answer: str, sources: Iterable[Any]) -> list[float]:
    """The record figures in ``answer`` that no source holds."""
    pool = known(sources)
    return [n for n in claimed(answer) if not any(_close(n, k) for k in pool)]


def drop_sentences_with(answer: str, bad: list[float]) -> str:
    """``answer`` without the record sentences that still state a figure
    nothing backs; the whole answer when that would leave nothing."""
    if not bad:
        return answer
    kept_lines = []
    for line in answer.split("\n"):
        parts = re.split(r"(?<=[.!?;])\s+", line)
        keep = [
            s
            for s in parts
            if not (
                _RECORD_WORDS.search(s)
                and any(_close(n, b) for n in _numbers(s) for b in bad)
            )
        ]
        kept_lines.append(" ".join(keep).rstrip())
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(kept_lines)).strip()
    return text or answer


def fmt(n: float) -> str:
    return f"{n:,.0f}" if n == int(n) else f"{n:,}"
