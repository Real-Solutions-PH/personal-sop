# AWS production infrastructure

- **Date:** 2026-10-23
- **Code:** [`infra/`](../infra/) (AWS CDK v2, TypeScript, [ADR-0022](adr/0022-aws-cdk-for-infrastructure.md))
- **Plan it implements:** "Production on AWS (plan)" in [13-deployment.md](13-deployment.md), and [ADR-0021](adr/0021-self-hosted-gotrue-on-aws.md) for sign-in
- **Status:** written and verified offline (`cdk synth`, `bun run test`, `cdk diff` against the account). **Nothing is deployed yet**: the account has no CDK bootstrap and none of these resources.

Account `619648596614`, region `ap-southeast-1` (Singapore).

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
| | **One NAT gateway** + S3 gateway endpoint | See "Decisions" below |
| Edge | Application Load Balancer | `/api/*` → API, `/auth/v1/*` → GoTrue, anything else 404. Idle timeout **300 s** for the server-sent-event streams. HTTPS on `api.<domain>` with an ACM certificate once a domain is set; plain HTTP on the ALB's own name until then |
| | AWS WAF web ACL | AWS IP-reputation and known-bad-inputs rule groups; per-IP rate limits (5-minute window): `/auth/v1/*` 300, AI routes (`/api/v1/{ai,agents,chat,companion,capture,ocr}/`) 300, everything 3,000. The NAT address is exempt from the auth limit because the API's own GoTrue calls come back in through the ALB |
| Compute | ECS cluster `unfurl` (Fargate) | |
| | `unfurl-api` | Backend image, `fastapi run --workers 2` on port 8000; 2 tasks × 0.5 vCPU / 1 GB; rolling deploy with circuit-breaker rollback; ALB health check `/api/v1/utils/health-check/` |
| | `unfurl-worker` | Same image. A one-shot `migrate` container runs `scripts/prestart.sh` (Alembic `upgrade head`, then the seed); the `procrastinate` worker starts only if it succeeds. 1 task × 0.5 vCPU / 1 GB |
| | `unfurl-gotrue` | `public.ecr.aws/supabase/gotrue:v2.197.0` on 127.0.0.1:9999, plus an `nginx:1.31.8-alpine` sidecar on 8080 that strips `/auth/v1`. 2 tasks × 0.25 vCPU / 0.5 GB; ALB health check `/auth/v1/health` |
| Data | RDS PostgreSQL **18.6** (matches `pgvector/pgvector:pg18` in compose) | `db.t4g.small`, single-AZ (`unfurl:databaseMultiAz` switches on a standby), 20 GB gp3 growing to 100 GB, encrypted, private. Automated backups kept 7 days, which gives point-in-time restore over that window. Deletion protection on; a snapshot is taken if the stack ever deletes it |
| | Databases and roles | `app` (created by RDS) and `auth`, owned by `supabase_auth_admin`, created by the `DbSetup` custom resource, which also gives `app_user` LOGIN and its password |
| | ElastiCache (Valkey 8.0) | `cache.t4g.micro`, one node, TLS (`rediss://`) and encryption at rest. Replaces the compose `redis` |
| | S3 bucket `unfurl-media-<account>` | Private, TLS only, versioned (old versions kept 30 days). Replaces MinIO; the API presigns uploads and downloads as today, signing with its task role |
| Email | SES domain identity (when `unfurl:domain` is set) | DKIM, MAIL FROM `mail.<domain>` and DMARC records are created automatically when a Route 53 hosted zone is given |
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

## Decisions

- **One NAT gateway, not VPC endpoints.** The tasks must reach the internet anyway: Nebius, Deepgram, Expo push, and Apple's and Google's token checks. So interface endpoints couldn't replace NAT. They would only add cost: ECR API, ECR Docker, CloudWatch Logs and Secrets Manager in two AZs come to roughly USD 60–75 a month, against USD 43 for the gateway. S3 traffic skips NAT through the free gateway endpoint. The trade: if the NAT's AZ fails, egress stops until it is recreated. A second gateway (about +USD 47 a month) removes that.
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
| `FRONTEND_HOST` | `https://<domain>`; the ALB URL until a domain exists |
| `FIRST_SUPERUSER` | `unfurl:adminEmail`, default `admin@<domain>` (`admin@example.com` until a domain exists) |
| `FIRST_SUPERUSER_PASSWORD` | Secret `unfurl/app` → `first_superuser_password` |
| `SUPABASE_URL` | `https://api.<domain>`, or the ALB URL. The backend reaches GoTrue through the ALB at `/auth/v1` |
| `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Secret `unfurl/gotrue` |
| `POSTGRES_SERVER`, `POSTGRES_PORT` | RDS endpoint |
| `POSTGRES_DB`, `POSTGRES_USER` | `app`, `postgres` |
| `POSTGRES_PASSWORD` | Secret `unfurl/db-master` |
| `POSTGRES_APP_USER`, `POSTGRES_APP_PASSWORD` | `app_user`, secret `unfurl/app-user-db`. Tenant RLS is enforced from the first deploy |
| `REDIS_URL` | `rediss://<cache endpoint>:6379/0` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_SSL` | `email-smtp.ap-southeast-1.amazonaws.com`, `587`, `true`, `false` |
| `SMTP_USER`, `SMTP_PASSWORD` | Secret `unfurl/smtp` |
| `EMAILS_FROM_EMAIL` | `no-reply@<domain>`; empty (email off) until a domain exists |
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
| HTTPS, `api.<domain>`, SES sending, email confirmation | Buying the domain | Set `unfurl:domain` (and `unfurl:hostedZoneId` if DNS is in Route 53) in `infra/cdk.json`, deploy. Without a hosted zone, add the ACM and SES DNS records at the registrar by hand; the deploy waits on the certificate |
| Email to real users | SES sandbox | Request SES production access for `ap-southeast-1` (a support form, not infrastructure) |
| Sign in with Apple | Paid Apple Developer account | Services ID and key → put them in `unfurl/auth-providers`, set `unfurl:appleSignIn: true`, deploy |
| Google sign-in | Google Cloud OAuth consent and client IDs | Put them in `unfurl/auth-providers`, set `unfurl:googleSignIn: true`, deploy |
| Alarm emails | An address | Set `unfurl:alertEmail`, deploy, confirm the SNS email |
| Web frontend | Not in scope | Next.js isn't deployed; mobile is the client. `BACKEND_CORS_ORIGINS` stays empty |

