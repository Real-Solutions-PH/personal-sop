// Screen time's records on the device: the same rows the server keeps
// (screen_group, screen_day), camelCased, plus a habit's screen-time rule and
// the events the device-activity-monitor extension writes to the App Group.
// Every minute figure here is a lower bound: the highest threshold crossed.

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
