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
| Cloudflare DNS plan (read-only) | `CLOUDFLARE_API_TOKEN=… AWS_PROFILE=unfurl bun run dns` (`--apply` writes, `--watch` repeats until the certificate is issued) |

`cdk bootstrap` and `cdk deploy` create billable resources, and `bun run dns --apply` writes DNS records: run them only with a go. Sizing: `unfurl:profile` in `cdk.json` is `lean` (default, ≈ USD 140–150 a month) or `production` (≈ USD 240–260). Routine deploys go through the `Deploy to AWS` workflow (`workflow_dispatch` only).

| Path | What |
|---|---|
| `bin/unfurl.ts` | The app: `UnfurlCi` (ECR, GitHub OIDC deploy role) and `UnfurlProd` (everything else) |
| `lib/config.ts` | Context settings (`unfurl:*` in `cdk.json`) and pinned images |
| `lib/prod-stack.ts` | VPC, ALB, ECS services, RDS, ElastiCache, S3, SES, secrets, alarms |
| `lib/waf.ts` | WAF web ACL and rate limits |
| `lib/cloudflare.ts` | Cloudflare's edge IP ranges (the ALB admits only these) and the client-IP header |
| `lib/backend-env.ts` | Backend settings production leaves at their default, and why |
| `scripts/cloudflare-dns.ts` | Applies the Cloudflare DNS records and the SSL Full (strict) rule from the live AWS resources |
| `lambda/` | Custom-resource functions: database setup, generated secrets |
| `test/` | `bun test` suites |
