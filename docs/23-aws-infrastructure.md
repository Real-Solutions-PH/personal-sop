# AWS production infrastructure

- **Date:** 2026-10-23
- **Code:** [`infra/`](../infra/) (AWS CDK v2, TypeScript, [ADR-0022](adr/0022-aws-cdk-for-infrastructure.md))
- **Plan it implements:** "Production on AWS (plan)" in [13-deployment.md](13-deployment.md), and [ADR-0021](adr/0021-self-hosted-gotrue-on-aws.md) for sign-in
- **Status:** written and verified offline (`cdk synth`, `bun run test`, `cdk diff` against the account, and the Cloudflare DNS script in plan-only mode). **Nothing is deployed yet and no DNS record is written**: the account has no CDK bootstrap and none of these resources.

Account `619648596614`, region `ap-southeast-1` (Singapore).

| Public name | What | DNS (Cloudflare) |
|---|---|---|
| `unfurl-api.realsolutionsph.com` | API (`/api/*`) and sign-in (`/auth/v1/*`) on the ALB | CNAME to the ALB, **proxied**, SSL Full (strict) for this host only |
| `unfurl.realsolutionsph.com` | SES sending domain (`noreply@`), MAIL FROM `mail.unfurl.realsolutionsph.com`. The name itself is reserved for a landing or web page later, and is GoTrue's site URL | DKIM, MX, SPF and DMARC records, DNS-only |

The API host is single-label under the zone on purpose: Cloudflare's free Universal SSL certificate covers `*.realsolutionsph.com` but not deeper names.

### Two sizing profiles

`unfurl:profile` in `infra/cdk.json` picks the size. **`lean` is the default** for the first deploy: one user, before launch. `production` is the size planned for launch. Switching is that one value and a deploy; the database class change is an RDS modification with a short restart.

| | `lean` (default) | `production` |
|---|---|---|
| API tasks | 1 × 0.5 vCPU / 1 GB | 2 × 0.5 vCPU / 1 GB |
| Worker (and migrations) | 1 × 0.25 vCPU / 1 GB | 1 × 0.5 vCPU / 1 GB |
| GoTrue tasks | 1 × 0.25 vCPU / 0.5 GB | 2 × 0.25 vCPU / 0.5 GB |
| RDS | `db.t4g.micro` (2 vCPU burstable, 1 GB) | `db.t4g.small` (2 GB) |
| Cache | `cache.t4g.micro` (the smallest node) | `cache.t4g.micro` |
| NAT | **t4g.nano NAT instance** | Managed NAT gateway |
| Estimated cost | **≈ USD 140–150 / month** | **≈ USD 240–260 / month** |

What `lean` gives up:
- **One task per service.** A deploy still has no downtime, because ECS starts the new task before it stops the old one. A task that crashes means a minute or two of outage while ECS replaces it.
- **A 1 GB database.** That's fine for one user and the pgvector memory table at this size. Watch the `db-cpu` alarm and the RDS `FreeableMemory` metric.
- **A NAT instance instead of a gateway.** About USD 4 against USD 43 a month. It has no redundancy, and its network is burstable: about 32 Mbit/s baseline, bursting to 5 Gbit/s on credits. That's plenty for API calls to Nebius and Deepgram. Image pulls from ECR also go through it, so a task start can take a little longer once the burst credits run out. If the instance stops, egress stops until it's replaced. It keeps the same Elastic IP as the gateway would, so the WAF exemption doesn't change.

## What the stacks define

### `UnfurlCi`: image registry and deploy role

| Resource | Detail |
|---|---|
| ECR repository `unfurl-backend` | Immutable tags (the git SHA), scan on push, keeps the last 30 images |
| GitHub OIDC provider | `token.actions.githubusercontent.com`; the account had none |
| IAM role `unfurl-github-deploy` | Trusts only `repo:Real-Solutions-PH/personal-sop:environment:production`. It can push to the repository and assume the `cdk bootstrap` roles, nothing else |

### `UnfurlProd`: everything that runs

