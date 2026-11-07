// The order the "What are you working on?" picker lists things in: open
// tasks by when they are due, then active habits. Overdue and today share
// the first group, since both are "now"; within it, and within each
// upcoming date, the more important task comes first, then the older due
// date, then starred, due time and the list's own order. Search keeps the
// same order.

import type { FocusItem } from "@domain/focus/data"
import type { Habit } from "@domain/habits/data"
import type { Task } from "@domain/tasks/data"
import { priorityRank } from "@domain/tasks/logic"

export type PickerSectionKey = "today" | "upcoming" | "undated" | "habits"

export interface PickerRow {
  item: FocusItem
  label: string
  /** The task behind a task row, for its priority, due date and list. */
  task?: Task
}

export interface PickerSection {
  key: PickerSectionKey
  title: string
  rows: PickerRow[]
}

const TITLES: Record<PickerSectionKey, string> = {
  today: "Today and overdue",
  upcoming: "Upcoming",
  undated: "No date",
  habits: "Habits",
}

const bucket = (t: Task, today: string): PickerSectionKey =>
  !t.dueDate ? "undated" : t.dueDate <= today ? "today" : "upcoming"

/** The date a task sorts under: overdue folds into today. */
const sortDay = (t: Task, today: string) =>
  !t.dueDate ? "" : t.dueDate < today ? today : t.dueDate

function compare(a: Task, b: Task, today: string): number {
  const da = sortDay(a, today),
    db = sortDay(b, today)
  if (da !== db) return da < db ? -1 : 1
  const p = priorityRank(a) - priorityRank(b)
  if (p) return p
  if ((a.dueDate ?? "") !== (b.dueDate ?? ""))
    return (a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1
  if (a.starred !== b.starred) return a.starred ? -1 : 1
  if ((a.dueTime ?? "99") !== (b.dueTime ?? "99"))
    return (a.dueTime ?? "99") < (b.dueTime ?? "99") ? -1 : 1
  return a.order - b.order
}

/** The picker's groups, in order, without the empty ones. */
export function pickerSections(
  tasks: Task[],
  habits: Habit[],
  query: string,
  today: string,
): PickerSection[] {
  const text = query.trim().toLowerCase()
  const hit = (s: string) => !text || s.toLowerCase().includes(text)
  const by: Record<PickerSectionKey, PickerRow[]> = {
    today: [],
    upcoming: [],
    undated: [],
    habits: [],
  }
  const open = tasks
    .filter((x) => x.status === "open" && hit(x.title))
    .sort((a, b) => compare(a, b, today))
  for (const x of open)
    by[bucket(x, today)].push({
      item: { kind: "task", id: x.id, title: x.title },
      label: x.title,
      task: x,
    })
  for (const h of habits)
    if (h.status === "active" && hit(`${h.icon} ${h.name}`))
      by.habits.push({
        item: { kind: "habit", id: h.id, title: h.name },
        label: `${h.icon} ${h.name}`,
      })
  return (Object.keys(TITLES) as PickerSectionKey[])
    .filter((k) => by[k].length)
    .map((k) => ({ key: k, title: TITLES[k], rows: by[k] }))
}
