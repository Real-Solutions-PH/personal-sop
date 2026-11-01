"""How Fern hears that a reply was good or bad, and what it learns from it.

Seen live (2026-10-30/31): Kai wrote "JUST FICKING GIVE ME THE PORTION…"
and nothing recorded it; nothing could, as no signal existed anywhere.

Signals (``FernFeedback``), each tied to the Fern reply it is about:

- **thumb**: 👍/👎 on a reply, with an optional reason chip and short note
  (``rate``); one per reply, changeable.
- **correction** / **frustration**: read from the person's next message in
  the same chat (``classify``; words only, no model call): "that's wrong",
  "try again", "I said…", "mali", or shouting and swearing.
- **undo**: a card the reply proposed or logged that the person then
  discarded or undid (``record_undos``).

Learning, after the reply has streamed (``digest``, from the route):

1. **For the person**: a negative signal's words (and the reply they were
   about) go to ``services.learn``, which keeps a lasting preference as a
   ``response_style`` memory ("wants the portion in grams, no preamble").
   That stays in their own rows like any memory.
2. **For every Fern** (``propose``): one short model call turns the signal
   into a general behaviour rule, or none. Privacy rules, enforced in code,
   not only asked of the model:

   - the model sees the person's words and the reply excerpt, and is told
     to write a rule about how Fern should answer, never about the person;
   - ``deidentified`` then refuses any rule holding a digit, an email or
     handle, a URL, a currency sign, a capitalised word other than Fern
     and the first word, or any word from the person's name, memories or
     message that is not a common word (``COMMON``) — so a brand, a place,
     a food or a condition the person mentioned cannot pass even if the
     model copies it;
   - the shared row (``FernRule``) holds only that text and counts: how
     many signals (``evidence``) and how many distinct people (``users``,
     counted through ``FernRuleVote``, a keyed hash of the user id);
     nothing links a rule back to a person, a message or a tenant.

   A rule shapes answers only once **approved** by an admin
   (``PATCH /companion/fern-rules/{id}``), or automatically once
   ``AUTO_USERS`` different people and ``AUTO_EVIDENCE`` signals stand
   behind it (``active_rules``). Five people means no single person's
   preference becomes everyone's rule, and the text already passed the
   de-identification check; a rejected rule never applies.
"""

import hashlib
import hmac
import re
import uuid
from collections.abc import Callable
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlmodel import col, select

from app.core.config import settings
from app.modules.ai_providers import public as ai
from app.modules.capture import public as capture
from app.modules.companion.models import (
    CompanionMessage,
    FernFeedback,
    FernRule,
    FernRuleVote,
)
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import domain_error

Rating = Literal["up", "down"]
Reason = Literal["wrong", "too_long", "missed", "slow", "other"]
Signal = Literal["correction", "frustration"]

# The automatic threshold for a rule nobody approved (see the module doc).
AUTO_USERS = 5
AUTO_EVIDENCE = 8
# At most this many rules go into a turn, the best supported first.
RULES_IN_CONTEXT = 8
RULES_CHARS = 900
# A turn learns from at most this many waiting signals.
DIGEST_BATCH = 3
# Replies looked back over for undone cards.
UNDO_LOOKBACK = 5
SAID_CHARS = 500
REPLY_EXCERPT = 600

# ---------------------------------------------------------------- thumbs


def _reply(ctx: Ctx, message_id: uuid.UUID) -> CompanionMessage:
    m = owned_repo.get(ctx, CompanionMessage, message_id)
    if m is None or m.role != "sol":
        raise domain_error(404, "reply_not_found", "That reply isn't there anymore")
    return m


