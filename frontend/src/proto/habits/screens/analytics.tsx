"use client"

import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  ListChecks,
  Repeat,
  Settings,
  Share2,
  TrendingUp,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { dayKey, dayOffset } from "../../lib/day"
import {
  Bars,
  Btn,
  Card,
  Empty,
  Heatmap,
  Ring,
  Screen,
  SectionTitle,
  Segmented,
  Sparkline,
  Stat,
} from "../../ui/kit"
import {
  addDays,
  fmtMinutes,
  habitStats,
  logIndex,
  mostMissedWeekday,
  overallDays,
  overallStats,
  pct,
  routineStats,
  sortedHabits,
  streaks,
  weekStartOf,
} from "../logic"
import { RoutineProgressCard } from "../routine-progress"
import { habitsStore } from "../store"
import { fmtDay, Gate, HabitIcon, StreakChip } from "../ui"

type Period = "7" | "30" | "90" | "365"
type RankSort = "rate" | "streak" | "skip" | "name"

const emptyAnalytics = (
  <Empty
    icon={<TrendingUp aria-hidden="true" className="size-12" />}
    title="No habit data yet"
    body="Check off a habit for a few days and your completion rate, streaks and misses show up here."
    action={
      <Btn href="/habits/new" accent="hab">
        Add a habit
      </Btn>
    }
  />
)

/** HAB-16 Habits analytics — the module home (Stats › Habits). */
export function AnalyticsScreen() {
  return (
    <Screen
      title="Habits"
      back
      actions={
        <>
          <Link
            href="/habits/week"
            aria-label="Week schedule"
            className="grid size-10 place-items-center rounded-full hover:bg-muted"
          >
            <CalendarDays className="size-5" />
          </Link>
          <Link
            href="/habits/settings"
            aria-label="Habit settings"
            className="grid size-10 place-items-center rounded-full hover:bg-muted"
          >
            <Settings className="size-5" />
          </Link>
        </>
      }
    >
      <Gate empty={emptyAnalytics} rows={6}>
        <Body />
      </Gate>
    </Screen>
  )
}

