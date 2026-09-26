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
| [08-data-model.md](08-data-model.md) | Entities, schema, relationships | Backend |
| [10-implementation-plan.md](10-implementation-plan.md) | Phases, tasks, dependencies | Tech lead |
| [13-deployment.md](13-deployment.md) | Single-environment policy, manual promotion | DevOps |
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
| [constitution.md](constitution.md) | Engineering Constitution — stack defaults and conventions | All |
| [adr/](adr/) | Architecture Decision Records — one file per decision | Tech lead |
| [runbook.md](runbook.md) | Deploy, rollback, backup/restore, common ops, incidents | DevOps |

## Conventions

- Update doc when reality changes. Stale doc worse than no doc.
- Decisions live in `docs/adr/` as ADRs (`docs/20-decision-log.md` is deprecated — see its banner).
- Date entries `YYYY-MM-DD`.
- Keep AI-context-friendly: short sections, headings, tables.
