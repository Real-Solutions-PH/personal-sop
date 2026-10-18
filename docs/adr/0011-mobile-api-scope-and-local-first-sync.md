# ADR-0011: Mobile API scope and local-first sync

- **Date:** 2026-10-18
- **Status:** accepted
- **Deciders:** owner, tech lead

## Context

The Expo app (`mobile/`) is a complete product UI. Every screen reads and writes on-device JSON stores, and every rule, score and the simulated AI run on the device (ADR-0009, ADR-0010). The owner asked for a backend that every UI function connects to, with full business logic and tests. The app must keep working offline and sync silently when it reconnects, with no new UI for it.

There are two tensions with the ratified IA (`docs/ia/README.md`):
- OQ-DSH-1 put social ("friends/follow/kudos feed") under Later, yet the mobile UI now ships a full social module.
- The app must work offline, while the backend must be the source of truth for business rules.

## Decision

1. **Scope.** Every module the mobile UI exposes gets a backend module, including **real multi-user social** inside the user's tenant. This overrides OQ-DSH-1 by owner instruction on 2026-10-18 ("all functionalities in the mobile app").

2. **Ids are minted on the device** (UUID v4). Rows the server derives as a side effect get UUID v5 ids from `(kind, parent id, key)` (`app/shared/ids.py`). The device can mint the same id offline, so the optimistic row and the replayed action converge on one row.

3. **Sync is operations plus a version cursor, not timestamps.**
   - **Version stamping.** A trigger stamps `version` from one Postgres sequence on every write.
   - **Pull.** `GET /sync/pull?cursor=` returns rows past the cursor, tombstones included, ordered by version and capped with `truncated`.
   - **Push.** `POST /sync/push` takes ordered ops: `upsert`, `delete`, or `action`, the last for domain actions that are not field writes, such as completing a task or settling a bill.
   - **Business rules on every write.** Each op runs through the same use cases REST uses, in its own SAVEPOINT.
   - **Replay safety.** `(owner, op_id)` receipts make replays return the first result.

4. **Conflict policy.**

   | Case | Outcome |
   |---|---|
   | Two writes to the same field | Field-level last-writer-wins in server order; an op carries only the fields it changed |
   | Write to a row tombstoned on the server | `conflict`; only an explicit restore revives it |
   | Delete | Idempotent |
   | A business rule refuses the op | `rejected` with the rule's code |
   | Derived fields (scores, balances, streaks) | The server is authoritative |

5. **Mobile keeps its stores as the UI's source of truth.** An outbox of ops in the native SQLite store is pushed on reconnect, on foreground, or when another device nudges over the event stream (ADR-0013). Server-computed reads are cached and shown stale offline. The web client is unchanged.

6. **Money and days.**
   - Money is integer centavos everywhere.
   - A business day is a user-clock `DATE` (time zone plus day start hour, default Asia/Manila 04:00, per IA ruling X-1).

## Constitution clause deviated from

None. §1 (multi-tenant from day one), §2.6 (OpenAPI as the contract, one error envelope) and §4.1 (RLS by tenant) are followed. Every new table has a tenant policy.

## Consequences

**Positive:**
- Offline use needs no special UI.
- Every synced write is guarded by the same business rules as REST.
- A missed op cannot corrupt state: receipts make it idempotent, and ids are known up front.

**Negative:**
- No merge of concurrent edits to the same field: the later write wins.
- Every syncable table carries the six base columns, and child rows denormalize `owner_id`/`tenant_id`.
- Social is not available offline beyond the cached feed.

**Follow-ups:**
- Mobile wiring: outbox, op mappers, pull merge.
