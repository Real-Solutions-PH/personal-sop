"""Photo captures (CAP-03): meal, receipt, nutrition label, statement,
whiteboard (IA J3/J4, ADR-0012 section 6).

Order of preference:

1. a vision-capable ``resolve_model(ctx, "vision")`` reads the image (with
   the user's caption as a hint) and answers structured JSON per hint;
2. otherwise the OCR module reads the text and the capture model, or the
   rules parser, interprets it (statements always go through OCR when no
   vision model reads them);
3. with no model at all: the built-in meal estimator over the caption, the
   parser over the OCR text, or an info card.

The prototype simulated every photo (a fixed adobo plate, a rotating set of
three receipts); the server never invents what a photo shows.
"""

import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date as Date
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlmodel import col

from app.modules.ai_providers import public as ai
from app.modules.capture import ports, seams
from app.modules.capture.models import Capture, CaptureAttachment, RecordCard
from app.modules.capture.parse import (
    Draft,
    InfoDraft,
    ParseCtx,
    RecordDraft,
    World,
    money_category,
    parse_capture,
)
from app.modules.media import public as media
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid
from app.shared.money import MAX_MINOR

HINT_OPTIONS = [
    {"label": "🍽️ Meal", "value": "meal"},
    {"label": "🧾 Receipt", "value": "receipt"},
    {"label": "Both", "value": "both"},
    {"label": "Just a note", "value": "note"},
]
ANSWERABLE_HINTS = (
    "meal",
    "receipt",
    "label",
    "statement",
    "whiteboard",
    "both",
    "note",
)


# ---------------------------------------------------------------- vision JSON