| Part | Resource | Detail |
|---|---|---|
| Network | VPC `10.40.0.0/16`, 2 AZs | Public subnets (ALB, NAT), private subnets with egress (tasks, setup function), isolated subnets (RDS, cache) |
| | **One NAT** (instance in `lean`, gateway in `production`) on a fixed Elastic IP, plus an S3 gateway endpoint | See "Decisions" below |
| Edge | Cloudflare (proxied) → Application Load Balancer | `/api/*` → API, `/auth/v1/*` → GoTrue, anything else 404. HTTPS only, on 443, with an ACM certificate for `unfurl-api.realsolutionsph.com`. The ALB's security group admits **only Cloudflare's published IPv4 ranges** (`infra/lib/cloudflare.ts`). Idle timeout 300 s. Cloudflare's own proxied-connection timeout is 100 s, and the server-sent-event streams (`/events/stream`, `/companion/ask/stream`) send a heartbeat every 25 s, so they stay open |
| | AWS WAF web ACL | AWS IP-reputation and known-bad-inputs rule groups; per-visitor rate limits (5-minute window): `/auth/v1/*` 300, AI routes (`/api/v1/{ai,agents,chat,companion,capture,ocr}/`) 300, everything 3,000. Behind Cloudflare the WAF counts by `CF-Connecting-IP` (the visitor), not by the connecting Cloudflare edge. The NAT address is exempt from the auth limit, because the API's own GoTrue calls leave through NAT and come back in through Cloudflare |
| Compute | ECS cluster `unfurl` (Fargate) | |
| | `unfurl-api` | Backend image, `fastapi run --workers 2` on port 8000; task count and size per profile; rolling deploy with circuit-breaker rollback; ALB health check `/api/v1/utils/health-check/` |
| | `unfurl-worker` | Same image. A one-shot `migrate` container runs `scripts/prestart.sh` (Alembic `upgrade head`, then the seed); the `procrastinate` worker starts only if it succeeds. One task |
| | `unfurl-gotrue` | `public.ecr.aws/supabase/gotrue:v2.197.0` on 127.0.0.1:9999, plus an `nginx:1.31.8-alpine` sidecar on 8080 that strips `/auth/v1` and passes `CF-Connecting-IP` to GoTrue as the client address. ALB health check `/auth/v1/health` |
| Data | RDS PostgreSQL **18.6** (matches `pgvector/pgvector:pg18` in compose) | `db.t4g.micro` (`lean`) or `db.t4g.small` (`production`), single-AZ (`unfurl:databaseMultiAz` switches on a standby), 20 GB gp3 growing to 100 GB, encrypted, private. Automated backups kept 7 days, which gives point-in-time restore over that window. Deletion protection on; a snapshot is taken if the stack ever deletes it |
| | Databases and roles | `app` (created by RDS) and `auth`, owned by `supabase_auth_admin`, created by the `DbSetup` custom resource, which also gives `app_user` LOGIN and its password |
| | ElastiCache (Valkey 8.0) | `cache.t4g.micro`, one node, TLS (`rediss://`) and encryption at rest. Replaces the compose `redis` |
| | S3 bucket `unfurl-media-<account>` | Private, TLS only, versioned (old versions kept 30 days). Replaces MinIO; the API presigns uploads and downloads as today, signing with its task role |
| Email | SES domain identity `unfurl.realsolutionsph.com` | Easy DKIM, custom MAIL FROM `mail.unfurl.realsolutionsph.com`; sender `noreply@unfurl.realsolutionsph.com`. Its DNS records go into Cloudflare (next section) |
| | IAM user `unfurl-ses-smtp` | `ses:SendRawEmail` only. Its access key is turned into SES SMTP credentials by the bootstrap function |
| Secrets | Secrets Manager (`unfurl/*`) | See the next table |
| Observability | CloudWatch log groups `/unfurl/{api,worker,gotrue}` (30 days), RDS logs, SNS topic `unfurl-alarms` | Alarms: API unhealthy / no healthy API, sign-in unhealthy / no healthy sign-in, API 5xx ≥ 20 in 5 min, worker not running, DB CPU > 80 %, DB free storage < 2 GB |

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

Secrets are kept (`RETAIN`) if the stack is deleted.

### DNS on Cloudflare

The zone `realsolutionsph.com` is on Cloudflare, not Route 53, so the stack can't create its own records. [`infra/scripts/cloudflare-dns.ts`](../infra/scripts/cloudflare-dns.ts) reads the live AWS resources by name (the newest ACM certificate for the API host, the `unfurl` ALB, the SES identity) and makes Cloudflare match:

| Record | Value | Proxied |
|---|---|---|
| ACM validation CNAME (`_<hash>.unfurl-api…`) | ACM's validation target | no |
| `unfurl-api.realsolutionsph.com` CNAME | the ALB's DNS name | **yes** |
| `<token>._domainkey.unfurl.realsolutionsph.com` CNAME ×3 | `<token>.dkim.amazonses.com` | no |
| `mail.unfurl.realsolutionsph.com` MX 10 | `feedback-smtp.ap-southeast-1.amazonses.com` | no |
| `mail.unfurl.realsolutionsph.com` TXT | `v=spf1 include:amazonses.com ~all` | no |
| `_dmarc.unfurl.realsolutionsph.com` TXT | `v=DMARC1; p=quarantine; adkim=r; aspf=r` | no |
| Configuration Rule `unfurl_api_ssl_strict` | SSL **Full (strict)** when `http.host eq "unfurl-api.realsolutionsph.com"` | — |

