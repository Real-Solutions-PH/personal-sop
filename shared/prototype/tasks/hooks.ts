"use client"
import { useMemo } from "react"
import type { Task, TaskList } from "./data"
import {
  addDays,
  byDue,
  computeStats,
  doneDay,
  isOverdue,
  today,
} from "./logic"
import { tasksStore } from "./store"
export function useLists(includeArchived = false): TaskList[] {
  const lists = tasksStore.use((s) => s.lists)
  return useMemo(
    () =>
      lists
        .filter((l) => includeArchived || !l.archivedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [lists, includeArchived],
  )
}
export function useListMap(): Map<string, TaskList> {
  const lists = tasksStore.use((s) => s.lists)
  return useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists])
}
export interface TodayData {
  overdue: Task[]
  due: Task[]
  doneToday: Task[]
  doneDueToday: Task[]
  upcoming: {
    day: string
    tasks: Task[]
  }[]
  later: Task[]
  inbox: Task[]
  starred: Task[]
  shoppingOpen: number
  nextReminder: Task | null
  everHadTasks: boolean
}
export function useTodayData(): TodayData {
  const tasks = tasksStore.use((s) => s.tasks)
  const lists = tasksStore.use((s) => s.lists)
  return useMemo(() => {
    const tk = today()
    const shop = new Set(
      lists.filter((l) => l.kind === "shopping").map((l) => l.id),
    )
    const archived = new Set(lists.filter((l) => l.archivedAt).map((l) => l.id))
    const vis = tasks.filter(
      (t) =>
        t.status !== "deleted" &&
        !(t.listId && shop.has(t.listId)) &&
        !(t.listId && archived.has(t.listId)),
    )
    const open = vis.filter((t) => t.status === "open")
    const overdue = open.filter((t) => isOverdue(t, tk)).sort(byDue)
    const due = open.filter((t) => t.dueDate === tk).sort(byDue)
    const doneToday = vis.filter(
      (t) => t.status === "done" && doneDay(t) === tk,
    )
    const doneDueToday = doneToday.filter((t) => !!t.dueDate && t.dueDate <= tk)
    const upcoming = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(tk, i + 1)
      return { day, tasks: open.filter((t) => t.dueDate === day).sort(byDue) }
    })
    const horizon = addDays(tk, 7)
    const later = open
      .filter((t) => !!t.dueDate && t.dueDate > horizon)
      .sort(byDue)
    const now = Date.now()
    const nextReminder =
      open
        .filter((t) => t.remindAt && new Date(t.remindAt).getTime() > now)
        .sort((a, b) =>
          (a.remindAt ?? "").localeCompare(b.remindAt ?? ""),
        )[0] ?? null
    return {
      overdue,
      due,
      doneToday,
      doneDueToday,
      upcoming,
      later,
      inbox: open.filter((t) => t.listId === null).sort(byDue),
      starred: open.filter((t) => t.starred).sort(byDue),
      shoppingOpen: tasks.filter(
        (t) =>
          t.status === "open" &&
          t.listId &&
          shop.has(t.listId) &&
          !archived.has(t.listId),
      ).length,
      nextReminder,
      everHadTasks: tasks.length > 0,
    }
  }, [tasks, lists])
}
export function useStats(days: number, offset = 0) {
  const state = tasksStore.use((s) => s)
  return useMemo(() => {
    const to = addDays(today(), -offset)
    return computeStats(state, addDays(to, -(days - 1)), to)
  }, [state, days, offset])
}
