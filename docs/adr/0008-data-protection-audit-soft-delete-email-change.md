# ADR-0008 — Audit trail, soft-delete/retention convention, and verified email change

- **Date:** 2026-09-04
- **Status:** accepted
- **Deciders:** maintainers

## Context

The backend had no forensic trail for privileged actions, only immediate
hard-delete with cascade (no retention or data-portability story), and a
self-service email change that pushed the new address straight through the
Supabase Auth **admin** API marked confirmed — letting any authenticated user
mark an address they do not own as verified (an account-takeover primitive,
since recovery and magic-link sign-in trust the verified email).

These are secure-by-default gaps for a template meant to be forked into
production products.

## Decision

1. **Append-only audit log.** A single `auditlog` table (actor, action,
   target, before/after snapshot, timestamp) written from the service layer
   for user create/update/delete and MCP/tool CRUD. No foreign keys — an
   entry must outlive the actor and target it records. Snapshots carry only
   an explicit allow-list of non-secret fields; connection secrets are never
   captured.

2. **Soft-delete / retention convention.** A nullable `deleted_at` on `user`
   and `item` marks a row logically deleted but retained; normal reads hide
   it. This is distinct from erasure (the irreversible hard delete, which also
   revokes the Supabase Auth identity first). No automatic purge ships —
   retention duration is a deployer policy decision. A GDPR data-export helper
   returns all data still held, retained rows included. See
   [22-data-protection.md](../22-data-protection.md).

3. **Self-service email change is refused.** `PATCH /users/me` no longer
   changes the account email; it returns 400 when a different email is
   submitted. The admin path (superuser `update_user`) keeps the authoritative
   admin change. A proper user-initiated, double-confirmation change (Supabase
   Auth `PUT /auth/v1/user`, which emails both the old and new address and
   only applies on confirmation) is the intended end state; it needs the
   user's own access token forwarded from the route and working SMTP, and is
   deferred until both exist.

## Constitution clause deviated from

- **§3 — "Creds stored encrypted in DB."** MCP/tool `config` may hold secrets
  and is now guaranteed write-only (absent from every response), but is still
  stored as plaintext JSONB, not encrypted at rest. Encryption-at-rest for
  connection secrets is a tracked follow-up.
- No clause mandates a self-service email-change feature; refusing it until it
  can be done with verified ownership is a strengthening of the secure-by-
  default posture, not a regression.

## Consequences

**Positive:**

- Every privileged mutation leaves a durable, queryable record.
- Deletion has a reversible path and a documented erase/export flow.
- An unverified email can no longer be marked confirmed via self-service.

**Negative / limitations:**

- `auditlog.actor_id` is only populated where the acting user already reaches
  the service (the delete flows). Admin create/update and MCP/tool CRUD record
  the action but not yet the actor — the routes gate on superuser but do not
  forward the current user to the service. Wiring that through is a follow-up.
- The `user` soft-delete marker is enforced for auth (via `is_active`) but the
  user read paths are not yet `deleted_at`-filtered.
- Self-service email change is unavailable until the verified flow lands.

**Follow-ups:**

- Forward the acting user into the audited service functions so `actor_id` is
  always populated.
- Implement the user-initiated double-confirmation email change once the route
  forwards the access token and SMTP is configured.
- Encrypt MCP/tool `config` at rest (§3).
- Filter user read paths by `deleted_at`, and add a retention-purge job.
