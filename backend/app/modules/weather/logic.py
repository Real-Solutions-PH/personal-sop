"""Pure weather logic, ported from ``mobile/src/prototype/weather.ts``:
Open-Meteo parsing, outdoor scoring, the best/worst window plan and the
one-line advice. Times are location-local ``YYYY-MM-DDTHH:MM`` strings, as
Open-Meteo returns them with ``timezone=auto``; ``now_ms`` is epoch millis.
Golden-tested against the prototype (``tests/golden/weather-logic.json``)."""

import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

TempUnit = Literal["c", "f"]
IssueKind = Literal["rain", "storm", "heat", "cold", "uv", "wind"]


def js_round(x: float) -> int:
    """JavaScript ``Math.round``: halves go toward +infinity."""
    return math.floor(x + 0.5)


@dataclass
class Hour:
    time: str
    temp: float
    feels: float
    code: float
    pop: float
    precip: float
    wind: float
    uv: float
    humidity: float
    day: bool


@dataclass
class Day:
    date: str
    code: float
    max: float
    min: float
    feelsMax: float  # noqa: N815 - the prototype's wire name
    pop: float
    precip: float
    uv: float
    wind: float
    sunrise: str
    sunset: str


@dataclass
class Place:
    name: str
    lat: float
    lon: float
    detail: str | None = None


@dataclass
class Forecast:
    fetchedAt: int  # noqa: N815
    place: Place
    offset: int
    current: Hour
    hourly: list[Hour]
    daily: list[Day]


@dataclass
class Issue:
    kind: IssueKind
    penalty: float
    value: float


@dataclass
class Scored:
    hour: Hour
    score: int
    issues: list[Issue] = field(default_factory=list)


@dataclass
class HourWindow:
    start: int
    end: int
    hours: list[Scored]
    avg: float


@dataclass
class Plan:
    label: Literal["Today", "Tomorrow"]
    hours: list[Scored]
    best: HourWindow | None
    worst: HourWindow | None


@dataclass
class Advice:
    kind: Literal["storm", "rain", "heat", "uv", "wind", "window", "fair", "none"]
    tone: Literal["good", "warn", "bad"]
    text: str


def _num(v: object) -> float:
    if isinstance(v, bool) or not isinstance(v, int | float):
        return 0
    return v if math.isfinite(v) else 0


def parse_forecast(json: dict[str, Any], place: Place, now_ms: int) -> Forecast:
    h, d, c = json["hourly"], json["daily"], json["current"]
    times = list(h["time"])

    def ahead(col: list[Any], i: int) -> float:
        # Open-Meteo's hourly precipitation and its probability cover the hour
        # BEFORE the timestamp; shift them so the 2 PM slot means 2-3 PM. The
        # last slot has no following hour and keeps its own values.
        return _num(col[i + 1 if i + 1 < len(times) else i])

    hourly = [
        Hour(
            time=t,
            temp=_num(h["temperature_2m"][i]),
            feels=_num(h["apparent_temperature"][i]),
            code=_num(h["weather_code"][i]),
            pop=ahead(h["precipitation_probability"], i),
            precip=ahead(h["precipitation"], i),
            wind=_num(h["wind_speed_10m"][i]),
            uv=_num(h["uv_index"][i]),
            humidity=_num(h["relative_humidity_2m"][i]),
            day=_num(h["is_day"][i]) == 1,
        )
        for i, t in enumerate(times[:72])
    ]
    time = str(c["time"])
    match = next((x for x in hourly if x.time[:13] == time[:13]), None)
    uv_raw = c.get("uv_index")
    current = Hour(
        time=time,
        temp=_num(c.get("temperature_2m")),
        feels=_num(c.get("apparent_temperature")),
        code=_num(c.get("weather_code")),
        pop=match.pop if match else 0,
        precip=_num(c.get("precipitation")),
        wind=_num(c.get("wind_speed_10m")),
        uv=_num(uv_raw if uv_raw is not None else (match.uv if match else None)),
        humidity=_num(c.get("relative_humidity_2m")),
        day=_num(c.get("is_day")) == 1,
    )
    daily = [
        Day(
            date=t,
            code=_num(d["weather_code"][i]),
            max=_num(d["temperature_2m_max"][i]),
            min=_num(d["temperature_2m_min"][i]),
            feelsMax=_num(d["apparent_temperature_max"][i]),
            pop=_num(d["precipitation_probability_max"][i]),
            precip=_num(d["precipitation_sum"][i]),
            uv=_num(d["uv_index_max"][i]),
            wind=_num(d["wind_speed_10m_max"][i]),
            sunrise=str(d["sunrise"][i] or ""),
            sunset=str(d["sunset"][i] or ""),
        )
        for i, t in enumerate(d["time"])
    ]
    return Forecast(
        fetchedAt=now_ms,
        place=place,
        offset=int(_num(json.get("utc_offset_seconds"))),
        current=current,
        hourly=hourly,
        daily=daily,
    )


def local_stamp(offset: int, now_ms: int) -> str:
    at = datetime.fromtimestamp(now_ms / 1000 + offset, tz=timezone.utc)
    return at.strftime("%Y-%m-%dT%H:%M")


