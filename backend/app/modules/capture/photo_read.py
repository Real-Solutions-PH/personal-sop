"""Reading photos for Fern: nutrition labels, plates of food, receipts,
screens. Pure parts only (no database, no network): preparing an image,
the readers' instructions, merging several readers into one reading by
majority, and writing that reading as text for the chat agent.

Why several readers: one vision model misreads a digit now and then (5.6
for 5.8, 50 for 540), and a misread label becomes a logged meal. Reading a
label with three models and keeping each number only when at least two
agree gave, on real labels, 96% of values agreed and right, the rest
flagged unclear and none agreed and wrong. A value the readers disagree on
is passed on as unclear with what each saw, so Fern asks instead of
guessing.
"""

import io
import json
import re
from collections import Counter
from typing import Any

# Small photos are enlarged before reading: phone uploads of 512 px made
# label digits too small (75% of values right, against 95% once enlarged).
MIN_EDGE = 1400
MAX_EDGE = 2000

READER = (
    "You read photos attached to a message in a personal tracking app "
    "(meals and macros, money, training, habits). Answer only JSON:\n"
    '{"photos": [{"kind": "label"|"meal"|"receipt"|"screen"|"other",'
    ' "what": str, "product": str|null, "serving_size": str|null,'
    ' "servings_per_container": str|null,'
    ' "per_serving": {"kcal": num, "fat_g": num, "sat_fat_g": num,'
    ' "carbs_g": num, "fiber_g": num, "sugar_g": num, "protein_g": num,'
    ' "sodium_mg": num}|null, "per_100g": {same keys}|null,'
    ' "foods": [{"name": str, "grams": num, "how": "scale"|"label"|"estimate"}]|null,'
    ' "scale_g": num|null, "text": str|null, "unclear": [str]}]}\n'
    "One entry per photo, in order. A photo may be rotated or upside down: "
    "read it anyway.\n"
    "label: product is the brand and name printed on the visible pack "
    "(null when not shown; never a guess from the ingredients or other "
    "small print). Copy every number "
    "exactly as printed: per_serving from the per-serving column, per_100g "
    "only if the label has that column. '<1' is 0.5. null for a row the "
    "label lacks. A value you cannot read clearly goes in unclear, never a "
    "guess.\n"
    "meal: every food separately (rice, each protein, sauce, oil, drink) "
    "with its cooked grams. Use a kitchen scale's display when one shows "
    "(scale_g, and how=scale); otherwise estimate from the plate, bowl, "
    "spoon or hand, leaning higher for large portions.\n"
    "receipt or screen: the lines that matter in text (items, amounts with "
    "currency, payee, date; exercises, sets, reps, weights).\n"
    "what: a few words on what the photo shows."
)
CAREFUL = (
    "\nThis is a second, careful reading because the first may have been "
    "wrong: check every digit and decimal point against the photo again."
)

NUTRIENTS = (
    ("kcal", "", "kcal"),
    ("fat_g", "fat", "g"),
    ("sat_fat_g", "saturated fat", "g"),
    ("carbs_g", "carbs", "g"),
    ("fiber_g", "fiber", "g"),
    ("sugar_g", "sugar", "g"),
    ("protein_g", "protein", "g"),
    ("sodium_mg", "sodium", "mg"),
)
_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)
_DECODER = json.JSONDecoder()


def json_object(text: str | None) -> dict[str, Any] | None:
    """The JSON object in a model's answer, or None. Thinking models put
    their reasoning (``<think>…</think>``, often with braces in it) or a
    sentence before the JSON; taking everything from the first "{" to the
    last "}" then fails to parse and a good answer was thrown away. So the
    thinking goes first, then the widest object that parses wins."""
    if not text:
        return None
    body = _THINK.sub("", text)
    best: tuple[int, dict[str, Any]] | None = None
    at = body.find("{")
    while at >= 0:
        try:
            obj, end = _DECODER.raw_decode(body, at)
        except ValueError:
            obj, end = None, at
        if isinstance(obj, dict) and (best is None or end - at > best[0]):
            best = (end - at, obj)
        at = body.find("{", max(end, at + 1))
    return best[1] if best else None


def prepare(data: bytes, mime: str) -> tuple[bytes, str]:
    """The photo upright (EXIF orientation applied) with its long edge
    between MIN_EDGE and MAX_EDGE, as JPEG. The original when it cannot be
    decoded."""
    try:
        from PIL import Image, ImageOps

        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
        im = im.convert("RGB")
        long = max(im.size)
        target = MIN_EDGE if long < MIN_EDGE else MAX_EDGE if long > MAX_EDGE else long
        if target != long:
            w, h = im.size
            im = im.resize(
                (round(w * target / long), round(h * target / long)),
                Image.Resampling.LANCZOS,
            )
        out = io.BytesIO()
        im.save(out, "JPEG", quality=90)
        return out.getvalue(), "image/jpeg"
    except Exception:  # noqa: BLE001 - an unreadable image is sent as it came
        return data, mime


def parse(text: str | None) -> list[dict[str, Any]] | None:
    """A reader's photos, or None when it did not answer the JSON asked."""
    if not text:
        return None
    obj = json_object(text)
    photos = obj.get("photos") if obj is not None else None
    if not isinstance(photos, list):
        return None
    return [p for p in photos if isinstance(p, dict)]


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or v is None:
        return None
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return None


