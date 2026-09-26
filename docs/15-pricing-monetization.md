# Pricing & Monetization

## Model

- [ ] Subscription
- [ ] Usage-based
- [ ] Hybrid
- [ ] Freemium
- [ ] One-time

## Plans

| Plan | Price/mo | Seats | Limits | Features | Target |
|------|----------|-------|--------|----------|--------|
| Free | $0 | 1 | 100 X/mo | core | trial users |
| Pro | $ | 5 | 10k X/mo | + advanced | SMB |
| Business | $ | 25 | unlimited | + SSO, audit | mid-market |
| Enterprise | custom | custom | custom | + SLA, DPA | enterprise |

## Billing

- Provider: Stripe
- Trial: 14 days, no card.
- Proration: yes.
- Invoicing: monthly / annual (20% off).
- Tax: Stripe Tax.
- Dunning: 3 retries over 14d.

## Feature Gating

- Server-side check on every gated action.
- Client UI hides/disables for UX only.

## Metrics

- MRR, ARR, ARPU, LTV, CAC, churn, NRR.