class ItemOut(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    qty: float = Field(default=1, ge=0, le=10000)
    unit: str = Field(default="serving", max_length=24)
    kcal: float = Field(ge=0, le=20000)
    protein: float = Field(default=0, ge=0, le=2000)
    carbs: float = Field(default=0, ge=0, le=2000)
    fat: float = Field(default=0, ge=0, le=2000)
    assumption: str | None = Field(default=None, max_length=200)


class FollowOut(BaseModel):
    question: str = Field(max_length=200)
    options: list[str] = Field(default_factory=list, max_length=6)


class MealOut(BaseModel):
    items: list[ItemOut] = Field(default_factory=list, max_length=30)
    confidence: float = Field(default=0.5, ge=0, le=1)
    follow_up: FollowOut | None = None


class ReceiptOut(BaseModel):
    merchant: str | None = Field(default=None, max_length=120)
    total: float = Field(gt=0, le=MAX_MINOR / 100)
    date: Date | None = None
    category: str | None = Field(default=None, max_length=60)
    confidence: float = Field(default=0.8, ge=0, le=1)


class LabelOut(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    serving: str = Field(default="1 serving", max_length=60)
    kcal: float = Field(ge=0, le=20000)
    protein: float = Field(default=0, ge=0, le=2000)
    carbs: float = Field(default=0, ge=0, le=2000)
    fat: float = Field(default=0, ge=0, le=2000)
    servings: float | None = Field(default=None, gt=0, le=100)


class RowOut(BaseModel):
    date: Date
    time: str = Field(default="00:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    description: str = Field(min_length=1, max_length=500)
    amount: float = Field(gt=0, le=MAX_MINOR / 100)
    direction: Literal["in", "out"]
    ref: str = Field(default="", max_length=80)


class StatementOut(BaseModel):
    rows: list[RowOut] = Field(default_factory=list, max_length=5000)


class SetOut(BaseModel):
    reps: int = Field(ge=0, le=1000)
    weight: float = Field(default=0, ge=0, le=2000)


class ExOut(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sets: list[SetOut] = Field(default_factory=list, max_length=50)


class BoardOut(BaseModel):
    """A whiteboard is a to-do list or a gym board."""

    tasks: list[str] = Field(default_factory=list, max_length=50)
    exercises: list[ExOut] = Field(default_factory=list, max_length=40)


class AutoOut(BaseModel):
    hint: Literal["meal", "receipt", "label", "statement", "whiteboard", "other"]


SYSTEM = (
    "You read photos for a personal life-logging app in the Philippines. "
    "Amounts are Philippine pesos. Reply with one JSON object only, no prose."
)
PROMPTS: dict[str, str] = {
    "auto": 'What is this photo of? {"hint": "meal|receipt|label|statement|whiteboard|other"}',
    "meal": (
        "Itemise the meal with estimated macros per item: "
        '{"items": [{"name", "qty", "unit", "kcal", "protein", "carbs", "fat", "assumption"}], '
        '"confidence": 0-1, "follow_up": {"question", "options": [..]} or null}'
    ),
    "receipt": (
        'Read the receipt: {"merchant", "total" (pesos), "date" (YYYY-MM-DD or null), '
        '"category" (a spending category word), "confidence": 0-1}'
    ),
    "label": (
        'Read the nutrition label per serving: {"name", "serving", "kcal", "protein", '
        '"carbs", "fat", "servings" (eaten, or null when not stated)}'
    ),
    "statement": (
        'List every transaction row: {"rows": [{"date": "YYYY-MM-DD", "time": "HH:MM", '
        '"description", "amount" (pesos, positive), "direction": "in|out", "ref"}]}'
    ),
    "whiteboard": (
        'Read the board. A to-do list: {"tasks": ["..."]}. A gym board: {"exercises": '
        '[{"name", "sets": [{"reps", "weight"}]}]}'
    ),
}


# ---------------------------------------------------------------- drafts


def _meal_draft(
    raw: str,
    items: list[dict[str, Any]],
    confidence: float,
    follow_up: dict[str, Any] | None,
    *,
    field: str = "rice",
    warn: str | None = None,
) -> RecordDraft:
    ask = None
    if follow_up and follow_up.get("question"):
        ask = {
            "question": follow_up["question"],
            "field": field,
            "options": [
                {"label": o, "value": o} if isinstance(o, str) else o
                for o in follow_up.get("options") or []
            ],
        }
    return RecordDraft(
        kind="meal",
        target="fitness",
        rule="meal",
        confirm=True,
        confidence=confidence,
        ask=ask,
        warn=warn,
        payload={
            "kind": "meal",
            "raw": raw,
            "items": [{k: v for k, v in i.items() if v is not None} for i in items],
            "confidence": confidence,
            "from_photo": True,
        },
    )


def _receipt_draft(ctx: Ctx, cap: Capture, world: World, r: ReceiptOut) -> RecordDraft:
    cat_slug, payee = money_category(f"{r.merchant or ''} {r.category or ''}")
    cat = world.category_slugs.get(cat_slug) if cat_slug else None
    if cat is None and r.category:
        hit = ports.finance.resolve_category(ctx, r.category)
        cat = str(hit.id) if hit else None
    offset = 0
    if r.date is not None:
        offset = max(-366, min(0, (r.date - ctx.clock.day_of(cap.at)).days))
    return RecordDraft(
        kind="expense",
        target="finance",
        rule="expense",
        confirm=True,
        confidence=r.confidence,
        day_offset=offset,
        warn="Read from the receipt · date from receipt"
        if offset
        else "Read from the receipt",
        payload={
            k: v
            for k, v in {
                "kind": "expense",
                "amount_minor": round(r.total * 100),
                "category_id": cat,
                "account_id": world.default_account,
                "payee": r.merchant or payee,
                "from_receipt": True,
            }.items()
            if v is not None
        },
    )


def _label_draft(lb: LabelOut) -> RecordDraft:
    n = lb.servings or 1
    item = {
        "name": lb.name,
        "qty": n,
        "unit": lb.serving,
        "kcal": lb.kcal * n,
        "protein": lb.protein * n,
        "carbs": lb.carbs * n,
        "fat": lb.fat * n,
    }
    follow = (
        None
        if lb.servings
        else {
            "question": "How many servings did you eat?",
            "options": [
                {"label": f"{v} serving{'' if v == '1' else 's'}", "value": v}
                for v in ("1", "2", "3")
            ],
        }
    )
    return _meal_draft(lb.name, [item], 0.9, follow, field="servings")


def _board_drafts(ctx: Ctx, world: World, b: BoardOut) -> list[Draft]:
    warn = "Read from the board — check the numbers."
    out: list[Draft] = []
    if b.tasks:
        out.append(
            RecordDraft(
                kind="task",
                target="tasks",
                rule="task",
                confirm=True,
                warn=warn,
                payload={
                    "kind": "task",
                    "tasks": [
                        {
                            "title": t[:280],
                            "list_id": None,
                            "due_date": None,
                            "due_time": None,
                            "remind": False,
                        }
                        for t in b.tasks
                        if t.strip()
                    ],
                },
            )
        )
    if b.exercises:
        out.append(
            RecordDraft(
                kind="workout",
                target="fitness",
                rule="workout",
                confirm=True,
                warn=warn,
                payload={
                    "kind": "workout",
                    "name": "Workout" if len(b.exercises) > 1 else b.exercises[0].name,
                    "exercises": [
                        {"exercise": e.name, "sets": [s.model_dump() for s in e.sets]}
                        for e in b.exercises
                    ],
                },
            )
        )
    del ctx, world
    return out


def _info(tone: str, title: str, body: str, actions: list[dict[str, Any]]) -> InfoDraft:
    return InfoDraft({"tone": tone, "title": title, "body": body, "actions": actions})


def unreadable(caption: str) -> InfoDraft:
    return _info(
        "fallback",
        "Couldn't find anything to log",
        "I couldn't read this photo. Describe it in a line, or log it by hand.",
        [
            {"label": "Quick add", "do": "quickadd"},
            {
                "label": "Save as note",
                "do": "journal",
                "prompt": caption or "Photo note",
            },
        ],
    )


def ask_hint(caption: str) -> RecordDraft:
    return RecordDraft(
        kind="photo",
        target="fitness",
        rule="meal",
        confirm=True,
        payload={"kind": "photo", "caption": caption},
        ask={
            "question": "What should I log from this photo?",
            "field": "hint",
            "options": list(HINT_OPTIONS),
        },
    )


# ---------------------------------------------------------------- pipeline


@dataclass
class PhotoEnv:
    """What a photo interpretation needs; ``text_path`` runs the capture
    model (or the rules) over text the OCR read."""

    world: World
    image: tuple[bytes, str] | None
    vision: ai.ResolvedModel | None
    text_path: Callable[[str, str], list[Draft]]


def image_of(ctx: Ctx, cap: Capture) -> tuple[uuid.UUID, bytes, str] | None:
    att = owned_repo.find_one(
        ctx,
        CaptureAttachment,
        col(CaptureAttachment.capture_id) == cap.id,
        col(CaptureAttachment.kind) == "image",
    )
    if att is None:
        return None
    m = media.require_ready(ctx, att.media_id, kinds=("image",))
    return att.media_id, media.read_bytes(m, max_bytes=seams.IMAGE_MAX_BYTES), m.mime


def statement_handoff(
    ctx: Ctx, cap: Capture, *, rows: list[RowOut] | None, account_id: uuid.UUID | None
) -> InfoDraft:
    acct = account_id
    if acct is None:
        d = ports.finance.default_account(ctx)
        acct = d.id if d else None
    if acct is None:
        return _info(
            "handoff",
            "That's a statement — add an account first",
            "Finance matches statements to an account's transactions.",
            [{"label": "Open Finance", "do": "link", "href": "/finance"}],
        )
    media_id = None
    att = owned_repo.find_one(
        ctx, CaptureAttachment, col(CaptureAttachment.capture_id) == cap.id
    )
    if att is not None:
        media_id = att.media_id
    ftype = (
        "image"
        if cap.source == "photo"
        else ("csv" if (cap.file_name or "").lower().endswith(".csv") else "pdf")
    )
    imp = ports.start_statement_import(
        ctx,
        account_id=acct,
        file_name=cap.file_name or "statement",
        file_type=ftype,
        media_id=media_id,
        import_id=uuid.uuid5(cap.id, "statement-import"),
        rows=[
            {
                "ref": r.ref,
                "date": r.date.isoformat(),
                "time": r.time,
                "raw": r.description,
                "amount_minor": round(r.amount * 100),
                "direction": r.direction,
            }
            for r in rows
        ]
        if rows
        else None,
    )
    n = len(rows or [])
    return _info(
        "handoff",
        "That's a statement — Finance matches those to your transactions",
        (
            f"I read {n} line{'' if n == 1 else 's'}. Import shows you the differences before anything changes."
            if n
            else "Import reads every line and shows you the differences before anything changes."
        ),
        [{"label": "Open import", "do": "link", "href": f"/finance/import/{imp}"}],
    )


def _vision(
    ctx: Ctx, env: PhotoEnv, hint: str, caption: str, schema: type[seams.M]
) -> seams.M:
    assert env.vision is not None and env.image is not None
    text = PROMPTS[hint] + (f"\nThe user says: {caption}" if caption else "")
    return seams.ask_json(
        ctx, env.vision, schema, system=SYSTEM, text=text, image=env.image
    )


def interpret(
    ctx: Ctx,
    cap: Capture,
    env: PhotoEnv,
    *,
    hint: str,
    caption: str,
    account_id: uuid.UUID | None = None,
) -> list[Draft]:
    """Drafts for one photo under ``hint`` (``photoDrafts``)."""
    if hint == "note":
        return [
            _info(
                "journal-suggest",
                "Saved as a note",
                "Kept in Capture history — nothing logged.",
                [
                    {
                        "label": "Save as journal",
                        "do": "journal",
                        "prompt": caption or "Photo note",
                    }
                ],
            )
        ]
    if hint == "both":
        return interpret(ctx, cap, env, hint="meal", caption=caption) + interpret(
            ctx, cap, env, hint="receipt", caption=caption
        )
    if env.vision is not None and env.image is not None:
        try:
            return _by_vision(ctx, cap, env, hint, caption, account_id)
        except seams.SeamError:
            pass  # fall through to OCR / rules: the input is never lost
    return _without_vision(ctx, cap, env, hint, caption, account_id)


def _by_vision(
    ctx: Ctx,
    cap: Capture,
    env: PhotoEnv,
    hint: str,
    caption: str,
    account_id: uuid.UUID | None,
) -> list[Draft]:
    if hint == "auto":
        hint = _vision(ctx, env, "auto", caption, AutoOut).hint
        if hint == "other":
            return (
                [unreadable(caption)]
                if not caption.strip()
                else env.text_path(caption, "auto")
            )
    if hint == "meal":
        m = _vision(ctx, env, "meal", caption, MealOut)
        if not m.items:
            return [unreadable(caption)]
        return [
            _meal_draft(
                caption,
                [i.model_dump() for i in m.items],
                m.confidence,
                m.follow_up.model_dump() if m.follow_up else None,
                field="portion",
                warn="Estimated from the photo — portions are a guess.",
            )
        ]
    if hint == "receipt":
        return [
            _receipt_draft(
                ctx, cap, env.world, _vision(ctx, env, "receipt", caption, ReceiptOut)
            )
        ]
    if hint == "label":
        return [_label_draft(_vision(ctx, env, "label", caption, LabelOut))]
    if hint == "statement":
        st = _vision(ctx, env, "statement", caption, StatementOut)
        return [statement_handoff(ctx, cap, rows=st.rows, account_id=account_id)]
    if hint == "whiteboard":
        drafts = _board_drafts(
            ctx, env.world, _vision(ctx, env, "whiteboard", caption, BoardOut)
        )
        return drafts or [unreadable(caption)]
    return [unreadable(caption)]


def _without_vision(
    ctx: Ctx,
    cap: Capture,
    env: PhotoEnv,
    hint: str,
    caption: str,
    account_id: uuid.UUID | None,
) -> list[Draft]:
    text = seams.ocr_text(*env.image) if env.image is not None else None
    if hint == "statement":
        return [statement_handoff(ctx, cap, rows=None, account_id=account_id)]
    if hint in ("meal", "label"):
        est = ports.meal_estimate(ctx, caption) if caption.strip() else None
        if est is not None:
            return [
                _meal_draft(
                    caption,
                    est.items,
                    est.confidence - 0.08,
                    est.follow_up,
                    warn="Estimated from your caption — check the portions.",
                )
            ]
        if text and hint == "label":
            return env.text_path(text, hint)
        return [unreadable(caption)]
    if text or caption.strip():
        combined = "\n".join(x for x in (caption.strip(), text or "") if x)
        drafts = env.text_path(combined, hint)
        if any(isinstance(d, RecordDraft) for d in drafts):
            return drafts
    if hint == "auto" and not text:
        return [ask_hint(caption)]
    return [unreadable(caption)]


_TOTAL = re.compile(
    r"^(?!.*sub\s*-?\s*total).*\b(total|amount due|grand total)\b", re.I
)
_MONEY = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?")


def receipt_text(text: str) -> str:
    """What the rules parser can read from OCR'd receipt text: the first
    line (the merchant) and the amount on the TOTAL line (else the largest
    amount on the slip)."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return text
    amounts: list[int] = []
    total: int | None = None
    for ln in lines:
        found = [int(m.group(1).replace(",", "")) for m in _MONEY.finditer(ln)]
        amounts.extend(found)
        if found and _TOTAL.search(ln):
            total = found[-1]
    amount = total if total is not None else (max(amounts) if amounts else None)
    merchant = re.sub(r"[^\w &'.-]", " ", lines[0]).strip()
    return f"{merchant} {amount}" if amount else " ".join(lines)


PHOTO_HINT_TO_PARSER = {"receipt": "expense", "meal": "meal", "label": "meal"}


def rules_text_path(world: World) -> Callable[[str, str], list[Draft]]:
    def run(text: str, hint: str) -> list[Draft]:
        if hint == "receipt":
            text = receipt_text(text)
        return parse_capture(
            world,
            text,
            ParseCtx(source="photo", hint=PHOTO_HINT_TO_PARSER.get(hint), photo=True),
        )

    return run


def answer_hint(
    ctx: Ctx, cap: Capture, card: RecordCard, value: str
) -> list[RecordCard]:
    """The "what should I log from this photo?" chip: replace the question
    card with the hint's cards (the prototype's ``answerCard`` photo path)."""
    from app.modules.capture import cards as C
    from app.modules.capture import engine

    if value not in ANSWERABLE_HINTS:
        raise invalid("hint_unknown", "Pick one of the options")
    caption = str(card.payload.get("caption") or "")
    env = engine.photo_env(ctx, cap)
    drafts = interpret(ctx, cap, env, hint=value, caption=caption)
    C.discard_row(ctx, card)
    if value in ("meal", "receipt", "label", "statement", "whiteboard"):
        cap.hint = value
        ctx.session.add(cap)
    start = max((c.position for c in C.cards_of(ctx, cap.id)), default=0) + 1
    start = max(
        start, max((r.position for r in C.replies_of(ctx, cap.id)), default=0) + 1
    )
    built = C.add_drafts(
        ctx, cap, drafts, answer_fn=lambda q: {"t": "info"}, start=start, actor="user"
    )
    C.refresh_status(ctx, cap)
    return built.cards
