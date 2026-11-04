# ADR-0034 — Fern eval: other people's chats, with consent, in a private store

- **Date:** 2026-11-04
- **Status:** accepted
- **Deciders:** Kai (owner); drafted by the agent that refreshed the eval

## Context

The Fern replay eval (ADR-0029) is built from Kai's chats only, scrubbed, in this public repository. Other people now use Unfurl, and their conversations hit failures Kai's never do. Kai decided on 2026-11-04 that their chats may join the eval, on two conditions: each person opts in, and their cases never enter the public repository.

## Decision

1. **Consent is opt-in, per person, off by default.**
   - It is stored on the profile row: `user_profile.fern_eval_consent` (default `false`), plus `fern_eval_consent_at`, the moment it was last turned on or off. The server sets that moment; a device cannot.
   - The phone shows it in Me as **Help improve Fern**. Turning it on first asks in plain words: "Let Unfurl use anonymised copies of your chats to test Fern. They stay private and are never published. You can turn this off any time." Turning it off takes effect at once.
2. **Who is exported.** `backend/scripts/fern_eval_export.py` reads Kai's chats (for the public set, under ADR-0029) and the chats of people whose setting is on at the moment of the export. Nobody else's rows are read. It runs as a one-off ECS task, in a read-only transaction (docs/runbook.md, "Fern eval export").
3. **Where their cases live: a private GitHub repository**, `Real-Solutions-PH/unfurl-fern-eval-private`.
   - Cases go in its `cases/` directory, in the same JSON format, built with the same scrub rules as ADR-0029.
   - The ids start with `P-` and name the person only by a pseudonym (`P-F-U01-T03-1`). The private repository's `owners.json` maps each `U01` to a user id.
   - The hashes of the terms scrubbed from those chats go in `cases/scrub_denylist.sha256` in the same repository, never here.
   - The raw export and the case builder stay in one session's scratch directory, as before, and are deleted afterwards.
4. **How the eval reads them.** `FERN_EVAL_PRIVATE_CASES` names a checkout of that `cases/` directory. The harness then loads the private cases after the public ones, and the scrub test also checks them against both denylists. Unset, nothing changes.
   - `baseline.json` and the CI gate count the public cases only, so private cases never move the bar.
5. **CI.** With the `FERN_EVAL_PRIVATE_TOKEN` repository secret, the `Fern eval` job checks out the private repository and replays its cases in a separate step.
   - This repository is public, and so are its logs, job summaries and artifacts. That step prints no case detail, writes its results outside the uploaded folder, and adds only counts to the summary.
6. **Who can read it:**
   - Kai, as owner of the private repository.
   - The CI token (read-only).
   - Sessions running on Kai's machine with his GitHub login.
   - Nobody else.
7. **Withdrawal.** A person who turns the setting off is absent from the next export.
   - That refresh deletes every case of a pseudonym that is no longer exported, and the person's row in `owners.json`.
   - Each refresh is pushed as a single new commit on an orphan branch that replaces `main`, so the private repository keeps no history of withdrawn cases.
8. **The public dataset stays Kai-only.** Nothing in this ADR adds anyone else's chats to `backend/tests/eval/fern/cases/`.

## Why a private repository rather than an encrypted object in S3

- Cases stay reviewable as diffs in pull requests, like the public ones.
- CI needs one read-only token, scoped to one repository, instead of AWS credentials in a public repository's workflow.
- The harness reads a directory either way.

An encrypted S3 object would keep the cases inside the AWS account that already holds the data. That would be the better choice if a person's chats ever needed to stay inside AWS. Today that requirement does not exist.

## Constitution clause deviated from

None.

## Consequences

**Positive:**
- Failures from other people's conversations can be replayed, without publishing them.
- Consent is explicit, timestamped, revocable, and read at the moment of each export.

**Negative:**
- A second repository, a token and a secret to manage.
- The export prints the consenting people's rows into the production API log group, which keeps them for 30 days, like Kai's.
- Scrubbing other people's chats needs their names hashed in the private denylist; a missed name is caught only if it is listed.

**Kai's setup (one time):**
1. Create the private repository `Real-Solutions-PH/unfurl-fern-eval-private`, with an empty `cases/` directory.
2. Create a fine-grained personal access token with access to that one repository only and **Contents: Read-only**, and nothing else.
3. Add it to `Real-Solutions-PH/personal-sop` as the Actions repository secret `FERN_EVAL_PRIVATE_TOKEN`.

**Follow-ups:**
- The first private refresh can run once the setting is live in production and at least one person has turned it on.