def _vote(values: list[float | None], readers: int) -> tuple[float | None, list[float]]:
    """(the agreed value, what the readers saw when they did not agree).
    ``values`` has one entry per reader that answered, None where it read
    nothing. One reader: its value. Several: the value at least two read
    alike; a number only one of them saw is a guess and is dropped, and two
    different numbers are returned to be asked about."""
    seen = [v for v in values if v is not None]
    if not seen:
        return None, []
    if readers < 2:
        return seen[0], []
    best, n = Counter(seen).most_common(1)[0]
    if n >= 2:
        return best, []
    return None, (seen if len(set(seen)) > 1 else [])


def _first(photos: list[dict[str, Any]], key: str) -> Any:
    for p in photos:
        v = p.get(key)
        if v not in (None, "", []):
            return v
    return None


def merge_photo(answers: list[str | None]) -> dict[str, Any] | None:
    """One photo's reading from every reader's answer for it (readers in
    order of preference). Numbers are voted; descriptions, foods and text
    come from the first reader that has them. None when no reader answered
    the JSON asked for."""
    photos: list[dict[str, Any]] = []
    for a in answers:
        got = parse(a)
        if got:
            photos.append(got[0])
    if not photos:
        return None
    n = len(photos)
    kinds = Counter(str(p.get("kind") or "other") for p in photos)
    out: dict[str, Any] = {
        "kind": kinds.most_common(1)[0][0],
        "readers": n,
        "unclear": {},
    }
    for key in (
        "what",
        "product",
        "serving_size",
        "servings_per_container",
        "text",
        "foods",
    ):
        out[key] = _first(photos, key)
    out["notes"] = sorted({str(u) for p in photos for u in (p.get("unclear") or [])})
    for basis in ("per_serving", "per_100g"):
        rows: list[dict[str, Any]] = [
            r if isinstance(r := p.get(basis), dict) else {} for p in photos
        ]
        if not any(rows):
            continue
        values: dict[str, float] = {}
        for key, _, _ in NUTRIENTS:
            agreed, split = _vote([_num(r.get(key)) for r in rows], n)
            if agreed is not None:
                values[key] = agreed
            elif split:
                out["unclear"][f"{basis}.{key}"] = split
        if values:
            out[basis] = values
    scale, split = _vote([_num(p.get("scale_g")) for p in photos], n)
    out["scale_g"] = scale
    if split:
        out["unclear"]["scale_g"] = split
    return out


def merge(per_photo: list[list[str | None]]) -> list[dict[str, Any]]:
    """Every photo's reading, in order; a photo no reader could read says so."""
    out: list[dict[str, Any]] = []
    for answers in per_photo:
        m = merge_photo(answers)
        out.append(m or {"kind": "unread", "readers": 0, "unclear": {}, "notes": []})
    return out if any(m["readers"] for m in out) else []


def _fmt(v: float) -> str:
    return str(int(v)) if v == int(v) else str(v)


def _nutrients(values: dict[str, float]) -> str:
    parts = []
    for key, name, unit in NUTRIENTS:
        if key in values:
            v = _fmt(values[key])
            parts.append(f"{v} kcal" if key == "kcal" else f"{name} {v} {unit}")
    return ", ".join(parts)


def render(merged: list[dict[str, Any]], label: str) -> str:
    """The reading as text for Fern."""
    readers = max((m["readers"] for m in merged), default=1)
    head = f"[{label} attached. What they show"
    if readers > 1:
        head += f" (read by {readers} readers; label numbers are the ones at least two read alike)"
    lines = [head + ":"]
    for i, m in enumerate(merged, 1):
        if m["kind"] == "unread":
            lines.append(f"Photo {i} — could not be read just now.")
            continue
        kind = {"label": "nutrition label", "meal": "meal"}.get(m["kind"], m["kind"])
        title = m.get("product") or m.get("what") or ""
        lines.append(f"Photo {i} — {kind}: {title}".rstrip(": "))
        if m.get("serving_size") or m.get("servings_per_container"):
            lines.append(
                f"Serving {m.get('serving_size') or '?'}; servings per container "
                f"{m.get('servings_per_container') or '?'}."
            )
        if m.get("per_serving"):
            lines.append(f"Per serving: {_nutrients(m['per_serving'])}.")
        if m.get("per_100g"):
            lines.append(f"Per 100 g: {_nutrients(m['per_100g'])}.")
        foods = m.get("foods") or []
        if isinstance(foods, list) and foods:
            items = []
            for f in foods:
                if not isinstance(f, dict) or not f.get("name"):
                    continue
                g = _num(f.get("grams"))
                how = "weighed" if f.get("how") == "scale" else "about"
                items.append(f"{f['name']} {how} {_fmt(g)} g" if g else str(f["name"]))
            if items:
                lines.append("Foods: " + "; ".join(items) + ".")
        if m.get("scale_g") is not None:
            lines.append(f"Kitchen scale shows {_fmt(m['scale_g'])} g.")
        if m.get("text") and m["kind"] not in ("label",):
            lines.append(str(m["text"]))
        if m["unclear"]:
            seen = "; ".join(
                f"{k.split('.')[-1].replace('_g', '').replace('_mg', '')} "
                f"(read as {', '.join(_fmt(v) for v in vs)})"
                for k, vs in m["unclear"].items()
            )
            lines.append(f"Unclear, ask before using: {seen}.")
        if m.get("notes"):
            lines.append("Hard to read: " + "; ".join(m["notes"]) + ".")
    return "\n".join(lines) + "]"
