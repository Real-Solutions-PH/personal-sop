# ADR-0037 — RevenueCat for Unfurl Plus; the server holds the plan

- **Date:** 2026-11-09
- **Status:** proposed
- **Deciders:** Kai (founder)

## Context

Nothing in Unfurl can be bought. Pricing was ruled on 2026-11-08: Unfurl Plus at US$7.99 a month or US$49.99 a year (Philippines ₱249 and ₱1,490), with data export staying free. The app ships on iOS only. Selling a subscription there means App Store in-app purchase, receipt validation, renewals, refunds, billing-retry and grace periods, and a way for the server to learn about each of them.

Options considered:

| Option | Receipt checks and renewals | Server notification | Cost |
|---|---|---|---|
| `expo-iap` / StoreKit 2 directly | ours to build | App Store Server Notifications v2, our own JWS verification | none |
| **RevenueCat** (`react-native-purchases`) | handled | one webhook for every store, REST API to read a customer | free under US$2.5k monthly tracked revenue, then 1% |
| Adapty / Qonversion | handled | webhook | similar |

## Decision

1. **RevenueCat** is the purchase layer. The app signs in to RevenueCat with the account's id (`Purchases.logIn(user.id)`), so a purchase belongs to the account, not the device: a reinstall or a second phone signed in to the same account restores it.
2. Products: `plus_monthly` and `plus_yearly` in one App Store subscription group, both granting the RevenueCat entitlement `plus`.
3. **The server holds the plan.** One `entitlement` row per account (`plan` free or plus, `plus_until`, `will_renew`). It is written only:
   - from RevenueCat webhooks (`POST /api/v1/webhooks/revenuecat`), accepted only when the `Authorization` header matches `REVENUECAT_WEBHOOK_AUTH` (constant-time compare);
   - from `POST /api/v1/billing/refresh`, where the server asks RevenueCat's REST API (`REVENUECAT_SECRET_API_KEY`) what the account holds. The app calls it on start and right after a purchase or a restore; the request carries nothing from the device.
4. Plus is in force while `plan` is plus and `plus_until` is empty or still ahead. So a cancelled subscription lapses at the end of its paid period with no further event, and a refund (a `CANCELLATION` with `cancel_reason` `CUSTOMER_SUPPORT`) makes the plan free at once, when the refunded product is the one held (an upgrade can refund the product left behind).
5. The app shows the Unfurl Plus row in Me only when the build can buy (the RevenueCat key is set) or the account already holds Plus.
6. The plan reaches the phone through sync as a read-only entity (ADR-0011) and in `GET /users/me`. The phone shows what the server says. Its only check of its own is that a `plus_until` already past shows as free, which can only take Plus away, never grant it.
7. Purchase moments go into `usage_event`: the phone sends `paywall_shown`, `purchase_started` and `restored`; the server writes `purchased`, `cancelled` and `refunded` from webhooks, and does not accept those three from the phone.
8. Sandbox purchases (TestFlight) count while `REVENUECAT_ALLOW_SANDBOX` is true, which is the default. It is turned off once paying customers only buy through the App Store build.
9. Data export is never gated by plan.

## Constitution clause deviated from

None. RevenueCat is a hosted processor, but the exit is named: the plan lives in our own table, and swapping in StoreKit 2 with App Store Server Notifications would change only the webhook handler, the refresh call and the app's purchase module (`mobile/src/live/purchases.ts`).

## Consequences

**Positive:**
- Renewals, refunds, grace periods and receipt checks are not ours to build.
- One server-side answer to "is this account Plus", which the Fern allowance (ADR-0038) reads through `billing.public.plan_of`.

**Negative:**
- A new data processor (RevenueCat sees the account id and purchase history, no health or money records). The App Store privacy label gains "Purchases".
- 1% of tracked revenue above US$2.5k a month.
- A native module: the next build must be a native build, not an over-the-air update.

**Follow-ups:**
- Set the app's RevenueCat key only once the Fern allowance (free daily allowance, Plus fair-use budget) is live: the paywall's main benefit is going beyond that allowance, and until the key is set the app hides the Unfurl Plus row from free accounts.
- Create the App Store Connect products, the RevenueCat project, entitlement and offering, and the webhook, then set the four settings (`REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_SECRET_API_KEY` on the server; `EXPO_PUBLIC_REVENUECAT_IOS_KEY` in the app build).
- Turn `REVENUECAT_ALLOW_SANDBOX` off at App Store launch.