- **Zone SSL mode is left alone.** The zone runs SSL "Full" today, and another proxied site depends on it, so strict mode is set for the API host only, by a Configuration Rule (available on the Free plan).
- **Safe by construction.** The script never deletes a record, refuses any name outside the API host and the email domain, and leaves an unrelated TXT record at the same name alone. Without `--apply` it only prints the plan. Every record it writes carries the comment `managed by infra/scripts/cloudflare-dns.ts`.
- **When it runs.** CloudFormation waits on the ACM certificate until its validation CNAME resolves, and that name only exists once the deploy has requested the certificate. So the script runs beside `cdk deploy` with `--apply --watch`: it re-reads AWS every 30 s and exits when the certificate is issued and the ALB and SES records are in place. The deploy workflow does this; on later deploys everything already matches and it exits at once.
- **Token.** On the Mac: `CLOUDFLARE_API_TOKEN="$(security find-generic-password -a "$USER" -s cloudflare-api-token -w)"`. Never print it or write it to a file. In CI, the repository secret `CLOUDFLARE_API_TOKEN`; a token limited to Zone → DNS → Edit and Zone → Config Rules → Edit on `realsolutionsph.com` is enough.
- **Checked:** plan-only mode ran against the real zone and AWS account on 2026-10-23. It authenticated to both, found no Unfurl records and no AWS resources yet, and would create only the DMARC record and the SSL rule. **No record has been written.**
- **Cloudflare's IP ranges** are pinned in `infra/lib/cloudflare.ts` (read 2026-10-23). The script warns when Cloudflare's published list changes; update the file and deploy.

## Decisions

- **One NAT, not VPC endpoints.** The tasks must reach the internet anyway: Nebius, Deepgram, Expo push, and Apple's and Google's token checks. So interface endpoints couldn't replace NAT. They would only add cost: ECR API, ECR Docker, CloudWatch Logs and Secrets Manager in two AZs come to roughly USD 60–75 a month. `lean` uses a t4g.nano NAT instance (CDK's `NatProvider.instanceV2`, about USD 4 a month); `production` a managed NAT gateway (about USD 43 a month plus USD 0.059 per GB, and it scales and heals itself). S3 traffic skips NAT through the free gateway endpoint. Either way, if the NAT's AZ fails, egress stops until it is replaced.
- **Behind Cloudflare, trust `CF-Connecting-IP`.** The ALB only accepts connections from Cloudflare's ranges, so that header holds the visitor's address. The WAF rate rules key on it, and nginx hands it to GoTrue as `X-Real-IP` for GoTrue's own per-IP limits.
- **Database setup is a custom resource, not a one-off task.** A Lambda function in the VPC (`infra/lambda/db-setup.ts`) runs idempotent SQL on every create and on every change to its `Version` property. It creates the `supabase_auth_admin` role, the `auth` database and schema, NOLOGIN `anon` / `authenticated` / `service_role` roles for GoTrue's migration grants, and gives `app_user` LOGIN with its password. Because it runs inside the deploy, there's no manual step and nothing to forget. GoTrue runs its own migrations on start.
- **Migrations run in the worker task, in order.** The worker service is a single task replaced stop-then-start, so two migrations never run at once. The API service depends on it, so CloudFormation updates the API only after the migrated worker is stable. A failed migration stops the worker task, the circuit breaker rolls the deploy back, and the API never sees the new code.
- **Key material is created inside AWS.** The `BootstrapSecrets` function (`infra/lambda/bootstrap-secrets.ts`) generates GoTrue's P-256 key and signs the `anon` and `service_role` JWTs with it (ES256, 10-year expiry, as Supabase does). It also derives SES SMTP credentials and the AI key-encryption key. None of it passes through the CloudFormation template. It runs on create only; rotation is a runbook step.
- **S3 through the task role.** A new backend setting, `OBJECT_STORAGE_IAM_AUTH=true`, makes the same boto3 client use the ECS task role instead of MinIO's static keys, and skips the MinIO default-key guard (the keys are never sent).
- **The image tag is the git SHA.** ECR tags are immutable, so a deployed tag always means the same bytes, and a redeploy of the same commit reuses its image.

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
| `SUPABASE_URL` | `https://unfurl-api.realsolutionsph.com`. The backend reaches GoTrue the way the app does, through Cloudflare and the ALB at `/auth/v1` |
| `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Secret `unfurl/gotrue` |
| `POSTGRES_SERVER`, `POSTGRES_PORT` | RDS endpoint |
| `POSTGRES_DB`, `POSTGRES_USER` | `app`, `postgres` |
| `POSTGRES_PASSWORD` | Secret `unfurl/db-master` |
| `POSTGRES_APP_USER`, `POSTGRES_APP_PASSWORD` | `app_user`, secret `unfurl/app-user-db`. Tenant RLS is enforced from the first deploy |
| `REDIS_URL` | `rediss://<cache endpoint>:6379/0` |
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
| `FORWARDED_ALLOW_IPS` | `*` (read by uvicorn, not config.py): only the ALB can reach the tasks |

