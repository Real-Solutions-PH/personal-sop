# Deployment

## Principle: One Environment, Manual Promotion

Per constitution §2.5 there is exactly **one deployed environment at any time**, and per §2.2 **nothing deploys automatically on push or merge**. Promotion is always a deliberate human action.

- No per-environment branches, no auto-deploy from `main`/`master` (§2.2).
- No standing staging environment running alongside production.
- Production is always AWS, built during the production-targeting phase. When production goes live (cutover), the testing environment is torn down.

## Environments

| Env | Where | Purpose | How it gets deployed |
|-----|-------|---------|----------------------|
| Local | Docker Compose (this repo) | Day-to-day development | `docker compose watch` — never "deployed" anywhere |
| Testing | Vercel free tier: Next.js frontend + FastAPI as serverless functions; managed Postgres | Client-internal testing only — never real users | Deliberately, via the Vercel CLI or dashboard; never on push |
| Production | Always AWS | Real users | Built in the production-targeting phase; the testing env is torn down at cutover |

Only one of Testing or Production is deployed at a time — Testing exists before cutover, Production after.

## Promotion Path (Vercel → AWS)

Promotion to production is a deliberate manual act:

- A `workflow_dispatch`-only GitHub Actions workflow that deploys an explicitly chosen tag or commit SHA to AWS. This workflow will be added when the production environment is built.
- **Never** a `push:` or `release:` trigger. No deploy may be a side effect of merging or tagging.
- At cutover, the Vercel testing environment is torn down (§2.5).

## What This Template Deliberately Does NOT Include

Removed on purpose, per the constitution:

- **Self-hosted GitHub Actions runners** and VPS deploy workflows — no self-hosted clusters or servers for a lean team (§1).
- **Traefik reverse proxy** (`compose.traefik.yml` and all `traefik.*` labels) — there is no self-hosted server for it to front (§1, §2.5).
- **Standing staging environments** and auto-deploy on merge to `master` (§2.2, §2.5).
- **Railway or any third PaaS** — Vercel for testing, AWS for production; Hetzner only if EU data residency requires it (§2.5).

## Vercel Readiness Gaps (Documented, Not Yet Implemented)

Deploying this template's backend to Vercel free tier requires work that has deliberately not been done yet:

- **Serverless entrypoint**: FastAPI needs a Vercel-compatible entrypoint and a `vercel.json`; the current Docker-based backend image is not directly deployable to Vercel functions.
- **Managed service replacements**: the Compose stack's Postgres, Redis, MinIO, and Mailcatcher/SMTP containers must be replaced with managed equivalents (e.g. managed Postgres, hosted Redis, S3-compatible storage, a transactional email provider).
- **Migrations**: `prestart.sh` (which runs Alembic migrations) will not run in a serverless environment — migrations need an explicit story, e.g. run manually or from a one-off job before deploying.
- **Free-tier limits**: 60s max function duration (300s with Fluid compute) and ~4h active CPU per month — fine for CRUD APIs, unsuitable for WebSockets or long-running jobs (§2.5).

## ADR Escape Hatch

A project generated from this template may adopt a self-hosted Docker Compose + Traefik deployment **only** via an Architecture Decision Record in `docs/adr/` (per constitution §0.3; see [adr/](adr/)). The old self-hosted deployment guide is preserved in git history: `deployment.md` at commit `d3a9c71`.

## Reference: Secrets and Environment Variables

### Generate secret keys

Some environment variables in the `.env` file have a default value of `changethis`.

You have to change them with a secret key, to generate secret keys you can run the following command:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Copy the content and use that as password / secret key. And run that again to generate another secure key.

### Environment variable reference

This reference is generated from [`.env.example`](../.env.example) — that file
is the source of truth, so when you add or rename a variable there, update this
list to match. Every value that ships as `changethis` **must** be rotated to a
generated secret (above) before any non-local deployment.

> Redis runs in the Compose stack (rate-limit / cache seam) but has no
> environment variable — the backend reaches it at the fixed `redis` service
> host, so there is nothing to configure here.

**Domain and environment**

* `DOMAIN`: The deployed environment's domain (`localhost` locally). Set per environment.
* `FRONTEND_HOST`: Frontend base URL the backend uses to build links in emails. Set to the deployed frontend host in a deployed environment.
* `ENVIRONMENT`: One of `local`, `staging`, `production` (accepted values in `backend/app/core/config.py`).
* `PROJECT_NAME`: The name of the project, used in the API docs and emails.
* `STACK_NAME`: The name used for Docker Compose labels and the compose project name.

**Backend and first superuser**

* `BACKEND_CORS_ORIGINS`: A list of allowed CORS origins separated by commas.
* `FIRST_SUPERUSER`: The email of the first superuser — the account that can create other users.
* `FIRST_SUPERUSER_PASSWORD`: Password for that first superuser. Ships as `changethis` — **rotate it** for any non-local environment.

