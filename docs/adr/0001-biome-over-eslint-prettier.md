# ADR-0001 — Biome instead of eslint + prettier for TypeScript lint/format

- **Date:** 2026-07-12
- **Status:** accepted
- **Deciders:** maintainers

## Context

Constitution §2.6 defaults TypeScript tooling to eslint + prettier. This template already runs Biome across `frontend/` and `mobile/`, wired into pre-commit and the CI Lint workflow. Switching to eslint + prettier would be churn with no functional gain: two tools and two config surfaces instead of one, materially slower runs, and a re-baselining of every existing suppression.

## Decision

Keep **Biome** as the single linter/formatter for all TypeScript workspaces. CI runs `biome ci` (read-only); the package `lint` scripts remain mutating (`--write`) for local use.

## Constitution clause deviated from

§2.6 — "TypeScript: strict mode + eslint + prettier."

## Consequences

**Positive:**
- One fast tool, one config per workspace; already green in CI.

**Negative:**
- Biome's rule ecosystem is smaller than eslint's plugin universe; niche plugins (e.g. framework-specific a11y packs) have no direct equivalent.
- Frontend (Biome 2.x) and mobile (Biome 1.9.x) currently use different config schemas — configs cannot be shared until mobile upgrades.

**Follow-ups:**
- Align mobile to Biome 2.x when the Expo toolchain allows.