function Body() {
  const state = habitsStore.use((s) => s)
  const [period, setPeriod] = useState<Period>("30")
  const [sort, setSort] = useState<RankSort>("rate")
  const days = Number(period)
  const today = dayKey()

  const d = useMemo(() => {
    const idx = logIndex(state.logs)
    const hs = sortedHabits(state.habits.filter((h) => h.status !== "archived"))
    const from = dayOffset(-days + 1)
    const cur = overallStats(state, days)
    const prev = overallStats(state, days, days)
    const perHabit = hs.map((h) => {
      const s = habitStats(h, idx, from, today, today)
      const st = streaks(h, idx, today)
      return {
        h,
        s,
        st,
        brokenInPeriod: st.broken.filter((b) => b.day >= from),
      }
    })
    // heatmap: last 13 weeks aligned to week start, row = week
    const start = weekStartOf(dayOffset(-90), state.settings.weekStart)
    const grid = overallDays(
      hs,
      idx,
      start,
      addDays(weekStartOf(today, state.settings.weekStart), 6),
      today,
    )
    const heat = grid.map((g) => (g.day > today ? null : g.rate))
    const series = overallDays(hs, idx, from, today, today)
    // 7-day rolling rate
    const rolling = series.map((_, i) => {
      const w = series.slice(Math.max(0, i - 6), i + 1)
      const due = w.reduce((a, x) => a + x.due, 0)
      const done = w.reduce((a, x) => a + x.done, 0)
      return due ? Math.round((done / due) * 100) : 0
    })
    // time invested per week (last 8 weeks)
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const end = dayOffset(-(7 - i) * 7)
      const startW = addDays(end, -6)
      return hs
        .filter((h) => h.type === "duration")
        .reduce((a, h) => a + habitStats(h, idx, startW, end, today).minutes, 0)
    })
    const worstDay = mostMissedWeekday(hs, idx, from, today)
    const mostSkipped = [...perHabit].sort(
      (a, b) => b.s.skipped - a.s.skipped,
    )[0]
    const routines = state.routines
      .filter((r) => r.status === "active")
      .map((r) => ({ r, s: routineStats(r, state.runs, days, today) }))
    return {
      cur,
      prev,
      perHabit,
      heat,
      rolling,
      weeks,
      worstDay,
      mostSkipped,
      routines,
    }
  }, [state, days, today])

  const ranked = [...d.perHabit].sort((a, b) =>
    sort === "rate"
      ? b.s.rate - a.s.rate
      : sort === "streak"
        ? b.st.current - a.st.current
        : sort === "skip"
          ? b.s.skipRate - a.s.skipRate
          : a.h.name.localeCompare(b.h.name),
  )
  const low = d.perHabit.filter((x) => x.s.scheduled >= 3 && x.s.rate < 0.5)
  const broken = d.perHabit.flatMap((x) =>
    x.brokenInPeriod.map((b) => ({ ...b, h: x.h })),
  )
  const abandoned = d.routines.flatMap((x) =>
    x.s.abandoned.map((run) => ({ run, r: x.r })),
  )

  if (d.perHabit.length === 0) return emptyAnalytics

  return (
    <div className="space-y-3 pt-1">
      <Segmented
        value={period}
        onChange={setPeriod}
        options={[
          { value: "7", label: "7d" },
          { value: "30", label: "30d" },
          { value: "90", label: "90d" },
          { value: "365", label: "Year" },
        ]}
      />

      <Card className="flex items-center gap-4">
        <Ring value={d.cur.rate} size={96} stroke={9} accent="hab">
          <div>
            <div className="num font-bold text-2xl">
              {Math.round(d.cur.rate * 100)}%
            </div>
            <div className="text-[10px] text-muted-foreground">completion</div>
          </div>
        </Ring>
        <div className="grid flex-1 grid-cols-2 gap-3">
          <div>
            <div
              className={cn(
                "num font-semibold text-2xl tracking-tight",
                d.cur.rate >= d.prev.rate ? "text-good" : "text-bad",
              )}
            >
              {d.cur.rate >= d.prev.rate ? "+" : "−"}
              {Math.abs(Math.round((d.cur.rate - d.prev.rate) * 100))}pt
            </div>
            <div className="text-muted-foreground text-xs">
              vs prev {period === "365" ? "year" : `${period}d`}
            </div>
          </div>
          <Stat
            label="Perfect days"
            value={d.cur.perfect}
            delta={d.cur.perfect - d.prev.perfect}
          />
          <Stat
            label="Invested"
            // whole hours once it's long enough to crowd the tile ("29h", not "29h 5…")
            value={
              d.cur.minutes >= 600
                ? `${Math.round(d.cur.minutes / 60)}h`
                : fmtMinutes(d.cur.minutes)
            }
            delta={Math.round((d.cur.minutes - d.prev.minutes) / 60)}
          />
          <Stat
            label="Skip rate"
            value={pct(d.cur.skipRate)}
            delta={Math.round((d.cur.skipRate - d.prev.skipRate) * 100)}
            goodWhen="down"
          />
        </div>
      </Card>

      <Card>
        <div className="mb-1 flex items-center justify-between text-muted-foreground text-xs">
          <span>7-day rolling completion</span>
          <span className="num">{d.rolling.at(-1)}%</span>
        </div>
        <Sparkline data={d.rolling} accent="hab" height={56} />
      </Card>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Btn variant="secondary" href="/habits/manage" className="px-2">
          <ListChecks className="size-4" /> Habits
        </Btn>
        <Btn variant="secondary" href="/habits/routines" className="px-2">
          <Repeat className="size-4" /> Routines
        </Btn>
        <Btn
          variant="secondary"
          href="/habits/share?t=scoreboard"
          className="px-2"
        >
          <Share2 className="size-4" /> Share
        </Btn>
      </div>

      {/* Reflection is always visible (F-HAB-31, C2). */}
      <SectionTitle>Reflection</SectionTitle>
      <Card className="space-y-3 border-bad/20">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <AlertTriangle className="size-4 text-bad" /> What slipped
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="Missed"
            value={d.cur.missed}
            accent={d.cur.missed ? undefined : "hab"}
          />
          <Stat label="Broken streaks" value={broken.length} />
          <Stat label="Worst day" value={d.worstDay?.day ?? "—"} />
        </div>
        {broken
          .slice(-3)
          .reverse()
          .map((b) => (
            <Link
              key={`${b.h.id}${b.day}`}
              href={`/habits/${b.h.id}`}
              className="flex items-center gap-2 text-sm"
            >
              <span>{b.h.icon}</span>
              <span className="flex-1">
                Lost a <b>{b.length}-day</b> {b.h.name} streak
              </span>
              <span className="text-muted-foreground text-xs">
                {fmtDay(b.day, { month: "short", day: "numeric" })}
              </span>
            </Link>
          ))}
        {d.mostSkipped && d.mostSkipped.s.skipped > 0 && (
          <div className="text-sm">
            Most skipped: <b>{d.mostSkipped.h.name}</b>{" "}
            <span className="text-muted-foreground">
              ({d.mostSkipped.s.skipped}× · {pct(d.mostSkipped.s.skipRate)})
            </span>
          </div>
        )}
        {low.length > 0 && (
          <div className="text-sm">
            Below 50%:{" "}
            {low.map((x, i) => (
              <span key={x.h.id}>
                {i > 0 && ", "}
                <Link
                  href={`/habits/${x.h.id}`}
                  className="font-semibold text-bad"
                >
                  {x.h.name} {pct(x.s.rate)}
                </Link>
              </span>
            ))}
          </div>
        )}
        {abandoned.slice(-2).map(({ run, r }) => (
          <div key={run.id} className="text-sm">
            {r.icon} {r.name} abandoned at {run.current}/{run.steps.length}{" "}
            <span className="text-muted-foreground text-xs">
              · {fmtDay(run.day, { month: "short", day: "numeric" })}
            </span>
          </div>
        ))}
        {d.cur.missed === 0 && broken.length === 0 && (
          <div className="text-good text-sm">Nothing slipped this period.</div>
        )}
      </Card>

      <SectionTitle>Last 13 weeks</SectionTitle>
      <Card>
        <div className="flex justify-center">
          <Heatmap values={d.heat} accent="hab" cols={7} flow="column" />
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>each column = a week, oldest left</span>
          <span>brighter = more done</span>
        </div>
      </Card>

      <SectionTitle
        action={
          <div className="flex gap-1">
            {(["rate", "streak", "skip", "name"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSort(k)}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px]",
                  sort === k ? "bg-hab/15 text-hab" : "text-muted-foreground",
                )}
              >
                {k}
              </button>
            ))}
          </div>
        }
      >
        Ranking
      </SectionTitle>
      <Card className="p-1">
        {ranked.map(({ h, s, st }, i) => (
          <Link
            key={h.id}
            href={`/habits/${h.id}`}
            className="flex items-center gap-3 rounded-xl px-2 py-2.5 active:bg-muted/60"
          >
            <span className="num w-4 text-center text-muted-foreground text-xs">
              {i + 1}
            </span>
            <HabitIcon icon={h.icon} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium text-sm">{h.name}</span>
                <StreakChip n={st.current} />
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    s.rate < 0.5 ? "bg-bad" : "bg-hab",
                  )}
                  style={{ width: `${s.rate * 100}%` }}
                />
              </div>
            </div>
            <div className="w-14 text-right">
              <div className="num font-semibold text-sm">{pct(s.rate)}</div>
              <div className="num text-[10px] text-muted-foreground">
                {s.skipped ? `${pct(s.skipRate)} skip` : `best ${st.best}`}
              </div>
            </div>
          </Link>
        ))}
      </Card>

      <SectionTitle>Time invested · 8 weeks</SectionTitle>
      <Card>
        <div className="mb-2 flex items-baseline gap-2">
          <span className="num font-semibold text-2xl">
            {fmtMinutes(d.weeks.at(-1) ?? 0)}
          </span>
          <span className="text-muted-foreground text-xs">
            this week in timed habits
          </span>
        </div>
        <Bars data={d.weeks} accent="hab" height={64} />
      </Card>

      {d.routines.length > 0 && (
        <>
          <SectionTitle>Routines</SectionTitle>
          <div className="space-y-3">
            {d.routines.map(({ r, s }) => (
              <RoutineProgressCard
                key={r.id}
                r={r}
                s={s}
                habits={state.habits}
              />
            ))}
          </div>
        </>
      )}

      <Link
        href="/habits/today"
        className="flex items-center justify-between px-1 py-2 text-muted-foreground text-xs"
      >
        Preview the Today card <ChevronRight className="size-3.5" />
      </Link>
    </div>
  )
}
