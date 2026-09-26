# Runbook

Operational reference for this project. Skeleton — sections get filled in as the relevant features land.

## Overview & environments

Single deployed environment at any time (testing → production at cutover). See [13-deployment.md](13-deployment.md) for the full environment story and promotion path.

## Deploy

Deployment is a deliberate, manual promotion — single environment, no auto-deploy on push/merge. Full detail lives in [13-deployment.md](13-deployment.md); not duplicated here.

## Rollback

- **App (Vercel/AWS):** redeploy the prior tag or commit SHA — never forward-fix under pressure. Vercel supports instant rollback to a previous deployment.
- **Database (Alembic):** `make backend-downgrade` to step back one migration.

## Backup & restore

- **Postgres:** data lives in the `app-db-data` Docker volume. Back up / restore with `pg_dump` / `pg_restore` (or `psql < dump.sql`).
- **MinIO (object storage):** back up the `app-minio-data` volume or mirror buckets with the MinIO client (`mc mirror`).
- **Redis:** cache only — data loss is acceptable; no backup required.

## Common operations

- `make up` / `make down` / `make logs` / `make ps` — start, stop, tail logs, list containers.
- Run migrations: `make backend-migrate` (upgrade head) or `make backend-revision MSG="..."` to create one.
- Regenerate the API client after a backend change: `bash scripts/generate-client.sh` (enforced by a pre-commit hook).
- First superuser is created by `backend/scripts/prestart.sh` (`FIRST_SUPERUSER` env var) — runs automatically via the `prestart` compose service.
- Mailcatcher (dev SMTP inbox): `http://localhost:1080`.

## Error monitoring & uptime

### GlitchTip (error monitoring, Sentry-SDK compatible)

**Per-client setup:** one GlitchTip organization per client, with three projects: `{client}-backend`, `{client}-frontend`, `{client}-mobile`. Each project issues its own DSN.

**Where each DSN goes** (all surfaces no-op silently when their DSN is unset):

| Surface | Variable | How it's applied |
|---------|----------|------------------|
| Backend | `SENTRY_DSN` | Runtime env var (`.env` / deploy environment) — picked up by FastAPI on boot. |
| Frontend | `FRONTEND_SENTRY_DSN` → `NEXT_PUBLIC_SENTRY_DSN` | Docker **build arg** (see `compose.yml`), inlined into the Next.js bundle at build time. Setting it only at runtime silently no-ops — rebuild the image after changing it. |
| Mobile | `EXPO_PUBLIC_SENTRY_DSN` | EAS environment variable, or `mobile/.env` for local builds. Build-time inlined, same caveat as frontend. |

**Mobile native builds:** the `@sentry/react-native/expo` plugin injects a source-map upload step into prebuild/EAS builds that **fails the build** when no `SENTRY_AUTH_TOKEN` is configured (and defaults to sentry.io, not GlitchTip). Set `SENTRY_DISABLE_AUTO_UPLOAD=true` in the build environment (see `mobile/.env.example`) until uploads are deliberately configured with the GlitchTip `url`/`organization`/`project` plugin options.

**Verification:** after wiring a DSN, trigger a test error on each surface and confirm it appears in the matching GlitchTip project:
- Backend: raise an exception from any endpoint (or temporarily add a `/sentry-debug` route that raises).
- Frontend: throw inside a page component — the `error.tsx` / `global-error.tsx` boundaries report it.
- Mobile: call `Sentry.captureException(new Error("test"))` from a dev build with the DSN set.

**Alerts:** in each GlitchTip project, set alert rules to email the on-call address (e.g. notify on any new issue; tune noise later).

### Better Stack (uptime)

One Better Stack account per client (free tier: 10 monitors, 3-minute checks, status page).

- **Monitors:** backend health check `https://api.{domain}/api/v1/utils/health-check/` and the frontend URL `https://{domain}/`.
- **Escalation:** alert the on-call email/phone per the incident severities below (SEV1 path for prod-down).
- **Status page:** publish a Better Stack status page for the client with both monitors.

### DSN rotation at offboarding

When a client engagement ends: rotate (regenerate) all three GlitchTip DSNs — or delete the projects — and remove the old values from deploy env, build args, and EAS. Hand the GlitchTip org and Better Stack account over to the client or tear them down per contract.

## Client-owned org setup

**Per-client setup:** the client creates their own Supabase organization and project (ADR-0005) and owns it. As of 2026-07, Supabase orgs support unlimited team members on every plan including Free, so **inviting the development team as a full (non-project-scoped) member is the default path**: the client sends the invite from Organization → Team. Fall back to **shared credentials** (constitution §2.5) only if the client's account genuinely can't invite (e.g. an SSO-gated org that only accepts same-IdP invites).

**Credential placement** (§2.8 — the team password manager is the source of truth, `.env` is generated from it, credentials never travel via chat/email):

| Credential | Dashboard location | Where it's used |
|---|---|---|
| Project URL | Settings → API Keys | Public — frontend + backend `.env` |
| anon / publishable key | Settings → API Keys → Publishable key (Legacy tab: `anon`) | Public — frontend `.env` |
| service_role / secret key | Settings → API Keys → Secret keys (Legacy tab: `service_role`) | **Backend `.env` only — never frontend or mobile.** |
| DB connection string | Settings → Database → Connection string | Backend `.env` only |
| JWT secret / signing keys | Settings → JWT Keys | Backend `.env` only |

**Local dev vs. client project:**

