import { useMemo } from "react"
import type { CalendarItem, Metric, Miss, ModuleContract } from "../contract"
import { dayKey } from "../lib/day"
import {
  cellFor,
  daysBetween,
  fmtMinutes,
  isDue,
  lk,
  logIndex,
  overallStats,
  runState,
  slotFor,
  streaks,
} from "./logic"
import { habitsStore } from "./store"

const useState = () => habitsStore.use((s) => s)
function useAreaRate(days: number, offset = 0) {
  const s = useState()
  return useMemo(() => overallStats(s, days, offset).rate, [s, days, offset])
}
function useMetrics(days: number): Metric[] {
  const s = useState()
  return useMemo(() => {
    const cur = overallStats(s, days)
    const prev = overallStats(s, days, days)
    const idx = logIndex(s.logs)
    const active = s.habits.filter((h) => h.status !== "archived")
    const st = active.map((h) => ({ h, ...streaks(h, idx) }))
    const top = st.sort((a, b) => b.current - a.current)[0]
    return [
      {
        key: "habits.rate",
        label: "Habit completion",
        value: `${Math.round(cur.rate * 100)}%`,
        delta: Math.round((cur.rate - prev.rate) * 100),
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "habits.streak",
        label: top ? `Top streak · ${top.h.name}` : "Top streak",
        value: `${top?.current ?? 0}-day`,
        shareable: true,
      },
      {
        key: "habits.perfect",
        label: "Perfect days",
        value: String(cur.perfect),
        delta: cur.perfect - prev.perfect,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "habits.time",
        label: "Time invested",
        value: fmtMinutes(cur.minutes),
        delta: Math.round((cur.minutes - prev.minutes) / 60),
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "habits.skip",
        label: "Skip rate",
        value: `${Math.round(cur.skipRate * 100)}%`,
        delta: Math.round((cur.skipRate - prev.skipRate) * 100),
        goodWhen: "down",
        shareable: true,
      },
    ]
  }, [s, days])
}
function useCalendar(from: string, to: string): CalendarItem[] {
  const s = useState()
  return useMemo(() => {
    const idx = logIndex(s.logs)
    const out: CalendarItem[] = []
    for (const day of daysBetween(from, to)) {
      for (const r of s.routines) {
        if (r.status !== "active" || day < r.createdAt) continue
        const slot = slotFor(r.schedule, day)
        if (!slot) continue
        out.push({
          id: `routine-${r.id}-${day}`,
          day,
          time: slot.time,
          title: `${r.icon} ${r.name}`,
          module: "habits",
          done: s.runs.some(
            (x) =>
              x.routineId === r.id && x.day === day && x.state === "completed",
          ),
          href: `/habits/routines/${r.id}`,
        })
      }
      for (const h of s.habits) {
        if (!isDue(h, day)) continue
        out.push({
          id: `habit-${h.id}-${day}`,
          day,
          time: slotFor(h.schedule, day)?.time,
          title: `${h.icon} ${h.name}`,
          module: "habits",
          done: idx.get(lk(h.id, day))?.status === "done",
          href: `/habits/${h.id}`,
        })
      }
    }
    return out
  }, [s, from, to])
}
function useMisses(from: string, to: string): Miss[] {
  const s = useState()
  return useMemo(() => {
    const today = dayKey()
    const idx = logIndex(s.logs)
    const out: Miss[] = []
    for (const day of daysBetween(from, to)) {
      for (const h of s.habits)
        if (cellFor(h, day, idx, today) === "missed")
          out.push({
            id: `miss-${h.id}-${day}`,
            day,
            title: `Missed: ${h.name}`,
            module: "habits",
            href: `/habits/${h.id}`,
          })
    }
    for (const run of s.runs)
      if (
        run.day >= from &&
        run.day <= to &&
        runState(run, today) === "abandoned"
      ) {
        const r = s.routines.find((x) => x.id === run.routineId)
        out.push({
          id: `abandon-${run.id}`,
          day: run.day,
          title: `${r?.name ?? "Routine"} abandoned at ${run.current}/${run.steps.length}`,
          module: "habits",
          href: `/habits/routines/${run.routineId}`,
        })
      }
    return out
  }, [s, from, to])
}
function useTodayProgress() {
  const s = useState()
  return useMemo(() => {
    const today = dayKey()
    const idx = logIndex(s.logs)
    let due = 0
    let done = 0
    for (const h of s.habits) {
      if (!isDue(h, today)) continue
      const l = idx.get(lk(h.id, today))
      if (l?.status === "skipped") continue
      due++
      if (l?.status === "done") done++
    }
    return { due, done }
  }, [s])
}
export const module: ModuleContract = {
  key: "habits",
  label: "Habits",
  useAreaRate,
  useMetrics,
  useCalendar,
  useMisses,
  useTodayProgress,
  href: "/habits",
}