def rate(
    ctx: Ctx,
    message_id: uuid.UUID,
    *,
    rating: Rating | None,
    reason: Reason | None = None,
    note: str | None = None,
) -> FernFeedback | None:
    """Set (or with ``rating=None`` clear) the person's thumb on a reply.
    A reason or note only means something on a thumbs-down."""
    _reply(ctx, message_id)
    row = owned_repo.find_one(
        ctx,
        FernFeedback,
        col(FernFeedback.message_id) == message_id,
        col(FernFeedback.kind) == "thumb",
        include_deleted=True,
    )
    if rating is None:
        if row is not None:
            ctx.session.delete(row)
            ctx.commit()
        return None
    down = rating == "down"
    data: dict[str, Any] = {
        "message_id": message_id,
        "kind": "thumb",
        "rating": rating,
        "reason": reason if down else None,
        "note": ((note or "").strip()[:280] or None) if down else None,
        # A changed thumb is learned from again.
        "digested": not down,
        "deleted_at": None,
    }
    saved, _ = owned_repo.upsert(
        ctx, FernFeedback, row.id if row else uuid.uuid4(), data
    )
    ctx.commit()
    return saved


# ---------------------------------------------------------------- implicit

_CORRECTION = re.compile(
    r"\b(that'?s (wrong|not right|incorrect|not what i)|wrong|incorrect|"
    r"not what i (asked|meant|said|wanted)|try again|again\b.*\bplease|"
    r"redo|i (said|told you|asked)|you (forgot|missed|ignored|didn'?t)|"
    r"no[,.!]\s|nope|not (\d|that)|mali|hindi (yan|iyan|ganyan|tama)|"
    r"ulitin|ulit)\b",
    re.I,
)
_SWEAR = re.compile(
    r"\b(f+u+c+k\w*|f+i+c+k\w*|fk|wtf|shit\w*|damn\w*|stupid|useless|"
    r"puta\w*|tangina\w*|gago|bwisit|bobo|tanga)\b",
    re.I,
)


def classify(text: str) -> Signal | None:
    """Whether the person's message pushes back on the reply before it.
    Frustration (shouting: most letters upper case over a real sentence,
    or swearing) wins over a plain correction."""
    letters = [c for c in text if c.isalpha()]
    shouting = (
        len(letters) >= 12 and sum(c.isupper() for c in letters) / len(letters) > 0.7
    )
    if shouting or _SWEAR.search(text):
        return "frustration"
    if _CORRECTION.search(text):
        return "correction"
    return None


def _previous_reply(ctx: Ctx, me: CompanionMessage) -> CompanionMessage | None:
    """The Fern reply just before the question ``me`` in its chat."""
    rows = owned_repo.list_rows(
        ctx,
        CompanionMessage,
        col(CompanionMessage.role) == "sol",
        col(CompanionMessage.created_at) < me.created_at,
        _same_chat(me.thread_id),
        order_by=[col(CompanionMessage.created_at).desc()],
        limit=1,
    )
    return rows[0] if rows else None


def _same_chat(thread_id: uuid.UUID | None) -> Any:
    return (
        col(CompanionMessage.thread_id) == thread_id
        if thread_id is not None
        else col(CompanionMessage.thread_id).is_(None)
    )


def _record(
    ctx: Ctx, reply_id: uuid.UUID, kind: str, said: str | None = None
) -> FernFeedback | None:
    """One implicit signal on a reply; a repeat of the same kind is kept once."""
    if (
        owned_repo.find_one(
            ctx,
            FernFeedback,
            col(FernFeedback.message_id) == reply_id,
            col(FernFeedback.kind) == kind,
            include_deleted=True,
        )
        is not None
    ):
        return None
    row, _ = owned_repo.upsert(
        ctx,
        FernFeedback,
        uuid.uuid4(),
        {
            "message_id": reply_id,
            "kind": kind,
            "rating": "down",
            "said": (said or "")[:SAID_CHARS] or None,
        },
    )
    return row


def record_turn_signal(
    ctx: Ctx, me_id: uuid.UUID, text: str
) -> tuple[Signal, CompanionMessage] | None:
    """A correction or frustration in the question ``me_id``, recorded on the
    reply before it in the same chat. Returns the signal and that reply."""
    signal = classify(text)
    if signal is None:
        return None
    me = owned_repo.get(ctx, CompanionMessage, me_id)
    reply = _previous_reply(ctx, me) if me is not None else None
    if reply is None:
        return None
    _record(ctx, reply.id, signal, text)
    ctx.commit()
    return signal, reply


