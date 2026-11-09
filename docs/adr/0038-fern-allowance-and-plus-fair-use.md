# ADR-0038 — Fern allowance and Plus fair use: a turn ledger, server-key only, limits in settings

- **Date:** 2026-11-09
- **Status:** accepted
- **Deciders:** Kai (pricing ruling 2026-11-08), engineering

## Context

The pricing ruling of 2026-11-08 limits Fern: free accounts get 15 messages a day in their first week, then 5 (low-price countries 10, then 3); Unfurl Plus gets a monthly AI budget of US$2.50 / 1.50 / 1.00 by price tier, then a lighter model, with hard stops at 60 messages a day and US$5 a month. Until now the only limit was the person's own monthly spend cap (`ai_settings.spend_cap_minor`, ADR-0012 §5).

Three facts shaped how this is built:

1. `ai_usage` holds one row per model call, and one Fern reply makes two to four calls. It cannot count messages, and it has no link back to the question.
2. `ai_model_assignment` is per person: each row ties a purpose to one of that person's own provider keys. It has no row for the server's key, which is what every limited turn runs on.
3. An account has no country field. Its time zone is the one location it always carries; the App Store storefront country is only known on the phone.

## Decision

- **A turn ledger.** A new owned table, `fern_turn`, holds one row per Fern message answered on the server's key, unique on `(owner_id, message_id)`. A turn is written with `INSERT … ON CONFLICT DO NOTHING` before the model is asked, in the same transaction as the turn. A resent or retried message is counted once, a turn whose transaction rolled back is not counted, and deleting the chat does not restore the allowance. The count runs over the person's business day (`day_window`, their time zone and day-start hour), as `month_window` does for months.
- **Only the server's key is limited.** A person who brought their own provider key pays their own provider, so neither the allowance nor fair use counts their turns. Their own spend cap still applies. Plus spend is the server-key spend (`ai_usage.credential_id IS NULL`) of every purpose in the business month.
- **The light model is a setting, not an assignment row.** `FERN_LIGHT_MODELS` names a model per purpose (`chat=deepseek-ai/DeepSeek-V4-Flash-0731`). The ticket suggested `ai_model_assignment`, but that table only names models on a person's own key, and those turns are not limited (above), so a row there would never be read.
- **Price tier.** `PRICE_TIER_COUNTRIES` maps ISO countries to the pricing study's tiers (BR, MX tier 2; PH, IN, ID tier 3; every other country tier 1). The country is `user_profile.storefront_country` when the phone has set it, else the country of the account's time zone (`ai_providers.price_tier.ZONE_COUNTRY`).
- **One plan seam.** `ai_providers.allowance.plan_of` is the one place the plan is read. It returns `free` until the billing module (ADR-0037) is on master, then reads the entitlement.
- **Errors.** 402 `fern_daily_allowance_reached` (free allowance, or Plus's 60 a day) and 402 `fern_monthly_limit_reached` (Plus's US$5 a month), each with `resets_at`. The stream route refuses before it opens, so the phone reads a plain 402. `GET /companion/allowance` tells the phone what is left.
- Every number is a setting (`FERN_*`, `PRICE_TIER_COUNTRIES`); none is a constant.

## Constitution clause deviated from

None.

## Consequences

**Positive:**
- Counting is exact per message and cannot be gamed by retries or by clearing the chat.
- Limits change with an environment variable, no release.

**Negative:**
- A time zone is a weak stand-in for a country (a traveller, or someone who changed it). It only decides the tier until the phone reports the storefront.
- When the AI is off or capped, the free rules engine still answers and is not counted; that is deliberate, because it costs nothing.

**Follow-ups:**
- When the billing module lands, `plan_of` reads `billing.public.plan_of`, and the phone sets `storefront_country` from the purchases SDK's storefront (alpha-2).

## Amendment 2026-11-09: switched off while testing

While the app is in testing, `FERN_ALLOWANCE_ENFORCED` (default `false`) switches enforcement off: no Fern message is refused, `/companion/allowance` reports `applies: false` so the app shows no "messages left" note, and turns are still counted in `fern_turn`. Setting it to `true` restores the limits above unchanged.
