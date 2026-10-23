# AWS production infrastructure

- **Date:** 2026-10-23, revised 2026-10-24 (Cloudflare Tunnel, no ALB, WAF or NAT, Graviton: [ADR-0023](adr/0023-cloudflare-tunnel-no-alb-waf-nat.md))
- **Code:** [`infra/`](../infra/) (AWS CDK v2, TypeScript, [ADR-0022](adr/0022-aws-cdk-for-infrastructure.md))
- **Plan it implements:** "Production on AWS (plan)" in [13-deployment.md](13-deployment.md), and [ADR-0021](adr/0021-self-hosted-gotrue-on-aws.md) for sign-in
- **Status:** written and verified offline (`cdk synth`, `bun run test`, `cdk diff` against the account, the Cloudflare script in plan-only mode). **Nothing is deployed, and no tunnel or DNS record is created**: the account has no CDK bootstrap and none of these resources.

Account `619648596614`, region `ap-southeast-1` (Singapore).

## How a request arrives

```
phone ──HTTPS──▶ Cloudflare edge (TLS, rate rule) ──tunnel──▶ cloudflared task (AWS, outbound-only)
                                                               ├─ /auth/v1/* ─▶ auth.unfurl.internal:8080 (nginx → GoTrue)
                                                               └─ everything else ─▶ api.unfurl.internal:8000 (FastAPI)
```

Nothing in AWS listens on the internet. There is no load balancer, and no security group admits an internet address. `cloudflared` opens the tunnel outward to Cloudflare, and Cloudflare sends requests down it.

| Public name | What | DNS (Cloudflare) |
|---|---|---|
| `unfurl-api.realsolutionsph.com` | API (`/api/*`) and sign-in (`/auth/v1/*`) | CNAME to `<tunnel id>.cfargotunnel.com`, **proxied** |
| `unfurl.realsolutionsph.com` | SES sending domain (`noreply@`), MAIL FROM `mail.unfurl.realsolutionsph.com`. The name itself is reserved for a landing or web page later, and is GoTrue's site URL | DKIM, MX, SPF and DMARC records, DNS-only |

The API host is single-label under the zone on purpose: Cloudflare's free Universal SSL certificate covers `*.realsolutionsph.com` but not deeper names.

## Sizing: `lean` (up to 5 users) and `production`

`unfurl:profile` in `infra/cdk.json` picks the size. **`lean` is the default: up to 5 users**, the smallest setup that serves them comfortably. `production` is the size planned for launch.

| | **`lean` (default, up to 5 users)** | `production` |
|---|---|---|
| API tasks | 1 × 0.25 vCPU / 0.5 GB, **1 uvicorn worker** | 2 × 0.5 vCPU / 1 GB, 2 workers each |
| Worker (and migrations) | 1 × 0.25 vCPU / 0.5 GB | 1 × 0.5 vCPU / 1 GB |
| GoTrue tasks | 1 × 0.25 vCPU / 0.5 GB | 2 × 0.25 vCPU / 0.5 GB |
| Tunnel (`cloudflared`) tasks | 1 × 0.25 vCPU / 0.5 GB | 2 × 0.25 vCPU / 0.5 GB |
| RDS | `db.t4g.micro` (1 GB) | `db.t4g.small` (2 GB) |
| Cache | `cache.t4g.micro` (the smallest Valkey node) | `cache.t4g.micro` |
| Estimated cost | **≈ USD 92–100 / month** | **≈ USD 180–190 / month** |

All tasks run on Graviton (arm64). In `lean`, every task is at Fargate's smallest size.

**Why 0.5 GB is enough.** These were measured on 2026-10-24 on the backend's virtualenv: macOS arm64, AI and jobs on, after a few hundred warm-up requests. That is not the Linux container, so treat the numbers as close, not exact.

