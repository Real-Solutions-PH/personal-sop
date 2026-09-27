import { useMemo } from "react"
import type { CalendarItem, Metric, Miss, ModuleContract } from "../contract"
import { useStats, useTodayData } from "./hooks"
import { addDays, diffDays, doneDay, isShopping, today } from "./logic"
import { tasksStore } from "./store"
import { TasksTodayCard } from "./today-card"

// M2 Tasks module seam (proto/contract.ts).

const round1 = (n: number) => Math.round(n * 10) / 10

function useMetrics(days: number): Metric[] {
  const cur = useStats(days)
  const prev = useStats(days, days)
  return useMemo(() => {
    const pp = (v: number | null) => (v === null ? 0 : Math.round(v * 100))
    return [
      {
        key: "tasks.done",
        label: "Tasks done",
        value: String(cur.done),
        delta: cur.done - prev.done,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "tasks.onTime",
        label: "On-time rate",
        value: cur.onTimeRate === null ? "—" : `${pp(cur.onTimeRate)}%`,
        delta: pp(cur.onTimeRate) - pp(prev.onTimeRate),
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "tasks.streak",
        label: "Done streak",
        value: `${cur.streak}-day`,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "tasks.overdue",
        label: "Overdue now",
        value: String(cur.overdueNow),
        goodWhen: "down",
        shareable: false,
      },
      {
        key: "tasks.reschedules",
        label: "Reschedules",
        value: String(cur.reschedules),
        delta: cur.reschedules - prev.reschedules,
        goodWhen: "down",
        shareable: false,
      },
      {
        key: "tasks.followThrough",
        label: "Follow-through ratio",
        value: cur.followThrough.toFixed(1),
        delta: round1(cur.followThrough - prev.followThrough),
        goodWhen: "up",
        shareable: true,
      },
    ]
  }, [cur, prev])
}

/** Life Score area rate: on-time rate over the window (no data → neutral 0.5). */
function useAreaRate(days: number, offset = 0): number {
  const s = useStats(days, offset)
  return s.onTimeRate ?? 0.5
}

function useCalendar(from: string, to: string): CalendarItem[] {
  const tasks = tasksStore.use((s) => s.tasks)
  const lists = tasksStore.use((s) => s.lists)
  return useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            t.status !== "deleted" &&
            t.dueDate &&
            t.dueDate >= from &&
            t.dueDate <= to &&
            !isShopping(lists, t.listId),
        )
        .map((t) => ({
          id: `task:${t.id}`,
          day: t.dueDate ?? "",
          time: t.dueTime ?? undefined,
          title: t.title,
          module: "tasks" as const,
          done: t.status === "done",
          href: `/tasks/task/${t.id}`,
        })),
    [tasks, lists, from, to],
  )
}

function useMisses(from: string, to: string): Miss[] {
  const tasks = tasksStore.use((s) => s.tasks)
  const lists = tasksStore.use((s) => s.lists)
  return useMemo(() => {
    const tk = today()
    const out: Miss[] = []
    for (const t of tasks) {
      if (t.status === "deleted" || !t.dueDate || isShopping(lists, t.listId))
        continue
      if (
        t.status === "open" &&
        t.dueDate < tk &&
        t.dueDate >= from &&
        t.dueDate <= to
      )
        out.push({
          id: `task-overdue:${t.id}`,
          day: t.dueDate,
          title: `Overdue ${diffDays(t.dueDate, tk)}d: ${t.title}`,
          module: "tasks",
          href: `/tasks/task/${t.id}`,
        })
      const dd = doneDay(t)
      if (
        t.status === "done" &&
        dd &&
        t.originalDue &&
        dd > t.originalDue &&
        dd >= from &&
        dd <= to
      )
        out.push({
          id: `task-late:${t.id}`,
          day: dd,
          title: `Done ${diffDays(t.originalDue, dd)}d late: ${t.title}`,
          module: "tasks",
          href: `/tasks/task/${t.id}`,
        })
      if (
        t.status === "open" &&
        t.rescheduleCount >= 3 &&
        t.dueDate >= from &&
        t.dueDate <= addDays(to, 30)
      )
        out.push({
          id: `task-pushed:${t.id}`,
          day: t.dueDate,
          title: `Pushed ${t.rescheduleCount}×: ${t.title}`,
          module: "tasks",
          href: `/tasks/task/${t.id}`,
        })
    }
    return out.sort((a, b) => b.day.localeCompare(a.day))
  }, [tasks, lists, from, to])
}

function useTodayProgress() {
  const d = useTodayData()
  const due = d.due.length + d.overdue.length + d.doneDueToday.length
  const done = d.doneDueToday.length
  return useMemo(() => ({ due, done }), [due, done])
}

export const module: ModuleContract = {
  key: "tasks",
  label: "Tasks",
  TodayCard: TasksTodayCard,
  useAreaRate,
  useMetrics,
  useCalendar,
  useMisses,
  useTodayProgress,
  href: "/tasks",
}

export { TasksPlanView } from "./plan"
export { TaskSheets } from "./sheets"
export { openQuickAdd, openTask, openTriage } from "./ui"
