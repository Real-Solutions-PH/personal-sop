"""Natural-language task capture, ported from ``shared/prototype/tasks/parse.ts``.

``parse_task`` pulls a due date, time and repeat rule out of one line;
``split_capture`` splits a brain-dump into drafts and routes each to a list.
The device runs the same parser offline, so this port keeps the prototype's
exact regexes and their JavaScript semantics:

- ``re.ASCII``: JS ``\\b`` and ``\\d`` are ASCII-only without the ``u`` flag.
- ``_WS`` replaces ``\\s``: JS whitespace includes NBSP and the Unicode
  spaces, which ``re.ASCII`` would drop.
- ``\\Z`` replaces ``$``: Python's ``$`` also matches before a final newline.
- ``str.replace(match, " ", 1)``: JS ``String.replace`` with a string pattern
  replaces the FIRST occurrence of the matched text, not the match position.

Dates stay ``YYYY-MM-DD`` strings, as in the prototype: "nov 45" yields the
key ``YYYY-11-45`` exactly as the device does. :func:`valid_day` is the gate
the services use before storing one.
"""

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

_WS = "[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]"
_FLAGS = re.ASCII | re.IGNORECASE

DAYS = {
    "sun": 0,
    "sunday": 0,
    "mon": 1,
    "monday": 1,
    "tue": 2,
    "tues": 2,
    "tuesday": 2,
    "wed": 3,
    "wednesday": 3,
    "thu": 4,
    "thur": 4,
    "thurs": 4,
    "thursday": 4,
    "fri": 5,
    "friday": 5,
    "sat": 6,
    "saturday": 6,
}
MONTHS = (
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
)


def _pad(n: int) -> str:
    return str(n).rjust(2, "0")


def _key(d: date) -> str:
    return d.isoformat()


def _add(key: str, n: int) -> str:
    return _key(date.fromisoformat(key) + timedelta(days=n))


def _weekday(key: str) -> int:
    return (date.fromisoformat(key).weekday() + 1) % 7


def js_trim(s: str) -> str:
    return re.sub(f"^{_WS}+|{_WS}+\\Z", "", s)


def valid_day(key: str | None) -> date | None:
    """A parsed key as a date, or None for an impossible one ("nov 45")."""
    if not key:
        return None
    try:
        return date.fromisoformat(key)
    except ValueError:
        return None


@dataclass
class Parsed:
    title: str
    due_date: str | None
    due_time: str | None
    recurrence: dict[str, Any] | None
    matched: list[str] = field(default_factory=list)


def _next_weekday(start: str, wd: int, allow_today: bool = False) -> str:
    for i in range(0 if allow_today else 1, 8):
        k = _add(start, i)
        if _weekday(k) == wd:
            return k
    return _add(start, 7)


def _nth_of_month(start: str, n: int) -> str:
    y, m, d = (int(x) for x in start.split("-"))
    # JS ``new Date(y, month, n)`` rolls an overflowing day into later months
    # (and day 0 back to the previous month's last day).
    if n > d:
        first = date(y, m, 1)
    else:
        first = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return _key(first + timedelta(days=n - 1))


_T_DAILY = re.compile(r"\b(every ?day|daily)\b", _FLAGS)
_T_WEEKDAYS = re.compile(r"\bevery weekday\b|\bweekdays\b", _FLAGS)
_T_EVERY_N = re.compile(r"\bevery (\d+) days\b", _FLAGS)
_T_MONTHLY = re.compile(r"\b(every month|monthly)\b", _FLAGS)
_T_EVERY_WD = re.compile(
    r"\bevery (sun|mon|tue|wed|thu|fri|sat)(?:day|nesday|rsday|urday|sday)?s?\b",
    _FLAGS,
)
_T_WEEKLY = re.compile(r"\bweekly\b|\bevery week\b", _FLAGS)
_T_AMPM = re.compile(r"\b(?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)\b", _FLAGS)
_T_24H = re.compile(r"\b(?:at )?([01]?\d|2[0-3]):([0-5]\d)\b", re.ASCII)
_T_NOON = re.compile(r"\bnoon\b", _FLAGS)
_T_TONIGHT = re.compile(r"\btonight\b", _FLAGS)
_T_TODAY = re.compile(r"\b(today|tdy|mamaya)\b", _FLAGS)
_T_TOMORROW = re.compile(r"\b(tomorrow|tmr|tmrw|bukas)\b", _FLAGS)
_T_NEXT_WEEK = re.compile(r"\bnext week\b", _FLAGS)
_T_WEEKEND = re.compile(r"\bthis weekend\b|\bweekend\b", _FLAGS)
_T_IN_DAYS = re.compile(r"\bin (\d+) days?\b", _FLAGS)
_T_WD = re.compile(
    r"\b(?:by |on |this |next )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)"
    r"(?:day|nesday|rsday|urday)?\b",
    _FLAGS,
)
_T_MONTH_DAY = re.compile(
    r"\b(?:on )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})\b",
    _FLAGS,
)
_T_NTH = re.compile(r"\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)\b", _FLAGS)

