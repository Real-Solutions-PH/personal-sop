# ADR-0009 — UI-first prototype on a local mock store

- **Date:** 2026-09-26
- **Status:** accepted
- **Deciders:** owner (Kai)

## Context

The owner's priority is to validate every screen of the IA ([docs/ia/](../ia/README.md)) before
any business logic. The default order (ERD + OpenAPI contract → mock layer behind the generated
API client → prototype → journey specs) front-loads backend design for ~170 screens whose shape
may still move after the walkthrough.

## Decision

- The prototype is the real Next.js front end, as an installable PWA, under the `(sop)` route group.
  It is **kept** and wired to the backend later.
- Data lives in `frontend/src/proto/`: one store per module (`createStore` in `proto/lib/store.ts`), seeded
  deterministically, held in session and persisted to `localStorage`. Each module's `data.ts` types
  are the **provisional contract**, and the ERD/OpenAPI are derived from them after UI sign-off.
- Cross-module seams are fixed by `proto/contract.ts` (Today card, Life Score rate, metrics,
  calendar items, misses).
- `NEXT_PUBLIC_PROTOTYPE=1` bypasses Supabase auth in `middleware.ts` so the prototype runs without the stack.
- AI capture is **simulated** (scripted parsing of example phrases), so the UX can be judged without provider keys.

## Constitution clause deviated from

Contract-before-screen ordering (RSPH SOP principle 20): the ERD and OpenAPI contract follow the UI sign-off instead of preceding it.
The journey specs (Cypress, ADR-0004) also follow the sign-off.

## Consequences

**Positive:**
- The owner can walk every screen within days, and screen changes are cheap.
- The typed module stores become the source for the ERD.

**Negative:**
- Wiring to the backend replaces each store's actions with API calls, and some data shapes will change.
- localStorage-only data: nothing syncs across devices during the prototype.

**Follow-ups:**
- After UI sign-off: derive the ERD + OpenAPI from `proto/*/data.ts`, then write journey specs, then remove the middleware bypass.
