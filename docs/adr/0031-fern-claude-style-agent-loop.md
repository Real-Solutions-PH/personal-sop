# ADR-0031 — Fern works each turn as a Claude-style agent loop

- **Date:** 2026-11-03
- **Status:** accepted
- **Deciders:** Kai (owner)

## Context

Fern answered from a long rule list (about 190 lines) with a guessed subset
of tools per message (ADR-0017's tool routing) and thought only before a
turn's first model call. On the replay eval of Kai's own chats (ADR-0029,
182 cases), it scored 0.653 from the judge. It was weakest at:

| Criterion | Score |
|---|---|
| Low-confidence assumptions asked as multiple choice | 0.08 |
| Filling every field when recording | 0.35 |
| Right data at the right time | 0.46 |
| Gathering before concluding | 0.53 |

Three alternatives were scored against the same cases on the same day, in
proof-of-concept form (2026-11-02):

| Arm | Judge | Cost per case | Note |
|---|---|---|---|
| Current loop | 0.653 | ₱0.45 | |
| A: Claude-style loop | **0.749** | ₱0.66 | Gains on 9 of 10 criteria |
| B: small-model check of each reply | 0.656 | ₱0.75 | No gain |
| B: second pass by the same model | 0.711 | ₱0.75 | |
| C: parallel reads | 0.633 | ₱0.44 | No meaningful speedup |

On C: only about 25% of tool rounds have two or more reads to run at once.
Those reads are millisecond database queries next to model calls of 3–5 s.

## Decision

Fern runs the loop Anthropic describes for Claude Code and the Agent SDK:
gather context, take action, verify, repeat until no tool is called. It
lives in `companion/loop.py`:

- **Short workflow prompt:** understand, plan, gather, ask, act, verify,
  reply. It keeps a short list of rules, each learned from a reply that
  went wrong. Everything else is in the tool descriptions.
- **Every tool on every turn.** The model calls independent reads in the
  same round; tool routing is removed. Amended 2026-11-03: the 34 rarely
  used tools are deferred, as Claude Code defers its own. They cover setup
  and edits of routines, workouts, accounts, budgets, categories, habits and
  focus, and made up about 1 in 20 calls on the replay eval. They are named
  with one line each in `load_tools`, and their schemas join the call after
  it. Sending all 75 schemas cost 11,925 tokens a call and pushed first
  words past the 7 s budget; 42 schemas cost 7,273.
- **Thinking before every model call,** not only the first. The existing
  cap still retries a call that thinks too long without thinking.
- **`todo`:** a plan the model writes for itself on multi-step asks
  (Claude Code's TodoWrite).
- **`ask_choice`:** a multiple-choice question, drawn as the chips the app
  already shows.
- **At most 10 model calls per turn** (was 6).
- **`log_meal` sends an item back once per reply** when it leaves out
  protein, carbs, fat, fiber (and its split), saturated fat, sugar or
  sodium. A food from the person's library is exempt. If a second try
  still lacks them, the meal is saved with its warning.

Arms B and C are not adopted.

## Constitution clause deviated from

None.

## Consequences

**Positive:**
- On the shipped code against master (2026-11-03):

  | Measure | Master | This change |
  |---|---|---|
  | Judge | 0.718 | 0.771 |
  | Failure cases passing (of 161) | 40 | 53 |
  | Checks passed (of 371) | 185 | 213 |
  | Filling every field | 0.37 | 0.60 |
  | Multiple-choice asks | 0.20 | 0.40 |

  Guard cases held 21 of 21.
- One prompt instead of a rule per incident. A failure becomes a replay
  case first (ADR-0029), and a rule only if the case needs one.

**Negative:**
- More model calls and tokens: every tool's schema is sent each call, and
  thinking runs every call. Measured on the shipped code against master
  (2026-11-03, the same 182 cases at the same time):

  | Measure | Master | This change |
  |---|---|---|
  | Model calls per case | 4.8 | 6.1 |
  | Input tokens per case | 53,754 | 75,519 (+40%) |
  | Cost for all 182 cases | ₱86 | ₱121 (+40%) |
  | Seconds per turn, mean | 14.0 | 20.9 |
  | Seconds per turn, p90 | 22.0 | 36.2 |
- A meal estimated without its details now costs one more model call.

**Follow-ups:**
- Rerun `make fern-eval` on every change to the loop, and raise
  `baseline.json` when a change holds its gain.