| Process | Memory |
|---|---|
| API, 1 uvicorn worker | ≈ 250 MB |
| API, 2 uvicorn workers + supervisor | ≈ 530 MB, over 0.5 GB, hence 1 worker in `lean` |
| Job worker (`procrastinate`), idle and running jobs | ≈ 30 MB |
| Migrations (`alembic upgrade head`), peak | ≈ 180 MB |
| Seed (`app/initial_data.py`), peak | ≈ 135 MB |

One uvicorn worker still serves concurrent requests: sync routes run in its thread pool and streams are async. For 5 users the API is waiting on Nebius and Deepgram, not computing. If memory runs tight, the `api-memory` and `worker-memory` alarms fire (above 85 % for 15 minutes) before a task is killed, and the next step is configuration.

**Scaling is configuration, not a rebuild.** Either switch the whole profile (`"unfurl:profile": "production"`) or override single values in `infra/cdk.json`, then deploy:

```json
"unfurl:sizingOverrides": { "api": { "count": 2, "cpu": 512, "memoryMiB": 1024, "workers": 2 }, "database": "t4g.small" }
```

Overridable: `api`, `worker`, `gotrue` and `tunnel` (`count`, `cpu`, `memoryMiB`, and `workers` for the API), `database` and `cache`. A typo, an unknown key or a CPU and memory pair Fargate doesn't offer fails `cdk synth`, never deploys a default. A database class change is an RDS modification with a short restart; everything else rolls tasks with no downtime.

What `lean` gives up: with one task per service, a crashed task means a minute or two of outage while ECS replaces it. A deploy still has no downtime, because ECS starts the new task before it stops the old one. With one `cloudflared` connector, a connector restart drops the tunnel for the seconds it takes to reconnect.

## What the stacks define

### `UnfurlCi`: image registry and deploy role

| Resource | Detail |
|---|---|
| ECR repository `unfurl-backend` | Immutable tags (the git SHA), scan on push, keeps the last 30 images |
| GitHub OIDC provider | `token.actions.githubusercontent.com`; the account had none |
| IAM role `unfurl-github-deploy` | Trusts only `repo:Real-Solutions-PH/personal-sop:environment:production`. It can push to the repository, assume the `cdk bootstrap` roles, read the SES identity, and create or update the `unfurl/cloudflared-tunnel` secret. Nothing else |

### `UnfurlProd`: everything that runs

