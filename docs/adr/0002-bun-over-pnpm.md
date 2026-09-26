# ADR-0002 — bun instead of pnpm workspaces for JS package management

- **Date:** 2026-07-12
- **Status:** accepted
- **Deciders:** maintainers

## Context

Constitution §2.1 defaults JS tooling to pnpm workspaces. This template uses bun: a root `bun.lock` covering the `frontend` workspace, and a standalone bun project in `mobile/`. Every CI job, Dockerfile, and script already invokes bun; Dependabot runs the `bun` ecosystem for both directories.

## Decision

Keep **bun** as the JS package manager and lockfile of record everywhere. npm/yarn/pnpm lockfiles stay gitignored (a stale npm lockfile in `mobile/` already caused real dependency drift).

## Constitution clause deviated from

§2.1 — "Tooling: pnpm workspaces (TS)."

## Consequences

**Positive:**
- No migration churn across three workspaces, CI, and Docker; bun install speed benefits every pipeline run.

**Negative:**
- bun's workspace/lockfile semantics are younger than pnpm's; occasional ecosystem tooling assumes npm/pnpm (worked around case-by-case, e.g. license-checker at the workspace root).

**Follow-ups:**
- None.
