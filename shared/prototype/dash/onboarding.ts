import type { ModuleKey } from "../contract"
import type { Goal } from "./data"
export const STEPS = [
  "welcome",
  "identity", // identity-based habits: who you're becoming, not what you do
  "modules", // all pre-selected; untick what you don't need (default effect)
  "targets", // pace presets, gentle start recommended (tiny-wins)
  "when", // implementation intention: a time you pick yourself
  "building", // labor illusion — the plan feels made for you
  "pledge", // commitment & consistency: hold to commit
  "notifications", // asked after commitment, framed as protecting the plan
  "install",
  "done", // peak-end: day 1 starts now
] as const
export type Step = (typeof STEPS)[number]
// Transitional steps don't count toward progress or get a Back stop.
export const PASS_THROUGH: Step[] = ["building"]
export const NO_SKIP: Step[] = ["welcome", "building", "pledge", "done"]

export const IDENTITIES: { text: string; module?: ModuleKey }[] = [
  { text: "I show up every day", module: "habits" },
  { text: "I finish what I start", module: "tasks" },
  { text: "I'm someone who trains", module: "fitness" },
  { text: "I eat to fuel my goals", module: "nutrition" },
  { text: "I do deep work every day", module: "focus" },
  { text: "I'm in control of my money", module: "finance" },
  { text: "I keep the promises I make to myself" },
]

export type Pace = "gentle" | "steady" | "ambitious"
export const PACES: Record<
  Pace,
  { label: string; note: string; targets: Record<ModuleKey, number> }
> = {
  gentle: {
    label: "Gentle",
    note: "Easy wins first",
    targets: {
      habits: 60,
      tasks: 70,
      fitness: 2,
      nutrition: 60,
      focus: 3,
      finance: 10,
    },
  },
  steady: {
    label: "Steady",
    note: "A real stretch",
    targets: {
      habits: 80,
      tasks: 85,
      fitness: 4,
      nutrition: 75,
      focus: 5,
      finance: 20,
    },
  },
  ambitious: {
    label: "Ambitious",
    note: "No days off",
    targets: {
      habits: 90,
      tasks: 95,
      fitness: 5,
      nutrition: 90,
      focus: 6,
      finance: 30,
    },
  },
}

interface Starter {
  metric: string
  label: string
  target: number
  unit: string
  comparator: Goal["comparator"]
  period: Goal["period"]
  hint: string
}

export const STARTERS: Record<ModuleKey, Starter> = {
  habits: {
    metric: "habits:habits.rate",
    label: "Habit completion",
    target: 80,
    unit: "%",
    comparator: "gte",
    period: "week",
    hint: "of scheduled habits done",
  },
  tasks: {
    metric: "tasks:tasks.onTime",
    label: "On-time rate",
    target: 85,
    unit: "%",
    comparator: "gte",
    period: "week",
    hint: "tasks done by their due date",
  },
  fitness: {
    metric: "fitness:sessions",
    label: "Workouts",
    target: 4,
    unit: "",
    comparator: "gte",
    period: "week",
    hint: "sessions per week",
  },
  nutrition: {
    metric: "nutrition:protein",
    label: "Protein hit rate",
    target: 75,
    unit: "%",
    comparator: "gte",
    period: "week",
    hint: "of logged days at your protein target",
  },
  focus: {
    metric: "focus:goalDays",
    label: "Days on focus goal",
    target: 5,
    unit: "",
    comparator: "gte",
    period: "week",
    hint: "days you reach your focus goal",
  },
  finance: {
    metric: "finance:savings-rate",
    label: "Savings rate",
    target: 20,
    unit: "%",
    comparator: "gte",
    period: "month",
    hint: "of income kept this month",
  },
}
