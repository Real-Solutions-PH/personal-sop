"use client"

import {
  Check,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  Moon,
  Sun,
  Sunrise,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import type { CalendarItem, ModuleKey } from "../contract"
import { FinancePlanPanel } from "../finance"
import { HabitsPlanView } from "../habits"
import { dayKey } from "../lib/day"
import { TasksPlanView } from "../tasks"
import { Card, Chip, Empty, Screen, SectionTitle, Segmented } from "../ui/kit"
import { AREA, addDaysKey, MODULE_KEYS } from "./data"
import { useAllCalendar, useEnabled } from "./hooks"
import {
  ErrorCard,
  fmtDay,
  Loading,
  ModuleDot,
  useQueryParam,
  useViewState,
} from "./ui"

// Plan tab (IA global frame): Tasks · Habits · Calendar. Calendar merges every
// module's useCalendar — tasks, habit schedule, routines, workouts, bills, paydays (X-9).

type Seg = "tasks" | "habits" | "calendar"

export function PlanScreen() {
  const param = useQueryParam("seg")
  const enabled = useEnabled()
  const [seg, setSeg] = useState<Seg>("tasks")
  useEffect(() => {
    if (param === "tasks" || param === "habits" || param === "calendar")
      setSeg(param)
  }, [param])
  const change = (s: Seg) => {
    setSeg(s)
    window.history.replaceState(null, "", `/plan?seg=${s}`)
  }
  const options = [
    ...(enabled.tasks ? [{ value: "tasks" as Seg, label: "Tasks" }] : []),
    ...(enabled.habits ? [{ value: "habits" as Seg, label: "Habits" }] : []),
    { value: "calendar" as Seg, label: "Calendar" },
  ]
  const active = options.some((o) => o.value === seg) ? seg : "calendar"

  return (
    <Screen title="Plan">
      <div className="sticky top-14 z-10 -mx-4 bg-background/85 px-4 pb-3 backdrop-blur-md">
        <Segmented value={active} onChange={change} options={options} />
      </div>
      {active === "tasks" && <TasksPlanView />}
      {active === "habits" && <HabitsPlanView />}
      {active === "calendar" && <CalendarView />}
    </Screen>
  )
}

// ---------------------------------------------------------------- calendar

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"]
const DOT: Record<ModuleKey, string> = {
  habits: "bg-hab",
  tasks: "bg-tsk",
  fitness: "bg-fit",
  nutrition: "bg-nut",
  focus: "bg-foc",
  finance: "bg-fin",
}

const mondayOf = (key: string) => {
  const d = new Date(`${key}T12:00:00`)
  return addDaysKey(key, -((d.getDay() + 6) % 7))
}

function CalendarView() {
  const state = useViewState()
  const today = dayKey()
  const enabled = useEnabled()
  const [mode, setMode] = useState<"month" | "week">("month")
  const [offset, setOffset] = useState(0)
  const [sel, setSel] = useState(today)
  const [hidden, setHidden] = useState<ModuleKey[]>([])

  const { from, to, days, anchorLabel } = useMemo(() => {
    if (mode === "week") {
      const start = addDaysKey(mondayOf(today), offset * 7)
      const ds = Array.from({ length: 7 }, (_, i) => addDaysKey(start, i))
      return {
        from: ds[0],
        to: ds[6],
        days: ds,
        anchorLabel: `${fmtDay(ds[0])} – ${fmtDay(ds[6])}`,
      }
    }
    const d = new Date(`${today}T12:00:00`)
    d.setDate(1)
    d.setMonth(d.getMonth() + offset)
    const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
    const start = mondayOf(first)
    const ds = Array.from({ length: 42 }, (_, i) => addDaysKey(start, i))
    return {
      from: ds[0],
      to: ds[41],
      days: ds,
      anchorLabel: d.toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric",
      }),
    }
  }, [mode, offset, today])
  const monthPrefix = mode === "month" ? days[15].slice(0, 7) : null

  const all = useAllCalendar(from, to)
  const items = useMemo(
    () => all.filter((i) => !hidden.includes(i.module)),
    [all, hidden],
  )
  const byDay = useMemo(() => {
    const m = new Map<string, typeof items>()
    for (const i of items) m.set(i.day, [...(m.get(i.day) ?? []), i])
    return m
  }, [items])
  const selItems = byDay.get(sel) ?? []

  if (state === "loading") return <Loading rows={3} />

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous"
          onClick={() => setOffset((o) => o - 1)}
          className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setOffset(0)
            setSel(today)
          }}
          className="flex-1 text-center font-semibold"
        >
          {anchorLabel}
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={() => setOffset((o) => o + 1)}
          className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted"
        >
          <ChevronRight className="size-5" />
        </button>
        <div className="w-28">
          <Segmented
            value={mode}
            onChange={(m) => {
              setMode(m)
              setOffset(0)
            }}
            options={[
              { value: "month", label: "M" },
              { value: "week", label: "W" },
            ]}
          />
        </div>
      </div>

      {state === "error" && <ErrorCard what="the calendar" />}

      <Card className="p-2">
        <div className="grid grid-cols-7 gap-0.5 pb-1 text-center text-[10px] text-muted-foreground">
          {WEEKDAYS.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {days.map((d) => {
            const list = byDay.get(d) ?? []
            const mods = MODULE_KEYS.filter((k) =>
              list.some((i) => i.module === k),
            )
            const dim = monthPrefix && !d.startsWith(monthPrefix)
            const allDone = list.length > 0 && list.every((i) => i.done)
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSel(d)}
                aria-label={`${fmtDay(d, { weekday: "long", month: "long", day: "numeric" })}, ${list.length} items`}
                aria-pressed={sel === d}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl py-1.5",
                  mode === "week" ? "h-20" : "h-14",
                  sel === d ? "bg-primary/15" : "active:bg-muted",
                  dim && "opacity-35",
                )}
              >
                <span
                  className={cn(
                    "num grid size-7 place-items-center rounded-full text-sm",
                    d === today && "bg-primary font-semibold text-background",
                    d < today && allDone && d !== today && "text-good",
                  )}
                >
                  {Number(d.slice(8))}
                </span>
                <span className="flex gap-0.5">
                  {mods.map((k) => (
                    <span
                      key={k}
                      className={cn("size-1.5 rounded-full", DOT[k])}
                    />
                  ))}
                </span>
                {mode === "week" && list.length > 0 && (
                  <span className="font-display num text-[10px] text-muted-foreground">
                    {list.length}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </Card>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {MODULE_KEYS.filter((k) => enabled[k]).map((k) => (
          <Chip
            key={k}
            active={!hidden.includes(k)}
            accent={AREA[k].accent}
            onClick={() =>
              setHidden((h) =>
                h.includes(k) ? h.filter((x) => x !== k) : [...h, k],
              )
            }
            className="h-11 text-xs"
          >
            {AREA[k].label}
          </Chip>
        ))}
      </div>

      <SectionTitle>
        {sel === today
          ? "Today"
          : fmtDay(sel, { weekday: "long", month: "short", day: "numeric" })}
        {" · "}
        {selItems.length}
      </SectionTitle>
      {selItems.length === 0 ? (
        <Card>
          <Empty
            title="Nothing scheduled"
            body="Free day — add a task or let it breathe."
          />
        </Card>
      ) : (
        <DayParts items={selItems} isToday={sel === today} />
      )}

      {enabled.finance && (
        <>
          <SectionTitle
            action={
              <Link href="/finance/planned" className="text-fin text-xs">
                All scheduled
              </Link>
            }
          >
            Bills & paydays
          </SectionTitle>
          <FinancePlanPanel />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- day parts

// The day split into fixed blocks (day-part planning). Night wraps past
// midnight to the 04:00 day boundary, so a 01:00 item stays in tonight's block.
const PARTS = [
  {
    key: "early",
    label: "Early morning",
    range: "4–8 AM",
    from: 4,
    to: 8,
    icon: Sunrise,
  },
  {
    key: "morning",
    label: "Morning",
    range: "8 AM–12 PM",
    from: 8,
    to: 12,
    icon: Sun,
  },
  {
    key: "afternoon",
    label: "Afternoon",
    range: "12–6 PM",
    from: 12,
    to: 18,
    icon: CloudSun,
  },
  {
    key: "night",
    label: "Night",
    range: "6 PM–4 AM",
    from: 18,
    to: 28,
    icon: Moon,
  },
] as const

const partOf = (time: string) => {
  const h = Number(time.slice(0, 2))
  const hh = h < 4 ? h + 24 : h
  return PARTS.find((p) => hh >= p.from && hh < p.to)?.key ?? "night"
}

function DayParts({
  items,
  isToday,
}: {
  items: CalendarItem[]
  isToday: boolean
}) {
  const nowH = new Date().getHours()
  const nowPart = partOf(`${String(nowH).padStart(2, "0")}:00`)
  const anytime = items.filter((i) => !i.time)
  const groups = PARTS.map((p) => ({
    ...p,
    items: items
      .filter((i) => i.time && partOf(i.time) === p.key)
      .sort((a, b) => {
        // keep after-midnight items at the end of the night block
        const k = (t = "") => (Number(t.slice(0, 2)) < 4 ? `2${t}` : `1${t}`)
        return k(a.time).localeCompare(k(b.time))
      }),
  }))
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const done = g.items.filter((i) => i.done).length
        const current = isToday && g.key === nowPart
        return (
          <section
            key={g.key}
            aria-label={`${g.label}, ${g.range}: ${g.items.length} items`}
            className={cn(
              "rounded-2xl border bg-card",
              current ? "border-primary/60" : "border-border/60",
            )}
          >
            <div className="flex items-center gap-2 px-3 pt-3 pb-1">
              <g.icon
                className={cn(
                  "size-4",
                  current ? "text-primary" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
              <span className="font-semibold text-sm">{g.label}</span>
              <span className="text-muted-foreground text-xs">{g.range}</span>
              {current && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-[10px] text-primary uppercase tracking-wider">
                  Now
                </span>
              )}
              {g.items.length > 0 && (
                <span className="num ml-auto text-muted-foreground text-xs">
                  {done}/{g.items.length}
                </span>
              )}
            </div>
            {g.items.length === 0 ? (
              <div className="px-3 pb-3 text-muted-foreground/70 text-xs">
                Nothing planned
              </div>
            ) : (
              <div className="px-3 pb-1">
                {g.items.map((i) => (
                  <CalRow key={i.id} i={i} />
                ))}
              </div>
            )}
          </section>
        )
      })}
      {anytime.length > 0 && (
        <section
          aria-label={`Anytime: ${anytime.length} items`}
          className="rounded-2xl border border-border/60 bg-card"
        >
          <div className="px-3 pt-3 pb-1 font-semibold text-sm">Anytime</div>
          <div className="px-3 pb-1">
            {anytime.map((i) => (
              <CalRow key={i.id} i={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function CalRow({ i }: { i: CalendarItem }) {
  return (
    <Link
      href={i.href}
      className="flex min-h-12 items-center gap-3 border-border/50 border-b py-2 last:border-0"
    >
      <ModuleDot module={i.module} />
      <span className="num w-11 shrink-0 text-muted-foreground text-xs">
        {i.time ?? "any"}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          i.done && "text-muted-foreground line-through",
        )}
      >
        {i.title}
      </span>
      {i.done ? (
        <Check className="size-4 text-good" aria-label="Done" />
      ) : (
        <ChevronRight
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      )}
    </Link>
  )
}