def hour_of(time: str) -> int:
    return int(time[11:13])


def current_conditions(f: Forecast, now_ms: int) -> Hour:
    # Drift from the prototype, which returns null once the hourly forecast
    # no longer covers now: the API's `current` field is not nullable, and the
    # server refetches long before its cached forecast runs out.
    if now_ms - f.fetchedAt < 45 * 60_000:
        return f.current
    key = local_stamp(f.offset, now_ms)[:13]
    return next((h for h in f.hourly if h.time[:13] == key), f.current)


def upcoming(f: Forecast, now_ms: int, count: int = 24) -> list[Hour]:
    key = local_stamp(f.offset, now_ms)[:13]
    idx = next((i for i, h in enumerate(f.hourly) if h.time[:13] == key), -1)
    return [] if idx < 0 else f.hourly[idx : idx + count]


def today_of(f: Forecast, now_ms: int) -> Day | None:
    date = local_stamp(f.offset, now_ms)[:10]
    return next((d for d in f.daily if d.date == date), None)


def rain_soon(f: Forecast, now_ms: int) -> float:
    nxt = upcoming(f, now_ms, 12)
    if nxt:
        return max(h.pop for h in nxt)
    today = today_of(f, now_ms)
    return today.pop if today else 0


def _is_storm(code: float) -> bool:
    return code >= 95


def _is_wet(code: float) -> bool:
    return (51 <= code <= 67) or (80 <= code <= 82) or code >= 95


def score_hour(h: Hour) -> Scored:
    issues: list[Issue] = []
    if h.pop >= 30 or h.precip >= 0.3:
        issues.append(Issue("rain", h.pop * 0.7 + min(h.precip, 5) * 8, h.pop))
    if _is_storm(h.code):
        issues.append(Issue("storm", 60, 0))
    if h.feels >= 31:
        issues.append(Issue("heat", (h.feels - 30) * 6, h.feels))
    if h.feels <= 8:
        issues.append(Issue("cold", (9 - h.feels) * 4, h.feels))
    if h.uv >= 6:
        issues.append(Issue("uv", (h.uv - 5) * 7, h.uv))
    if h.wind >= 30:
        issues.append(Issue("wind", (h.wind - 29) * 1.5, h.wind))
    # JS sort is stable; Python's too, so equal penalties keep push order.
    issues.sort(key=lambda i: -i.penalty)
    total = sum(i.penalty for i in issues)
    return Scored(hour=h, score=js_round(max(0, min(100, 100 - total))), issues=issues)


def _pick(
    hours: list[Scored],
    lengths: list[int],
    ok: Any,
    better: Any,
) -> HourWindow | None:
    for length in lengths:
        found: HourWindow | None = None
        for i in range(len(hours) - length + 1):
            run = hours[i : i + length]
            if hour_of(run[-1].hour.time) - hour_of(run[0].hour.time) != length - 1:
                continue
            if not all(ok(s) for s in run):
                continue
            avg = sum(s.score for s in run) / length
            if found is None or better(avg, found.avg):
                found = HourWindow(
                    start=hour_of(run[0].hour.time),
                    end=hour_of(run[-1].hour.time) + 1,
                    hours=run,
                    avg=avg,
                )
        if found is not None:
            return found
    return None


def outdoor_plan(f: Forecast, now_ms: int) -> Plan:
    stamp = local_stamp(f.offset, now_ms)
    date, hour_key = stamp[:10], stamp[:13]
    label: Literal["Today", "Tomorrow"] = "Today"
    hours = [
        h for h in f.hourly if h.time[:10] == date and h.time[:13] >= hour_key and h.day
    ]
    if not hours:
        label = "Tomorrow"
        nxt = next((h.time[:10] for h in f.hourly if h.time[:10] > date), None)
        hours = [h for h in f.hourly if h.time[:10] == nxt and h.day]
    scored = [score_hour(h) for h in hours]
    return Plan(
        label=label,
        hours=scored,
        best=_pick(scored, [4, 3, 2, 1], lambda s: s.score >= 70, lambda a, b: a > b),
        worst=_pick(scored, [3, 2, 1], lambda s: s.score < 50, lambda a, b: a < b),
    )


def to_unit(c: float, unit: TempUnit) -> float:
    return c * 9 / 5 + 32 if unit == "f" else c


def fmt_temp(c: float, unit: TempUnit) -> str:
    return f"{js_round(to_unit(c, unit))}°"


def fmt_hour(hour: int) -> str:
    h = ((hour % 24) + 24) % 24
    return f"{12 if h % 12 == 0 else h % 12} {'AM' if h < 12 else 'PM'}"


def fmt_range(start: int, end: int) -> str:
    a, b = fmt_hour(start).split(" "), fmt_hour(end).split(" ")
    return f"{a[0]}–{b[0]} {b[1]}" if a[1] == b[1] else f"{' '.join(a)}–{' '.join(b)}"


def _wet_hour(h: Hour) -> bool:
    return h.pop >= 50 or (_is_wet(h.code) and h.precip >= 0.5)