def _card_ids(m: CompanionMessage) -> list[str]:
    out: list[str] = []
    for b in m.blocks or []:
        if b.get("t") != "steps":
            continue
        items: list[dict[str, Any]] = b.get("items") or []  # type: ignore[assignment]
        for i in items:
            if i.get("card_id"):
                out.append(str(i["card_id"]))
            out += [str(c["card_id"]) for c in i.get("cards") or [] if c.get("card_id")]
    return out


UNDONE_STATES = ("discarded", "undone")


def record_undos(ctx: Ctx, me_id: uuid.UUID) -> int:
    """Replies whose cards the person later discarded or undid get an undo
    signal. Looks at the last few replies of the question ``me_id``'s chat;
    returns how many new signals were recorded."""
    me = owned_repo.get(ctx, CompanionMessage, me_id)
    if me is None:
        return 0
    replies = owned_repo.list_rows(
        ctx,
        CompanionMessage,
        col(CompanionMessage.role) == "sol",
        _same_chat(me.thread_id),
        order_by=[col(CompanionMessage.created_at).desc()],
        limit=UNDO_LOOKBACK,
    )
    made = 0
    for m in replies:
        ids = _card_ids(m)
        if ids and capture.cards_in_states(ctx, ids, UNDONE_STATES):
            made += _record(ctx, m.id, "undo") is not None
    if made:
        ctx.commit()
    return made


# ---------------------------------------------------------------- shared rules

GENERALISE = """You improve Fern, a personal tracking assistant used by many
people. Below is a reply Fern gave and how the person reacted (a thumbs
down, a correction, frustration, or undoing what it logged).

If the reaction shows a GENERAL lesson about how Fern should answer anyone
(format, length, directness, what to include, when to ask vs act), write it
as ONE short imperative rule, at most 25 words, e.g. "When asked for a
portion, give grams per food first, then the macros left." If the problem
is only about this person's own facts or data, or there is no clear general
lesson, answer NONE.

The rule must not contain any name, place, brand, food, number, date,
health condition or anything else about the person. Answer only the rule
or NONE."""

# Words a rule may use even when the person also used them.
COMMON = frozenset(
    """a an the and or but if when then than so to of in on at for with
    without from by as is are be been being it its this that these those
    give gives giving show list ask asked asks answer answers reply replies
    say says said tell told first last before after each every per all any
    some more less most least only just also not no never always do does
    did done don't use using used keep make made get got want wants wanted
    person people user users their them they you your fern short shorter
    long longer brief direct directly plain simple clear exact exactly
    number numbers amount amounts total totals grams gram portion portions
    portion size macros macro calories protein carbs fat fiber sugar left
    remaining food foods meal meals drink drinks log logs logged logging
    entry entries record records estimate estimates estimated guess guesses
    confirm confirmation question questions follow follow-up unit units
    format list bullet bullets table sentence sentences word words line
    lines step steps summary details detail data today day days week time
    times correct correction wrong mistake mistakes again retry instead
    stated states state explicitly clearly ask unclear sure missing""".split()
)
_BAD = re.compile(r"\d|@|https?:|www\.|[₱$€£¥]|\bwww\b", re.I)
_WORD = re.compile(r"[A-Za-z][A-Za-z'-]*")


class _Rule(BaseModel):
    text: str = Field(max_length=300)


def deidentified(rule: str, *, private: str) -> str | None:
    """``rule`` when it holds nothing that could identify a person or their
    data (see the module doc), normalised; else None. ``private`` is every
    text of theirs the rule was made from (their words, the reply, their
    name and memories)."""
    text = re.sub(r"\s+", " ", rule).strip().strip('"').strip()
    if not text or text.upper().startswith("NONE") or len(text) > 200:
        return None
    if _BAD.search(text):
        return None
    words = _WORD.findall(text)
    if len(words) < 5:
        return None
    theirs = {w.casefold() for w in _WORD.findall(private)}
    for i, w in enumerate(words):
        if i > 0 and w[0].isupper() and w != "Fern":
            return None  # a proper noun: a name, a brand, a place
        k = w.casefold()
        if k in theirs and k not in COMMON:
            return None  # their own word that is not a common one
    return text[0].upper() + text[1:]


