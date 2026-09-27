"use client"

import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  MessageSquarePlus,
  Plus,
  Repeat,
  Search,
  SlidersHorizontal,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { openCapture } from "../../lib/capture"
import { dayKey, dayOffset } from "../../lib/day"
import { liveStore } from "../../lib/live"
import {
  Btn,
  Card,
  Chip,
  Empty,
  Screen,
  SectionTitle,
  Segmented,
} from "../../ui/kit"
import { reorderHabit, timerHref } from "../actions"
import { type Habit, type HabitType, STARTERS } from "../data"
import {
  effectiveStatus,
  habitStats,
  isDue,
  lk,
  logIndex,
  scheduleLabel,
  slotFor,
  sortedHabits,
  streaks,
  toMin,
} from "../logic"
import { habitsStore } from "../store"
import {
  BottomSheet,
  Gate,
  HabitIcon,
  HabitRow,
  LogSheet,
  StreakChip,
  useStartGuard,
  WeekDots,
} from "../ui"

type Sort = "manual" | "time" | "streak" | "rate" | "name"
type TimeOfDay = "all" | "morning" | "afternoon" | "evening" | "anytime"
interface Filters {
  q: string
  status: "all" | "active" | "paused"
  type: "all" | HabitType
  tod: TimeOfDay
  sort: Sort
}
const DEFAULT_FILTERS: Filters = {
  q: "",
  status: "all",
  type: "all",
  tod: "all",
  sort: "manual",
}

function EmptyHabits() {
  return (
    <Empty
      icon={<span className="text-5xl">🌱</span>}
      title="Track your first habit"
      body="Start small. Pick one of these, make your own, or just tell Capture what you did."
      action={
        <div className="flex w-72 flex-col gap-2">
          {STARTERS.map((s) => (
            <Link
              key={s.name}
              href={`/habits/new?name=${encodeURIComponent(s.name)}&icon=${encodeURIComponent(s.icon)}&type=${s.type}&target=${s.target ?? ""}&unit=${s.unit ?? ""}`}
              className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left"
            >
              <HabitIcon icon={s.icon} size="sm" />
              <span className="flex-1 font-medium text-sm">{s.name}</span>
              <span className="text-muted-foreground text-xs">
                {s.type === "duration"
                  ? `${s.target} min`
                  : `${s.target} ${s.unit}`}
              </span>
            </Link>
          ))}
          <Btn accent="hab" href="/habits/new">
            <Plus className="size-4" /> New habit
          </Btn>
          <Btn
            variant="ghost"
            onClick={() => openCapture({ mode: "text", hint: "habit" })}
          >
            <MessageSquarePlus className="size-4" /> or just tell Capture
          </Btn>
        </div>
      }
    />
  )
}

/** HAB-01 Habits list (+ HAB-01a empty, HAB-21 filter/sort). */
export function HabitsListScreen() {
  return (
    <Screen
      title="Habits"
      back
      actions={
        <>
          <Link
            href="/habits/manage/archived"
            aria-label="Archived habits"
            className="grid size-10 place-items-center rounded-full hover:bg-muted"
          >
            <Archive className="size-5" />
          </Link>
          <Link
            href="/habits/new"
            aria-label="New habit"
            className="grid size-10 place-items-center rounded-full bg-hab text-background"
          >
            <Plus className="size-5" />
          </Link>
        </>
      }
    >
      <Gate empty={<EmptyHabits />} rows={6}>
        <ListBody />
      </Gate>
    </Screen>
  )
}

