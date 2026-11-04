"""A described meal estimated by the user's AI model.

"Describe your meal" used to run only the built-in food table
(``foods.parse_meal_text``): 26 dishes matched by keyword. A food it did not
know was dropped without a word, so a plate of four foods could come back as
the one it recognised; "chicken" alone matched nothing, and "eggplant"
matched "egg". The table stays as the fallback when no model resolves, the
budget refuses the call or the model fails.

The model's items go through the same checks Fern's meal tools use
(``nutrient_check.estimate_problems``). Any problem is sent back once to be
fixed; what is still wrong after that is settled here, never saved as is:
calories that do not add up from the macros take the Atwater value, and the
estimate's confidence drops so the review screen asks for a look.
"""

import json
import re
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field, ValidationError

from app.modules.ai_providers import public as ai
from app.modules.fitness import foods as F
from app.modules.fitness import nutrient_check as N
from app.shared.context import Ctx

SYSTEM = (
    "You estimate nutrition for a personal food log in the Philippines. "
    "Reply with one JSON object only, no prose."
)
PROMPT = (
    "Itemise this meal as the person described it, one item per food, every "
    "food they named (never leave one out). Amounts they state are exact: "
    "grams are the item's weight; cups, pieces, bowls and plates are counts "
    "of that unit. When no amount is given, assume one typical Filipino "
    "serving and say so in the assumption. Use cooked weights for cooked "
    "food (1 cup steamed white rice is about 160 g and 205 kcal). For each "
    "item give its edible weight in grams and its nutrition for that "
    "amount: kcal must equal about 4 x protein + 4 x carbs + 9 x fat. "
    'Sodium in milligrams. {"items": [{"name", "qty", "unit", "grams", '
    '"kcal", "protein", "carbs", "fat", "fiber", "sat_fat", "fiber_soluble", '
    '"fiber_insoluble", "sugar", "sodium", "assumption"}], "confidence": 0-1}'
    "\nMeal: "
)
REPAIR = (
    "Some items have values that cannot be right. Fix them and reply with "
    "the whole meal again, same JSON shape.\nProblems: {problems}\n"
    "Your answer was: {answer}"
)
# A model's confidence is its own; an estimate it needed fixing for, or one
# whose numbers were settled here, is never shown as more sure than this.
REPAIRED_CONFIDENCE = 0.6
SETTLED_CONFIDENCE = 0.4
MAX_CONFIDENCE = 0.92
_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)
_DECODER = json.JSONDecoder()
GRAM_UNITS = frozenset({"g", "gram", "grams"})


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    qty: float = Field(default=1, gt=0, le=10000)
    unit: str = Field(default="serving", min_length=1, max_length=24)
    grams: float | None = Field(default=None, gt=0, le=10000)
    kcal: float = Field(ge=0, le=20000)
    protein: float = Field(default=0, ge=0, le=2000)
    carbs: float = Field(default=0, ge=0, le=2000)
    fat: float = Field(default=0, ge=0, le=2000)
    fiber: float | None = Field(default=None, ge=0, le=2000)
    sat_fat: float | None = Field(default=None, ge=0, le=2000)
    fiber_soluble: float | None = Field(default=None, ge=0, le=2000)
    fiber_insoluble: float | None = Field(default=None, ge=0, le=2000)
    sugar: float | None = Field(default=None, ge=0, le=2000)
    sodium: float | None = Field(default=None, ge=0, le=100000)
    assumption: str | None = Field(default=None, max_length=200)


def ask(ctx: Ctx, resolved: ai.ResolvedModel, text: str) -> str | None:
    """The one model call (the seam a test substitutes): its answer text,
    or None when the provider fails. Metered either way."""
    model = ai.build_chat_model(resolved)
    msgs: list[BaseMessage] = [SystemMessage(SYSTEM), HumanMessage(content=text)]
    try:
        out = model.invoke(msgs)
    except Exception:  # noqa: BLE001 - a provider failure falls back to the table
        ai.record_usage(
            ctx, resolved, input_tokens=0, output_tokens=0, cost_minor=0, ok=False
        )
        return None
    meta = (
        (getattr(out, "usage_metadata", None) or {})
        if isinstance(out, AIMessage)
        else {}
    )
    i, o = int(meta.get("input_tokens") or 0), int(meta.get("output_tokens") or 0)
    ai.record_usage(
        ctx,
        resolved,
        input_tokens=i,
        output_tokens=o,
        cost_minor=ai.price_minor(resolved.model, i, o),
    )
    content = out.content
    return content if isinstance(content, str) else str(content)