def _voter(user_id: uuid.UUID) -> str:
    """A keyed hash of the user id: the same person always counts once, and
    the stored value says nothing about who without the server's secret."""
    secret = settings.FERN_RULE_VOTER_SALT or settings.AI_CREDENTIALS_KEK
    key = secret.get_secret_value() if secret else "unfurl-fern-rules"
    return hmac.new(key.encode(), str(user_id).encode(), hashlib.sha256).hexdigest()


def _rule_hash(text: str) -> str:
    key = re.sub(r"[^\w]+", " ", text.casefold()).strip()
    return hashlib.sha256(key.encode()).hexdigest()


# Two rules this close in meaning are one rule (the same measure as
# memory.DUPLICATE).
SAME_RULE = 0.90


def _same_rule(ctx: Ctx, text: str) -> tuple[FernRule | None, Any]:
    """An existing rule saying the same, by exact text or by meaning; and
    the new text's embedding when one was made."""
    exact = ctx.session.exec(
        select(FernRule).where(FernRule.text_hash == _rule_hash(text))
    ).first()
    if exact is not None:
        return exact, None
    try:
        vectors, model = ai.embed(ctx, [text])
    except ai.EmbedError:
        return None, None
    dist = FernRule.embedding.cosine_distance(vectors[0])  # type: ignore[union-attr]
    near = ctx.session.exec(
        select(FernRule, dist.label("d"))
        .where(col(FernRule.embedding).is_not(None), FernRule.embed_model == model)
        .order_by(dist)
        .limit(1)
    ).first()
    if near is not None and 1.0 - float(near[1]) >= SAME_RULE:
        return near[0], (vectors[0], model)
    return None, (vectors[0], model)


def add_support(ctx: Ctx, text: str) -> FernRule:
    """Count one signal from the signed-in person behind ``text`` (already
    de-identified): an existing rule saying the same gains evidence, else a
    new proposed rule. Flushes only."""
    rule, emb = _same_rule(ctx, text)
    if rule is None:
        rule = FernRule(text=text[:300], text_hash=_rule_hash(text))
        if emb is not None:
            rule.embedding, rule.embed_model = emb
        ctx.session.add(rule)
        ctx.session.flush()
    voter = _voter(ctx.user_id)
    vote = ctx.session.exec(
        select(FernRuleVote).where(
            FernRuleVote.rule_id == rule.id, FernRuleVote.voter == voter
        )
    ).first()
    if vote is None:
        ctx.session.add(FernRuleVote(rule_id=rule.id, voter=voter))
        rule.users += 1
    else:
        vote.count += 1
        ctx.session.add(vote)
    rule.evidence += 1
    rule.updated_at = ctx.now
    ctx.session.add(rule)
    ctx.session.flush()
    return rule


def propose(
    ctx: Ctx, resolved: ai.ResolvedModel, fb: FernFeedback, *, private: str
) -> FernRule | None:
    """A general rule from one negative signal, when it holds one and the
    rule passes ``deidentified``. One short model call."""
    reply = owned_repo.get(ctx, CompanionMessage, fb.message_id)
    reaction = {
        "thumb": "Thumbs down",
        "correction": "Corrected Fern",
        "frustration": "Frustrated",
        "undo": "Undid what Fern logged",
    }[fb.kind]
    parts = [
        f"FERN'S REPLY:\n{((reply.text if reply else '') or '')[:REPLY_EXCERPT]}",
        f"REACTION: {reaction}"
        + (f" (reason: {fb.reason})" if fb.reason else "")
        + (f"\nTHEY WROTE: {fb.note or fb.said}" if (fb.note or fb.said) else ""),
    ]
    try:
        out = capture.ask_text(
            ctx, resolved, system=GENERALISE, text="\n\n".join(parts)
        )
    except capture.SeamError:
        return None
    text = deidentified(
        out,
        private=" ".join(
            [private, fb.note or "", fb.said or "", (reply.text if reply else "") or ""]
        ),
    )
    return add_support(ctx, text) if text else None