function ListBody() {
  const state = habitsStore.use((s) => s)
  const live = liveStore.use((s) => s.live)
  const [mode, setMode] = useState<"today" | "all">("all")
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [reorder, setReorder] = useState(false)
  const [sheet, setSheet] = useState<Habit | null>(null)
  const guard = useStartGuard()
  const today = dayKey()

  const rows = useMemo(() => {
    const idx = logIndex(state.logs)
    const from = dayOffset(-29)
    let hs = sortedHabits(
      state.habits.filter((h) => h.status !== "archived"),
    ).map((h) => ({
      h,
      st: effectiveStatus(h, today),
      streak: streaks(h, idx, today).current,
      rate: habitStats(h, idx, from, today, today).rate,
      time: slotFor(h.schedule, today)?.time ?? h.schedule[0]?.time,
    }))
    if (mode === "today") hs = hs.filter((r) => isDue(r.h, today))
    if (f.q)
      hs = hs.filter((r) => r.h.name.toLowerCase().includes(f.q.toLowerCase()))
    if (f.status !== "all") hs = hs.filter((r) => r.st === f.status)
    if (f.type !== "all") hs = hs.filter((r) => r.h.type === f.type)
    if (f.tod !== "all")
      hs = hs.filter((r) => {
        if (!r.time) return f.tod === "anytime"
        const m = toMin(r.time)
        return f.tod === "morning"
          ? m < 12 * 60
          : f.tod === "afternoon"
            ? m >= 12 * 60 && m < 18 * 60
            : f.tod === "evening" && m >= 18 * 60
      })
    const by: Record<Sort, (a: (typeof hs)[0], b: (typeof hs)[0]) => number> = {
      manual: (a, b) => a.h.sortOrder - b.h.sortOrder,
      time: (a, b) => toMin(a.time ?? "99:99") - toMin(b.time ?? "99:99"),
      streak: (a, b) => b.streak - a.streak,
      rate: (a, b) => b.rate - a.rate,
      name: (a, b) => a.h.name.localeCompare(b.h.name),
    }
    return { list: hs.sort(by[f.sort]), idx }
  }, [state, mode, f, today])

  const activeCount = state.habits.filter((h) => h.status !== "archived").length
  const pausedCount = state.habits.filter(
    (h) => h.status !== "archived" && effectiveStatus(h, today) === "paused",
  ).length
  const filtered = JSON.stringify(f) !== JSON.stringify(DEFAULT_FILTERS)

  if (activeCount === 0) return <EmptyHabits />

  return (
    <div className="space-y-3 pt-1">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "today", label: "Today" },
          { value: "all", label: `All · ${activeCount}` },
        ]}
      />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip
          accent="hab"
          active={filtered}
          onClick={() => setFilterOpen(true)}
        >
          <SlidersHorizontal className="size-4" />
          {filtered ? "Filtered" : "Filter & sort"}
        </Chip>
        {pausedCount > 0 && (
          <Chip
            accent="hab"
            active={f.status === "paused"}
            onClick={() =>
              setF((x) => ({
                ...x,
                status: x.status === "paused" ? "all" : "paused",
              }))
            }
          >
            Paused · {pausedCount}
          </Chip>
        )}
        {mode === "all" && f.sort === "manual" && (
          <Chip
            accent="hab"
            active={reorder}
            onClick={() => setReorder((r) => !r)}
          >
            {reorder ? "Done reordering" : "Reorder"}
          </Chip>
        )}
      </div>

      {rows.list.length === 0 ? (
        <Card className="text-center text-muted-foreground text-sm">
          {mode === "today"
            ? "Nothing scheduled today — rest day."
            : "No habits match."}
          {filtered && (
            <button
              type="button"
              className="ml-1 text-hab"
              onClick={() => setF(DEFAULT_FILTERS)}
            >
              Reset filters
            </button>
          )}
        </Card>
      ) : mode === "today" ? (
        <Card className="py-2">
          {rows.list.map(({ h, streak }) => (
            <HabitRow
              key={h.id}
              habit={h}
              log={rows.idx.get(lk(h.id, today))}
              streak={streak}
              onMore={() => setSheet(h)}
              onTimer={() => guard.tryTimer(h.id)}
              running={live?.href === timerHref(h.id)}
            />
          ))}
        </Card>
      ) : (
        <Card className="p-1">
          {rows.list.map(({ h, st, streak, rate }, i) => (
            <div key={h.id} className="flex items-center">
              <Link
                href={`/habits/${h.id}`}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2.5 active:bg-muted/60",
                  st === "paused" && "opacity-60",
                )}
              >
                <HabitIcon icon={h.icon} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{h.name}</span>
                    {st === "paused" && (
                      <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                        PAUSED
                      </span>
                    )}
                  </div>
                  <div className="truncate text-muted-foreground text-xs">
                    {scheduleLabel(h.schedule)}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <WeekDots habit={h} logs={state.logs} />
                    <span className="num text-[11px] text-muted-foreground">
                      {Math.round(rate * 100)}%
                    </span>
                    <StreakChip n={streak} />
                  </div>
                </div>
                {!reorder && (
                  <ChevronRight className="size-4 text-muted-foreground" />
                )}
              </Link>
              {reorder && (
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label={`Move ${h.name} up`}
                    disabled={i === 0}
                    onClick={() => reorderHabit(h.id, -1)}
                    className="grid size-8 place-items-center rounded-lg disabled:opacity-20"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${h.name} down`}
                    disabled={i === rows.list.length - 1}
                    onClick={() => reorderHabit(h.id, 1)}
                    className="grid size-8 place-items-center rounded-lg disabled:opacity-20"
                  >
                    <ArrowDown className="size-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      <SectionTitle>Routines</SectionTitle>
      <Card href="/habits/routines" className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-2xl bg-hab/12 text-hab">
          <Repeat className="size-5" />
        </div>
        <div className="flex-1">
          <div className="font-medium">
            {state.routines.filter((r) => r.status === "active").length}{" "}
            routines
          </div>
          <div className="text-muted-foreground text-xs">
            Stack habits into one guided flow
          </div>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Card>

      <FilterSheet
        key={String(filterOpen)}
        open={filterOpen}
        onOpenChange={setFilterOpen}
        value={f}
        onApply={setF}
      />
      <LogSheet
        habit={sheet}
        open={!!sheet}
        onOpenChange={(o) => !o && setSheet(null)}
      />
      {guard.dialog}
    </div>
  )
}

/** HAB-21 filter / sort sheet. */
function FilterSheet({
  open,
  onOpenChange,
  value,
  onApply,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  value: Filters
  onApply: (f: Filters) => void
}) {
  const [f, setF] = useState(value)
  const group = <K extends keyof Filters>(
    k: K,
    label: string,
    opts: [Filters[K], string][],
  ) => (
    <div>
      <div className="mb-2 text-muted-foreground text-xs">{label}</div>
      <div className="flex flex-wrap gap-2">
        {opts.map(([v, l]) => (
          <Chip
            key={String(v)}
            accent="hab"
            active={f[k] === v}
            onClick={() => setF((x) => ({ ...x, [k]: v }))}
          >
            {l}
          </Chip>
        ))}
      </div>
    </div>
  )
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Filter & sort">
      <div className="space-y-4 pb-2">
        <label className="flex h-11 items-center gap-2 rounded-xl border border-border px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={f.q}
            onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))}
            placeholder="Search habits"
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        {group("status", "Status", [
          ["all", "All"],
          ["active", "Active"],
          ["paused", "Paused"],
        ])}
        {group("type", "Type", [
          ["all", "All"],
          ["check", "Check"],
          ["duration", "Timed"],
          ["count", "Count"],
        ])}
        {group("tod", "Time of day", [
          ["all", "All"],
          ["morning", "Morning"],
          ["afternoon", "Afternoon"],
          ["evening", "Evening"],
          ["anytime", "Anytime"],
        ])}
        {group("sort", "Sort by", [
          ["manual", "My order"],
          ["time", "Time"],
          ["streak", "Streak"],
          ["rate", "Rate"],
          ["name", "Name"],
        ])}
        <div className="flex gap-2">
          <Btn
            variant="secondary"
            onClick={() => {
              onApply(DEFAULT_FILTERS)
              onOpenChange(false)
            }}
          >
            Reset
          </Btn>
          <Btn
            accent="hab"
            className="flex-1"
            onClick={() => {
              onApply(f)
              onOpenChange(false)
            }}
          >
            Apply
          </Btn>
        </div>
      </div>
    </BottomSheet>
  )
}
