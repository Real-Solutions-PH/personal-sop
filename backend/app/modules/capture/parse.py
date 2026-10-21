"""The deterministic capture parser: a port of ``shared/prototype/capture/parse.ts``.

It answers when no AI model resolves for the user (ADR-0012) and is the
reference the AI path's cards are shaped like. Pure: everything it reads
about the user's data comes in a :class:`World` snapshot, so the golden
fixture (``tests/golden/capture-parse.json``) runs it over the prototype seed.

Shape differences from the prototype, deliberate:

- payload keys are snake_case and money is integer centavos
  (``amount_minor`` = prototype pesos x 100);
- ids are whatever the world maps a word to (the user's account, category,
  habit, task or routine id as a string);
- the segmenter never splits on a thousands separator: the prototype read
  "bought shoes 2,499 on shopee" as two expenses (P2 and P499).

Regexes keep the prototype's JavaScript semantics: ASCII ``\\b``/``\\w``
(``re.ASCII``), ``$`` as end of input (``\\Z``), half-up ``Math.round``.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from math import floor
from typing import Any, Literal

from app.shared.currency import PHP, Currency, money, money_marks

A = re.ASCII
AI = re.ASCII | re.IGNORECASE

Kind = Literal[
    "journal",
    "question",
    "advice",
    "command",
    "habitCreate",
    "routine",
    "planned",
    "transfer",
    "income",
    "task",
    "cardio",
    "strength",
    "weighIn",
    "expense",
    "taskComplete",
    "habit",
    "meal",
    "feel",
    "unknown",
]

USD_RATE = 56  # prototype: "at P56/$ (FX rules are an open question)"


# ---------------------------------------------------------------- world


@dataclass(frozen=True)
class HabitRef:
    id: str
    name: str
    type: str
    target: float | None
    status: str = "active"


@dataclass(frozen=True)
class TaskRef:
    id: str
    title: str


@dataclass(frozen=True)
class RoutineRef:
    id: str
    name: str
    icon: str
    status: str = "active"


@dataclass(frozen=True)
class MealEstimate:
    items: list[dict[str, Any]]
    confidence: float
    follow_up: dict[str, Any] | None = None


MealFn = Callable[[str], MealEstimate | None]


def _no_meal(_: str) -> MealEstimate | None:
    return None


@dataclass
class World:
    """What the parser may know about the user, read once per capture."""

    today: date
    habits: list[HabitRef] = field(default_factory=list)
    tasks: list[TaskRef] = field(default_factory=list)  # open tasks only
    routines: list[RoutineRef] = field(default_factory=list)
    # ACCOUNT_WORDS key ("gcash", "bpicc", ...) -> the user's account id.
    account_keys: dict[str, str] = field(default_factory=dict)
    # Category slug ("dining", "salary", ...) -> the user's category id.
    category_slugs: dict[str, str] = field(default_factory=dict)
    default_account: str | None = None
    latest_kg: float | None = None
    recent_cats: list[dict[str, str]] = field(default_factory=list)
    account_options: list[dict[str, str]] = field(default_factory=list)
    # Task list key ("work", "job2", "life", "groceries") -> list id.
    list_keys: dict[str, str] = field(default_factory=dict)
    meal: MealFn = _no_meal
    # The profile's currency: follow-up questions name it, and its symbol and
    # code count as money words next to the prototype's ₱ and "php".
    currency: Currency = PHP


# ---------------------------------------------------------------- drafts


@dataclass
class RecordDraft:
    kind: str
    target: str
    rule: str
    payload: dict[str, Any]
    confirm: bool | None = None
    ask: dict[str, Any] | None = None
    warn: str | None = None
    confidence: float | None = None
    day_offset: int | None = None
    t: str = "record"

    def as_dict(self) -> dict[str, Any]:
        return _clean(
            {
                "t": "record",
                "kind": self.kind,
                "target": self.target,
                "rule": self.rule,
                "payload": self.payload,
                "confirm": self.confirm,
                "ask": self.ask,
                "warn": self.warn,
                "confidence": self.confidence,
                "day_offset": self.day_offset,
            }
        )


@dataclass
class QuestionDraft:
    text: str
    t: str = "question"

    def as_dict(self) -> dict[str, Any]:
        return {"t": "question", "text": self.text}


@dataclass
class InfoDraft:
    card: dict[str, Any]
    t: str = "info"

    def as_dict(self) -> dict[str, Any]:
        return {"t": "info", "card": self.card}


Draft = RecordDraft | QuestionDraft | InfoDraft


@dataclass(frozen=True)
class ParseCtx:
    source: str = "text"
    hint: str | None = None
    photo: bool | None = None


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    """Drop ``None`` values (the prototype's ``undefined``) one level deep."""
    return {k: v for k, v in d.items() if v is not None}


# ---------------------------------------------------------------- JS helpers


def js_round(x: float) -> int:
    return floor(x + 0.5)


def js_to_fixed(x: float, digits: int = 1) -> str:
    from decimal import ROUND_HALF_UP, Decimal

    q = Decimal(1).scaleb(-digits)
    return str(Decimal(x).quantize(q, rounding=ROUND_HALF_UP))


def js_num(x: float) -> str:
    """``String(n)`` for the numbers the parser prints (72.6, 5, 3.5)."""
    if x == int(x):
        return str(int(x))
    return repr(x)


def num(s: str) -> int | float:
    """``Number(s)`` for the digit strings the regexes capture."""
    v = float(s)
    return int(v) if v == int(v) and "." not in s else v


def utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def grouped(n: int) -> str:
    """``n.toLocaleString()`` for a whole amount."""
    return f"{n:,}"


def title(s: str) -> str:
    return re.sub(r"\b\w", lambda m: m.group(0).upper(), s, flags=A).strip()


def _test(pattern: str, s: str, flags: int = A) -> bool:
    return re.search(pattern, s, flags) is not None


# ---------------------------------------------------------------- tables

MONEY_CATS: list[tuple[str, str, str | None]] = [
    (r"\bgrab ?food\b|\bfoodpanda\b", "dining", "GrabFood"),
    (r"\bgrab\b|\bangkas\b|\bjoyride\b|\btaxi\b", "grab", "Grab"),
    (
        r"\b(jeep(ney)?|mrt|lrt|tricycle|trike|bus|commute|pamasahe|fare|p2p)\b",
        "commute",
        "Jeep / MRT",
    ),
    (r"\b(gas|fuel|petron|shell|caltex|parking|toll)\b", "transport", None),
    (r"\b(coffee|kape|starbucks|tims|tim hortons|latte|frappe)\b", "coffee", None),
    (
        r"\b(groceries|grocery|puregold|sm supermarket|supermarket|palengke|market|savemore)\b",
        "groceries",
        None,
    ),
    (r"\b(meralco|electric(ity)?|kuryente)\b", "electricity", "Meralco"),
    (r"\b(internet|pldt|converge|wifi|fiber)\b", "internet", None),
    (r"\b(load|globe|smart|dito|mobile plan|postpaid)\b", "phone", None),
    (r"\b(rent|upa)\b", "rent", None),
    (r"\b(netflix|spotify|youtube premium|icloud|subscription|disney)\b", "subs", None),
    (r"\b(shopee|lazada|clothes|shirt|shoes|zalora|uniqlo)\b", "shopping", None),
    (r"\b(movie|cinema|concert|games?|steam)\b", "entertainment", None),
    (
        r"\b(medicine|gamot|mercury|watsons|doctor|checkup|dentist|vitamins)\b",
        "health",
        None,
    ),
    (r"\b(haircut|barber|salon|gupit)\b", "personal", None),
    (r"\b(gift|regalo|birthday)\b", "gifts", None),
    (
        r"\b(lunch|dinner|breakfast|merienda|food|jollibee|mcdo|mcdonald'?s|chowking"
        r"|inasal|kfc|carinderia|samgyup|pizza|snack|ulam|burger|milk ?tea)\b",
        "dining",
        None,
    ),
]
PAYEES: list[tuple[str, str]] = [
    (r"\bjollibee\b", "Jollibee"),
    (r"\bmcdo|mcdonald", "McDonald's"),
    (r"\bchowking\b", "Chowking"),
    (r"\binasal\b", "Mang Inasal"),
    (r"\bstarbucks\b", "Starbucks"),
    (r"\btims|tim hortons", "Tim Hortons"),
    (r"\bpuregold\b", "Puregold"),
    (r"\bsm\b", "SM Supermarket"),
    (r"\bshopee\b", "Shopee"),
    (r"\blazada\b", "Lazada"),
    (r"\bmercury\b", "Mercury Drug"),
    (r"\bnetflix\b", "Netflix"),
    (r"\bspotify\b", "Spotify"),
    (r"\bmeralco\b", "Meralco"),
    (r"\bpldt\b", "PLDT"),
    (r"\bgrab ?food\b", "GrabFood"),
    (r"\bgrab\b", "Grab"),
]
ACCOUNT_WORDS: list[tuple[str, str]] = [
    (r"\bg-?cash\b", "gcash"),
    (r"\b(pay)?maya\b", "maya"),
    (r"\b(credit ?card|bpi ?card|cc|card)\b", "bpicc"),
    (r"\bbpi\b", "bpi"),
    (r"\bcol\b", "col"),
    (r"\bcash\b", "cash"),
]
# The account words above, as the hint a server user's account is found by.
ACCOUNT_KEY_HINTS: dict[str, tuple[str, ...]] = {
    "gcash": ("gcash",),
    "maya": ("maya",),
    "bpicc": ("bpi credit", "credit card", "card"),
    "bpi": ("bpi",),
    "col": ("col",),
    "cash": ("cash",),
}
EXERCISES: list[tuple[str, str]] = [
    (r"\bincline\b", "Incline Dumbbell Press"),
    (r"\bbench\b", "Barbell Bench Press"),
    (r"\b(ohp|overhead|military)\b", "Overhead Press"),
    (r"\blateral", "Lateral Raise"),
    (r"\bpush ?downs?\b|\btricep", "Triceps Pushdown"),
    (r"\brows?\b", "Barbell Row"),
    (r"\bpull ?downs?\b|\blat\b", "Lat Pulldown"),
    (r"\bpull ?-?ups?\b|\bchin ?-?ups?\b", "Pull-up"),
    (r"\bface ?pulls?\b", "Face Pull"),
    (r"\bcurls?\b", "Dumbbell Curl"),
    (r"\brdl\b|\bromanian\b", "Romanian Deadlift"),
    (r"\bleg ?press\b", "Leg Press"),
    (r"\bsquats?\b", "Back Squat"),
    (r"\bdeadlifts?\b", "Deadlift"),
    (r"\bdips?\b", "Dips"),
    (r"\blunges?\b", "Lunge"),
    (r"\bplank\b", "Plank"),
]
HABIT_ICONS: list[tuple[str, str]] = [
    (r"read", "📖"),
    (r"run|jog", "🏃"),
    (r"meditat|breath", "🧘"),
    (r"water|drink", "💧"),
    (r"stretch|yoga|mobility", "🤸"),
    (r"journal|write", "✍️"),
    (r"sleep|bed", "🛏️"),
    (r"walk|steps", "🚶"),
    (r"floss|teeth", "🦷"),
    (r"gym|workout|lift", "🏋️"),
]
STOP = frozenset(
    "the a an my with done did finished completed na yung ang for to of and "
    "today already".split()
)
DUE_OPTIONS = [
    {"label": "Tonight 8 PM", "value": "0|20:00"},
    {"label": "Tomorrow 9 AM", "value": "1|09:00"},
    {"label": "Sat 10 AM", "value": "sat|10:00"},
]


# ---------------------------------------------------------------- readers

_AMOUNT = re.compile(
    r"(?:₱|php|p|\$)?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k\b)?"
    r"(?!\s?(?:min|mins|minutes|km|kg|kilos?|x\b|x\d|pcs?|pages?|glasses?|cups?"
    r"|reps?|sets?|am\b|pm\b|th\b|st\b|nd\b|rd\b|hours?|hrs?|steps?|servings?|%|:\d))",
    AI,
)
_USD = re.compile(r"\$\s?\d|\b\d+(\.\d+)?\s?(usd|dollars?)\b", AI)


def _has_symbol(s: str, cur: Currency) -> bool:
    return _test(r"[₱$]", s) or cur.symbol.lower() in s


@dataclass(frozen=True)
class Amount:
    amount: int
    usd: bool


def parse_amount(s: str) -> Amount | None:
    usd = _USD.search(s) is not None
    for m in _AMOUNT.finditer(s):
        n = float(m.group(1).replace(",", ""))
        if n <= 0:
            continue
        if m.group(2):
            n *= 1000
        if s[m.end() : m.end() + 1] == "x":
            continue
        return Amount(js_round(n), usd)
    return None


def money_category(s: str) -> tuple[str | None, str | None]:
    low = s.lower()
    payee = next((p for rx, p in PAYEES if _test(rx, low)), None)
    for rx, cat, p in MONEY_CATS:
        if _test(rx, low):
            return cat, payee if payee is not None else p
    return None, payee


def account_key_in(s: str) -> str | None:
    low = s.lower()
    return next((k for rx, k in ACCOUNT_WORDS if _test(rx, low)), None)


def account_keys_in(s: str) -> list[str]:
    low = s.lower()
    hits: list[tuple[int, str]] = []
    for rx, k in ACCOUNT_WORDS:
        m = re.search(rx, low, A)
        if m is not None and all(h[1] != k for h in hits):
            hits.append((m.start(), k))
    return [k for _, k in sorted(hits, key=lambda h: h[0])]


def rel_day(s: str) -> int:
    return -1 if _test(r"\b(yesterday|kahapon|last night)\b", s, AI) else 0


def words(s: str) -> list[str]:
    cleaned = re.sub(r"[^a-z0-9ñ ]", " ", s.lower())
    return [w for w in re.split(r"\s+", cleaned) if len(w) >= 3 and w not in STOP]


def stem(w: str) -> str:
    return re.sub(r"(ation|ing|ed|es|s|e)\Z", "", w, count=1)[:5]


def match_habits(world: World, text: str) -> list[HabitRef]:
    qs = [stem(w) for w in words(text)]
    scored: list[tuple[int, HabitRef]] = []
    for h in world.habits:
        if h.status == "archived":
            continue
        name = re.sub(r"[×x]\d+|\d+m\b|\d+", "", h.name, flags=A)
        hw = [stem(w) for w in words(name)]
        score = sum(1 for w in hw if len(w) >= 3 and w in qs)
        if score > 0:
            scored.append((score, h))
    scored.sort(key=lambda x: -x[0])
    return [h for _, h in scored]


def match_tasks(world: World, text: str) -> list[TaskRef]:
    qs = [stem(w) for w in words(text)]
    if not qs:
        return []
    scored: list[tuple[int, TaskRef]] = []
    for t in world.tasks:
        score = sum(1 for w in (stem(x) for x in words(t.title)) if w in qs)
        if score > 0:
            scored.append((score, t))
    scored.sort(key=lambda x: -x[0])
    return [t for _, t in scored]


def meal_label(s: str) -> str | None:
    if _test(r"\b(breakfast|almusal)\b", s, AI):
        return "breakfast"
    if _test(r"\b(lunch|tanghalian)\b", s, AI):
        return "lunch"
    if _test(r"\b(dinner|hapunan|supper)\b", s, AI):
        return "dinner"
    if _test(r"\b(snack|merienda)\b", s, AI):
        return "snack"
    return None


def _account(world: World, key: str | None) -> str | None:
    return world.account_keys.get(key) if key else None


def _category(world: World, slug: str | None) -> str | None:
    return world.category_slugs.get(slug) if slug else None


# ---------------------------------------------------------------- drafts


def meal_draft(
    world: World, raw: str, *, photo: bool | None = None, default_plate: bool = False
) -> RecordDraft | None:
    parsed = world.meal(raw)
    if parsed is None and default_plate:
        parsed = world.meal("chicken adobo, rice")
    if parsed is None:
        return None
    ask = None
    if parsed.follow_up:
        ask = {
            "question": parsed.follow_up["question"],
            "field": "rice",
            "options": [
                {"label": o, "value": o} for o in parsed.follow_up.get("options", [])
            ],
        }
    return RecordDraft(
        kind="meal",
        target="fitness",
        rule="meal",
        confirm=bool(photo) or parsed.confidence < 0.7,
        confidence=parsed.confidence - 0.08 if photo else parsed.confidence,
        ask=ask,
        payload=_clean(
            {
                "kind": "meal",
                "raw": raw,
                "label": meal_label(raw),
                "items": [_clean(dict(i)) for i in parsed.items],
                "confidence": parsed.confidence,
                "from_photo": photo,
            }
        ),
    )


def parse_time(s: str) -> str | None:
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b", s, AI)
    if m:
        h = int(m.group(1)) % 12
        if m.group(3).lower() == "pm":
            h += 12
        return f"{h:02d}:{m.group(2) or '00'}"
    m24 = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", s, A)
    return f"{int(m24.group(1)):02d}:{m24.group(2)}" if m24 else None


_DAY_KEYS = {"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}


def parse_days(s: str) -> list[int]:
    low = s.lower()
    if _test(r"\bweekdays?\b", low):
        return [1, 2, 3, 4, 5]
    if _test(r"\bweekends?\b", low):
        return [0, 6]
    hits = [v for k, v in _DAY_KEYS.items() if _test(rf"\b{k}", low)]
    return hits or [0, 1, 2, 3, 4, 5, 6]


def habit_create_draft(spec: str, log_today: bool = False) -> RecordDraft:
    low = spec.lower()
    name_raw = re.sub(
        r"\b(every|each|daily|weekdays?|weekends?|at|on)\b.*\Z", "", spec, flags=AI
    )
    name_raw = re.sub(
        r"\d+\s?(min|mins|minutes|pages|glasses|x)\b.*\Z", "", name_raw, flags=AI
    ).strip()
    name_raw = name_raw or spec
    mins = re.search(r"(\d+)\s?(min|mins|minutes)\b", low, A)
    cnt = re.search(r"(\d+)\s?(pages|glasses|cups|reps|times)\b", low, A)
    icon = next((i for rx, i in HABIT_ICONS if _test(rx, low)), "✅")
    return RecordDraft(
        kind="habitCreate",
        target="habits",
        rule="structure",
        confirm=True,
        payload=_clean(
            {
                "kind": "habitCreate",
                "name": title(name_raw),
                "icon": icon,
                "type": "duration" if mins else "count" if cnt else "check",
                "target": num(mins.group(1))
                if mins
                else num(cnt.group(1))
                if cnt
                else None,
                "unit": cnt.group(2) if cnt else None,
                "days": parse_days(spec),
                "time": parse_time(spec),
                "log_today": log_today,
            }
        ),
    )


def _strength_exercises(s: str) -> tuple[list[dict[str, Any]], list[str]]:
    out: list[dict[str, Any]] = []
    unknown: list[str] = []
    for p in re.split(r",|;|\band\b", s, flags=AI):
        low = p.lower()
        ex = next((n for rx, n in EXERCISES if _test(rx, low)), None)
        sets: list[dict[str, Any]] = []
        wrs = re.search(r"(\d+(?:\.\d+)?)\s?(?:kg)?\s?x\s?(\d+)\s?x\s?(\d+)", low, A)
        srw = re.search(
            r"(\d+)\s?x\s?(\d+)\s*(?:@|at)?\s*(\d+(?:\.\d+)?)?\s?(?:kg)?", low, A
        )
        if wrs:
            w, reps, n = num(wrs.group(1)), num(wrs.group(2)), num(wrs.group(3))
            if w > 20:
                sets = [{"reps": reps, "weight": w} for _ in range(int(n))]
            else:
                sets = [{"reps": reps, "weight": n} for _ in range(int(w))]
        elif srw:
            n, reps = num(srw.group(1)), num(srw.group(2))
            w = num(srw.group(3)) if srw.group(3) else 0
            sets = [{"reps": reps, "weight": w} for _ in range(int(min(n, 10)))]
        if not sets:
            continue
        if ex is None:
            rest = re.sub(r"(\d+(?:\.\d+)?)\s?(kg)?\s?x.*\Z", "", p, flags=AI)
            rest = re.sub(r"^\s*(did( legs| push| pull)?:?)\s*", "", rest, flags=AI)
            name = title(rest.strip() or "Exercise")
            unknown.append(name)
        else:
            name = ex
        out.append({"exercise": name, "sets": sets})
    return out, unknown


_FEEL = (
    r"\b(ugh|tired|pagod|long day|stressed|stress|happy|sad|grateful|anxious"
    r"|burn(ed|t)? out|frustrated|excited|proud|lonely|masaya|malungkot|nakakapagod)\b"
)


def _has_ex(s: str) -> bool:
    return any(_test(rx, s) for rx, _ in EXERCISES)


def classify(world: World, seg: str, hint: str | None = None) -> Kind:
    s = seg.lower().strip()
    if _test(r"^(journal|dear diary|diary|reflection)\s*[:\-–]", s):
        return "journal"
    if _test(r"^(should i|can i afford|is it worth|worth it)\b", s):
        return "advice"
    if _test(r"\?\s*\Z", s) or _test(
        r"^(how|what|what's|whats|when|which|who|where|did i|do i|have i|am i|is my"
        r"|are my|show me|magkano|ilan|gaano)\b",
        s,
    ):
        return "question"
    if _test(r"^(change|make|set) (that|it|the last( one)?|last one)\b", s) or _test(
        r"^(delete|remove|undo|cancel|scratch) (that|it|the last( one)?|last one)\b", s
    ):
        return "command"
    if _test(r"^(new habit|add (a )?habit|create (a )?habit|start a habit)\b", s):
        return "habitCreate"
    if _test(r"\broutine\b", s) and _test(
        r"\b(start|started|starting|begin|play)\b", s
    ):
        return "routine"
    if hint == "journal":
        return "journal"
    amt = parse_amount(s)
    if amt and _test(r"\bevery (month|\d{1,2}(st|nd|rd|th))\b|\bmonthly\b", s):
        return "planned"
    if (
        amt
        and _test(
            r"\b(moved|move|transfer(red)?|sent|send|lipat|top ?up|topped up|cash ?in"
            r"|withdr[ae]w)\b",
            s,
        )
        and len(account_keys_in(s)) >= 1
        and _test(r"\b(to|into|sa|from)\b", s)
    ):
        return "transfer"
    if amt and _test(
        r"\b(got paid|salary|sweldo|payday|received|income|client paid|paid me"
        r"|refund|bonus|commission)\b",
        s,
    ):
        return "income"
    if _test(
        r"^(remind me|reminder|todo|to do|to-do|need to|i need to|gotta|must"
        r"|don'?t forget|buy|call|email|book|schedule|pick up|reply|clean|submit"
        r"|renew|text)\b",
        s,
    ) or (_test(r"^pay\b", s) and not amt):
        return "task"
    if _test(
        r"\b(ran|run|jog(ged)?|walk(ed)?|biked?|cycled?|cycling|swam|swim|hiked?"
        r"|treadmill)\b",
        s,
    ) and _test(r"\d\s?(k\b|km|min|mins|minutes|hr|hour)", s):
        return "cardio"
    if _has_ex(s) and _test(r"\d\s?x\s?\d", s):
        return "strength"
    if (
        (
            _test(r"\b(weigh(ed|t|ing)?|timbang|scale)\b", s)
            and _test(r"\d{2,3}(\.\d)?", s)
        )
        or (hint == "weigh-in" and _test(r"\d{2,3}(\.\d)?", s))
        or _test(r"^\d{2,3}(\.\d)?\s?kg\Z", s)
    ):
        return "weighIn"
    if amt and (
        hint == "expense"
        or _test(
            r"\b(spent|spend|paid|bought|gastos|gumastos|bayad|binayad|cost|"
            rf"{money_marks(world.currency)})\b",
            s,
        )
        or _has_symbol(s, world.currency)
        or money_category(s)[0]
        or account_key_in(s)
    ):
        if hint == "meal" and not _test(
            rf"\b(spent|paid|{money_marks(world.currency)})\b", s
        ):
            return "meal"
        return "expense"
    if _test(
        r"^(done with|finished|completed|tapos na|natapos|sent the|submitted|did the)\b",
        s,
    ):
        if match_habits(world, s) and not match_tasks(world, s):
            return "habit"
        return "taskComplete"
    if _test(
        r"^(did|done|finished|completed|meditated|read|drank|journaled|slept|stretched"
        r"|walked|flossed)\b",
        s,
    ) and (match_habits(world, s) or _test(r"^did my\b", s)):
        return "habit"
    if match_habits(world, s) and _test(
        r"\d+\s?(min|mins|minutes|pages|glasses|cups)\b", s
    ):
        return "habit"
    if hint == "task":
        return "task"
    if (
        hint == "meal"
        or _test(
            r"\b(ate|eat|had|kumain|breakfast|lunch|dinner|snack|merienda|almusal"
            r"|tanghalian|hapunan)\b",
            s,
        )
        or world.meal(s)
    ):
        return "meal" if world.meal(s) or hint == "meal" else "unknown"
    if utf16_len(s) > 160:
        return "journal"
    if _test(_FEEL, s, AI):
        return "feel"
    return "unknown"


# The prototype split on every comma. ``(?<!\d),`` / ``,(?!\d{3}(?!\d))`` keep
# a thousands separator ("2,499") inside its segment.
_SEGMENTS = re.compile(
    r"\n|;|\s+then\s+|(?<!\d),\s*(?:and\s+)?|,(?!\d{3}(?!\d))\s*(?:and\s+)?"
    r"|\s+(?:and|tapos|pati)\s+(?=(?:i\s+)?(?:how|what|what's|whats|spent|paid|ran"
    r"|jogged|walked|remind|bought|weighed|did|meditated|read|got|moved|transferred"
    r"|sent|had|ate|buy|call|pay|bench|squat|log|gastos|kumain|started|finished"
    r"|done)\b)",
    AI,
)


@dataclass
class Segment:
    seg: str
    kind: Kind


def segment(world: World, text: str, hint: str | None = None) -> list[Segment]:
    t = text.strip()
    whole = classify(world, t, hint)
    first = re.split(r",|;|\n|\s+and\s+", t, flags=A)[0]
    whole_question = whole == "question" and classify(world, first, hint) == "question"
    long = utf16_len(t) > 220
    if whole in ("journal", "advice", "habitCreate") or whole_question or long:
        return [Segment(t, "journal" if long and whole != "question" else whole)]
    raw = [x.strip() for x in _SEGMENTS.split(t)]
    out: list[Segment] = []
    for seg in (x for x in raw if x):
        kind = classify(world, seg, hint)
        prev = out[-1] if out else None
        bare = not _test(r"\d", seg) and len(re.split(r"\s+", seg)) <= 3
        if prev and (
            (
                prev.kind == "task"
                and _test(r"^buy\b", prev.seg, AI)
                and kind in ("unknown", "meal")
                and bare
            )
            or (prev.kind == "strength" and kind in ("strength", "unknown"))
            or (
                prev.kind == "meal" and (kind == "meal" or (kind == "unknown" and bare))
            )
            or (prev.kind == "habitCreate" and kind == "unknown")
        ):
            prev.seg = f"{prev.seg}, {seg}"
            continue
        out.append(Segment(seg, kind))
    return out


def expense_draft(world: World, seg: str, ctx: ParseCtx) -> RecordDraft | None:
    a = parse_amount(seg)
    if a is None:
        return None
    cat, payee = money_category(seg)
    acct = account_key_in(seg)
    # A dollar amount is foreign only to a PHP user: the rate is the
    # prototype's peso ruling, and nothing converts other currencies.
    usd = a.usd and world.currency.code == "PHP"
    amount = a.amount * USD_RATE if usd else a.amount
    note = re.search(r"\b(?:on|for|at|sa)\s+([a-z][\w' ]{1,30})\Z", seg, AI)
    d = RecordDraft(
        kind="expense",
        target="finance",
        rule="expense",
        day_offset=rel_day(seg),
        payload=_clean(
            {
                "kind": "expense",
                "amount_minor": amount * 100,
                "category_id": _category(world, cat),
                "account_id": _account(world, acct) or world.default_account,
                "payee": payee
                if payee is not None
                else (title(note.group(1)) if note else None),
                "currency": "USD" if usd else None,
                "from_receipt": ctx.photo,
            }
        ),
    )
    if usd:
        d.confirm = True
        d.warn = (
            f"Foreign currency: ${a.amount} ≈ {money(amount * 100, world.currency)} at ₱{USD_RATE}/$ "
            "(FX rules are an open question in Finance)."
        )
    if d.payload.get("category_id") is None:
        d.ask = {
            "question": f"What was {money(amount * 100, world.currency)} for?",
            "field": "category_id",
            "free": True,
            "options": list(world.recent_cats),
        }
    return d


_REMIND_ME = r"^(remind me( to)?|reminder( to)?|don'?t forget( to)?)\s*"


def task_draft(world: World, seg: str, source: str) -> RecordDraft:
    from app.modules.tasks.parse import split_capture

    reminder = _test(_REMIND_ME, seg, AI)
    clean = re.sub(_REMIND_ME, "", seg, count=1, flags=AI)
    clean = re.sub(
        r"^(todo|to do|to-do|need to|i need to|gotta|must)\s*:?\s*",
        "",
        clean,
        count=1,
        flags=AI,
    )
    drafts = split_capture(
        clean,
        world.today.isoformat(),
        "capture-voice" if source == "voice" else "capture-text",
        list(world.list_keys),
    )
    tasks: list[dict[str, Any]] = []
    for d in drafts:
        list_id = world.list_keys.get(d.list_key) if d.list_key else None
        tasks.append(
            {
                "title": title(d.title[:1]) + d.title[1:],
                "list_id": list_id,
                "due_date": d.due_date,
                "due_time": d.due_time,
                "remind": reminder
                or (
                    bool(d.due_date) and bool(d.due_time) and d.list_key != "groceries"
                ),
            }
        )
    needs_time = reminder and any(not t["due_date"] for t in tasks)
    return RecordDraft(
        kind="task",
        target="tasks",
        rule="reminder" if any(t["remind"] for t in tasks) else "task",
        payload={"kind": "task", "tasks": tasks},
        ask={
            "question": "When should I remind you?",
            "field": "due",
            "options": list(DUE_OPTIONS),
        }
        if needs_time
        else None,
    )


def cardio_draft(seg: str) -> RecordDraft:
    low = seg.lower()
    km = re.search(r"(\d+(?:\.\d+)?)\s?(?:k\b|km)", low, A)
    mins = re.search(r"(\d+)\s?(?:min|mins|minutes)\b", low, A)
    hr = re.search(r"(\d+(?:\.\d+)?)\s?(?:hr|hour)", low, A)
    mmss = re.search(r"\b(\d{1,3}):(\d{2})\b", low, A)
    minutes = (
        num(mins.group(1))
        if mins
        else js_round(float(hr.group(1)) * 60)
        if hr
        else num(mmss.group(1))
        if mmss
        else None
    )
    activity = (
        "Walk"
        if _test("walk", low)
        else "Ride"
        if _test("bik|cycl", low)
        else "Swim"
        if _test("swam|swim", low)
        else "Hike"
        if _test("hike", low)
        else "Run"
    )
    km_n = num(km.group(1)) if km else None
    name = f"{js_num(km_n) + ' km ' if km_n else ''}{activity.lower()}"
    return RecordDraft(
        kind="workout",
        target="fitness",
        rule="workout",
        day_offset=rel_day(seg),
        payload={
            "kind": "workout",
            "name": name[:1].upper() + name[1:],
            "exercises": [],
            "cardio": _clean({"km": km_n, "min": minutes, "activity": activity}),
        },
    )


def weigh_draft(world: World, seg: str) -> RecordDraft | None:
    m = re.search(r"(\d{2,3}(?:\.\d)?)", seg, A)
    if m is None:
        return None
    kg: float = num(m.group(1))
    if _test(r"\b(lb|lbs|pounds?)\b", seg, AI):
        kg = js_round((kg / 2.2046) * 10) / 10
    prev = world.latest_kg
    off = abs(kg - prev) / prev if prev else 0
    return RecordDraft(
        kind="weighIn",
        target="fitness",
        rule="weighIn",
        confirm=off > 0.03,
        warn=(
            f"That's {js_to_fixed(off * 100, 1)}% off your last weigh-in "
            f"({js_num(prev)} kg) — typo?"
        )
        if off > 0.03 and prev
        else None,
        payload=_clean({"kind": "weighIn", "kg": kg, "prev_kg": prev}),
    )


def habit_draft(world: World, seg: str) -> RecordDraft:
    hs = match_habits(world, seg)
    low = seg.lower()
    mins = re.search(r"(\d+)\s?(min|mins|minutes)\b", low, A)
    cnt = re.search(r"(\d+)\s?(pages|glasses|cups|x|times)\b", low, A)
    if not hs:
        name = re.sub(
            r"^(did|done|finished|completed)\s+(my|the)?\s*", "", seg, flags=AI
        )
        name = re.sub(r"\b(today|already|na)\b", "", name, flags=AI).strip()
        d = habit_create_draft(name or seg, True)
        d.warn = f"No habit called “{title(name)}” yet — create it and check today?"
        return d
    h = hs[0]
    value: float | None
    if h.type == "duration":
        value = num(mins.group(1)) if mins else h.target
    elif h.type == "count":
        value = num(cnt.group(1)) if cnt else h.target
    else:
        value = None
    return RecordDraft(
        kind="habitLog",
        target="habits",
        rule="habit",
        day_offset=rel_day(seg),
        payload=_clean(
            {
                "kind": "habitLog",
                "habit_id": h.id,
                "value": value,
                "add": h.type == "count" and cnt is not None,
            }
        ),
    )


def income_draft(world: World, seg: str) -> RecordDraft | None:
    a = parse_amount(seg)
    if a is None:
        return None
    low = seg.lower()
    cat = (
        "salary"
        if _test(r"\b(salary|sweldo|payday|got paid|bonus)\b", low)
        else "freelance"
        if _test(r"\b(client|freelance|commission|side)\b", low)
        else "other-in"
    )
    acct = _account(world, account_key_in(seg))
    return RecordDraft(
        kind="income",
        target="finance",
        rule="income",
        payload=_clean(
            {
                "kind": "income",
                "amount_minor": a.amount * 100,
                "category_id": _category(world, cat),
                "account_id": acct,
                "payee": "Employer" if cat == "salary" else None,
            }
        ),
        ask=None
        if acct
        else {
            "question": f"Which account did the {money(a.amount * 100, world.currency)} land in?",
            "field": "account_id",
            "options": list(world.account_options),
        },
    )


def transfer_draft(world: World, seg: str) -> RecordDraft | None:
    a = parse_amount(seg)
    if a is None:
        return None
    low = seg.lower()
    accts = account_keys_in(seg)
    frm: str | None = None
    to: str | None = None
    to_m = re.search(r"\b(?:to|into|sa)\s+(\w[\w-]*)", low, A)
    from_m = re.search(r"\bfrom\s+(\w[\w-]*)", low, A)
    if to_m:
        to = account_key_in(to_m.group(1))
    if from_m:
        frm = account_key_in(from_m.group(1))
    if not frm and len(accts) == 2:
        frm = next((x for x in accts if x != to), None)
    if not to and len(accts) == 2:
        to = next((x for x in accts if x != frm), None)
    frm_id, to_id = _account(world, frm), _account(world, to)
    opts = world.account_options
    ask: dict[str, Any] | None = None
    if not frm_id:
        ask = {
            "question": f"Moved {money(a.amount * 100, world.currency)} from which account?",
            "field": "from",
            "options": [o for o in opts if o["value"] != to_id],
        }
    elif not to_id:
        ask = {
            "question": "To which account?",
            "field": "to",
            "options": [o for o in opts if o["value"] != frm_id],
        }
    return RecordDraft(
        kind="transfer",
        target="finance",
        rule="transfer",
        payload=_clean(
            {
                "kind": "transfer",
                "amount_minor": a.amount * 100,
                "from": frm_id,
                "to": to_id,
            }
        ),
        ask=ask,
    )


def planned_draft(world: World, seg: str) -> RecordDraft | None:
    a = parse_amount(seg)
    if a is None:
        return None
    dm = re.search(r"every\s+(\d{1,2})(?:st|nd|rd|th)", seg, AI)
    cat, payee = money_category(seg)
    if payee is None:
        rest = re.sub(
            rf"({money_marks(world.currency)})?\s?\d[\d,.]*k?", "", seg, flags=AI
        )
        rest = re.sub(r"\bevery.*\Z", "", rest, flags=AI).strip()
        name = title(rest or "Bill")
    else:
        name = payee
    return RecordDraft(
        kind="planned",
        target="finance",
        rule="structure",
        confirm=True,
        payload=_clean(
            {
                "kind": "planned",
                "name": name,
                "amount_minor": a.amount * 100,
                "day": int(dm.group(1)) if dm else world.today.day,
                "account_id": _account(world, account_key_in(seg))
                or world.default_account,
                "category_id": _category(world, cat),
            }
        ),
    )


def task_complete_draft(world: World, seg: str) -> Draft:
    q = re.sub(
        r"^(done with|finished|completed|tapos na( yung)?|natapos( ko)?( na)?( yung)?"
        r"|did the)\s*",
        "",
        seg,
        count=1,
        flags=AI,
    )
    ts = match_tasks(world, q)
    if not ts:
        return InfoDraft(
            {
                "tone": "fallback",
                "title": f"No open task matches “{q.strip()}”",
                "body": "Want to add it as done, or check your list?",
                "actions": [
                    {"label": "Open tasks", "do": "link", "href": "/tasks"},
                    {"label": "Quick add", "do": "quickadd"},
                ],
            }
        )
    return RecordDraft(
        kind="taskComplete",
        target="tasks",
        rule="task",
        payload=_clean(
            {
                "kind": "taskComplete",
                "task_id": ts[0].id if len(ts) == 1 else None,
                "query": q,
            }
        ),
        ask={
            "question": "Which one did you finish?",
            "field": "task_id",
            "options": [{"label": t.title, "value": t.id} for t in ts[:5]],
        }
        if len(ts) > 1
        else None,
    )


def routine_draft(world: World, seg: str) -> RecordDraft:
    rs = [r for r in world.routines if r.status == "active"]
    qs = [stem(w) for w in words(seg)]
    hit = next(
        (
            r
            for r in rs
            if any(w in qs and w != "routi" for w in (stem(x) for x in words(r.name)))
        ),
        None,
    )
    return RecordDraft(
        kind="routineStart",
        target="habits",
        rule="structure",
        confirm=True,
        payload=_clean(
            {
                "kind": "routineStart",
                "routine_id": hit.id if hit else None,
                "query": seg,
            }
        ),
        ask=None
        if hit
        else {
            "question": "Which routine?",
            "field": "routine_id",
            "options": [{"label": f"{r.icon} {r.name}", "value": r.id} for r in rs],
        },
    )


def strength_draft(seg: str) -> RecordDraft | None:
    out, unknown = _strength_exercises(seg)
    if not out:
        return None
    day = re.search(
        r"\b(legs|push|pull|chest|back|arms|upper|lower|shoulders?)\b", seg.lower(), A
    )
    n = len(unknown)
    return RecordDraft(
        kind="workout",
        target="fitness",
        rule="workout",
        confirm=n > 0,
        day_offset=rel_day(seg),
        warn=(
            f"New exercise{'s' if n > 1 else ''}: {', '.join(unknown)} — I'll add "
            f"{'them' if n > 1 else 'it'} to your library."
        )
        if n
        else None,
        payload={
            "kind": "workout",
            "name": f"{title(day.group(1))} day"
            if day
            else out[0]["exercise"]
            if len(out) == 1
            else "Workout",
            "exercises": out,
            "new_exercises": unknown,
        },
    )


def _upper_sentence(m: re.Match[str]) -> str:
    return m.group(1) + m.group(2).upper()


def journal_draft(text: str, source: str) -> RecordDraft:
    body = re.sub(
        r"^(journal|dear diary|diary|reflection)\s*[:\-–]\s*", "", text, flags=AI
    ).strip()
    low = body.lower()
    mood = (
        5
        if _test(r"\b(great|amazing|proud|grateful|happy|win|masaya)\b", low)
        else 4
        if _test(r"\b(good|nice|calm|productive)\b", low)
        else 2
        if _test(r"\b(tired|pagod|meh|long day|ugh)\b", low)
        else 1
        if _test(r"\b(sad|awful|terrible|anxious|stressed|malungkot)\b", low)
        else None
    )
    area = (
        "career"
        if _test(r"\b(work|client|boss|career|deck|meeting|job)\b", low)
        else "health"
        if _test(r"\b(gym|sleep|ate|workout|run|health|weight)\b", low)
        else "money"
        if _test(r"\b(money|spent|budget|save|savings|paid)\b", low)
        else "relationships"
        if _test(r"\b(mama|papa|family|friend|jessa|partner|date)\b", low)
        else "identity"
        if _test(r"\b(who i am|becoming|identity|values)\b", low)
        else None
    )
    if source == "voice":
        cleaned = re.sub(r"\b(um+|uh+|like,|you know,)\s*", "", body, flags=AI)
        cleaned = re.sub(r"(^|[.!?]\s+)([a-z])", _upper_sentence, cleaned, flags=A)
    else:
        cleaned = body[:1].upper() + body[1:]
    tags: list[str] = []
    for rx, tag in (
        (r"\bsleep|slept\b", "sleep"),
        (r"\bgym|workout|lift", "gym"),
        (r"\bgrateful|thankful\b", "gratitude"),
        (r"\bwin|shipped|proud\b", "win"),
    ):
        if _test(rx, low) and tag not in tags:
            tags.append(tag)
    return RecordDraft(
        kind="journal",
        target="journal",
        rule="journal",
        payload=_clean(
            {
                "kind": "journal",
                "body": cleaned,
                "mood": mood,
                "area": area,
                "tags": tags,
                "transcript": body if source == "voice" else None,
            }
        ),
    )


def facts_in_journal(world: World, text: str, ctx: ParseCtx) -> list[RecordDraft]:
    out: list[RecordDraft] = []
    low = text.lower()
    if re.search(r"slept (?:at )?(\d{1,2})\s?(am|pm)?", low, A):
        hs = match_habits(world, "sleep")
        if hs:
            out.append(
                RecordDraft(
                    kind="habitLog",
                    target="habits",
                    rule="habit",
                    confirm=True,
                    warn="From your journal — I won't save it unless you confirm.",
                    payload={"kind": "habitLog", "habit_id": hs[0].id},
                )
            )
    spent = re.search(
        rf"\bspent\s+(?:{money_marks(world.currency)})?\s?(\d[\d,]*k?)\s+on\s+([a-z ]{{2,20}})",
        text,
        AI,
    )
    if spent:
        d = expense_draft(world, spent.group(0), ctx)
        if d:
            d.confirm = True
            d.warn = "From your journal — confirm to log it."
            out.append(d)
    return out


def _info(
    tone: str, title_: str, body: str, actions: list[dict[str, Any]]
) -> InfoDraft:
    return InfoDraft({"tone": tone, "title": title_, "body": body, "actions": actions})


def _push(out: list[Draft], d: RecordDraft | None) -> None:
    if d is not None:
        out.append(d)


def parse_capture(world: World, text: str, ctx: ParseCtx) -> list[Draft]:
    out: list[Draft] = []
    for s in segment(world, text, ctx.hint):
        seg, kind = s.seg, s.kind
        if kind == "journal":
            out.append(journal_draft(seg, ctx.source))
            out.extend(facts_in_journal(world, seg, ctx))
        elif kind in ("question", "advice"):
            out.append(QuestionDraft(seg))
        elif kind == "command":
            a = parse_amount(seg)
            out.append(
                RecordDraft(
                    kind="command",
                    target="finance",
                    rule="structure",
                    confirm=True,
                    payload=_clean(
                        {
                            "kind": "command",
                            "op": "delete"
                            if _test(r"^(delete|remove|undo|cancel|scratch)", seg, AI)
                            else "edit",
                            "amount_minor": a.amount * 100 if a else None,
                        }
                    ),
                )
            )
        elif kind == "habitCreate":
            spec = re.sub(
                r"^(new habit|add (a )?habit|create (a )?habit|start a habit)\s*:?\s*",
                "",
                seg,
                count=1,
                flags=AI,
            )
            out.append(habit_create_draft(spec))
        elif kind == "routine":
            out.append(routine_draft(world, seg))
        elif kind == "planned":
            _push(out, planned_draft(world, seg))
        elif kind == "transfer":
            _push(out, transfer_draft(world, seg))
        elif kind == "income":
            _push(out, income_draft(world, seg))
        elif kind == "strength":
            _push(out, strength_draft(seg))
        elif kind == "weighIn":
            _push(out, weigh_draft(world, seg))
        elif kind == "expense":
            _push(out, expense_draft(world, seg, ctx))
        elif kind == "task":
            out.append(task_draft(world, seg, ctx.source))
        elif kind == "cardio":
            out.append(cardio_draft(seg))
        elif kind == "taskComplete":
            out.append(task_complete_draft(world, seg))
        elif kind == "habit":
            out.append(habit_draft(world, seg))
        elif kind == "meal":
            md = meal_draft(world, seg, photo=ctx.photo)
            if md is not None:
                md.day_offset = rel_day(seg)
                out.append(md)
            else:
                out.append(
                    _info(
                        "fallback",
                        "I couldn't tell what you ate",
                        "Name the dishes (e.g. “adobo, 1 cup rice”) or log it by hand.",
                        [
                            {"label": "Quick add meal", "do": "quickadd"},
                            {
                                "label": "Try: adobo with rice",
                                "do": "prompt",
                                "prompt": "lunch adobo with 1 cup rice",
                            },
                        ],
                    )
                )
        elif kind == "feel":
            out.append(
                _info(
                    "journal-suggest",
                    "Nothing to log — want to keep it?",
                    f"“{seg}”",
                    [
                        {"label": "Save as journal", "do": "journal", "prompt": seg},
                        {"label": "Just venting", "do": "link", "href": ""},
                    ],
                )
            )
        else:
            short = f"{seg[:40]}…" if utf16_len(seg) > 40 else seg
            out.append(
                _info(
                    "fallback",
                    f"Not sure what to do with “{short}”",
                    "Try saying it like you'd text a friend, or add it by hand.",
                    [
                        {"label": "Quick add", "do": "quickadd"},
                        {"label": "Save as journal", "do": "journal", "prompt": seg},
                        {
                            "label": "Make it a task",
                            "do": "prompt",
                            "prompt": f"todo {seg}",
                        },
                    ],
                )
            )
    return out