## Estimated monthly cost

On-demand prices for `ap-southeast-1`, 730 hours a month, low traffic. Fargate, RDS, ElastiCache and NAT rates were read from the AWS Pricing API on 2026-10-23; the other lines use AWS's published list prices. This is an estimate, not a bill.

| Item | Basis | USD / month |
|---|---|---|
| Fargate: API | 2 × (0.5 vCPU, 1 GB) at $0.05056 per vCPU-hour and $0.00553 per GB-hour | 45 |
| Fargate: worker | 1 × (0.5 vCPU, 1 GB) | 22 |
| Fargate: GoTrue | 2 × (0.25 vCPU, 0.5 GB) | 22 |
| NAT gateway | $0.059/h, plus $0.059/GB processed | 43 + data |
| Application Load Balancer | $0.0252/h + about 1 LCU | 24 |
| RDS `db.t4g.small` single-AZ | $0.051/h + 20 GB gp3 | 40 |
| ElastiCache Valkey `cache.t4g.micro` | $0.0192/h | 14 |
| Public IPv4 addresses | 3 (NAT, ALB in 2 AZs) × $0.005/h | 11 |
| WAF | Web ACL $5 + 5 rules × $1 + $0.60 per million requests | 10 |
| Secrets Manager | 7 secrets × $0.40 | 3 |
| CloudWatch | 8 alarms, log ingestion | 3–6 |
| S3, SES, ECR, SNS, Lambda | Small at launch volume | < 5 |
| **Total** | | **≈ 240–260** |

Levers if it should be lower: one API task instead of two (−22), Fargate on Graviton (about −20 % of compute, needs an arm64 image build), Fargate Spot for the worker, a Compute Savings Plan. Multi-AZ RDS adds about +40; a second NAT gateway adds about +47.

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

3. In GitHub: create the environment `production` (add required reviewers if a second approval is wanted), and set the repository variable `AWS_DEPLOY_ROLE_ARN` to the `DeployRoleArn` output from step 2.

4. Run the **Deploy to AWS** workflow with `ref` = `master`. It builds and pushes the backend image, then runs `cdk deploy UnfurlProd`. To do the same from a laptop instead:

```bash
TAG=$(git rev-parse --short=12 HEAD); REPO=619648596614.dkr.ecr.ap-southeast-1.amazonaws.com/unfurl-backend
env -u HTTPS_PROXY -u HTTP_PROXY aws ecr get-login-password --profile unfurl --region ap-southeast-1 | docker login --username AWS --password-stdin 619648596614.dkr.ecr.ap-southeast-1.amazonaws.com
docker buildx build --platform linux/amd64 -f backend/Dockerfile -t "$REPO:$TAG" --push .
cd infra && env -u HTTPS_PROXY -u HTTP_PROXY bunx cdk deploy UnfurlProd -c unfurl:imageTag=$TAG --profile unfurl
```

5. Put the third-party keys in, merging into the existing JSON so generated fields are kept, then restart the backend services so they read them:

```bash
CUR=$(env -u HTTPS_PROXY -u HTTP_PROXY aws secretsmanager get-secret-value --secret-id unfurl/app --profile unfurl --region ap-southeast-1 --query SecretString --output text)
echo "$CUR" | jq --arg n "<nebius key>" --arg d "<deepgram key>" '.nebius_api_key=$n | .deepgram_api_key=$d' > /tmp/unfurl-app.json
env -u HTTPS_PROXY -u HTTP_PROXY aws secretsmanager put-secret-value --secret-id unfurl/app --secret-string file:///tmp/unfurl-app.json --profile unfurl --region ap-southeast-1 && rm /tmp/unfurl-app.json
for s in unfurl-api unfurl-worker; do env -u HTTPS_PROXY -u HTTP_PROXY aws ecs update-service --cluster unfurl --service $s --force-new-deployment --profile unfurl --region ap-southeast-1 >/dev/null; done
```

6. Check: `curl <PublicUrl>/api/v1/utils/health-check/` and `curl <PublicUrl>/auth/v1/health` both return 200 (`PublicUrl` is a stack output).

The first `UnfurlProd` deploy takes roughly 20–30 minutes, mostly RDS. CloudFormation rolls the whole stack back if any service fails to stabilise. RDS (deletion protection, snapshot on delete), the media bucket, the secrets and the log groups are retained by design, so a failed first create can leave them behind for cleanup.

## Later deploys

Run the **Deploy to AWS** workflow with the tag or SHA to ship. It never runs on push, merge or tag (constitution §2.2). Read `cdk diff` in the pull request that changes `infra/` before deploying it:

```bash
cd infra && env -u HTTPS_PROXY -u HTTP_PROXY bunx cdk diff --profile unfurl -c unfurl:imageTag=<deployed tag>
```
