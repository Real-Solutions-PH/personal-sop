# ADR-0006 — Alembic remains the migration CLI

- **Date:** 2026-07-12
- **Status:** accepted
- **Deciders:** maintainers

## Context

Tenant scoping introduces a `tenant_id` column on every user-facing table (user,
item, ocr_document, conversation) and has to create the AI/OCR tables that were
previously only defined as SQLModel classes with no Alembic revision. That
forces a decision on which tool owns schema migrations going forward, since
ADR-0005 commits the project to Supabase (whose ecosystem default is the
Supabase CLI's SQL migrations).

## Decision

Alembic stays the schema-migration CLI. All schema changes — including the
tenant scoping — are expressed as Alembic revisions in
`backend/app/alembic/versions/`, generated against the SQLModel metadata in
`backend/app/db/models.py`.

## Constitution clause deviated from

None (§2.6 — Alembic is a compliant migration CLI; the Supabase CLI was the
example, not a mandate).

## Consequences

**Positive:**

- Migrations stay colocated with the SQLModel models they derive from; one
  source of truth for schema.
- No new tooling for the team; existing `make backend-migrate` /
  `make backend-revision` workflows keep working.

**Negative:**

- Supabase dashboard/CLI users must not run DDL outside Alembic; drift between
  Supabase-managed SQL and Alembic history would be manual to reconcile.

**Follow-ups:**

- Revisit if the models ever leave SQLModel, or when Supabase CLI ownership is
  decided in the production phase.
- Tenancy scope note: `agent`, `tool`, `mcpserver`, `agenttool`,
  `role`, and `permission` stay **global** (platform-level catalogs, not
  tenant-owned). Tenant-scoped tables are `user`, `item`, `ocr_document`,
  `conversation` (and `message` transitively via its conversation).