| Part | Resource | Detail |
|---|---|---|
| Network | VPC `10.40.0.0/16`, 2 AZs | **Public subnets** for the tasks (each task gets a public IP: that is its route out, with no NAT) and **isolated subnets** for RDS and the cache. Free S3 gateway endpoint. No NAT, no interface endpoints |
| | Security groups | **None admits an internet address.** `unfurl-tunnel` and `unfurl-worker` admit nothing. `unfurl-api` admits the tunnel on 8000. `unfurl-gotrue` admits the tunnel, the API and the worker on 8080. The DB admits the three task groups on 5432; the cache admits the API and worker on 6379. Egress is listed: 443 (images, Secrets Manager, CloudWatch, S3, provider APIs), 587 (SES SMTP), 7844 TCP/UDP for the tunnel, and the data stores |
| Edge | Cloudflare Tunnel `unfurl` | Created by [`infra/scripts/cloudflare.ts`](../infra/scripts/cloudflare.ts) (next section). The stack runs its connector |
| Compute | ECS cluster `unfurl` (Fargate, arm64) + Cloud Map namespace `unfurl.internal` | API and GoTrue register A records `api.unfurl.internal`, `auth.unfurl.internal` |
| | `unfurl-tunnel` | `cloudflare/cloudflared:2026.10.3`, `tunnel run` with the token from `unfurl/cloudflared-tunnel`. Starts after the API and GoTrue |
| | `unfurl-api` | Backend image, `fastapi run --workers 2` on port 8000. A container health check on `/api/v1/utils/health-check/` makes ECS replace an unhealthy task |
| | `unfurl-worker` | Same image. A one-shot `migrate` container runs `scripts/prestart.sh` (Alembic `upgrade head`, then the seed). The `procrastinate` worker starts only if it succeeds |
| | `unfurl-gotrue` | A one-shot `db-setup` container (the backend image running [`infra/lib/db-setup.ts`](../infra/lib/db-setup.ts)) prepares the database, then `public.ecr.aws/supabase/gotrue:v2.197.0` starts on 127.0.0.1:9999, behind an `nginx:1.31.8-alpine` proxy on 8080 that strips `/auth/v1` and passes `CF-Connecting-IP` to GoTrue as the client address. Health check: `/auth/v1/health` through nginx |
| Data | RDS PostgreSQL **18.6** (matches `pgvector/pgvector:pg18` in compose) | Size per profile, single-AZ (`unfurl:databaseMultiAz` adds a standby), 20 GB gp3 growing to 100 GB, encrypted, isolated. Automated backups kept 7 days, which gives point-in-time restore over that window. Deletion protection on; a snapshot is taken if the stack ever deletes it |
| | Databases and roles | `app` (created by RDS) and `auth`, owned by `supabase_auth_admin`. `app_user` gets LOGIN and its password. All of this is done by the `db-setup` container |
| | ElastiCache (Valkey 8.0) | `cache.t4g.micro`, one node, TLS (`rediss://`) and encryption at rest. Holds the rate-limit buckets too |
| | S3 bucket `unfurl-media-<account>` | Private, TLS only, versioned (old versions kept 30 days). Replaces MinIO; the API presigns uploads and downloads, signing with its task role |
| Email | SES domain identity `unfurl.realsolutionsph.com` | Easy DKIM, custom MAIL FROM `mail.unfurl.realsolutionsph.com`; sender `noreply@unfurl.realsolutionsph.com` |
| | IAM user `unfurl-ses-smtp` | `ses:SendRawEmail` only. Its access key is turned into SES SMTP credentials by the bootstrap function |
| Secrets | Secrets Manager (`unfurl/*`) | See the next table |
| Observability | CloudWatch log groups `/unfurl/{api,worker,gotrue,tunnel}` (30 days), RDS logs, SNS topic `unfurl-alarms` | Alarms: API, sign-in, tunnel or worker with no running task for 10 minutes; API or worker memory > 85 % for 15 minutes (the signal to scale up); DB CPU > 80 %; DB free storage < 2 GB |

### Secrets

| Secret | Holds | Filled by |
|---|---|---|
| `unfurl/db-master` | RDS master user `postgres` | RDS, generated |
| `unfurl/auth-db` | `supabase_auth_admin` password | Secrets Manager, generated |
| `unfurl/app-user-db` | `app_user` password (the RLS-enforced role) | Secrets Manager, generated |
| `unfurl/gotrue` | ES256 signing key (`jwt_keys`), HS256 fallback (`jwt_secret`), `anon_key`, `service_role_key` | `BootstrapSecrets` function, once, at stack creation |
| `unfurl/smtp` | SES SMTP username and password | `BootstrapSecrets` function |
| `unfurl/app` | `first_superuser_password` (generated); `ai_credentials_kek` (bootstrap function); `nebius_api_key`, `deepgram_api_key`, `openrouter_api_key`, `brave_api_key`, `expo_access_token`, `sentry_dsn` | **By hand**, after the first deploy. Empty values reach the backend as unset |
| `unfurl/auth-providers` | Apple and Google client IDs and secrets | **By hand**, once the accounts exist |
| `unfurl/cloudflared-tunnel` | `{"token": …}` for the tunnel | **`infra/scripts/cloudflare.ts`**, which owns it. It's not a CloudFormation resource; the stack reads it by name |

The stack's secrets are kept (`RETAIN`) if the stack is deleted.

### Cloudflare, from code

