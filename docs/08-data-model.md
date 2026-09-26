# Data Model

## ER Diagram

```mermaid
erDiagram
  USER ||--o{ ITEM : owns
  USER {
    uuid id
    string email
    uuid tenant_id FK
    bool is_active
  }
  ITEM {
    uuid id
    uuid owner_id
    string title
    text description
  }
```

## Entities

### User

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | uuid | PK | |
| email | text | unique, not null | synthetic example: user@example.test |
| (no password column) | — | — | auth lives in Supabase (GoTrue); `user.id` = the Supabase auth UID |
| is_active | bool | default true | |
| created_at | timestamptz | default now() | ISO-8601 UTC |

### Item

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | uuid | PK | |
| owner_id | uuid | FK -> user.id | |
| title | text | not null | |

## Indexes

- `user(email)` unique
- `item(owner_id)`

## Tenancy (2026-07-12)

All user-facing tables are tenant-scoped; a `tenant` row (id, name, slug unique, is_active) anchors them:

| Table | tenant_id | ON DELETE | Notes |
|-------|-----------|-----------|-------|
| user | not null, indexed | RESTRICT | a tenant with users cannot be deleted |
| item | not null, indexed | CASCADE | |
| ocr_document | not null, indexed | CASCADE | |
| conversation | not null, indexed | CASCADE | `message` scoped transitively via conversation |

Global (deliberately tenant-free, per ADR-0006): `agent`, `tool`, `mcpserver`, `agenttool`, `role`, `permission`.

Bootstrap: migration `b7d4e12a9f03` and `seed_tenants` both insert a **Default** tenant (slug `default`, fixed UUID `00000000-0000-4000-8000-000000000001`, idempotent on slug) and legacy rows are backfilled to it. New signups are assigned the tenant named by `settings.DEFAULT_TENANT_SLUG`.

Enforcement: the tenant filter lives in repo queries — rows outside the caller's tenant are invisible (404, no existence leak); wrong-owner rows inside the same tenant keep 403. Superusers are platform operators and bypass the filter.

DB-level RLS (2026-07-12): migration `c8f2a1d47e56` adds tenant-isolation policies on `user`, `item`, `ocr_document`, `conversation`, `tenant`, and `message` (transitive through its conversation), keyed on the Supabase-compatible `request.jwt.claims` GUC via `app_tenant_id()`. Owners/superusers bypass RLS, so the policies stay dormant until the app engine is flipped to the non-owner `app_user` role — see the runbook's "Row-Level Security & rate limiting" section for provisioning and verification.

## Migrations

- Tool: Alembic
- Naming: `YYYYMMDD_HHMM_description.py`
- Forward + backward compatible during deploys.

## Retention / Privacy

- PII fields: email
- Soft delete vs hard delete:
- GDPR export/erase:
