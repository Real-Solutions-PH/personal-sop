# ADR-0035 — Product analytics SDK deferred; retention read from our own tables

- **Date:** 2026-11-08
- **Status:** proposed
- **Deciders:** Kai (founder); proposed by the retention-KPI work

## Context

Unfurl has TestFlight users and no retention measurement. The KPIs in [docs/25-retention-kpis.md](../25-retention-kpis.md) are needed now. A product analytics SDK (PostHog, Amplitude, Mixpanel) would add screen flows, in-app funnels and session replay, but Unfurl shows health, food and money data on nearly every screen, and Apple restricts health data shared with third parties. No analytics SDK is in `mobile/package.json` today.

## Decision

1. Read retention from the backend's own tables with a read-only script (`backend/scripts/retention_report.py`). The one missing signal, app opens, closes and share cards, gets a small owned table `usage_event` and `POST /usage/events`.
2. **Do not add a product analytics SDK yet.** Revisit when weekly active loggers reach 30, or when a flow question comes up that the KPIs and interviews cannot answer.
3. When it is added, the default candidate is **PostHog** (MIT-licensed core, self-hostable or EU cloud, React Native SDK), under these rules:
   - Events carry ids and fixed names only, never record values or typed text.
   - Session replay is off by default. If turned on, it masks all text and all images, never records finance, nutrition, weigh-in or Fern screens, and runs only for people who agreed to it.
   - It sits behind one module in `mobile/` so it can be swapped or removed.

## Constitution clause deviated from

None. Adding PostHog later would need this ADR accepted first: analytics data is a stateful layer, and the constitution's OSS-or-named-exit rule is met through self-hosting.

## Consequences

**Positive:**
- No new vendor, no new data processor, no App Store privacy label change.
- The KPIs come from the same rows the app runs on, so they cannot drift from what people actually logged.

**Negative:**
- No screen flows or replay: questions like "where in the capture sheet do people give up" need interviews or a later SDK.
- `usage_event` is our own code to maintain.

**Follow-ups:**
- Kai accepts or rejects this ADR.
- Revisit at 30 weekly active loggers.
