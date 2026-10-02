# ADR-0010 — Native Expo prototype with a shared domain

- **Date:** 2026-10-02
- **Status:** accepted
- **Deciders:** owner authorization to migrate the prototype to React Native / Expo

## Context

The web prototype has 95 routes and substantial reusable domain logic, but its rendering, browser storage, gestures and media controls do not transfer directly to React Native. Copying the calculations and actions into a second client would create two sources of truth.

## Decision

Extract provisional domain types, data, calculations, actions and module hooks into `shared/prototype/`. Keep platform rendering in each client. The web client's prior imports remain compatibility re-exports, minimizing changes to existing screens.

Build native Expo Router screens with small common controls, Gesture Handler row actions, Reanimated press feedback and native media/sharing adapters. Resolve React from the consuming application in Metro and Jest to avoid duplicate runtimes. Use Expo-compatible package versions.

Preserve the locally seeded, simulated prototype scope of ADR-0009. SQLite implements the native storage adapter; localStorage implements the browser adapter. The original authenticated API template remains available through an explicit connected mode, guarded separately. No backend or synchronization service is added for this migration.

## Constitution alignment

This applies §1's foundation-first principle and §2.1's monorepo default. Shared domain behavior and a storage boundary are the foundation; a generic form engine, plugin framework, second backend and speculative synchronization layer are unnecessary. The UI-first contract-ordering deviation accepted in ADR-0009 continues to apply; this record does not change the pinned constitution.

## Consequences

Both clients receive domain fixes together, while native interaction changes stay local to mobile. Docker and CI must include the shared sources. Local state is not synchronized across devices, attachments remain bounded prototype data, and native device validation is required in addition to bundle exports and browser tests.

The later production migration replaces action/persistence implementations with the generated tenant-aware API rather than rewriting screens. It must add conflict resolution, server-side validation, real notifications and service-backed AI under the finalized contracts.

## References

Expo documentation checked 2026-10-02: [date/time picker](https://docs.expo.dev/versions/latest/sdk/date-time-picker/), [SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/), [Reanimated](https://docs.expo.dev/versions/latest/sdk/reanimated/).
