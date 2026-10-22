"""Fern's memory layer: what it keeps about one person, and how it finds it.

Two tiers (ADR-0017):

- **Always on**: how to answer and who the person is (``response_style``
  and ``profile`` memories, and any memory marked ``always_on``). These go
  into every turn, within :data:`ALWAYS_ON_CAP` memories and
  :data:`ALWAYS_ON_CHARS` characters, most important first.
- **Recalled**: everything else, found by :func:`recall` when a question
  needs it: meaning (pgvector cosine over the memory's embedding) and words
  (Postgres full text) searched together and fused by rank.

Writing never duplicates: an exact repeat is caught by the normalised
text's hash; an embedding at or above :data:`DUPLICATE` similarity to a live
memory is the same memory (it is refreshed, not added); between
:data:`NEAR` and :data:`DUPLICATE` a judge (the chat model, one short call)
says whether the new statement is the same, updates or contradicts the old
one (the old is superseded and kept as history), or is different. Without
an embedding model memories are still kept, matched by hash only, and
embedded later by :func:`backfill`.

Everything here is scoped to the signed-in owner and tenant; no query reads
another person's memories.
"""

import hashlib
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import text as sql
from sqlmodel import col, select

from app.modules.ai_providers import public as ai
from app.modules.companion.models import Memory
from app.shared import owned_repo
from app.shared.context import Ctx

ALWAYS_ON_KINDS = frozenset({"response_style", "profile"})
ALWAYS_ON_CAP = 25
ALWAYS_ON_CHARS = 2500
DUPLICATE = 0.92
NEAR = 0.80
RECALL_K = 6
# A question is embedded with an instruction (Qwen3-Embedding's query form)
# and must reach RECALL_MIN cosine with a memory to count. Measured on the
# server model 2026-10-22: with the instruction, the right memory scored
# 0.35-0.66 for seven personal questions (English and Tagalog) and the best
# unrelated one 0.23-0.29; without it unrelated memories scored up to 0.55
# and one question ranked the wrong memory first.
QUERY_PREFIX = (
    "Instruct: Given a question about a person, retrieve the remembered facts "
    "about them that answer it\nQuery: "
)
RECALL_MIN = 0.30

Verdict = Literal["same", "update", "contradicts", "different"]
Judge = Callable[[str, str], Verdict]


@dataclass(frozen=True)
class Saved:
    status: Literal["added", "duplicate", "updated"]
    memory: Memory
    replaced: Memory | None = None


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def text_hash(text: str) -> str:
    key = re.sub(r"[^\w]+", " ", normalise(text).casefold()).strip()
    return hashlib.sha256(key.encode()).hexdigest()


def live(ctx: Ctx) -> list[Memory]:
    """Every memory still in force (not deleted, not superseded), oldest
    first."""
    return owned_repo.list_rows(
        ctx,
        Memory,
        col(Memory.superseded_by).is_(None),
        order_by=[col(Memory.created_at)],
    )


def always_on(ctx: Ctx) -> list[Memory]:
    """The memories every turn carries: always-on kinds and pinned ones,
    most important and most recently confirmed first, within the caps."""
    rows = [m for m in live(ctx) if m.always_on or m.kind in ALWAYS_ON_KINDS]
    rows.sort(key=lambda m: (-m.importance, -(m.updated_at.timestamp())))
    out: list[Memory] = []
    used = 0
    for m in rows[:ALWAYS_ON_CAP]:
        if used + len(m.text) > ALWAYS_ON_CHARS:
            break
        out.append(m)
        used += len(m.text)
    return out


def _embed_one(ctx: Ctx, text: str) -> tuple[list[float], str] | None:
    try:
        vectors, model = ai.embed(ctx, [text])
    except ai.EmbedError:
        return None
    return vectors[0], model


def _nearest(
    ctx: Ctx, vector: list[float], model: str, k: int = 3
) -> list[tuple[Memory, float]]:
    """Live memories closest to ``vector`` (same embedding model), with
    cosine similarity."""
    dist = Memory.embedding.cosine_distance(vector)  # type: ignore[union-attr]
    q = (
        select(Memory, dist.label("d"))
        .where(
            Memory.owner_id == ctx.user_id,
            Memory.tenant_id == ctx.tenant_id,
            col(Memory.deleted_at).is_(None),
            col(Memory.superseded_by).is_(None),
            col(Memory.embedding).is_not(None),
            Memory.embed_model == model,
        )
        .order_by(dist)
        .limit(k)
    )
    return [(m, 1.0 - float(d)) for m, d in ctx.session.exec(q).all()]


