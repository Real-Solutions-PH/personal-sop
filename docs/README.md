# Project Docs

Context pack for human + AI programmers building this SaaS. Fill each template; keep updated as project evolves.

## Index

| File | Purpose | Owner |
|------|---------|-------|
| [00-vision.md](00-vision.md) | North star, mission, problem statement | Founder/PM |
| [01-market-research.md](01-market-research.md) | TAM/SAM/SOM, competitors, ICP | PM |
| [02-prd.md](02-prd.md) | Product requirements, features, scope | PM |
| [03-user-personas.md](03-user-personas.md) | Target users, jobs-to-be-done | PM/Design |
| [04-user-journeys.md](04-user-journeys.md) | Flows, touchpoints, edge cases | Design |
| [05-project-plan.md](05-project-plan.md) | Milestones, timeline, resources | PM |
| [08-data-model.md](08-data-model.md) | Entities, schema, relationships (incl. the mobile API domain ERD, 2026-10-18) | Backend |
| [10-implementation-plan.md](10-implementation-plan.md) | Phases, tasks, dependencies | Tech lead |
| [13-deployment.md](13-deployment.md) | Single-environment policy, manual promotion, production on AWS (ap-southeast-1) incl. self-hosted GoTrue (2026-10-23) | DevOps |
| [23-aws-infrastructure.md](23-aws-infrastructure.md) | AWS production stacks (`infra/`, CDK): what they define, backend env map, cost estimate, first-deploy commands (2026-10-23; Cloudflare Tunnel design 2026-10-24) | DevOps |
| [24-focus-data-model.md](24-focus-data-model.md) | Focus timer data model: sessions, segments, settings, invariants, derived numbers, sync (2026-10-24) | Backend |
| [14-observability.md](14-observability.md) | Logs, metrics, traces, alerts | DevOps |
| [15-pricing-monetization.md](15-pricing-monetization.md) | Plans, billing, gates | PM/Finance |
| [16-go-to-market.md](16-go-to-market.md) | Launch, channels, growth loops | Marketing |
| [17-roadmap.md](17-roadmap.md) | Quarterly themes, future bets | PM |
| [18-risks.md](18-risks.md) | Risks, mitigations, owners | All |
| [19-glossary.md](19-glossary.md) | Domain terms, acronyms | All |
| [20-decision-log.md](20-decision-log.md) | Deprecated — pointer to `adr/` | Tech lead |
| [21-onboarding.md](21-onboarding.md) | Dev setup, repo tour, runbook | Eng |
| [22-ai-module.md](22-ai-module.md) | AI module — LLM provider/key setup, chat transport, spend-cap posture | Backend |
| [22-data-protection.md](22-data-protection.md) | Deletion, retention, GDPR export/erase, audit trail | Backend |
| [mobile.md](mobile.md) | Native Expo prototype, shared domain, running and verification, widgets and lock-screen activities | Eng |
| [brand/fern.md](brand/fern.md) | Fern, the AI companion: mark, orb, colour, voice (2026-10-20) | Design |
| [brand/positioning-and-name.md](brand/positioning-and-name.md) | Positioning, product name (Unfurl), brand, launch pricing and channels (2026-10-22) | Founder/Marketing |
| [brand/design-system/](brand/design-system/project/README.md) | Unfurl design system: logo, tokens, brand book, component previews in HTML (2026-10-22) | Design |
| [constitution.md](constitution.md) | Engineering Constitution — stack defaults and conventions | All |
| [ia/](ia/README.md) | Information architecture — screens, flows, open questions per module | Design |
| [adr/](adr/) | Architecture Decision Records — one file per decision | Tech lead |
| [adr/0028-share-card-gradients.md](adr/0028-share-card-gradients.md) | Gradients allowed on share artwork only, amending the brand's flat rule (2026-10-30) | Design |
| [runbook.md](runbook.md) | Deploy, rollback, backup/restore, common ops, incidents | DevOps |

### Feature specs and plans

| File | Purpose | Owner |
|------|---------|-------|
| [superpowers/specs/2026-10-25-personalized-plans-design.md](superpowers/specs/2026-10-25-personalized-plans-design.md) | Personalized plans: design spec (2026-10-25) | Eng |
| [superpowers/plans/2026-10-25-personalized-plans.md](superpowers/plans/2026-10-25-personalized-plans.md) | Personalized plans: implementation plan, six tasks (2026-10-25) | Eng |
| [superpowers/specs/2026-10-25-savings-tracking-design.md](superpowers/specs/2026-10-25-savings-tracking-design.md) | Savings tracking: goals, interest, time deposits, rates directory (2026-10-25) | Eng |

## Conventions

- Update doc when reality changes. Stale doc worse than no doc.
- Decisions live in `docs/adr/` as ADRs (`docs/20-decision-log.md` is deprecated — see its banner).
- Date entries `YYYY-MM-DD`.
- Keep AI-context-friendly: short sections, headings, tables.