**Left at the code default** (reasons in `backend-env.ts`): model names and base URLs, media size limits, event and weather timings, `DEFAULT_TENANT_SLUG`, `MAX_REQUEST_BODY_SIZE_MB`, the OCR settings (OCR is off), `MEDIA_PUBLIC_ENDPOINT` (S3's endpoint is already public), `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` (unused under IAM auth), `SUPABASE_JWT_ISSUER` (GoTrue's issuer equals `SUPABASE_URL/auth/v1`), `BACKEND_CORS_ORIGINS` (no browser client yet), and `RATE_LIMIT_PER_MINUTE`. That one stays 0 because the bucket is per tenant and every user is in the one default tenant, so any budget would be global; WAF limits per IP instead.

**Not fillable yet:**

| Variable | Why |
|---|---|
| `SUPABASE_AUTH_HOOK_SECRET` | It signs a Supabase Database Webhook on `auth.users`, a feature of Supabase's platform that self-hosted GoTrue on RDS doesn't have. Account deletion from the app still works: the backend deletes the GoTrue identity, then its own rows. A user deleted directly in GoTrue (admin API) keeps a local row until a replacement (a trigger on `auth.users` or a reconcile job) is built |
| `NEBIUS_API_KEY`, `DEEPGRAM_API_KEY`, and the other third-party keys | Values exist only with their owners; put them in `unfurl/app` after the first deploy |
| Apple and Google client IDs and secrets | The accounts don't exist yet |

## Still blocked

| Item | Blocked on | What to do when unblocked |
|---|---|---|
| Cloudflare records written | The user's go (first deploy) | The DNS script writes them during the first deploy (see "First deploy") |
| `CLOUDFLARE_API_TOKEN` in GitHub | The user adding the repository secret | Ideally a DNS- and Config-Rules-only token for the zone, not the account-wide one |
| Email to real users | SES sandbox | Request SES production access for `ap-southeast-1` (a support form, not infrastructure) |
| Sign in with Apple | Paid Apple Developer account | Services ID and key → put them in `unfurl/auth-providers`, set `unfurl:appleSignIn: true`, deploy |
| Google sign-in | Google Cloud OAuth consent and client IDs | Put them in `unfurl/auth-providers`, set `unfurl:googleSignIn: true`, deploy |
| Alarm emails | An address | Set `unfurl:alertEmail`, deploy, confirm the SNS email |
| Web frontend | Not in scope | Next.js isn't deployed; mobile is the client. `BACKEND_CORS_ORIGINS` stays empty |

## Estimated monthly cost

On-demand prices for `ap-southeast-1`, 730 hours a month, low traffic. These rates were read from the AWS Pricing API on 2026-10-23: Fargate ($0.05056 per vCPU-hour, $0.00553 per GB-hour), RDS (`db.t4g.micro` $0.025/h, `db.t4g.small` $0.051/h), ElastiCache ($0.0192/h), NAT gateway ($0.059/h), EC2 `t4g.nano` ($0.0053/h) and public IPv4 ($0.005/h). The ALB, WAF, gp3 storage and the small items use AWS's published list prices. This is an estimate, not a bill. Cloudflare costs nothing (Free plan).

