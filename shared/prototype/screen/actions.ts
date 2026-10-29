// What the screen-time settings and the foreground reconcile do. Every
// action writes the store; the sync engine diffs it into screen_group and
// screen_day rows, and reconciled habit logs into habit_log rows, exactly as
// a tap's log would.

import type { HabitLog } from "../habits/data"
import { habitsStore } from "../habits/store"
import { newId } from "../lib/ids"
import { ALL_GROUP, type ScreenDay, type ScreenGroup } from "./data"
import { screenStore } from "./store"

const S = screenStore
const nextOrder = (groups: ScreenGroup[]) =>
  groups.length ? Math.max(...groups.map((g) => g.sortOrder)) + 1 : 0

/** A custom group with a daily budget in minutes; returns its id. */
export function addGroup(name: string, budgetMin: number): string {
  const id = newId()
  S.set((s) => ({
    ...s,
    groups: [
      ...s.groups,
      {
        id,
        name: name.trim().slice(0, 40),
        kind: "custom",
        budgetMin: Math.max(0, Math.round(budgetMin)),
        sortOrder: nextOrder(s.groups),
      },
    ],
  }))
  return id
}

export function updateGroup(
  id: string,
  patch: Partial<Pick<ScreenGroup, "name" | "budgetMin" | "sortOrder">>,
): void {
  S.set((s) => ({
    ...s,
    groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
  }))
}

/** The live habits whose rule points at the group. */
export function habitsUsing(groupId: string) {
  return habitsStore
    .get()
    .habits.filter(
      (h) =>
        h.rule?.groupId === groupId && h.status !== "archived" && !h.archivedAt,
    )
}

/** Archive a group. Refused, as the server refuses it, while a live habit's
 * rule points at it: change or archive those habits first. */
export function archiveGroup(id: string): void {
  if (habitsUsing(id).length) throw new Error("screen_group_in_use")
  const now = new Date().toISOString()
  S.set((s) => ({
    ...s,
    groups: s.groups.map((g) =>
      g.id === id && !g.archivedAt ? { ...g, archivedAt: now } : g,
    ),
  }))
}

/** The one "All apps" group, made when missing; returns its id. */
export function ensureAllGroup(): string {
  const found = S.get().groups.find((g) => g.kind === "all")
  if (found) return found.id
  const id = newId()
  S.set((s) => ({
    ...s,
    groups: [
      ...s.groups,
      {
        id,
        name: ALL_GROUP.name,
        kind: "all",
        budgetMin: ALL_GROUP.budgetMin,
        sortOrder: nextOrder(s.groups),
      },
    ],
  }))
  return id
}

/** Write what `reconcile` produced. A day row lands on the row already held
 * for its group and day (keeping that id, the higher minutes, and closed once
 * either was); a habit log is added only where the habit has none that day. */
export function applyReconcile(r: {
  days: ScreenDay[]
  logs: HabitLog[]
}): void {
  if (r.days.length)
    S.set((s) => {
      const key = (d: ScreenDay) => `${d.groupId}|${d.day}`
      const held = new Map(s.days.map((d) => [key(d), d]))
      const fresh: string[] = []
      for (const d of r.days) {
        const prev = held.get(key(d))
        if (!prev) fresh.push(key(d))
        held.set(
          key(d),
          prev
            ? {
                ...d,
                id: prev.id,
                usedMin: Math.max(prev.usedMin, d.usedMin),
                closed: prev.closed || d.closed,
              }
            : d,
        )
      }
      return {
        ...s,
        days: [
          ...s.days.map((d) => held.get(key(d)) ?? d),
          ...fresh.map((k) => held.get(k) as ScreenDay),
        ],
      }
    })
  if (r.logs.length)
    habitsStore.set((s) => {
      const have = new Set(s.logs.map((l) => `${l.habitId}|${l.day}`))
      const add: HabitLog[] = []
      for (const l of r.logs) {
        const k = `${l.habitId}|${l.day}`
        if (have.has(k)) continue
        have.add(k)
        add.push(l)
      }
      return add.length ? { ...s, logs: [...s.logs, ...add] } : s
    })
}
