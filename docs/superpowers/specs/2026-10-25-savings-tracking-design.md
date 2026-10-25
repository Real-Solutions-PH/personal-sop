# Savings tracking — design

Date: 2026-10-25. Prior art: Lemoneyd (web `/savings` rate table; iOS/Android
"Finance Tracker" app — savings goals, time-deposit interest + maturity).
The user asked for all of it and left the design calls to the builder; every
call below is the builder's.

## Intent

Make a savings account more than a balance: what it earns, when it matures,
what it's for — and help pick where to keep money in the first place.

## What ships

1. **Savings goal on an account.** Optional target amount + optional target
   date. Progress = current balance / target. With a date: amount still needed
   per month.
2. **Interest rate on an account.** Optional % p.a. Shows estimated monthly
   interest after the 20% PH final withholding tax, and interest earned this
   calendar year (sum of income records on that account in the system
   `interest` category — no new record type).
3. **Time deposit.** Any non-credit account with a maturity date. Card shows
   "Matures in Nd" / "Matured"; detail shows value at maturity
   (simple interest from the as-of date, net of 20% tax). New time deposits
   default to out of the savings projection (money is locked).
4. **Rates directory** (`/finance/rates`). Static list of PH digital-bank
   products with rate ranges and an "as of" date; search by bank; filters
   Daily interest / Monthly interest / Time deposit. Tapping a product opens a
   new-account sheet prefilled with name and rate.

## Calls

- No new tables. Four nullable columns on `account`: `rate_bp` (basis points,
  0–10000; integer to keep the wire integer-only), `matures_on`,
  `goal_minor`, `goal_by`.
- Interest math is client-side (`shared/prototype/finance/calc.ts`); the
  server only stores the fields.
- Rates list is a constant in `shared/prototype/finance/rates.ts`, refreshed
  by hand. A server feed is the upgrade if rates need updating between
  releases.
- Not built: referral offers, "picks", cashback filter, auto-sweep, multiple
  goals per account (make a second account), web UI (mobile first).

## Anti-goals

- Presenting a rate as advice. The directory says "as of" and "check with the
  bank"; no ranking, no recommendation.
