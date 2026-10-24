# Architecture Decision Records

ADRs are numbered sequentially upward from `ADR-0001`, one file per decision: `NNNN-title.md`.
An ADR is required for **any** deviation from a constitution default (see `docs/constitution.md` §0.3), and must record the constitution clause deviated from plus the rationale.
Start new ADRs from [template.md](template.md).

| ADR | Title |
|---|---|
| [0011](0011-mobile-api-scope-and-local-first-sync.md) | Mobile API scope and local-first sync |
| [0012](0012-per-user-ai-providers.md) | Per-user AI providers and keys |
| [0013](0013-transport-per-ux.md) | Transport per user experience |
| [0014](0014-aggregate-statistic.md) | One aggregate statistic across modules |
| [0015](0015-fern-chat-agent.md) | Fern: one streamed, multi-step chat agent |
| [0016](0016-live-dictation-on-device.md) | Live dictation: on-device recognition, Deepgram as fallback |
| [0017](0017-fern-memory-and-context.md) | Fern's memory layer and per-turn context |
| [0018](0018-hey-fern-wake-word.md) | "Hey Fern": a foreground wake phrase on the phone's recogniser |
| [0019](0019-unfurl-brand-and-design-system.md) | Unfurl brand and design system for the whole app |
| [0020](0020-widgets-and-lock-screen-activities.md) | Home-screen widgets and lock-screen activities (WidgetKit, ActivityKit, Android widgets and ongoing notification) |
| [0021](0021-self-hosted-gotrue-on-aws.md) | Self-hosted GoTrue on AWS for sign-in (email, Apple, Google), not a Supabase project |
| [0022](0022-aws-cdk-for-infrastructure.md) | AWS CDK (TypeScript) for production infrastructure |
| [0023](0023-cloudflare-tunnel-no-alb-waf-nat.md) | Cloudflare Tunnel instead of a load balancer, WAF and NAT |
| [0024](0024-nutrition-as-its-own-module.md) | Nutrition as its own module, separate from Fitness |
