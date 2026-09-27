"use client"

import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Pencil,
  Plus,
  Repeat,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { dayKey } from "../lib/day"
import { Btn, Card, Ring, SectionTitle } from "../ui/kit"
import { WEEKDAY_SHORT } from "./data"
import {
  addDays,
  cellFor,
  fmtTime,
  isDue,
  lk,
  logIndex,
  plannedMin,
  runState,
  slotFor,
  sortedHabits,
  toMin,
  weekStartOf,
} from "./logic"
import { habitsStore } from "./store"
import { fmtDay, HabitIcon, Skeleton, StatusGlyph, useMounted } from "./ui"

/** HAB-22 — Plan › Habits: this week's habit + routine schedule by day. */
export function HabitsPlanView() {
  const mounted = useMounted()
  if (!mounted) return <Skeleton rows={5} />
  return <PlanInner />
}

function PlanInner() {
  const state = habitsStore.use((s) => s)
  const today = dayKey()
  const [week, setWeek] = useState(0)
  const [sel, setSel] = useState(today)
  const start = addDays(weekStartOf(today, state.settings.weekStart), week * 7)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))

  const perDay = useMemo(() => {
    const idx = logIndex(state.logs)
    const hs = sortedHabits(state.habits.filter((h) => h.status !== "archived"))
    return new Map(
      days.map((d) => {
        const due = hs.filter((h) => isDue(h, d))
        const done = due.filter(
          (h) => idx.get(lk(h.id, d))?.status === "done",
        ).length
        return [d, { due: due.length, done }]
      }),
    )
  }, [state, days])

  const items = useMemo(() => {
    const idx = logIndex(state.logs)
    const hs = sortedHabits(state.habits.filter((h) => h.status !== "archived"))
    const list: {
      key: string
      time?: string
      node: React.ReactNode
    }[] = []
    for (const r of state.routines) {
      if (r.status !== "active" || sel < r.createdAt) continue
      const slot = slotFor(r.schedule, sel)
      if (!slot) continue
      const run = state.runs.find((x) => x.routineId === r.id && x.day === sel)
      const st = run ? runState(run, today) : null
      list.push({
        key: `r-${r.id}`,
        time: slot.time,
        node: (
          <Link
            href={`/habits/routines/${r.id}`}
            className="flex items-center gap-3 rounded-xl bg-hab/10 px-3 py-2.5"
          >
            <HabitIcon icon={r.icon} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{r.name}</div>
              <div className="text-muted-foreground text-xs">
                Routine · {r.steps.length} steps · {plannedMin(r)}m
              </div>
            </div>
            <span
              className={cn(
                "text-xs",
                st === "completed"
                  ? "text-good"
                  : st === "abandoned"
                    ? "text-bad"
                    : "text-muted-foreground",
              )}
            >
              {st === "completed"
                ? "✓ done"
                : st === "abandoned"
                  ? `abandoned ${run?.current}/${run?.steps.length}`
                  : st === "in_progress"
                    ? "in progress"
                    : sel < today
                      ? "not run"
                      : ""}
            </span>
          </Link>
        ),
      })
    }
    for (const h of hs) {
      const c = cellFor(h, sel, idx, today)
      if (c === "none") continue
      const slot = slotFor(h.schedule, sel)
      list.push({
        key: h.id,
        time: slot?.time,
        node: (
          <Link
            href={`/habits/${h.id}`}
            className="flex items-center gap-3 px-3 py-2"
          >
            <StatusGlyph cell={c} />
            <span aria-hidden>{h.icon}</span>
            <span
              className={cn(
                "flex-1 truncate text-sm",
                (c === "paused" || c === "bonus") && "text-muted-foreground",
              )}
            >
              {h.name}
              {c === "paused" && " · paused"}
              {c === "bonus" && " · bonus"}
            </span>
          </Link>
        ),
      })
    }
    return list.sort(
      (a, b) => toMin(a.time ?? "99:99") - toMin(b.time ?? "99:99"),
    )
  }, [state, sel, today])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => setWeek((w) => w - 1)}
          className="grid size-9 place-items-center rounded-full hover:bg-muted"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setWeek(0)
            setSel(today)
          }}
          className="font-medium text-sm"
        >
          {week === 0
            ? "This week"
            : `${fmtDay(days[0], { month: "short", day: "numeric" })} – ${fmtDay(days[6], { month: "short", day: "numeric" })}`}
        </button>
        <button
          type="button"
          aria-label="Next week"
          onClick={() => setWeek((w) => w + 1)}
          className="grid size-9 place-items-center rounded-full hover:bg-muted"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const p = perDay.get(d) ?? { due: 0, done: 0 }
          const past = d <= today
          return (
            <button
              key={d}
              type="button"
              onClick={() => setSel(d)}
              aria-pressed={sel === d}
              className={cn(
                "flex flex-col items-center gap-1 rounded-2xl py-2",
                sel === d ? "bg-hab/15" : "active:bg-muted",
              )}
            >
              <span className="text-[10px] text-muted-foreground">
                {WEEKDAY_SHORT[new Date(`${d}T12:00:00`).getDay()][0]}
              </span>
              <Ring
                value={past && p.due ? p.done / p.due : 0}
                size={34}
                stroke={3}
                accent="hab"
              >
                <span
                  className={cn(
                    "num font-semibold text-xs",
                    d === today && "text-hab",
                  )}
                >
                  {Number(d.slice(8))}
                </span>
              </Ring>
              <span className="num text-[10px] text-muted-foreground">
                {past ? `${p.done}/${p.due}` : p.due}
              </span>
            </button>
          )
        })}
      </div>

      <SectionTitle
        action={
          sel <= today ? (
            <Link
              href={`/habits/day/${sel}`}
              className="inline-flex items-center gap-1 text-hab text-xs"
            >
              <Pencil className="size-3" /> Edit day
            </Link>
          ) : null
        }
      >
        {sel === today ? "Today" : fmtDay(sel)}
      </SectionTitle>
      <Card className="p-1">
        {items.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            Nothing scheduled — rest day.
          </div>
        ) : (
          (() => {
            let lastLabel = ""
            return items.map((it) => {
              const label = fmtTime(it.time)
              const show = label !== lastLabel
              lastLabel = label
              return (
                <div key={it.key}>
                  {show && (
                    <div className="num px-3 pt-2 font-medium text-[11px] text-muted-foreground">
                      {label}
                    </div>
                  )}
                  {it.node}
                </div>
              )
            })
          })()
        )}
      </Card>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Btn variant="secondary" href="/habits/manage" className="px-2">
          <ListChecks className="size-4" /> Habits
        </Btn>
        <Btn variant="secondary" href="/habits/routines" className="px-2">
          <Repeat className="size-4" /> Routines
        </Btn>
        <Btn accent="hab" href="/habits/new" className="px-2">
          <Plus className="size-4" /> New
        </Btn>
      </div>
    </div>
  )
}
