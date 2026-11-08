// Pricing is driven entirely by this file.
//
// Source: Kai's ruling of 2026-11-08 (pricing study section 13, brand doc
// PR 332): a free plan with a Fern allowance, and Unfurl Plus at US$49.99 a
// year or US$7.99 a month. Plus is never called unlimited: it has a stated
// fair-use limit (a monthly AI budget, then a lighter model).
//
// The app cannot take payment yet (no purchase SDK), so every plan's button
// is the waitlist or download, never "buy". SHOW_PRICES = false hides every
// figure and falls back to "Free to start" (the marketing claims ledger
// blocks per-month or per-year prices until they are live in the stores).

export type Plan = {
  id: string
  name: string
  // Price as shown, e.g. "$49.99". null for free.
  price: string | null
  cadence: string | null
  // A smaller line under the price: the per-month equivalent, a trial.
  note: string | null
  features: string[]
  highlighted: boolean
}

// The competitor stack the roast and the brand doc compare against. US list
// prices checked 2026-10-22 (docs/brand/positioning-and-name.md, Sources);
// treat as approximate and re-check before going live.
const STACK_APPS = [
  { area: "Money", app: "YNAB", perYear: 109 },
  { area: "Food", app: "MacroFactor", perYear: 71.99 },
  { area: "Tasks", app: "Todoist Pro", perYear: 60 },
  { area: "Habits", app: "Habitify Premium", perYear: 39.99 },
  { area: "Training", app: "Strong PRO", perYear: 29.99 },
] as const

export const STACK = {
  apps: STACK_APPS,
  // Sum of the rows ($310.97), rounded to whole dollars and shown as "about".
  total: Math.round(STACK_APPS.reduce((n, a) => n + a.perYear, 0)),
  checked: "2026-10-22",
} as const

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: null,
    cadence: null,
    note: "Free to start",
    features: [
      "Every area: habits, tasks, training, food, money, journal, focus",
      "Unlimited logging by hand, charts and streaks",
      "Fern: 15 messages a day in your first week, then 5 a day",
      "Export all your data",
    ],
    highlighted: false,
  },
  {
    id: "plus-year",
    name: "Plus, yearly",
    price: "$49.99",
    cadence: "a year",
    note: "About $4.17 a month · 7-day free trial",
    features: [
      "Everything in Free",
      "Fern for everyday logging, up to a monthly fair-use budget, then a lighter model",
      "Ask about your whole history, not just this week",
      "Life Score breakdowns",
    ],
    highlighted: true,
  },
  {
    id: "plus-month",
    name: "Plus, monthly",
    price: "$7.99",
    cadence: "a month",
    note: "Cancel any time",
    features: ["Everything in Plus, billed monthly"],
    highlighted: false,
  },
]

export const SHOW_PRICES = true

// One plain sentence about how AI cost shapes the plan limits.
export const FAIR_USE =
  "Every Fern message has a running cost, so Free comes with a daily allowance and Plus with a stated monthly fair-use budget, after which Fern switches to a lighter model. Nothing is called unlimited."

// Regional notes. Free allowances are lower where prices are lower (10 a day
// in week one, then 3). Local prices are set per country in the stores
// (Philippines: ₱249 a month or ₱1,490 a year); the global site does not
// list them.
export const REGIONAL_NOTE =
  "Prices in US dollars; your local price shows in the App Store. In some countries the free Fern allowance is 10 messages a day in week one, then 3."

// Student discount from the brand doc: 50% off the yearly plan.
export const STUDENT_NOTE =
  "Students: half off the yearly plan, with verification."
