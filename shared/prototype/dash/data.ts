import type { ModuleKey } from "../contract"
import { at, dayKey, dayOffset } from "../lib/day"
export const MODULE_KEYS: ModuleKey[] = [
  "habits",
  "tasks",
  "fitness",
  "nutrition",
  "focus",
  "finance",
  "screen",
]
/** Every module once, in the person's order: listed keys first, then any
 * missing (or new) module in its default place. */
export function orderModules(
  order: readonly string[] | undefined,
): ModuleKey[] {
  const seen = new Set<ModuleKey>()
  for (const k of order ?? [])
    if (MODULE_KEYS.includes(k as ModuleKey)) seen.add(k as ModuleKey)
  for (const k of MODULE_KEYS) seen.add(k)
  return [...seen]
}
/** How long Today keeps a weekly review's card once it has been opened. */
export const REVIEW_CARD_MS = 24 * 60 * 60 * 1000
/** Today shows a review's card until it is opened and for a day after;
 * an unopened review never leaves on its own. A review marked done before
 * opens were tracked counts as opened when it was done. */
export function reviewCardShown(
  r: ReviewState | undefined,
  now: number,
): boolean {
  const opened = r?.openedAt ?? r?.doneAt
  if (!opened) return true
  const at = Date.parse(opened)
  return Number.isNaN(at) || now - at < REVIEW_CARD_MS
}
export const AREA = {
  habits: { label: "Habits", accent: "hab" },
  tasks: { label: "Tasks", accent: "tsk" },
  fitness: { label: "Fitness", accent: "fit" },
  nutrition: { label: "Nutrition", accent: "nut" },
  focus: { label: "Focus", accent: "foc" },
  finance: { label: "Finance", accent: "fin" },
  screen: { label: "Screen time", accent: "scr" },
} as const
const pad = (n: number) => String(n).padStart(2, "0")
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export function weekStartKey(weeksAgo: number): string {
  const d = new Date(`${dayKey()}T12:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - weeksAgo * 7)
  return keyOf(d)
}
export function monthStartKey(monthsAgo: number): string {
  const d = new Date(`${dayKey()}T12:00:00`)
  d.setDate(1)
  d.setMonth(d.getMonth() - monthsAgo)
  return keyOf(d)
}
export const addDaysKey = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + n)
  return keyOf(d)
}
export type MetricRef = string
export interface Goal {
  id: string
  metric: MetricRef
  label: string
  target: number
  unit: string
  comparator: "gte" | "lte"
  period: "week" | "month"
  createdAt: string
  status: "active" | "archived"
  via?: "manual" | "onboarding" | "review"
}
export interface Identity {
  id: string
  text: string
  goalId?: string
}
export interface Notif {
  id: string
  at: string
  kind: "reminder" | "achievement" | "review" | "system"
  title: string
  body: string
  href: string
  read: boolean
}
export interface ReviewState {
  done: boolean
  doneAt?: string
  /** First time the review was opened; Today's card leaves a day after. */
  openedAt?: string
  reflection?: string
  focus?: MetricRef
}
export interface WrapUp {
  at: string
  onTarget: boolean
  done: number
  due: number
  reflection?: string
}
export type ShareTemplate =
  | "life"
  | "weekly"
  | "monthly"
  | "streak"
  | "finance"
  | "profile"
  | "goal"
export interface DashState {
  profile: {
    name: string
    handle: string
    since: string
    identities: Identity[]
    photo?: string
  }
  /** Live mode: a profile photo change the server has not taken yet (offline
   * or refused); ``uri`` null is a removal, ``mediaId`` an upload already
   * done. Retried on the next connect. */
  profilePhotoPending?: { uri: string | null; mediaId?: string }
  weights: Record<ModuleKey, number>
  enabled: Record<ModuleKey, boolean>
  /** The modules' card order (Settings → Sections); read via orderModules. */
  order?: ModuleKey[]
  goals: Goal[]
  reviews: Record<string, ReviewState>
  notifs: Notif[]
  missNotes: Record<string, string>
  wrapups: Record<string, WrapUp>
  share: Partial<Record<ShareTemplate, Record<string, boolean>>>
  onboarded: boolean
  setupSkipped: ModuleKey[]
  setupHidden: boolean
  installDismissed: boolean
  push: {
    permission: "default" | "granted" | "denied"
    morning: string
    evening: string
    review: string
    /** Daily Fern check-in time (HH:MM); empty = off. Syncs. */
    checkin: string
    /** The business day a check-in was last sent; this device only. */
    lastCheckin: string
  }
  targetThreshold: number
  eveningStart: string
  seenTrophies: string[]
  /** The one-time reintroduction of a hidden part (a module, the Journal
   * or Community): offered once by Fern, and turned down for good with
   * "Not for me". On the account, so they outlive a reinstall. */
  intro: { offered: string[]; dismissed: string[] }
}
export const seed = (): DashState => ({
  profile: {
    name: "Kai Tecson",
    handle: "@kai.sop",
    since: dayOffset(-92),
    identities: [
      { id: "id1", text: "I train 4× a week, no excuses", goalId: "g2" },
      { id: "id2", text: "I pay myself first — 25% saved", goalId: "g3" },
      { id: "id3", text: "I finish what I start", goalId: "g1" },
    ],
  },
  weights: {
    habits: 3,
    tasks: 2,
    fitness: 3,
    nutrition: 2,
    focus: 2,
    finance: 2,
    screen: 2,
  },
  enabled: {
    habits: true,
    tasks: true,
    fitness: true,
    nutrition: true,
    focus: true,
    finance: true,
    screen: true,
  },
  goals: [
    {
      id: "g1",
      metric: "life",
      label: "Life Score",
      target: 75,
      unit: "",
      comparator: "gte",
      period: "month",
      createdAt: dayOffset(-40),
      status: "active",
      via: "manual",
    },
    {
      id: "g2",
      metric: "fitness:sessions",
      label: "Workouts",
      target: 4,
      unit: "",
      comparator: "gte",
      period: "week",
      createdAt: dayOffset(-60),
      status: "active",
      via: "onboarding",
    },
    {
      id: "g3",
      metric: "finance:savings-rate",
      label: "Savings rate",
      target: 25,
      unit: "%",
      comparator: "gte",
      period: "month",
      createdAt: dayOffset(-60),
      status: "active",
      via: "onboarding",
    },
    {
      id: "g4",
      metric: "habits:habits.rate",
      label: "Habit completion",
      target: 85,
      unit: "%",
      comparator: "gte",
      period: "week",
      createdAt: dayOffset(-20),
      status: "active",
      via: "review",
    },
    {
      id: "g5",
      metric: "tasks:tasks.overdue",
      label: "Overdue now",
      target: 2,
      unit: "",
      comparator: "lte",
      period: "week",
      createdAt: dayOffset(-75),
      status: "archived",
      via: "manual",
    },
  ],
  reviews: {
    [`w-${weekStartKey(2)}`]: {
      done: true,
      doneAt: at(-13, 19, 20),
      reflection: "Gym was solid, tasks slipped midweek. Batch errands Sat.",
      focus: "tasks:tasks.onTime",
    },
    [`w-${weekStartKey(3)}`]: {
      done: true,
      doneAt: at(-20, 20, 5),
      reflection: "Best week of the month. Keep the 5am alarm.",
    },
    [`m-${monthStartKey(2)}`]: {
      done: true,
      doneAt: at(-40, 19, 0),
      reflection: "Savings on target; food delivery is the leak.",
      focus: "finance:savings-rate",
    },
  },
  notifs: [
    {
      id: "n1",
      at: at(0, 7, 0),
      kind: "reminder",
      title: "Good morning",
      body: "6 things due today. Morning routine is up first.",
      href: "/today",
      read: false,
    },
    {
      id: "n2",
      at: at(-1, 21, 2),
      kind: "achievement",
      title: "New personal record",
      body: "You set a personal record in your last session.",
      href: "/stats/trophies",
      read: false,
    },
    {
      id: "n3",
      at: at(-1, 19, 0),
      kind: "review",
      title: "Weekly review is ready",
      body: "See how this week stacked up vs last week.",
      href: "/stats/reviews",
      read: false,
    },
    {
      id: "n4",
      at: at(-1, 18, 30),
      kind: "reminder",
      title: "Wrap up your day",
      body: "3 items still open. 30 seconds to close the day.",
      href: "/today/wrap-up",
      read: true,
    },
    {
      id: "n5",
      at: at(-2, 12, 15),
      kind: "system",
      title: "Budget heads-up",
      body: "Food budget is at 82% with 9 days left.",
      href: "/finance/budgets",
      read: true,
    },
    {
      id: "n6",
      at: at(-4, 7, 0),
      kind: "achievement",
      title: "7-day on-target streak",
      body: "A full week of on-target days. Keep it rolling.",
      href: "/stats/trophies",
      read: true,
    },
  ],
  missNotes: {},
  wrapups: {},
  share: {},
  onboarded: true,
  setupSkipped: [],
  setupHidden: false,
  installDismissed: false,
  push: {
    permission: "default",
    morning: "07:00",
    evening: "21:00",
    review: "Sun 19:00",
    checkin: "",
    lastCheckin: "",
  },
  targetThreshold: 0.8,
  eveningStart: "18:00",
  seenTrophies: [],
  intro: { offered: [], dismissed: [] },
})