- Local development runs against the Supabase CLI local stack (`supabase start`) — no client credentials needed day-to-day.
- `supabase link --project-ref <ref>` binds the repo to the client's hosted project once the invite/credentials are in hand.
- Migrations are committed files pushed to the linked project; dashboard-only schema edits are prohibited (§2.6). Only one person pushes at a time to avoid ordering conflicts. *(Migration tooling: **Alembic** — decided in ADR-0006.)*

**Rotation at handover / offboarding:**

- Regenerate (or have the client regenerate) the anon and service_role keys; rotate the JWT signing key.
- Remove the development team from the org (or revoke shared credentials if that path was used).
- Purge the old values from the password manager, `.env`, deploy env, and build args.
- Hand the org fully to the client, or tear it down per contract.

**Supabase Auth operational notes:**

- **Re-harden self-hosted GoTrue:** `supabase/config.toml` relaxes `[auth.rate_limit] sign_in_sign_ups` to 500 strictly for the local E2E suite. Supabase Cloud ignores the file, but anyone self-hosting GoTrue from this repo's config MUST restore the default 30 (and review the other rate limits) before exposing the auth endpoint.
- **Bootstrap before exposure:** run the FIRST_SUPERUSER bootstrap (backend prestart / `init_db`) *before* the auth endpoint is publicly reachable. The bootstrap adopts an already-registered email by password-reset; a squatter who pre-registered `FIRST_SUPERUSER` loses the password at bootstrap but any token they already hold stays signature-valid for up to `jwt_expiry` (1h default) — bootstrapping first closes that window entirely.
- **Migrating pre-existing local users** (deliberate template non-goal, C1): the template only JIT-provisions Supabase-born identities. For a legacy row, the operator creates the GoTrue user via the admin API (`POST /auth/v1/admin/users`, service-role key) and re-keys the local row to the auth UID: `UPDATE "user" SET id = '<auth_uid>' WHERE email = '<email>';` (FKs on `item.owner_id` etc. must be updated in the same transaction or cascaded).

## Row-Level Security & rate limiting (2026-07-12)

**RLS.** Migration `c8f2a1d47e56` enables RLS with tenant-isolation policies on `user`, `item`, `ocr_document`, `conversation`, `tenant`, and `message` (transitive via its conversation). Policies key on `current_setting('request.jwt.claims', true)` through the `app_tenant_id()` helper — byte-compatible with Supabase PostgREST, so they survive the Supabase migration unchanged.

- **Why Alembic/seeds are unaffected:** Postgres superusers and table *owners* bypass RLS. Migrations and prestart seeding connect as the DB owner, so for them the policies are a dormant second wall. The app connects through a **separate app engine** (`app/core/db.py: app_engine`): when `POSTGRES_APP_USER` is set it connects as the non-owner `app_user` role (RLS enforced); when unset it falls back to the owner engine (RLS dormant — the local/dev default). Startup runs `check_rls_posture()`: silent when the app engine is a non-owner, a `RLS is DORMANT` warning in local, and a **fatal error outside local** when `POSTGRES_APP_USER` is set yet the connection still bypasses (a silent-isolation-off guard).
- **Per-request claims:** the opt-in `get_tenant_session` dependency (`app/modules/iam/deps.py`) opens a session on the app engine and injects the caller's tenant claim transaction-locally, re-applied on every transaction (a transaction-local `set_config` resets to `''` on commit). The tenant is resolved from the authenticated user's row — the Supabase JWT does not carry `tenant_id`. Platform-operator (superuser) routes keep the owner-backed `SessionDep`, since under RLS the tenant policy would hide other tenants' rows. **Route cutover is incremental:** a tenant-scoped route adopts `TenantSessionDep` in place of `SessionDep` to enforce isolation; until a route adopts it, that route still runs on the owner engine.
- **`app_user` provisioning:** the migration creates `app_user` as `NOLOGIN` with no password (no secrets in the repo) plus DML grants and default privileges. Ops enables it out-of-band per §2.8 (value lives in the team password manager): `ALTER ROLE app_user LOGIN PASSWORD '<from-password-manager>';` then set `POSTGRES_APP_USER`/`POSTGRES_APP_PASSWORD` in the environment so the app engine uses it.
- **Verifying isolation by hand:** in a transaction as `app_user`, `SELECT set_config('request.jwt.claims', '{"tenant_id": "<uuid>"}', true);` then query — only that tenant's rows are visible. A claim-less session sees zero rows. (Any SQL touching the claim must go through `app_tenant_id()`, which `NULLIF`-guards the empty-string GUC left behind after a transaction-local `set_config`.)

**Rate limiting.** Write routes (items / OCR / AI chat) pass through a per-tenant seam (`app/shared/rate_limit.py`). The default backend is a **Redis token bucket** keyed on `(tenant_id, key)`, enforced atomically via a Lua script and **failing open** (allow + log) when Redis is unreachable — availability over strictness. It is **disabled by default** (`RATE_LIMIT_PER_MINUTE=0` → the no-op `NullBackend`); set a positive per-minute budget (also the burst capacity) plus `REDIS_URL` to turn it on. Denials surface as 429 in the standard error envelope. The same hook is where constitution §3 per-tenant AI spend caps plug in. There is no per-tenant kill switch yet; deactivating a tenant (`tenant.is_active`) is not consulted by the seam.

## Incidents & escalation

Per constitution §3: SEV1 (prod down / data breach) ack < 4 PH business hours (best effort < 24h any calendar day); SEV2 (major feature degraded) ack < 8 working hours; SEV3 (minor) ack next business day. First move is rollback, not forward-fix. SEV1 gets a written postmortem within 5 business days.
