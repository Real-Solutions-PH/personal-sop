# infra

AWS production infrastructure for Unfurl, in AWS CDK v2 (TypeScript). Why CDK: [ADR-0022](../docs/adr/0022-aws-cdk-for-infrastructure.md). What the stacks define, the backend environment map, the cost estimate and the first-deploy commands: [docs/23-aws-infrastructure.md](../docs/23-aws-infrastructure.md).

A standalone bun project, not part of the root workspace. Run everything from this folder.

| Task | Command |
|---|---|
| Install | `bun install` |
| Test (offline synth + assertions) | `bun run test` |
| Typecheck | `bun run typecheck` |
| Lint (Biome, mutates) | `bun run lint` |
| Synth | `bunx cdk synth -c unfurl:imageTag=<tag>` |
| Diff against the account | `env -u HTTPS_PROXY -u HTTP_PROXY bunx cdk diff --profile unfurl -c unfurl:imageTag=<tag>` |
| Cloudflare plan (read-only) | `CLOUDFLARE_API_TOKEN=… AWS_PROFILE=unfurl bun run cloudflare` (`--apply` writes: tunnel, token secret, ingress, DNS, rate rule) |

`cdk bootstrap` and `cdk deploy` create billable resources, and `bun run cloudflare --apply` creates the tunnel and writes DNS records: run them only with a go. Sizing: `unfurl:profile` in `cdk.json` is `production` (default: 100 people at once, ≈ USD 255 a month, up to ≈ 320 when the API scales out) or `lean` (up to 5 users, ≈ USD 92–100); single values can be overridden with `unfurl:sizingOverrides`. Routine deploys go through the `Deploy to AWS` workflow (`workflow_dispatch` only).

| Path | What |
|---|---|
| `bin/unfurl.ts` | The app: `UnfurlCi` (ECR, GitHub OIDC deploy role) and `UnfurlProd` (everything else) |
| `lib/config.ts` | Context settings (`unfurl:*` in `cdk.json`) and pinned images |
| `lib/prod-stack.ts` | VPC (public + isolated, no NAT), ECS services on Graviton (API, worker, GoTrue, cloudflared), Cloud Map, RDS, ElastiCache, S3, SES, secrets, alarms |
| `lib/cloudflare.ts` | The visitor-IP header and the rate-limit budgets (in-app and the Cloudflare rule) |
| `lib/db-setup.ts` | The database setup script the GoTrue task runs before GoTrue |
| `lib/backend-env.ts` | Backend settings production leaves at their default, and why |
| `scripts/cloudflare.ts` | Creates the tunnel and its token secret, sets its ingress, applies the DNS records and the zone rate-limiting rule |
| `lambda/` | The custom-resource function that generates GoTrue's keys and the SES SMTP credentials |
| `test/` | `bun test` suites |