_TAIL = re.compile(f"\\b(remind me to|remind me|by|on|at){_WS}*\\Z", _FLAGS)
_HEAD = re.compile(f"^{_WS}*(remind me to|remind me)\\b", _FLAGS)
_SPACES = re.compile(f"{_WS}+")


def parse_task(text_in: str, today: str) -> Parsed:
    """Pull when/repeat out of ``text_in``; ``today`` is the business day key."""
    text = f" {text_in} "
    matched: list[str] = []
    o: dict[str, Any] = {"due_date": None, "due_time": None, "recurrence": None}

    def take(rx: re.Pattern[str]) -> re.Match[str] | None:
        nonlocal text
        m = rx.search(text)
        if not m:
            return None
        matched.append(js_trim(m.group(0)))
        text = text.replace(m.group(0), " ", 1)
        return m

    if take(_T_DAILY):
        o["recurrence"] = {"rule": {"kind": "daily"}, "mode": "fixed"}
    if take(_T_WEEKDAYS):
        o["recurrence"] = {"rule": {"kind": "weekdays"}, "mode": "fixed"}
    if m := take(_T_EVERY_N):
        o["recurrence"] = {"rule": {"kind": "everyN", "n": int(m[1])}, "mode": "fixed"}
    if take(_T_MONTHLY):
        o["recurrence"] = {"rule": {"kind": "monthly", "day": 1}, "mode": "fixed"}
    if m := take(_T_EVERY_WD):
        wd = DAYS[m[1].lower()]
        o["recurrence"] = {"rule": {"kind": "weekly", "days": [wd]}, "mode": "fixed"}
        o["due_date"] = _next_weekday(today, wd, True)
    if take(_T_WEEKLY):
        o["recurrence"] = {
            "rule": {"kind": "weekly", "days": [_weekday(today)]},
            "mode": "fixed",
        }
    if m := take(_T_AMPM):
        h = int(m[1]) % 12
        if m[3].lower() == "pm":
            h += 12
        o["due_time"] = f"{_pad(h)}:{_pad(int(m[2] or 0))}"
    if not o["due_time"] and (m := take(_T_24H)):
        o["due_time"] = f"{_pad(int(m[1]))}:{m[2]}"
    if take(_T_NOON):
        o["due_time"] = "12:00"
    if take(_T_TONIGHT):
        o["due_date"] = today
        o["due_time"] = o["due_time"] or "20:00"
    if take(_T_TODAY):
        o["due_date"] = today
    if take(_T_TOMORROW):
        o["due_date"] = _add(today, 1)
    if take(_T_NEXT_WEEK):
        o["due_date"] = _next_weekday(today, 1)
    if take(_T_WEEKEND):
        o["due_date"] = _next_weekday(today, 6, True)
    if m := take(_T_IN_DAYS):
        o["due_date"] = _add(today, int(m[1]))
    if m := take(_T_WD):
        o["due_date"] = _next_weekday(today, DAYS[m[1].lower()])
    if m := take(_T_MONTH_DAY):
        mo = MONTHS.index(m[1].lower())
        y = int(today[:4])
        k = f"{y}-{_pad(mo + 1)}-{_pad(int(m[2]))}"
        if k < today:
            k = f"{y + 1}-{_pad(mo + 1)}-{_pad(int(m[2]))}"
        o["due_date"] = k
    if m := take(_T_NTH):
        n = int(m[1])
        o["due_date"] = _nth_of_month(today, n)
        r = o["recurrence"]
        if r and r["rule"]["kind"] == "monthly":
            r["rule"] = {"kind": "monthly", "day": n}
    r = o["recurrence"]
    if r and r["rule"]["kind"] == "monthly" and o["due_date"]:
        r["rule"] = {"kind": "monthly", "day": int(o["due_date"][8:])}
    if o["recurrence"] and not o["due_date"]:
        o["due_date"] = today
    if o["due_time"] and not o["due_date"]:
        o["due_date"] = today

    title = _TAIL.sub("", text, count=1)
    title = _HEAD.sub("", title, count=1)
    title = js_trim(_SPACES.sub(" ", title))
    return Parsed(
        title=title[0].upper() + title[1:] if title else js_trim(text_in),
        due_date=o["due_date"],
        due_time=o["due_time"],
        recurrence=o["recurrence"],
        matched=matched,
    )


