# ADR-0029 — Fern replay eval: a scrubbed dataset of real chats, in the repository

- **Date:** 2026-11-02
- **Status:** accepted
- **Deciders:** Kai (owner); drafted by the agent that built the eval

## Context

Fern's failures in production came from real conversations: meals logged without saturated fat, sugar or sodium; a correction to a waiting entry failing twice; replies that claimed a save that never happened; a queued burst ("it is not" … "finished") answered as two thoughts. Unit tests with a scripted model prove the plumbing, not the behaviour. A change to the chat agent needs to be replayed against the conversations that went wrong, and the ones that went right, with the real model.

Those conversations are Kai's personal data: what he eats, his money, his work, his clients, his medication, the people he names. **The repository is public.** The dataset therefore cannot be a dump of his chats, and it cannot live only on one laptop, or CI could not run it.

## Decision

1. **The dataset lives in the repository, scrubbed**, at `backend/tests/eval/fern/cases/`, one JSON file per case. Each case holds:
   - the chat before the turn: at most 16 messages;
   - the record state at that moment, scoped to what the turn could touch;
   - the message or queued burst;
   - the expected behaviour, as deterministic checks plus a rubric.
2. **The record state is reconstructed as it was at that moment.**
   - Included: rows created before the message and not yet deleted, with tasks completed later reopened, and entries still waiting for Confirm.
   - The scope is by domain: meals and the food library for food talk; templates, workouts and weigh-ins for training; accounts and transactions for money. Tasks, habits and saved memories are always included.
   - Every row id is replaced by a stable symbolic one.
3. **Scrubbing, applied to every string in a case:**
   - **People and the user:** the user becomes "Sam", and other people get stock first names.
   - **Organisations:** employers, clients and projects become generic names ("Acme Studio", "Client B", "ProjectD").
   - **Health:** medication becomes a generic supplement.
   - **Money:** bank and wallet names become "Wallet", "Savings", "Credit Card", "Bank A" and "Bank B". Salary figures are replaced in both the text and the records.
   - **Places and assets:** the home town, the barangay, a land purchase and a car purchase become generic terms.
   - **Receipt text read from photos:** card digits, numbers of nine or more digits, tax and registration ids, and email addresses are masked.
   - **Kept as they were:** foods, brands, times and nutrition numbers. The failures are made of them, and they do not identify anyone.
4. **A guard test keeps it scrubbed.** `scrub_denylist.sha256` holds SHA-256 hashes of the scrubbed terms, never the terms themselves. `test_fern_dataset.py` fails if any one-, two- or three-word sequence in a case hashes to one of them. This runs in every backend test run.
5. **The raw export never enters the repository.** It came from a read-only transaction in production (`SET TRANSACTION READ ONLY`, run as a one-off ECS task, read from the task's log). It and the case builder lived in one session's scratch directory, which was deleted when the dataset was committed. Rebuilding the dataset means repeating that read-only export.
6. **Replay results are not committed either.** They are written to `backend/fern-eval-out/`, which is git-ignored, and CI keeps them as a 7-day artifact. Every reply in them is generated from the scrubbed cases.

## Constitution clause deviated from

None. This adds a test suite and a CI job; it changes no default.

## Consequences

**Positive:**
- Every change to `companion/`, `capture/` or `ai_providers/` replays 182 real turns: 161 failures and 21 guards.
- The cases are reviewable in the pull request that changes them.
- CI can run the eval without any secret other than the model key.

**Negative:**
- Scrubbing is lossy. Text that named a person or a place reads a little differently from what the model originally saw, though rarely in a way that matters to the failure.
- The record state is approximate. A row edited after the moment keeps its later values (only creation and deletion times are reconstructed), and a photo turn is replayed with the photo's stored description instead of the image.
- A public dataset of one person's food and training habits, under a pseudonym, is still a disclosure of habits. It is Kai's data and his call: merging this ADR is that decision. **Nobody else's chats may be added under this ADR.**

**Rejected alternative:** an encrypted dataset in the repository, with the key in Secrets Manager and a GitHub secret. This would give a verbatim, unscrubbed replay, but it adds a key to manage and a secret per environment. It remains the upgrade path if scrub losses start to hide failures.

**Follow-ups:**
- Add the `NEBIUS_API_KEY` repository secret so the `Fern eval` CI job runs; without it the job skips with a notice.
- New failures seen in production become new cases. Export them read-only, then scrub them with the same rules.