| Item | `lean` | `production` |
|---|---|---|
| Fargate: API | 1 × (0.5 vCPU, 1 GB): 22 | 2 × (0.5 vCPU, 1 GB): 45 |
| Fargate: worker | 0.25 vCPU, 1 GB: 13 | 0.5 vCPU, 1 GB: 22 |
| Fargate: GoTrue | 1 × (0.25 vCPU, 0.5 GB): 11 | 2 × (0.25 vCPU, 0.5 GB): 22 |
| NAT | t4g.nano instance + 8 GB disk: 5 | gateway: 43, plus $0.059/GB |
| Application Load Balancer | $0.0252/h + about 1 LCU: 24 | 24 |
| RDS (single-AZ, 20 GB gp3) | `db.t4g.micro`: 21 | `db.t4g.small`: 40 |
| ElastiCache Valkey `cache.t4g.micro` | 14 | 14 |
| Public IPv4 (NAT, ALB in 2 AZs) | 3 × $0.005/h: 11 | 11 |
| WAF (web ACL, 5 rules, requests) | 10 | 10 |
| Secrets Manager (7 secrets) | 3 | 3 |
| CloudWatch (8 alarms, logs) | 3–6 | 3–6 |
| S3, SES, ECR, SNS, Lambda | < 5 | < 5 |
| **Total (USD / month)** | **≈ 140–150** | **≈ 240–260** |

Further levers, in either profile: Fargate on Graviton (about −20 % of compute, needs an arm64 image build), Fargate Spot for the worker, a Compute Savings Plan. Dropping WAF would save 10, but it's the only per-visitor rate limit in front of the AI routes, so it stays. Multi-AZ RDS adds about +20 (`lean`) or +40 (`production`).

## First deploy

None of this has been run. Each step creates billable resources, so each needs a go.

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

4. Run the **Deploy to AWS** workflow with `ref` = `master`. It builds and pushes the backend image, then runs `cdk deploy UnfurlProd` with the DNS script beside it, which writes the Cloudflare records as each AWS resource appears. To do the same from a laptop instead (the DNS script runs in the background while the deploy waits on the certificate):

```bash
TAG=$(git rev-parse --short=12 HEAD); REPO=619648596614.dkr.ecr.ap-southeast-1.amazonaws.com/unfurl-backend
env -u HTTPS_PROXY -u HTTP_PROXY aws ecr get-login-password --profile unfurl --region ap-southeast-1 | docker login --username AWS --password-stdin 619648596614.dkr.ecr.ap-southeast-1.amazonaws.com
docker buildx build --platform linux/amd64 -f backend/Dockerfile -t "$REPO:$TAG" --push .
cd infra
export AWS_PROFILE=unfurl CLOUDFLARE_API_TOKEN="$(security find-generic-password -a "$USER" -s cloudflare-api-token -w)"
env -u HTTPS_PROXY -u HTTP_PROXY bun run dns --apply --watch > /tmp/unfurl-dns.log 2>&1 &
env -u HTTPS_PROXY -u HTTP_PROXY bunx cdk deploy UnfurlProd -c unfurl:imageTag=$TAG
wait; cat /tmp/unfurl-dns.log
```

5. Put the third-party keys in, merging into the existing JSON so generated fields are kept, then restart the backend services so they read them:

```bash
CUR=$(env -u HTTPS_PROXY -u HTTP_PROXY aws secretsmanager get-secret-value --secret-id unfurl/app --profile unfurl --region ap-southeast-1 --query SecretString --output text)
echo "$CUR" | jq --arg n "<nebius key>" --arg d "<deepgram key>" '.nebius_api_key=$n | .deepgram_api_key=$d' > /tmp/unfurl-app.json
env -u HTTPS_PROXY -u HTTP_PROXY aws secretsmanager put-secret-value --secret-id unfurl/app --secret-string file:///tmp/unfurl-app.json --profile unfurl --region ap-southeast-1 && rm /tmp/unfurl-app.json
for s in unfurl-api unfurl-worker; do env -u HTTPS_PROXY -u HTTP_PROXY aws ecs update-service --cluster unfurl --service $s --force-new-deployment --profile unfurl --region ap-southeast-1 >/dev/null; done
```

6. Check: `curl https://unfurl-api.realsolutionsph.com/api/v1/utils/health-check/` and `curl https://unfurl-api.realsolutionsph.com/auth/v1/health` both return 200.

The first `UnfurlProd` deploy takes roughly 20–30 minutes, mostly RDS and the certificate validation. CloudFormation rolls the whole stack back if any service fails to stabilise. RDS (deletion protection, snapshot on delete), the media bucket, the secrets and the log groups are retained by design, so a failed first create can leave them behind for cleanup.

## Later deploys

Run the **Deploy to AWS** workflow with the tag or SHA to ship. It never runs on push, merge or tag (constitution §2.2). Read `cdk diff` in the pull request that changes `infra/` before deploying it:

```bash
cd infra && env -u HTTPS_PROXY -u HTTP_PROXY bunx cdk diff --profile unfurl -c unfurl:imageTag=<deployed tag>
```