[`infra/scripts/cloudflare.ts`](../infra/scripts/cloudflare.ts) (`bun run cloudflare`, plan-only unless `--apply`) applies:

| Object | Value |
|---|---|
| Tunnel `unfurl` | Remotely managed; created once |
| Secret `unfurl/cloudflared-tunnel` | The tunnel's token, created or updated in Secrets Manager; never printed |
| Tunnel ingress | `unfurl-api.realsolutionsph.com` + path `^/auth/v1/` → `http://auth.unfurl.internal:8080`; `unfurl-api.realsolutionsph.com` → `http://api.unfurl.internal:8000`; anything else → 404. Idle origin connections kept 300 s |
| `unfurl-api.realsolutionsph.com` CNAME | `<tunnel id>.cfargotunnel.com`, proxied |
| `<token>._domainkey.unfurl.realsolutionsph.com` CNAME ×3 | `<token>.dkim.amazonses.com` (once the stack has created the SES identity) |
| `mail.unfurl.realsolutionsph.com` MX 10 + TXT | `feedback-smtp.ap-southeast-1.amazonses.com`; `v=spf1 include:amazonses.com ~all` |
| `_dmarc.unfurl.realsolutionsph.com` TXT | `v=DMARC1; p=quarantine; adkim=r; aspf=r` |
| Zone rate-limiting rule `unfurl_rate_limit` | 50 requests per 10 s per visitor IP on `/auth/v1/`, `/api/v1/ai/`, `/api/v1/companion/`, `/api/v1/capture/`, `/api/v1/ocr/`, `/api/v1/fitness/meals/estimate`; blocks for 10 s. The Free plan allows one rule and matches on the path only, so it applies zone-wide to those paths, and no other site in the zone uses them |

- **Safe by construction.** It never deletes anything, refuses DNS names outside the API host and the email domain, and leaves an unrelated TXT record at the same name alone. Records carry the comment `managed by infra/scripts/cloudflare.ts`.
- **Order.** It runs **before** `cdk deploy`, because the `cloudflared` service needs the token secret, and **again after**, because the SES DKIM and MAIL FROM records need the identity the deploy creates. The deploy workflow does both.
- **Token.** On the Mac: `CLOUDFLARE_API_TOKEN="$(security find-generic-password -a "$USER" -s cloudflare-api-token -w)"`. Never print it or write it to a file. In CI, the repository secret `CLOUDFLARE_API_TOKEN`. A scoped token needs Account → Cloudflare Tunnel: Edit, Zone → DNS: Edit and Zone → Zone WAF: Edit (for the rate-limiting rule) on `realsolutionsph.com`.
- **Checked (2026-10-24, plan only):** it authenticated to Cloudflare and AWS, read tunnels, the secret and the rate-limit ruleset, and would create the tunnel, secret, ingress, CNAME, DMARC record and rate rule. **Nothing was written.** Whether the Free plan accepts `starts_with` in the rule's expression will only show on the first `--apply`; if it refuses, the rule is the one piece to adjust.

## Rate limits without a WAF

| Layer | What | Where |
|---|---|---|
| Cloudflare | One zone rule: 50 requests / 10 s per visitor IP on the auth and AI paths | `scripts/cloudflare.ts` |
| API, model-backed routes | 20 requests / minute **per user and per visitor IP**: Fern's ask, ask-stream and speech; capture submit, stream, dictate, answer, retry, rerun and resume; the meal estimate; OCR; AI provider tests; the CopilotKit agent run | `RATE_LIMIT_AI_PER_MINUTE`, `guarded("ai", …)` in `backend/app/shared/rate_limit.py` |
| API, account routes | 10 requests / minute per user and per visitor IP: `PATCH /users/me` (can change the email at GoTrue) and `DELETE /users/me` | `RATE_LIMIT_ACCOUNT_PER_MINUTE`, `guarded("account", …)` |
| GoTrue | Its built-in per-address limits on sign-up, sign-in, token refresh, verify, OTP and email, keyed on the visitor IP through nginx | `GOTRUE_RATE_LIMIT_*` in `prod-stack.ts` |

