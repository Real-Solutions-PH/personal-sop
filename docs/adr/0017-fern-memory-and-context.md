# ADR-0017 — Fern's memory layer and per-turn context

- **Date:** 2026-10-22
- **Status:** accepted
- **Deciders:** Product owner; engineering

## Context

Fern kept memories as plain text and put up to 50 of them into every turn.
That kept no metadata (what kind of fact, how important, where it came from)
and did not stop duplicates. It also could not scale: the more Fern knew,
the more every turn cost.

Measured on 2026-10-22 against the production chat model (Qwen3-30B on
Nebius), a turn averaged about 10,600 input tokens per model call over 63
calls. The conversation itself was small: six messages from the current day,
each cut to 600 characters. Most of the cost was the 37 tool schemas, about
9,500 tokens of a call's input as the provider counts them, resent on each
of a reply's two to four model calls.

## Decision

**Memory store.** Memories stay in Postgres, in the existing `memory`
table, now with these columns:

- `kind`: response_style, preference, profile, fact, goal, relationship,
  health, routine or event.
- `tags`, `importance` (1 to 5), `always_on` and `source` (said, inferred
  or app).
- `text_hash`, for exact repeats.
- `embedding`, a pgvector `vector(1024)` with an HNSW cosine index, plus
  `embed_model`.
- `last_used_at` and `use_count`.
- `superseded_by`, which keeps a replaced memory as history.

A Postgres full-text index covers the text. pgvector is used rather than a
separate vector database: per-person memory sets are small, and the vectors
stay under the same row-level security and transactions as the rest of the
person's data. Hosted Supabase ships pgvector. Local and CI use
`pgvector/pgvector:pg18`.

**Embeddings.** Embeddings are a model purpose of their own (`embedding`).
The person's own assignment is used if they have one, otherwise the
server's Nebius `Qwen/Qwen3-Embedding-8B` at 1,024 dimensions. It is
multilingual, so Taglish matches English. Queries carry the model's
instruction prefix.

**Two tiers of recall:**
- **Always on.** response_style and profile memories, and any memory marked
  `always_on` (hard constraints such as an allergy), go into every turn.
  The cap is 25 memories or 2,500 characters, most important first.
- **On demand.** Everything else is found by the `recall_memories` tool.
  The vector ranking and the full-text ranking are fused by reciprocal rank,
  and the vector side needs a cosine of at least 0.30.
- **Why that floor.** With the instruction prefix, measured on 2026-10-22,
  the right memory scored 0.35–0.66 for seven personal questions in English
  and Tagalog, and the best unrelated memory scored 0.23–0.29.

**No duplicates:**
- An exact repeat, by normalised text hash, refreshes the existing memory.
- A cosine of 0.92 or more is the same memory.
- Between 0.80 and 0.92, the chat model judges in one short call: same,
  update or contradicts (the old memory is superseded and kept as history),
  or different.
- Calibration on 2026-10-22: "Prefers short answers" and "Likes short
  answers" scored 0.924. "Works out five days a week" and "three days a week
  now" scored 0.857.
- Memories kept while no embedding model answers are matched by hash only,
  and embedded later.

**Explicit asks.** A message that explicitly asks Fern to remember
something ("remember", "from now on", "tandaan") is saved first, in a
focused pass with only the memory tool. With the full instructions, the
model tended to answer "Remembered: …" without calling the tool.

**Per-turn context:**
- **Tool routing.** Each turn offers a core set of 17 tools, plus the
  groups (money, tasks, habits, fitness, journal) that its words, or the
  person's two previous messages, point to. A long message that names no
  group gets every tool, as do a message with photos, a generic write
  request, and the corrective pass. Measured with the same prompt: 2,514
  input tokens with no tools, 4,348 with the core set, 9,464 with all tools.
- **Prompt order.** The fixed rules come first. Everything that changes each
  turn comes last: the time, today's facts, the always-on memories,
  trackers and the summary. That keeps the rules and tools as one prefix a
  provider can cache.
- **Rolling summary.** Conversation older than the six-message window is
  folded into a summary of at most 150 words on the companion row: earlier
  days' messages once 4 have built up, or a long day's once 20 have. Before
  this, earlier days were dropped.

## Constitution clause deviated from

None. pgvector is an extension to the Postgres default, not a new store.

## Consequences

**Positive:**
- Memory grows without growing every turn. Only the always-on set is
  always paid for.
- A core-only turn costs about 54% less per model call.
- Facts are kept once, and an updated fact replaces the old one with
  history kept.

**Negative:**
- Each memory write and each recall costs an embedding call. These are
  small: under 10 tokens per memory measured.
- Tool routing can leave a tool out when a message's words miss its group.
  The fallbacks (long or generic messages get every tool, plus the
  corrective pass) bound this, but do not remove it.
- The local and test Postgres needs the pgvector extension.

**Follow-ups:**
- A Memories screen in the app to browse by kind, pin always-on memories,
  and edit or delete them.
- Optional automatic extraction of implicit facts, which would be one extra
  call per turn, if explicit saving proves too sparse.