def waiting(ctx: Ctx) -> list[FernFeedback]:
    """The person's negative signals not yet learned from, oldest first."""
    return owned_repo.list_rows(
        ctx,
        FernFeedback,
        col(FernFeedback.rating) == "down",
        col(FernFeedback.digested).is_(False),
        order_by=[col(FernFeedback.created_at)],
        limit=DIGEST_BATCH,
    )


def active_rules(ctx: Ctx) -> list[str]:
    """The rules every Fern follows now: approved ones, and proposed ones
    past the automatic threshold; best supported first, within budget."""
    rows = ctx.session.exec(
        select(FernRule)
        .where(
            or_(
                col(FernRule.status) == "approved",
                and_(
                    col(FernRule.status) == "proposed",
                    col(FernRule.users) >= AUTO_USERS,
                    col(FernRule.evidence) >= AUTO_EVIDENCE,
                ),
            )
        )
        .order_by(col(FernRule.users).desc(), col(FernRule.evidence).desc())
        .limit(RULES_IN_CONTEXT)
    ).all()
    out: list[str] = []
    used = 0
    for r in rows:
        if used + len(r.text) > RULES_CHARS:
            break
        out.append(r.text)
        used += len(r.text)
    return out


def rules(*, ctx: Ctx, status: str | None = None) -> list[FernRule]:
    """Every shared rule (for the admin list), most supported first."""
    q = select(FernRule)
    if status:
        q = q.where(FernRule.status == status)
    return list(
        ctx.session.exec(
            q.order_by(col(FernRule.users).desc(), col(FernRule.evidence).desc())
        ).all()
    )


def decide(ctx: Ctx, rule_id: uuid.UUID, status: str, text: str | None) -> FernRule:
    """An admin approves, rejects or re-opens a rule, optionally rewording
    it (the new wording must pass the same de-identification check)."""
    rule = ctx.session.get(FernRule, rule_id)
    if rule is None:
        raise domain_error(404, "rule_not_found", "That rule isn't there")
    if text is not None and text.strip() != rule.text:
        clean = deidentified(text, private="")
        if clean is None:
            raise domain_error(
                422,
                "rule_not_general",
                "A rule can't hold numbers, names or other specifics",
            )
        rule.text, rule.text_hash = clean, _rule_hash(clean)
        rule.embedding = rule.embed_model = None
    rule.status = status
    rule.decided_at = ctx.now if status != "proposed" else None
    rule.updated_at = ctx.now
    ctx.session.add(rule)
    ctx.commit()
    return rule


def _resolve(ctx: Ctx) -> ai.ResolvedModel | None:
    resolved = ai.resolve_model(ctx, "chat")
    if resolved is None:
        return None
    try:
        ai.check_budget(ctx)
    except HTTPException:
        return None
    return resolved


def digest(
    ctx: Ctx, *, private: str, learn: Callable[[str, str | None], object]
) -> int:
    """Learn from the person's waiting negative signals (at most
    DIGEST_BATCH a turn): a thumbs-down's note goes to their own memory
    through ``learn(words, reply_text)`` (a correction or frustration was
    already read with the message that carried it), and every signal may
    propose a shared rule. Returns how many were digested."""
    rows = waiting(ctx)
    if not rows:
        return 0
    resolved = _resolve(ctx)
    if resolved is None:
        return 0
    for fb in rows:
        reply = owned_repo.get(ctx, CompanionMessage, fb.message_id)
        if fb.kind == "thumb" and (fb.note or fb.reason):
            learn(
                fb.note or f"(gave a thumbs down: {fb.reason})",
                reply.text if reply else None,
            )
        propose(ctx, resolved, fb, private=private)
        fb.digested = True
        ctx.session.add(fb)
        ctx.commit()
    return len(rows)
