// Pricing is driven entirely by this file. PENDING KAI'S APPROVAL for the
// public site: the marketing claims ledger blocks any per-month or per-year
// price until prices are live in the stores.
//
// Two presets:
// - "plus" is what Kai ratified on 2026-11-08 (pricing study section 13,
//   brand doc PR 332): free tier plus Unfurl Plus at $49.99 a year or $7.99
//   a month, 7-day trial.
// - "optionC" is the roast's proposal (2026-11-07), not ratified: a free
//   download, a $14.99 one-time unlock, and Cloud & Fern by subscription.
// Switch with ACTIVE_PRESET; set SHOW_PRICES to false to hide every figure
// and fall back to "Free to start".

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
  cta: string
}

export type Preset = {
  label: string
  status: "ratified" | "proposed"
  plans: Plan[]
  // One plain sentence about how AI cost shapes the plan limits.
  fairUse: string
}

// The competitor stack the roast and the brand doc compare against. US list
// prices checked 2026-10-22 (docs/brand/positioning-and-name.md, Sources);
// treat as approximate and re-check before going live.
export const STACK = {
  total: 311,
  apps: [
    { area: "Money", app: "YNAB", perYear: 109 },
    { area: "Food", app: "MacroFactor", perYear: 71.99 },
    { area: "Tasks", app: "Todoist Pro", perYear: 60 },
    { area: "Habits", app: "Habitify Premium", perYear: 39.99 },
    { area: "Training", app: "Strong PRO", perYear: 29.99 },
  ],
  checked: "2026-10-22",
} as const

const PRESETS: Record<"plus" | "optionC", Preset> = {
  plus: {
    label: "Ratified 2026-11-08",
    status: "ratified",
    fairUse:
      "Every Fern message has a running cost, so free comes with a daily allowance and Plus with a stated fair-use limit. Nothing is called unlimited.",
    plans: [
      {
        id: "free",
        name: "Free",
        price: null,
        cadence: null,
        note: "Free to start",
        features: [
          "Every area: habits, tasks, training, food, money, journal, focus",
          "Unlimited logging by hand, charts and streaks",
          "Fern: 15 messages a day in your first week, then 5",
          "Export all your data",
        ],
        highlighted: false,
        cta: "Join the waitlist",
      },
      {
        id: "plus-year",
        name: "Plus, yearly",
        price: "$49.99",
        cadence: "a year",
        note: "About $4.17 a month · 7-day free trial",
        features: [
          "Everything in Free",
          "Fern for everyday logging, with a stated fair-use limit",
          "Ask about your whole history, not just this week",
          "Life Score breakdowns",
        ],
        highlighted: true,
        cta: "Join the waitlist",
      },
      {
        id: "plus-month",
        name: "Plus, monthly",
        price: "$7.99",
        cadence: "a month",
        note: "Cancel any time",
        features: ["Everything in Plus, billed monthly"],
        highlighted: false,
        cta: "Join the waitlist",
      },
    ],
  },
  // Option C's plan contents beyond the three prices are placeholders: the
  // roast proposed the prices, not what each tier includes.
  optionC: {
    label: "Proposed (option C), not ratified",
    status: "proposed",
    fairUse:
      "Fern in the cloud has a running cost, so it is the one part sold by subscription. Everything on your phone is yours for a one-time price.",
    plans: [
      {
        id: "free",
        name: "Free",
        price: null,
        cadence: null,
        note: "Free download",
        features: [
          "Every area, logged by hand",
          "Charts and streaks",
          "Data stays on your phone",
        ],
        highlighted: false,
        cta: "Join the waitlist",
      },
      {
        id: "unlock",
        name: "Unlock",
        price: "$14.99",
        cadence: "once",
        note: "Pay once, keep it",
        features: [
          "Everything in Free",
          "Every module and widget unlocked",
          "Backup and export",
        ],
        highlighted: false,
        cta: "Join the waitlist",
      },
      {
        id: "cloud",
        name: "Cloud & Fern",
        price: "$29.99",
        cadence: "a year",
        note: "Or $3.99 a month · 7-day free trial",
        features: [
          "Everything in Unlock",
          "Tell Fern by text, voice or photo",
          "Sync across devices",
        ],
        highlighted: true,
        cta: "Join the waitlist",
      },
    ],
  },
}

export const ACTIVE_PRESET: keyof typeof PRESETS = "plus"
export const SHOW_PRICES = true
export const PRICING = PRESETS[ACTIVE_PRESET]

// Student discount from the brand doc: 50% off the yearly plan.
export const STUDENT_NOTE =
  "Students: half off the yearly plan, with verification."
