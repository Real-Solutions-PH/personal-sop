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

`cdk bootstrap` and `cdk deploy` create billable resources: run them only with a go. Routine deploys go through the `Deploy to AWS` workflow (`workflow_dispatch` only).

| Path | What |
|---|---|
| `bin/unfurl.ts` | The app: `UnfurlCi` (ECR, GitHub OIDC deploy role) and `UnfurlProd` (everything else) |
| `lib/config.ts` | Context settings (`unfurl:*` in `cdk.json`) and pinned images |
| `lib/prod-stack.ts` | VPC, ALB, ECS services, RDS, ElastiCache, S3, SES, secrets, alarms |
| `lib/waf.ts` | WAF web ACL and rate limits |
| `lib/backend-env.ts` | Backend settings production leaves at their default, and why |
| `lambda/` | Custom-resource functions: database setup, generated secrets |
| `test/` | `bun test` suites |