def _object(text: str | None) -> dict[str, Any] | None:
    """The widest JSON object in a model's answer (its thinking removed)."""
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


def _items(answer: str | None) -> tuple[list[ItemIn], float] | None:
    obj = _object(answer)
    if obj is None or not isinstance(obj.get("items"), list):
        return None
    items = []
    for raw in obj["items"][:30]:
        try:
            items.append(ItemIn.model_validate(raw))
        except ValidationError:
            continue
    if not items:
        return None
    try:
        confidence = float(obj.get("confidence", 0.7))
    except (TypeError, ValueError):
        confidence = 0.7
    return items, max(0.0, min(MAX_CONFIDENCE, confidence))


def _problems(items: list[ItemIn]) -> list[dict[str, Any]]:
    out = []
    for it in items:
        found = N.estimate_problems(it.model_dump(exclude_none=True))
        if found:
            out.append({"item": it.name, "problems": found})
    return out


def settle(it: ItemIn) -> tuple[ItemIn, bool]:
    """An item made consistent with itself: its amount in grams when it is
    weighed, and calories from its macros when the two disagree. True when
    a number had to change."""
    if it.grams and it.unit.strip().casefold() in GRAM_UNITS:
        it = it.model_copy(update={"qty": it.grams})
    data: Mapping[str, Any] = it.model_dump(exclude_none=True)
    if any(
        p["problem"] == "kcal_does_not_match_macros" for p in N.value_problems(data)
    ):
        atwater = N.kcal_from_macros(data)
        if atwater is not None:
            return it.model_copy(update={"kcal": float(round(atwater))}), True
    return it, False


def _draft(it: ItemIn) -> F.ItemDraft:
    assumption = it.assumption
    if it.grams and it.unit.strip().casefold() not in GRAM_UNITS:
        weight = f"about {it.grams:g} g"
        assumption = f"{assumption}, {weight}" if assumption else weight
    return F.ItemDraft(
        name=it.name,
        qty=round(it.qty, 2),
        unit=it.unit,
        kcal=round(it.kcal),
        protein=round(it.protein),
        carbs=round(it.carbs),
        fat=round(it.fat),
        assumption=assumption[:200] if assumption else None,
        fiber=it.fiber,
        sat_fat=it.sat_fat,
        fiber_soluble=it.fiber_soluble,
        fiber_insoluble=it.fiber_insoluble,
        sugar=it.sugar,
        sodium=it.sodium,
    )


def _resolve(ctx: Ctx) -> ai.ResolvedModel | None:
    resolved = ai.resolve_model(ctx, "capture") or ai.resolve_model(ctx, "chat")
    if resolved is None:
        return None
    try:
        ai.check_budget(ctx)
    except HTTPException:
        return None
    return resolved


def estimate(ctx: Ctx, text: str) -> F.Estimate | None:
    """The model's estimate of a described meal, checked; None when no
    model is available or it gave nothing usable (the caller then uses the
    built-in table). Flushes usage rows only."""
    resolved = _resolve(ctx)
    if resolved is None:
        return None
    # Sums in the box are added up first, so the resolved weight is what the
    # model reads and what the item shows ("209+25-27g" is 207 g).
    text = F.add_up_amounts(text)
    answer = ask(ctx, resolved, PROMPT + text[:2000])
    got = _items(answer)
    if got is None:
        return None
    items, confidence = got
    wrong = _problems(items)
    if wrong:
        again = _items(
            ask(
                ctx,
                resolved,
                PROMPT
                + text[:2000]
                + "\n"
                + REPAIR.format(
                    problems=json.dumps(wrong, ensure_ascii=False),
                    answer=json.dumps(
                        [i.model_dump(exclude_none=True) for i in items],
                        ensure_ascii=False,
                    ),
                ),
            )
        )
        if again is not None:
            items, confidence = again[0], min(again[1], REPAIRED_CONFIDENCE)
        else:
            confidence = min(confidence, REPAIRED_CONFIDENCE)
    settled = [settle(i) for i in items]
    if any(changed for _, changed in settled) or _problems([i for i, _ in settled]):
        confidence = min(confidence, SETTLED_CONFIDENCE)
    return F.Estimate(items=[_draft(i) for i, _ in settled], confidence=confidence)
