# ADR-0023 — Cloudflare Tunnel instead of a load balancer, WAF and NAT

- **Date:** 2026-10-24
- **Status:** accepted
- **Deciders:** product owner, tech lead

## Context

The AWS production stack ([ADR-0022](0022-aws-cdk-for-infrastructure.md), `infra/`) was first written with an Application Load Balancer, AWS WAF, a NAT and an ACM certificate, behind Cloudflare. Its `lean` profile was estimated at USD 140–150 a month, for one user before launch. A third of that is the edge, not the app:

| Edge piece | USD / month | What it does that Cloudflare already does |
|---|---|---|
| ALB (plus its 2 public IPv4 addresses) | ≈ 31 | Terminates TLS and routes by path. Cloudflare terminates TLS at its edge |
| AWS WAF | ≈ 10 | Per-IP rate limits. Cloudflare has a rate-limiting rule, the app has a Redis rate-limit seam, and GoTrue has its own limits |
| NAT (instance or gateway) | ≈ 5–43 | Egress for private subnets |
| ACM certificate | 0 | Needed only because the ALB terminated TLS for Cloudflare |

DNS for the product's domain is already on Cloudflare.

## Decision

The product owner decided on 2026-10-24:

1. **No ALB: a Cloudflare Tunnel.** `cloudflared` (pinned, arm64) runs as one ECS service and opens the tunnel outward to Cloudflare. The tunnel's ingress routes `unfurl-api.realsolutionsph.com`: `/auth/v1/*` to GoTrue's nginx proxy, everything else to the API, any other host to 404. Cloudflare terminates TLS, so there is no ACM certificate. The tunnel, its token (stored in Secrets Manager), its ingress, the DNS record and the rate-limiting rule are created from code by `infra/scripts/cloudflare.ts` through the Cloudflare API.
   - **One cloudflared service, not a sidecar per task.** A tunnel's ingress rules are shared by every connector, and they route one hostname to two services by path, so every connector must reach both the API and GoTrue. A sidecar inside the API task can't reach GoTrue's task, and the reverse holds too. So one `unfurl-tunnel` service (1 task in `lean`, 2 in `production`) reaches both through private DNS.
   - **Cloud Map DNS, not ECS Service Connect.** The API and GoTrue register A records as `api.unfurl.internal` and `auth.unfurl.internal`. Service Connect would add an Envoy proxy to every task, which takes memory from each one for two plain HTTP hops that don't need it.
   - **The backend reaches GoTrue privately.** `SUPABASE_URL` is `http://auth.unfurl.internal:8080` and `SUPABASE_JWT_ISSUER` is the public `https://unfurl-api.realsolutionsph.com/auth/v1`, so admin calls and the JWKS fetch never leave the VPC.
   - **Long-lived streams.** The tunnel keeps idle origin connections for 300 s, as the ALB did. Cloudflare closes a proxied response that is silent for 100 s; the server-sent-event streams heartbeat every 25 s.
2. **No AWS WAF.** Rate limiting moves into three layers:
   - The API: per user and per visitor address (`CF-Connecting-IP`), in Redis, on the model-backed routes and the account routes that call GoTrue (`RATE_LIMIT_AI_PER_MINUTE` = 20, `RATE_LIMIT_ACCOUNT_PER_MINUTE` = 10; `backend/app/shared/rate_limit.py`).
   - GoTrue's built-in per-address limits for sign-in, keyed on the visitor through nginx.
   - One Cloudflare rate-limiting rule (the Free plan allows one): 50 requests per 10 s per visitor IP on `/auth/v1/` and the AI path prefixes, blocking for 10 s.
3. **No NAT: public subnets and security groups.** The tasks run in public subnets with a public IP, which is their route out. **No security group admits anything from the internet.** The tunnel and worker groups admit nothing at all. The API admits only the tunnel (8000). GoTrue's proxy admits only the tunnel, the API and the worker (8080), because the backend calls GoTrue privately. Egress is listed rather than open: HTTPS, SMTP 587, the tunnel's 7844, and the data stores. RDS and Valkey stay in isolated subnets, reachable only from the task groups. The free S3 gateway endpoint stays.
   - **Database setup moves into a container.** The setup was a Lambda in the VPC. Without NAT it has no route to Secrets Manager, so it now runs as a one-shot `db-setup` container in the GoTrue task (the backend image runs `lib/db-setup.ts`'s Python), where ECS already injects the secrets. It is idempotent and serialised by an advisory lock.
4. **Graviton (arm64) for every Fargate task.** The deploy workflow builds an arm64 backend image, under QEMU on GitHub's x86 runner. Every image used is multi-arch.

## Constitution clause deviated from

None. These are infrastructure choices inside AWS production (§2.5); ADR-0021's "behind the same ALB" and "AWS WAF rate rules" are superseded here and amended in place.

## Consequences

**Positive:**
- `lean` drops from about USD 140–150 to about **USD 105–115** a month, and `production` from about 240–260 to about **180–190** (`docs/23-aws-infrastructure.md`).
- Nothing in AWS listens on the internet. There's no load balancer to probe, and the origin can't be reached around Cloudflare.
- Rate limits now follow the user as well as the address, which the WAF couldn't do, and they live in code with tests.

**Negative:**
- **Cloudflare is now in the request path for availability, not just DNS.** If the tunnel or Cloudflare is down, the API is unreachable even when AWS is healthy. `production` runs two connectors.
- Each task pays for a public IPv4 address (USD 3.65 a month each). That's still cheaper than NAT plus the ALB's addresses. A later IPv6 egress design could remove it.
- No load-balancer health checks or metrics. ECS replaces a task whose container health check fails (the API's health route, GoTrue's `/auth/v1/health` through nginx), and alarms fire when a service has no running task. There's no external uptime check yet.
- The Cloudflare token must be able to edit tunnels, DNS and zone rate-limiting rules. A narrowly scoped token is better than the account-wide one.
- The `cloudflared` image comes from Docker Hub (there's no ECR Public copy), so anonymous pull limits apply to task starts.
- The tunnel token secret is created by the Cloudflare script, not by CloudFormation, so the stack references it by name. Run the script before the first deploy.

**Follow-ups:**
- An external uptime check (for example a Cloudflare health check or a scheduled probe) once paying users depend on it.
- Consider IPv6 egress to drop the per-task IPv4 charge.