def remember(
    ctx: Ctx,
    *,
    text: str,
    kind: str = "fact",
    tags: list[str] | None = None,
    importance: int = 3,
    always_on: bool = False,
    source: str = "said",
    memory_id: uuid.UUID | None = None,
    judge: Judge | None = None,
) -> Saved:
    """Keep ``text`` unless it is already known. Flushes only."""
    body = normalise(text)[:500]
    h = text_hash(body)
    exact = owned_repo.find_one(
        ctx,
        Memory,
        col(Memory.text_hash) == h,
        col(Memory.superseded_by).is_(None),
    )
    if exact is not None:
        return Saved("duplicate", _refresh(ctx, exact, tags, importance, always_on))
    emb = _embed_one(ctx, body)
    replaced: Memory | None = None
    if emb is not None:
        for old, sim in _nearest(ctx, *emb):
            if sim >= DUPLICATE:
                return Saved(
                    "duplicate", _refresh(ctx, old, tags, importance, always_on)
                )
            if sim >= NEAR and judge is not None:
                verdict = judge(old.text, body)
                if verdict == "same":
                    return Saved(
                        "duplicate", _refresh(ctx, old, tags, importance, always_on)
                    )
                if verdict in ("update", "contradicts"):
                    replaced = old
                    break
    row, _ = owned_repo.upsert(
        ctx,
        Memory,
        memory_id or uuid.uuid4(),
        {
            "text": body,
            "kind": kind,
            "tags": clean_tags(tags),
            "importance": max(1, min(5, importance)),
            "always_on": always_on,
            "source": source,
            "text_hash": h,
            "embedding": emb[0] if emb else None,
            "embed_model": emb[1] if emb else None,
        },
    )
    if replaced is not None:
        # Kept as history (superseded_by names the newer one) but no longer
        # live: soft-deleted, so the app's list drops it too.
        replaced.superseded_by = row.id
        owned_repo.soft_delete(ctx, replaced)
        return Saved("updated", row, replaced)
    return Saved("added", row)


def clean_tags(tags: list[str] | None) -> list[str]:
    seen: list[str] = []
    for t in tags or []:
        k = normalise(t).casefold()[:30]
        if k and k not in seen:
            seen.append(k)
    return seen[:8]


def _refresh(
    ctx: Ctx,
    m: Memory,
    tags: list[str] | None,
    importance: int,
    always_on: bool,
) -> Memory:
    """A repeat confirms a memory: newer, at least as important, and with
    any new tags."""
    m.tags = clean_tags([*m.tags, *(tags or [])])
    m.importance = max(m.importance, max(1, min(5, importance)))
    m.always_on = m.always_on or always_on
    m.updated_at = ctx.now
    ctx.session.add(m)
    ctx.session.flush()
    return m


def recall(
    ctx: Ctx,
    query: str,
    *,
    kinds: list[str] | None = None,
    k: int = RECALL_K,
) -> list[Memory]:
    """The live memories most relevant to ``query``: vector and full-text
    rankings fused (reciprocal rank, k=60). Marks them used."""
    words = [w for w in re.findall(r"\w+", query.casefold()) if len(w) > 2][:12]
    emb = _embed_one(ctx, QUERY_PREFIX + query)
    kind_sql = "AND kind = ANY(:kinds)" if kinds else ""
    parts: list[str] = []
    params: dict[str, Any] = {
        "owner": ctx.user_id,
        "tenant": ctx.tenant_id,
        "kinds": kinds or [],
        "k": k,
    }
    base = (
        "FROM memory WHERE owner_id = :owner AND tenant_id = :tenant "
        f"AND deleted_at IS NULL AND superseded_by IS NULL {kind_sql}"
    )
    if emb is not None:
        params |= {"vec": str(emb[0]), "model": emb[1], "far": 1 - RECALL_MIN}
        parts.append(
            "SELECT id, row_number() OVER (ORDER BY embedding <=> "
            "CAST(:vec AS vector)) AS r "
            f"{base} AND embedding IS NOT NULL AND embed_model = :model "
            "AND embedding <=> CAST(:vec AS vector) <= :far "
            "ORDER BY embedding <=> CAST(:vec AS vector) LIMIT 20"
        )
    if words:
        params["tsq"] = " | ".join(words)
        parts.append(
            "SELECT id, row_number() OVER (ORDER BY ts_rank("
            "to_tsvector('simple', text), to_tsquery('simple', :tsq)) DESC) AS r "
            f"{base} AND to_tsvector('simple', text) @@ to_tsquery('simple', :tsq) "
            "LIMIT 20"
        )
    if not parts:
        return []
    union = " UNION ALL ".join(f"({p})" for p in parts)
    rows = ctx.session.execute(
        sql(
            f"SELECT id, sum(1.0 / (60 + r)) AS score FROM ({union}) x "
            "GROUP BY id ORDER BY score DESC LIMIT :k"
        ),
        params,
    ).all()
    ids = [r[0] for r in rows]
    found = {
        m.id: m for m in owned_repo.list_rows(ctx, Memory, col(Memory.id).in_(ids))
    }
    out = [found[i] for i in ids if i in found]
    for m in out:
        m.last_used_at = ctx.now
        m.use_count += 1
        ctx.session.add(m)
    ctx.session.flush()
    return out


def backfill(ctx: Ctx, *, limit: int = 50) -> int:
    """Embed live memories that have no embedding, or one from another
    model than the current one. Returns how many were embedded."""
    resolved = ai.embedding_model(ctx)
    if resolved is None:
        return 0
    rows = [
        m for m in live(ctx) if m.embedding is None or m.embed_model != resolved.model
    ][:limit]
    if not rows:
        return 0
    try:
        vectors, model = ai.embed(ctx, [m.text for m in rows])
    except ai.EmbedError:
        return 0
    for m, v in zip(rows, vectors, strict=True):
        m.embedding = v
        m.embed_model = model
        if m.text_hash is None:
            m.text_hash = text_hash(m.text)
        ctx.session.add(m)
    ctx.session.flush()
    return len(rows)