**Supabase auth** (the backend verifies Supabase-issued JWTs via JWKS — ADR-0005)

* `SUPABASE_URL`: Supabase auth URL — the local CLI stack locally, the hosted project URL in a deployed environment.
* `SUPABASE_ANON_KEY`: Public anon key. The committed value is Supabase's well-known **local demo** key (safe to commit); use the hosted project's real key when deployed.
* `SUPABASE_SERVICE_ROLE_KEY`: Service-role key. The committed value is the local demo key; the hosted project's real value is a **secret**.
* `SUPABASE_JWT_ISSUER`: Override the token issuer only when it differs from `SUPABASE_URL` (e.g. a containerized backend reaching the stack via `host.docker.internal` while tokens say `127.0.0.1`). Leave empty otherwise.
* `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: The same URL and anon key exposed to the browser. Compose derives them from the two `SUPABASE_*` values above as Docker **build args** inlined into the Next.js bundle.

**Emails (SMTP)**

* `SMTP_HOST`: The SMTP server host, from your email provider (e.g. Mailgun, Sparkpost, Sendgrid).
* `SMTP_USER`: The SMTP server user.
* `SMTP_PASSWORD`: The SMTP server password.
* `EMAILS_FROM_EMAIL`: The email address to send from.
* `SMTP_TLS`, `SMTP_SSL`, `SMTP_PORT`: Transport settings (defaults: TLS on, SSL off, port 587).

**Postgres**

* `POSTGRES_SERVER`: The hostname of the PostgreSQL server. Leave the default (`db` in Compose) unless using a third-party provider.
* `POSTGRES_PORT`: The port of the PostgreSQL server. Leave the default unless using a third-party provider.
* `POSTGRES_USER`: The Postgres user. Leave the default.
* `POSTGRES_DB`: The database name for this application. Leave the default of `app`.
* `POSTGRES_PASSWORD`: The Postgres password. Ships as `changethis` — **rotate it** for any non-local environment.

**Tenancy**

* `DEFAULT_TENANT_SLUG`: Slug of the tenant new signups are assigned to. The tenant's UUID is fixed by the seed/migration and is not configurable here.

**MinIO (S3-compatible object storage)**

* `MINIO_ENDPOINT`: Object-storage endpoint URL.
* `MINIO_ROOT_USER`: Object-storage access key.
* `MINIO_ROOT_PASSWORD`: Object-storage secret key. Ships as `changethis` — **rotate it** for any non-local environment.
* `MINIO_DEFAULT_BUCKET`: Default bucket for uploads.

**OCR module** (optional — gated by `OCR_ENABLED`)

* `OCR_ENABLED`: Enables the OCR module and its routes when `true`.
* `OCR_DEFAULT_PROVIDER`: OCR engine — `rapidocr`, `easyocr`, or `granite`.
* `OCR_MAX_FILE_SIZE_MB`: Maximum upload size accepted for OCR.
* `OCR_ALLOWED_MIME_TYPES`: Comma-separated allowed MIME types.
* `OCR_BUCKET`: Object-storage bucket for OCR documents.

**Error monitoring** (GlitchTip — Sentry-SDK compatible; see [runbook](runbook.md))

* `SENTRY_DSN`: Backend DSN, read at runtime by the FastAPI app. Leave empty to disable.
* `FRONTEND_SENTRY_DSN`: Frontend DSN, passed as a Docker **build arg** (`NEXT_PUBLIC_SENTRY_DSN`) and inlined into the Next.js bundle — a runtime-only value no-ops.
* Mobile uses `EXPO_PUBLIC_SENTRY_DSN`, set in `mobile/.env` (or EAS env), not here.

**AI module** (optional — gated by `AI_ENABLED`; see [AI module](22-ai-module.md))

* `AI_ENABLED`: Mounts the AI routes and agent seed on the backend when `true`.
* `NEXT_PUBLIC_AI_ENABLED`: Exposes the chat UI on the frontend when `true` (build arg, inlined at build).
* `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, `NEBIUS_MODEL`: Nebius provider credentials and model.
* `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`: OpenRouter provider credentials and model.
* `DEFAULT_LLM_PROVIDER`: Which provider to use by default — `nebius` or `openrouter`. At least one provider's key is required when `AI_ENABLED=true`.

**Tools**

* `BRAVE_API_KEY`: Enables the Brave web-search agent tool when set.

**Docker images**

* `DOCKER_IMAGE_BACKEND`, `DOCKER_IMAGE_FRONTEND`: Registry image names, used when building/pushing deploy images.

## Runbook

See `docs/runbook.md`.
