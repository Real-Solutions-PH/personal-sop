# ADR-0022 — AWS CDK (TypeScript) for production infrastructure

- **Date:** 2026-10-23
- **Status:** accepted
- **Deciders:** product owner, tech lead

## Context

Production is AWS only, in one account and one region (`ap-southeast-1`), and sign-in runs there too as self-hosted GoTrue ([ADR-0021](0021-self-hosted-gotrue-on-aws.md)). Every production resource must be infrastructure as code: nothing configured by hand in the console, and changes reviewed in a pull request like code. The constitution names `infra/` as the home for infrastructure as code (§2.1) but sets no default tool, so the choice is recorded here.

The candidates:

| Tool | For | Against |
|---|---|---|
| **AWS CDK v2, TypeScript** | High-level AWS constructs (VPC, Fargate services, RDS with a generated secret) in a few lines each; state lives in CloudFormation, so there is no state bucket or lock table to run; assertion tests synthesise the stack offline; TypeScript, bun and Biome are already the repo's tooling | AWS only; CloudFormation is slower than direct API calls and has a 500-resource limit per stack; needs a one-time `cdk bootstrap` |
| Terraform / OpenTofu | Multi-cloud; fast plans; large module ecosystem | A state backend to create and protect; HCL is a second language in the repo; lower-level for ECS and RDS wiring |
| Pulumi | Real languages, multi-cloud | A state service (Pulumi Cloud or a self-managed backend); smaller AWS construct library |
| SST | Good developer experience for serverless | Aimed at Lambda-first apps; this backend is long-running containers |

Multi-cloud is not a goal: §2.5 puts production on AWS, and ADR-0021 removed the only second vendor. So Terraform's main advantage doesn't apply here, while its state backend would be one more thing to run.

## Decision

Production infrastructure is **AWS CDK v2 in TypeScript**, in `infra/`, a standalone bun project (not part of the root workspace, like `mobile/`), linted with Biome and tested with `bun test` and `aws-cdk-lib/assertions`.

- **Two stacks.** `UnfurlCi` holds the ECR repository and the GitHub OIDC deploy role, so the backend image can be pushed before anything that runs it exists. `UnfurlProd` holds everything else (VPC, ALB and WAF, ECS Fargate services, RDS, ElastiCache, S3, SES, Secrets Manager, alarms). It references the repository by name, not by a cross-stack export, so either stack can change on its own.
- **Deploys** go through the `workflow_dispatch`-only workflow `.github/workflows/deploy-aws.yml` (§2.2): it builds and pushes the image for a chosen ref and runs `cdk deploy UnfurlProd`, assuming the deploy role through GitHub OIDC. No AWS keys are stored in GitHub.
- **No secret passes through CDK.** Generated values (database passwords, GoTrue's ES256 signing key and JWTs, SES SMTP credentials, the AI key-encryption key) are created inside AWS by Secrets Manager or by a custom-resource function. Third-party keys are put into Secrets Manager by hand after the first deploy.
- **Settings are CDK context** in `infra/cdk.json` (API host, email domain, sizing profile, alert email, sign-in providers). They are non-secret and committed, so a laptop deploy and a workflow deploy synthesise the same stack.
- **DNS is on Cloudflare, not Route 53** (amended 2026-10-23). The product's domain, `realsolutionsph.com`, is on Cloudflare, so the stack can't create its own records. `infra/scripts/cloudflare.ts` creates the Cloudflare Tunnel and its ingress, stores the tunnel token in Secrets Manager, and applies the DNS records (the tunnel CNAME, SES DKIM, MAIL FROM, DMARC) and the zone rate-limiting rule through the Cloudflare API ([ADR-0023](0023-cloudflare-tunnel-no-alb-waf-nat.md), amended 2026-10-24). The deploy workflow runs it before and after `cdk deploy`. A script rather than a Cloudflare provider: CDK has no first-class Cloudflare support, and a custom resource would put the Cloudflare token into AWS.

The design choices inside the stack (a Cloudflare Tunnel instead of a load balancer, no NAT, migrations in the worker task, database setup in the GoTrue task, a custom resource for generated secrets) are in [docs/23-aws-infrastructure.md](../23-aws-infrastructure.md).

## Constitution clause deviated from

None. §2.1 places infrastructure as code in `infra/` without naming a tool; this ADR records the choice. `infra/` uses bun rather than the skeleton's pnpm, as the whole repo does ([ADR-0002](0002-bun-over-pnpm.md)).

## Consequences

**Positive:**
- One language for the app's TypeScript and its infrastructure, under the same Biome and test tooling.
- No state backend to create, secure or lock: CloudFormation holds the state and rolls back a failed deploy.
- `bun run test` in `infra/` synthesises both stacks offline and asserts the decisions that matter (private database, nothing open to the internet, pinned images, migration ordering, and that every backend setting has a production source). CI runs it on every pull request that touches `infra/` or the backend's settings.

**Negative:**
- AWS lock-in at the infrastructure layer (accepted under §2.5 and ADR-0021).
- CloudFormation deploys are slow (the first one takes roughly 20–30 minutes, mostly RDS and the certificate), and a stack is capped at 500 resources. `UnfurlProd` has about 120 today.
- `cdk bootstrap` creates a staging bucket and roles in the account once, before the first deploy.
- Upgrading `aws-cdk-lib` can change synthesised templates. Read `cdk diff` before every deploy that bumps it.

**Follow-ups:**
- First deploy (commands in [docs/23-aws-infrastructure.md](../23-aws-infrastructure.md)): bootstrap, deploy `UnfurlCi`, push the first image, deploy `UnfurlProd`.
- Request SES production access for `ap-southeast-1` once the identity is verified (a support form, not infrastructure).