def _storm_hour(h: Hour) -> bool:
    return _is_storm(h.code) and h.pop >= 40


def _rain_lead(f: Forecast, plan: Plan, now_ms: int) -> tuple[str, str] | None:
    """Rain in the next few hours, daylight or not: (kind, text). Leads the
    advice when it is raining now, and at night (when the plan has moved on
    to tomorrow) when it starts within 3 hours."""
    nxt = upcoming(f, now_ms, 7)
    if not nxt:
        return None
    cur = current_conditions(f, now_ms)
    raining = cur.precip > 0 or _wet_hour(nxt[0])
    storm = _storm_hour(nxt[0])
    if raining or storm:
        end = next(
            (
                i
                for i, h in enumerate(nxt)
                if i > 0 and not _wet_hour(h) and not _storm_hour(h) and h.precip < 0.3
            ),
            -1,
        )
        kind = "storm" if storm else "rain"
        what = "Thunderstorms now" if storm else "Raining now"
        if end > 0:
            return kind, f"{what} until about {fmt_hour(hour_of(nxt[end].time))}"
        last = fmt_hour(hour_of(nxt[0].time) + len(nxt))
        return kind, f"{what} — no break before {last}"
    if plan.label != "Tomorrow":
        return None
    later = next((h for h in nxt[1:4] if _storm_hour(h) or _wet_hour(h)), None)
    if later is None:
        return None
    at = fmt_hour(hour_of(later.time))
    if _storm_hour(later):
        return "storm", f"Thunderstorms likely after {at}"
    return "rain", f"Rain likely after {at}"


_TONE_RANK = {"good": 0, "warn": 1, "bad": 2}


def outdoor_advice(f: Forecast, unit: TempUnit, now_ms: int) -> Advice:
    plan = outdoor_plan(f, now_ms)
    lead = _rain_lead(f, plan, now_ms)
    if lead and plan.label == "Today":
        kind, text = lead
        if kind == "storm":
            return Advice("storm", "bad", f"{text} — avoid open ground")
        return Advice("rain", "warn", f"{text} — bring a jacket")
    rest = _plan_advice(f, plan, unit, now_ms)
    if not lead or rest.kind == "none":
        return rest
    kind, text = lead
    tone: Literal["good", "warn", "bad"] = "bad" if kind == "storm" else "warn"
    if _TONE_RANK[rest.tone] > _TONE_RANK[tone]:
        tone = rest.tone
    return Advice("storm" if kind == "storm" else "rain", tone, f"{text}. {rest.text}")


def _plan_advice(f: Forecast, plan: Plan, unit: TempUnit, now_ms: int) -> Advice:
    hours = [s.hour for s in plan.hours]
    if not hours:
        return Advice("none", "warn", "Forecast is out of date — pull to refresh")
    pre = "Tomorrow: " if plan.label == "Tomorrow" else ""
    first = hour_of(hours[0].time)
    now_hour = hour_of(local_stamp(f.offset, now_ms))

    def when(h: Hour) -> str:
        if plan.label == "Today" and hour_of(h.time) == first and first == now_hour:
            return "now"
        return f"after {fmt_hour(hour_of(h.time))}"

    best_text = fmt_range(plan.best.start, plan.best.end) if plan.best else None
    storm = next((h for h in hours if _storm_hour(h)), None)
    if storm:
        return Advice(
            "storm",
            "bad",
            f"{pre}Thunderstorms likely {when(storm)} — avoid open ground",
        )
    rain = next((h for h in hours if _wet_hour(h)), None)
    if rain:
        w = when(rain)
        text = (
            f"{pre}Raining now — bring a jacket"
            if w == "now"
            else f"{pre}Rain likely {w} — bring a jacket"
        )
        return Advice("rain", "warn", text)
    hottest = hours[0]
    for h in hours[1:]:
        if h.feels > hottest.feels:
            hottest = h
    if hottest.feels >= 35:
        tail = f", best outside {best_text}" if best_text else " and take shade breaks"
        return Advice(
            "heat",
            "bad" if hottest.feels >= 41 else "warn",
            f"{pre}Feels like {fmt_temp(hottest.feels, unit)} — hydrate{tail}",
        )
    uv = [h for h in hours if h.uv >= 8]
    if uv:
        peak = max(h.uv for h in uv)
        span = fmt_range(hour_of(uv[0].time), hour_of(uv[-1].time) + 1)
        level = "extreme" if peak >= 11 else "very high"
        return Advice("uv", "warn", f"{pre}UV {level} {span}, seek shade")
    windy = next((h for h in hours if h.wind >= 40), None)
    if windy:
        return Advice(
            "wind",
            "warn",
            f"{pre}Strong wind near {js_round(windy.wind)} km/h — secure loose items",
        )
    if best_text:
        return Advice(
            "window", "good", f"{pre}Good window for outdoor work {best_text}"
        )
    return Advice("fair", "warn", f"{pre}Fair conditions — pace yourself outdoors")


def to_dict(obj: object) -> dict[str, Any]:
    return asdict(obj)  # type: ignore[call-overload,no-any-return]
