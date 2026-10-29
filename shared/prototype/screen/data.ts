// Screen time's records on the device: the same rows the server keeps
// (screen_group, screen_day), camelCased, plus a habit's screen-time rule and
// the events the device-activity-monitor extension writes to the App Group.
// Every minute figure here is a lower bound: the highest threshold crossed.

import { at, dayOffset } from "../lib/day"
import { derivedId } from "../lib/ids"

export type ScreenGroupKind = "all" | "custom"
export interface ScreenGroup {
  id: string
  name: string
  kind: ScreenGroupKind
  budgetMin: number
  sortOrder: number
  archivedAt?: string
}
export interface ScreenDay {
  id: string
  groupId: string
  day: string
  usedMin: number
  closed: boolean
  updatedAt: string
}
export interface HabitRule {
  kind: "screen_limit"
  groupId: string
  maxMin: number
}
// What the extension writes to the App Group, one per callback.
export type NativeEvent =
  | { kind: "start"; groupId: string; at: number; hasSelection: boolean }
  | { kind: "end"; groupId: string; at: number }
  | { kind: "rung"; groupId: string; at: number; rungMin: number }

/** What the phone keeps: the groups and their day rows. The picked apps
 * never leave the phone; they live in the App Group keyed by group id. */
export interface ScreenState {
  groups: ScreenGroup[]
  days: ScreenDay[]
}

/** The built-in group that counts all phone use. */
export const ALL_GROUP = { name: "All apps", budgetMin: 180 } as const
/** A custom group's budget when none is given (the server's default). */
export const DEFAULT_BUDGET_MIN = 60

const NS = "6f1d7c2a-4b8e-5a3c-9d10-2e7f40b1c9a5"
// Three weeks of the prototype's sample use, oldest first: minutes crossed
// on All apps and on Social. Today is still open.
const DEMO_ALL = [
  210, 165, 180, 240, 150, 135, 195, 180, 120, 165, 225, 150, 105, 180, 165,
  135, 150, 195, 120, 135, 150,
]
const DEMO_SOCIAL = [
  90, 45, 60, 105, 45, 30, 75, 60, 30, 45, 90, 45, 30, 60, 45, 30, 45, 60, 30,
  30, 45,
]

export function seedScreen(): ScreenState {
  const all: ScreenGroup = {
    id: derivedId("demo-screen-group", NS, "all"),
    name: ALL_GROUP.name,
    kind: "all",
    budgetMin: ALL_GROUP.budgetMin,
    sortOrder: 0,
  }
  const social: ScreenGroup = {
    id: derivedId("demo-screen-group", NS, "social"),
    name: "Social",
    kind: "custom",
    budgetMin: DEFAULT_BUDGET_MIN,
    sortOrder: 1,
  }
  const days: ScreenDay[] = []
  const n = DEMO_ALL.length
  for (let i = 0; i < n; i++) {
    const back = n - i
    const day = dayOffset(-back)
    const updatedAt = at(-back + 1, 4)
    for (const [g, used] of [
      [all, DEMO_ALL[i]],
      [social, DEMO_SOCIAL[i]],
    ] as const)
      days.push({
        id: derivedId("demo-screen-day", g.id, day),
        groupId: g.id,
        day,
        usedMin: used,
        closed: true,
        updatedAt,
      })
  }
  const today = dayOffset(0)
  for (const [g, used] of [
    [all, 45],
    [social, 15],
  ] as const)
    days.push({
      id: derivedId("demo-screen-day", g.id, today),
      groupId: g.id,
      day: today,
      usedMin: used,
      closed: false,
      updatedAt: at(0, 9),
    })
  return { groups: [all, social], days }
}