GROCERY = re.compile(
    r"\b(eggs?|rice|milk|bread|pandesal|coffee|chicken|pork|beef|fish|tuna|sardines"
    r"|garlic|onions?|tomato(es)?|bananas?|apples?|vegetables?|veggies|soy sauce"
    r"|vinegar|sugar|salt|oil|detergent|soap|shampoo|tissue|noodles|pasta|cheese"
    r"|butter|protein|oats|water)\b",
    _FLAGS,
)
WORK = re.compile(
    r"\b(deck|client|meeting|report|email|pr\b|jira|sprint|invoice|slides|standup"
    r"|boss|work)\b",
    _FLAGS,
)
VAGUE = re.compile(
    r"\b(after lunch|this afternoon|later today|later|after work)\b", _FLAGS
)
_SPLIT = re.compile(
    r",|;|\n| and (?=(?:buy|call|email|finish|pay|send|book|pick|reply|clean)\b)",
    _FLAGS,
)
_BUY_START = re.compile(f"^{_WS}*buy\\b", _FLAGS)
_BUY_PREFIX = re.compile(f"^{_WS}*buy{_WS}+", _FLAGS)
_AND = re.compile(" and ", _FLAGS)
_FOR_WORK = re.compile(r"\bfor work\b", _FLAGS)
_JOB2 = re.compile(r"\b(job ?2|side ?job|freelance)\b", _FLAGS)
_LIFE = re.compile(
    r"\b(pay|bill|meralco|pldt|mama|papa|dentist|doctor|laundry|clean)\b", _FLAGS
)

# The list keys capture routes to; services map them onto the user's lists.
LIST_KEYS = ("work", "job2", "life", "groceries")


@dataclass
class CaptureDraft(Parsed):
    list_key: str | None = None
    source: str = "capture-text"
    vague: bool = False


def split_capture(
    text: str,
    today: str,
    source: str = "capture-text",
    list_keys: tuple[str, ...] | list[str] = LIST_KEYS,
) -> list[CaptureDraft]:
    parts: list[str] = []
    for p in _SPLIT.split(text):
        parts.extend(_AND.split(p) if _BUY_START.search(p) else [p])
    out: list[CaptureDraft] = []
    for raw in parts:
        p = js_trim(raw)
        if not p:
            continue
        buy = bool(_BUY_PREFIX.search(p))
        vague = bool(VAGUE.search(p))
        clean = _BUY_PREFIX.sub("", p, count=1)
        clean = _FOR_WORK.sub("", clean, count=1)
        clean = VAGUE.sub("", clean, count=1)
        parsed = parse_task(clean, today)
        if vague and not parsed.due_time:
            parsed.due_date = parsed.due_date or today
        key: str | None = None
        if (
            (buy or GROCERY.search(clean))
            and not parsed.due_date
            and ("groceries" in list_keys)
        ):
            key = "groceries"
        elif (WORK.search(p) or _FOR_WORK.search(p)) and "work" in list_keys:
            key = "work"
        elif _JOB2.search(p) and "job2" in list_keys:
            key = "job2"
        elif _LIFE.search(p) and "life" in list_keys:
            key = "life"
        out.append(
            CaptureDraft(
                title=parsed.title,
                due_date=parsed.due_date,
                due_time=parsed.due_time,
                recurrence=parsed.recurrence,
                matched=parsed.matched,
                list_key=key,
                source=source,
                vague=vague and not parsed.due_time,
            )
        )
    return out
