# ADR-0021 — Self-hosted GoTrue on AWS for sign-in, not a Supabase project

- **Date:** 2026-10-23
- **Status:** accepted
- **Deciders:** product owner, tech lead

## Context

ADR-0005 adopted Supabase for auth, data and storage. What the product actually uses today is narrower:

- **Sign-in only.** Supabase's auth server, **GoTrue**, handles sign-up, sign-in, email confirmation, password reset, sessions and refresh tokens. The backend verifies GoTrue-issued JWTs against its JWKS with a module-scope key cache, so there is no network call per request (`backend/app/core/supabase_auth.py`). It also calls GoTrue's admin API to look up and delete auth users.
- **Data is not on Supabase.** The data lives in our own Postgres, managed by Alembic (ADR-0006) with tenant RLS, and photos and files live in S3-compatible storage (MinIO locally). Locally the Supabase CLI stack runs only to provide GoTrue.

Production is always AWS (constitution §2.5, `docs/13-deployment.md`). A hosted Supabase project would put one piece, sign-in, on a second vendor in a second account. That means a second bill, a second set of secrets, a second region to keep beside the API, and the user table split across two providers.

The app needs **Sign in with Apple** and **Google** sign-in, on top of email and password. In GoTrue these are configuration: the phone gets an ID token from the native Apple or Google sheet, and `supabase.auth.signInWithIdToken()` hands it to GoTrue, which verifies it. That works the same whether GoTrue is Supabase-hosted or self-hosted. Writing our own auth server would mean rebuilding everything GoTrue already does (password storage, confirmation and reset email, refresh-token rotation and revocation, rate limiting, ID-token verification), which is exactly the surface ADR-0005 removed.

## Decision

Run **GoTrue ourselves on AWS, next to the API**, in the same account and region (`ap-southeast-1`, Singapore). No Supabase project.

- **Runtime:** GoTrue's official container (`supabase/gotrue`, a pinned release, upgraded deliberately) as its own ECS Fargate service. It's small: 0.25 vCPU and 0.5 GB to start, two tasks for availability.
- **Same URLs as today:** a reverse-proxy sidecar (nginx) in the same task serves `https://<api-domain>/auth/v1/*` and strips the `/auth/v1` prefix before GoTrue, as Supabase's Kong gateway does. The app's `supabase-js` client and the backend's `/auth/v1/...` calls work unchanged; only `SUPABASE_URL` changes. Requests reach it through the same Cloudflare Tunnel as the API, which terminates TLS ([ADR-0023](0023-cloudflare-tunnel-no-alb-waf-nat.md), amended 2026-10-24; it was an Application Load Balancer with ACM).
- **Database:** the same RDS PostgreSQL instance as the app, in its own database (`auth`) with its own role (`supabase_auth_admin`). GoTrue runs its own migrations there. The app's tables never share a database with GoTrue's, and one instance means one backup and point-in-time-restore story.
- **Tokens:** asymmetric signing (ES256), with the signing key in AWS Secrets Manager, so GoTrue publishes `/.well-known/jwks.json`. The backend's verification path is unchanged: JWKS, issuer, audience `authenticated`. Access tokens last one hour, and refresh tokens rotate.
- **Providers:**
  - **Email and password,** with confirmation and reset email sent through Amazon SES (SMTP) from the product's domain.
  - **Sign in with Apple:** native on iOS (`expo-apple-authentication` → `signInWithIdToken`). It needs the paid Apple Developer account for the Services ID and signing key. App Store guideline 4.8 requires it whenever Google sign-in is offered on iOS.
  - **Google:** native on iOS and Android (Google Sign-In → `signInWithIdToken`), with OAuth client IDs for iOS, Android and web in the product's Google Cloud project.
- **Secrets and configuration** (signing key, SMTP credentials, Apple and Google client secrets, the service-role key) live in Secrets Manager and are injected into the task. None are in the repo or `.env`.
- **Abuse limits:** GoTrue's built-in rate limits on sign-up, sign-in, OTP and email, keyed on the visitor's address, plus a Cloudflare rate-limiting rule on `/auth/v1/*` (ADR-0023, amended 2026-10-24; it was AWS WAF at the load balancer).
- **Infrastructure as code:** the GoTrue service, its database and role, the secrets and the rate rules are defined in the same infrastructure-as-code stack as the rest of production. Nothing is configured by hand in the console.
- **Local development is unchanged:** the Supabase CLI stack runs the same GoTrue, so tests and the phone in development keep working as they do now.

## Constitution clause deviated from

§4.1 (universal default "Data / Auth / Storage: Supabase") and §2.5 (client-owned Supabase org). Auth stays on GoTrue, the server Supabase itself runs. Only the host changes, from Supabase's platform to the product's own AWS account. Data and storage already follow §2.5's AWS production rule.

## Consequences

**Positive:**
- One cloud, one account, one region for everything in production. Sign-in sits beside the API, so its latency is local.
- No app or backend code changes. The client libraries and the token verification path are the same as with a Supabase project.
- No per-user pricing and no second vendor. The cost is one small Fargate service, roughly USD 10–20 a month for two tasks, plus SES email.
- The exit path is open both ways. GoTrue's `auth` database is standard Postgres, so it can move to a Supabase project, or the other way, by migrating that database.

**Negative:**
- We run it. That means pinning and upgrading GoTrue, watching its health and logs, and rotating the signing key. Infrastructure as code and runbook entries absorb this, but it's real work Supabase would otherwise do.
- There's no Supabase dashboard for auth. Looking up users, banning, or resending email goes through GoTrue's admin API or the product's own admin tools.
- The `/auth/v1` prefix depends on the sidecar proxy. If it's misconfigured, sign-in breaks while the API stays up, so a container health check covers `/auth/v1/health` through the proxy, and an alarm fires when no GoTrue task is running.
- Sign in with Apple and Google need accounts we don't have yet: the paid Apple Developer program, and a Google Cloud project with OAuth consent.

**Follow-ups:**
- Production infrastructure-as-code stack: GoTrue service and sidecar, `auth` database and role, Secrets Manager entries, SES domain verification (SPF, DKIM, DMARC), rate rules, and an `/auth/v1/health` check. Built in `infra/` (ADR-0022, ADR-0023).
- Apple: Services ID, Sign in with Apple key and return URL; revoke the Apple token when an account is deleted (App Store guideline 5.1.1(v)). GoTrue doesn't call Apple's revoke endpoint itself, so the backend's account-deletion path must do it.
- Google: OAuth consent screen and the iOS, Android and web client IDs.
- Mobile: Apple and Google buttons on the sign-in screens calling `signInWithIdToken`.
- Runbook: GoTrue upgrade, signing-key rotation, and user lookup or ban via the admin API.
- ADR-0005 is amended in place to point here for where auth runs in production.