The visitor IP is Cloudflare's `CF-Connecting-IP` (`CLIENT_IP_HEADER`). Only the tunnel can reach the API, so a client can't forge it. The buckets live in Valkey and fail open if it is unreachable. Tests: `backend/tests/shared/test_rate_limit_guards.py` (real Redis buckets: one user from many addresses, one address with many users) and `backend/tests/api/test_rate_limit_guards.py` (every guarded route returns 429 when its guard denies; plain writes and reads don't).

## Decisions

- **Cloudflare Tunnel instead of a load balancer, no WAF, no NAT, Graviton.** Recorded in [ADR-0023](adr/0023-cloudflare-tunnel-no-alb-waf-nat.md), including why there's one `cloudflared` service reaching both services through Cloud Map, instead of a sidecar per task or Service Connect.
- **Database setup runs in the GoTrue task.** It was a Lambda in the VPC; without NAT that Lambda has no route to Secrets Manager. The `db-setup` container gets its secrets injected by ECS, runs idempotent SQL under an advisory lock (two tasks starting together never race), and passes passwords as SQL literals. It was verified on 2026-10-24 against a throwaway Postgres 18 with a non-superuser master like RDS's: two concurrent runs and a rerun, with passwords containing quotes.
- **Migrations run in the worker task, in order.** The worker service is a single task replaced stop-then-start, so two migrations never run at once. The API service depends on it, so CloudFormation updates the API only after the migrated worker is stable.
- **Key material is created inside AWS.** The `BootstrapSecrets` function (outside the VPC) generates GoTrue's P-256 key and signs the `anon` and `service_role` JWTs (ES256, 10-year expiry). It also derives SES SMTP credentials and the AI key-encryption key. It runs on create only; rotation is a runbook step.
- **S3 through the task role** (`OBJECT_STORAGE_IAM_AUTH=true`), not MinIO's static keys.
- **The image tag is the git SHA**, and ECR tags are immutable.

## Backend environment in production

Every setting in `backend/app/core/config.py` is either set by the stack or listed in [`infra/lib/backend-env.ts`](../infra/lib/backend-env.ts) with the reason it isn't. `bun run test` fails when a new setting is in neither place.

**Set by the stack (API, worker and migration get the same set):**

| Variable | Source |
|---|---|
| `ENVIRONMENT` | `production` |
| `PROJECT_NAME`, `EMAILS_FROM_NAME` | `Unfurl` |
| `FRONTEND_HOST` | `https://unfurl.realsolutionsph.com` (`unfurl:siteUrl`, defaulting to the email domain) |
| `FIRST_SUPERUSER` | `unfurl:adminEmail`, default `admin@unfurl.realsolutionsph.com` |
| `FIRST_SUPERUSER_PASSWORD` | Secret `unfurl/app` → `first_superuser_password` |
| `SUPABASE_URL` | `http://auth.unfurl.internal:8080`: GoTrue over the private network, not out through Cloudflare and back |
| `SUPABASE_JWT_ISSUER` | `https://unfurl-api.realsolutionsph.com/auth/v1`, the issuer GoTrue puts in the tokens |
| `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Secret `unfurl/gotrue` |
| `POSTGRES_SERVER`, `POSTGRES_PORT` | RDS endpoint |
| `POSTGRES_DB`, `POSTGRES_USER` | `app`, `postgres` |
| `POSTGRES_PASSWORD` | Secret `unfurl/db-master` |
| `POSTGRES_APP_USER`, `POSTGRES_APP_PASSWORD` | `app_user`, secret `unfurl/app-user-db`. Tenant RLS is enforced from the first deploy |
| `REDIS_URL` | `rediss://<cache endpoint>:6379/0` |
| `CLIENT_IP_HEADER` | `CF-Connecting-IP` |
| `RATE_LIMIT_AI_PER_MINUTE`, `RATE_LIMIT_ACCOUNT_PER_MINUTE` | `20`, `10` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_SSL` | `email-smtp.ap-southeast-1.amazonaws.com`, `587`, `true`, `false` |
| `SMTP_USER`, `SMTP_PASSWORD` | Secret `unfurl/smtp` |
| `EMAILS_FROM_EMAIL` | `noreply@unfurl.realsolutionsph.com` |
| `OBJECT_STORAGE_IAM_AUTH` | `true` |
| `MINIO_ENDPOINT`, `MINIO_REGION` | `https://s3.ap-southeast-1.amazonaws.com`, `ap-southeast-1` |
| `MINIO_DEFAULT_BUCKET`, `MEDIA_BUCKET`, `OCR_BUCKET` | The media bucket |
| `AI_ENABLED`, `AI_SERVER_FALLBACK`, `JOBS_ENABLED`, `PUSH_ENABLED` | `true` |
| `OCR_ENABLED` | `false` |
| `DEFAULT_LLM_PROVIDER` | `nebius` |
| `NEBIUS_API_KEY`, `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `BRAVE_API_KEY`, `EXPO_ACCESS_TOKEN`, `SENTRY_DSN` | Secret `unfurl/app`, filled by hand |
| `AI_CREDENTIALS_KEK` | Secret `unfurl/app`, generated |
| `FORWARDED_ALLOW_IPS` | `*` (read by uvicorn, not config.py): only the tunnel can reach the API |

**Left at the code default** (reasons in `backend-env.ts`): model names and base URLs, media size limits, event and weather timings, `DEFAULT_TENANT_SLUG`, `MAX_REQUEST_BODY_SIZE_MB`, the OCR settings (OCR is off), `MEDIA_PUBLIC_ENDPOINT` (S3's endpoint is already public), `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` (unused under IAM auth), `BACKEND_CORS_ORIGINS` (no browser client yet), and `RATE_LIMIT_PER_MINUTE`. That one stays 0: its bucket is per tenant and every user is in the one default tenant, so any budget would be global. The per-user and per-address guards above replace it.

**Not fillable yet:**

| Variable | Why |
|---|---|
| `SUPABASE_AUTH_HOOK_SECRET` | It signs a Supabase Database Webhook on `auth.users`, a feature of Supabase's platform that self-hosted GoTrue on RDS doesn't have. Account deletion from the app still works: the backend deletes the GoTrue identity, then its own rows. A user deleted directly in GoTrue (admin API) keeps a local row until a replacement (a trigger on `auth.users` or a reconcile job) is built |
| `NEBIUS_API_KEY`, `DEEPGRAM_API_KEY`, and the other third-party keys | Values exist only with their owners; put them in `unfurl/app` after the first deploy |
| Apple and Google client IDs and secrets | The accounts don't exist yet |

## Still blocked

| Item | Blocked on | What to do when unblocked |
|---|---|---|
| Tunnel, DNS records, rate rule | The user's go (first deploy) | `bun run cloudflare --apply` creates them (see "First deploy") |
| `CLOUDFLARE_API_TOKEN` in GitHub | The user adding the repository secret | A token scoped to Tunnel, DNS and Zone WAF edit, not the account-wide one |
| Email to real users | SES sandbox | Request SES production access for `ap-southeast-1` (a support form, not infrastructure) |
| Sign in with Apple | Apple Developer account setup | Services ID and key → put them in `unfurl/auth-providers`, set `unfurl:appleSignIn: true`, deploy |
| Google sign-in | Google Cloud OAuth consent and client IDs | Put them in `unfurl/auth-providers`, set `unfurl:googleSignIn: true`, deploy |
| Alarm emails | An address | Set `unfurl:alertEmail`, deploy, confirm the SNS email |
| External uptime check | Not built | There's no load balancer health check any more; add a Cloudflare health check or a scheduled probe when paying users depend on it |
| Web frontend | Not in scope | Next.js isn't deployed; mobile is the client |

## Estimated monthly cost

On-demand prices for `ap-southeast-1`, 730 hours a month, low traffic. These rates were read from the AWS Pricing API: Fargate **Graviton** at $0.04045 per vCPU-hour and $0.00442 per GB-hour (2026-10-24; x86 is $0.05056 and $0.00553), RDS `db.t4g.micro` $0.025/h and `db.t4g.small` $0.051/h, ElastiCache $0.0192/h, public IPv4 $0.005/h, and Cloud Map $0.10 per registered instance plus $0.50 for its private hosted zone. Storage and the small items use AWS's published list prices. This is an estimate, not a bill. Cloudflare costs nothing (Free plan, one tunnel, one rate rule).

| Item | **`lean` (up to 5 users)** | `production` |
|---|---|---|
| Fargate: API | 1 × (0.25 vCPU, 0.5 GB): 9 | 2 × (0.5 vCPU, 1 GB): 36 |
| Fargate: worker | 0.25 vCPU, 0.5 GB: 9 | 0.5 vCPU, 1 GB: 18 |
| Fargate: GoTrue | 1 × (0.25 vCPU, 0.5 GB): 9 | 2 ×: 18 |
| Fargate: tunnel (`cloudflared`) | 1 × (0.25 vCPU, 0.5 GB): 9 | 2 ×: 18 |
| Public IPv4, one per task | 4 × $3.65: 15 | 7 × $3.65: 26 |
| RDS (single-AZ, 20 GB gp3) | `db.t4g.micro`: 21 | `db.t4g.small`: 40 |
| ElastiCache Valkey `cache.t4g.micro` | 14 | 14 |
| Cloud Map (private DNS) | 1 | 1 |
| Secrets Manager (8 secrets) | 3 | 3 |
| CloudWatch (8 alarms, logs) | 2–4 | 3–6 |
| S3, SES, ECR, SNS, Lambda | < 3 | < 5 |
| **Total (USD / month)** | **≈ 92–100** | **≈ 180–190** |

In `lean`, the four tasks together are 36; the fixed floor is the database (21), the per-task IPv4 addresses (15) and the cache (14).

**How the estimate got here:**

| Design | `lean` | `production` |
|---|---|---|
| ALB, WAF, ACM, NAT, x86 (PR #63) | ≈ 140–150 | ≈ 240–260 |
| Cloudflare Tunnel, no WAF or NAT, Graviton (PR #66) | ≈ 105–115 | ≈ 180–190 |
| **Same, `lean` resized for up to 5 users (smallest Fargate size everywhere, 1 uvicorn worker)** | **≈ 92–100** | ≈ 180–190 |

The tunnel design removed the ALB (24, plus 7 for its IPv4 addresses), the WAF (10), the NAT (5 as an instance or 43 as a gateway, plus its IPv4) and the x86 premium (about 9 in `lean`, 17 in `production`). It added the tunnel tasks (9 each), a public IPv4 address per task (3.65 each) and Cloud Map (1). The 5-user sizing then took the API from 0.5 vCPU / 1 GB to 0.25 / 0.5 (−9) and the worker from 1 GB to 0.5 GB (−2).

Further levers: Fargate Spot for the worker; a Compute Savings Plan; IPv6 egress to drop the per-task IPv4 charge (15 to 26 a month). Below `lean`, the next cuts are architectural (no separate cache, a smaller database engine), not sizing.

## First deploy

None of this has been run. Each step creates billable resources or writes to Cloudflare, so each needs a go.

```bash
cd infra && bun install
```

1. Bootstrap CDK in the account (an S3 staging bucket, an ECR assets repo and the deploy roles):

```bash
env -u HTTPS_PROXY -u HTTP_PROXY bunx cdk bootstrap aws://619648596614/ap-southeast-1 --profile unfurl
```

2. Create the registry and the deploy role:

```bash
env -u HTTPS_PROXY -u HTTP_PROXY bunx cdk deploy UnfurlCi --profile unfurl
```

3. In GitHub: create the environment `production` (add required reviewers if a second approval is wanted), set the repository variable `AWS_DEPLOY_ROLE_ARN` to the `DeployRoleArn` output from step 2, and add the repository secret `CLOUDFLARE_API_TOKEN`.

4. Run the **Deploy to AWS** workflow with `ref` = `master`. It builds and pushes the arm64 backend image, runs the Cloudflare script (tunnel, token secret, ingress, DNS, rate rule), runs `cdk deploy UnfurlProd`, then runs the script again for the SES records. To do the same from the Mac instead (Apple Silicon builds arm64 natively):

```bash
TAG=$(git rev-parse --short=12 HEAD); REPO=619648596614.dkr.ecr.ap-southeast-1.amazonaws.com/unfurl-backend
env -u HTTPS_PROXY -u HTTP_PROXY aws ecr get-login-password --profile unfurl --region ap-southeast-1 | docker login --username AWS --password-stdin 619648596614.dkr.ecr.ap-southeast-1.amazonaws.com
docker buildx build --platform linux/arm64 -f backend/Dockerfile -t "$REPO:$TAG" --push .
cd infra
export AWS_PROFILE=unfurl CLOUDFLARE_API_TOKEN="$(security find-generic-password -a "$USER" -s cloudflare-api-token -w)"
env -u HTTPS_PROXY -u HTTP_PROXY bun run cloudflare --apply
env -u HTTPS_PROXY -u HTTP_PROXY bunx cdk deploy UnfurlProd -c unfurl:imageTag=$TAG
env -u HTTPS_PROXY -u HTTP_PROXY bun run cloudflare --apply
```

5. Put the third-party keys in, merging into the existing JSON so generated fields are kept, then restart the backend services so they read them:

```bash
CUR=$(env -u HTTPS_PROXY -u HTTP_PROXY aws secretsmanager get-secret-value --secret-id unfurl/app --profile unfurl --region ap-southeast-1 --query SecretString --output text)
echo "$CUR" | jq --arg n "<nebius key>" --arg d "<deepgram key>" '.nebius_api_key=$n | .deepgram_api_key=$d' > /tmp/unfurl-app.json
env -u HTTPS_PROXY -u HTTP_PROXY aws secretsmanager put-secret-value --secret-id unfurl/app --secret-string file:///tmp/unfurl-app.json --profile unfurl --region ap-southeast-1 && rm /tmp/unfurl-app.json
for s in unfurl-api unfurl-worker; do env -u HTTPS_PROXY -u HTTP_PROXY aws ecs update-service --cluster unfurl --service $s --force-new-deployment --profile unfurl --region ap-southeast-1 >/dev/null; done
```

6. Check: `curl https://unfurl-api.realsolutionsph.com/api/v1/utils/health-check/` and `curl https://unfurl-api.realsolutionsph.com/auth/v1/health` both return 200.

The first `UnfurlProd` deploy takes roughly 20 minutes, mostly RDS. CloudFormation rolls the whole stack back if any service fails to stabilise. RDS (deletion protection, snapshot on delete), the media bucket, the secrets and the log groups are retained by design, so a failed first create can leave them behind for cleanup.

## Later deploys

Run the **Deploy to AWS** workflow with the tag or SHA to ship. It never runs on push, merge or tag (constitution §2.2). Read `cdk diff` in the pull request that changes `infra/` before deploying it:

```bash
cd infra && env -u HTTPS_PROXY -u HTTP_PROXY bunx cdk diff --profile unfurl -c unfurl:imageTag=<deployed tag>
```
