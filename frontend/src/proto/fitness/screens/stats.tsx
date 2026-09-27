"use client"

import { AlertTriangle, ChevronRight, Share2 } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { dayKey } from "../../lib/day"
import {
  Bars,
  Card,
  Empty,
  Screen,
  SectionTitle,
  Segmented,
  Sparkline,
  Stat,
} from "../../ui/kit"
import {
  adherence,
  consistencyStreak,
  exerciseHistory,
  finished,
  fmtVolume,
  isStalled,
  kgShort,
  overloadRate,
  periodSummary,
  sessionsByWeek,
  weeklyRate,
  weekStart,
  weightTrend,
  workoutTotals,
} from "../calc"
import { useFit } from "../store"
import { ErrorState, LoadingState, useViewState } from "../ui"

// FIT-26 Fitness stats

const TOP = ["bench", "squat", "row", "ohp", "rdl"]

export function StatsScreen() {
  const s = useFit()
  const view = useViewState()
  const [range, setRange] = useState<"28" | "84">("28")
  const days = Number(range)
  const d = useMemo(() => {
    const weeks = days / 7
    const sw = sessionsByWeek(s, weeks)
    const vol = sw.map((w) =>
      finished(s)
        .filter((x) => weekStart(dayKey(new Date(x.startedAt))) === w.start)
        .reduce((a, x) => a + workoutTotals(s, x).volume, 0),
    )
    const cur = periodSummary(s, days)
    const prev = periodSummary(s, days, -days)
    const lifts = TOP.map((id) => {
      const ex = s.exercises.find((e) => e.id === id)
      const h = exerciseHistory(s, id)
      const inRange = h.filter(
        (x) => dayKey(new Date(x.workout.startedAt)) >= sw[0].start,
      )
      const last = h.at(-1)?.stats.bestE1rm ?? 0
      const first = inRange[0]?.stats.bestE1rm ?? last
      return {
        id,
        name: ex?.name ?? id,
        last,
        delta: last - first,
        series: inRange.map((x) => x.stats.bestE1rm),
        stalled: isStalled(h),
      }
    }).filter((l) => l.last > 0)
    const stalls = s.exercises.filter(
      (e) => !e.archived && isStalled(exerciseHistory(s, e.id)),
    )
    return {
      sw,
      vol,
      cur,
      prev,
      lifts,
      stalls,
      overload: overloadRate(s, 28),
      streak: consistencyStreak(s),
      weight: weightTrend(s, days),
      rate: weeklyRate(s),
      adh: adherence(s, Math.min(days, 14)),
      latest: finished(s).at(-1),
    }
  }, [s, days])
  const empty = view === "empty" || !d.latest
  return (
    <Screen
      back
      title="Fitness stats"
      actions={
        d.latest && (
          <Link
            href={`/fitness/share/${d.latest.id}`}
            aria-label="Share"
            className="grid size-10 place-items-center rounded-full hover:bg-muted"
          >
            <Share2 className="size-5" />
          </Link>
        )
      }
    >
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: "28", label: "4 weeks" },
          { value: "84", label: "12 weeks" },
        ]}
      />
      {view === "loading" ? (
        <LoadingState />
      ) : view === "error" ? (
        <ErrorState />
      ) : empty ? (
        <Empty
          title="No training data yet"
          body="Finish a workout and your sessions, PRs and lifts show up here."
        />
      ) : (
        <>
          <Card className="mt-3 grid grid-cols-2 gap-4">
            <Stat
              label={`Sessions (target ${Math.round(d.cur.target)})`}
              value={d.cur.sessions}
              delta={d.cur.sessions - d.prev.sessions}
              accent="fit"
            />
            <Stat
              label="PRs"
              value={d.cur.prs}
              delta={d.cur.prs - d.prev.prs}
            />
            <Stat
              label="Progress rate (4 wks)"
              value={`${Math.round(d.overload * 100)}%`}
            />
            <Stat label="Weekly streak" value={`${d.streak} wk`} />
          </Card>

          <SectionTitle>Sessions per week</SectionTitle>
          <Card>
            <Bars
              data={d.sw.map((w) => w.count)}
              labels={d.sw.map((w) =>
                d.sw.length > 6
                  ? ""
                  : new Date(`${w.start}T12:00:00`).toLocaleDateString(
                      "en-PH",
                      { month: "short", day: "numeric" },
                    ),
              )}
              accent="fit"
              height={90}
            />
            <div className="mt-2 flex justify-between text-muted-foreground text-xs">
              <span>Target {s.settings.weeklyTarget}/week</span>
              <span className={d.cur.missed ? "text-bad" : "text-good"}>
                {d.cur.missed ? `${d.cur.missed} missed` : "No misses"}
              </span>
            </div>
          </Card>

          <SectionTitle>Weekly volume</SectionTitle>
          <Card>
            <div className="num font-semibold text-xl">
              {fmtVolume(d.cur.volume)}
            </div>
            <div className="text-muted-foreground text-xs">
              in range · prev {fmtVolume(d.prev.volume)}
            </div>
            <Sparkline data={d.vol} accent="fit" height={56} className="mt-2" />
          </Card>

          <SectionTitle>Top lifts · e1RM</SectionTitle>
          <Card className="divide-y divide-border/60 p-0">
            {d.lifts.map((l) => (
              <Link
                key={l.id}
                href={`/fitness/exercises/${l.id}`}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate font-medium text-sm">
                    {l.name}
                    {l.stalled && (
                      <AlertTriangle className="size-3.5 text-warn" />
                    )}
                  </div>
                  <div
                    className={
                      l.delta > 0
                        ? "num text-good text-xs"
                        : "num text-muted-foreground text-xs"
                    }
                  >
                    {l.delta > 0 ? "▲" : l.delta < 0 ? "▼" : "•"}{" "}
                    {kgShort(Math.round(Math.abs(l.delta) * 10) / 10)} kg
                  </div>
                </div>
                <div className="w-20">
                  <Sparkline
                    data={l.series}
                    accent="fit"
                    height={28}
                    area={false}
                  />
                </div>
                <div className="num w-14 text-right font-semibold">
                  {kgShort(Math.round(l.last))}
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </Card>

          {!!d.stalls.length && (
            <>
              <SectionTitle>Stalled lifts</SectionTitle>
              <Card className="space-y-1 text-sm">
                {d.stalls.map((e) => (
                  <Link
                    key={e.id}
                    href={`/fitness/exercises/${e.id}`}
                    className="flex items-center justify-between"
                  >
                    <span>{e.name}</span>
                    <span className="text-muted-foreground text-xs">
                      no strength gain · 3 wks
                    </span>
                  </Link>
                ))}
              </Card>
            </>
          )}

          <SectionTitle>Body weight</SectionTitle>
          <Card href="/fitness/body">
            <div className="flex items-baseline justify-between">
              <div className="num font-semibold text-xl">
                {d.rate?.avg.toFixed(1) ?? "—"} kg
              </div>
              {d.rate && (
                <div
                  className={
                    (
                      s.settings.goalDirection === "cut"
                        ? d.rate.kg <= 0
                        : d.rate.kg >= 0
                    )
                      ? "num text-good text-sm"
                      : "num text-bad text-sm"
                  }
                >
                  {d.rate.kg > 0 ? "▲" : "▼"} {Math.abs(d.rate.kg).toFixed(2)}{" "}
                  kg/wk
                </div>
              )}
            </div>
            <Sparkline
              data={d.weight
                .map((p) => p.avg)
                .filter((v): v is number => v !== undefined)}
              accent="fit"
              height={48}
              className="mt-2"
            />
          </Card>

          <SectionTitle>Nutrition · last 14 days</SectionTitle>
          <Card
            href="/fitness/nutrition/history"
            className="grid grid-cols-2 gap-4"
          >
            <Stat
              label="Calories on target"
              value={`${Math.round(d.adh.calorie * 100)}%`}
            />
            <Stat
              label="Protein hit rate"
              value={`${Math.round(d.adh.protein * 100)}%`}
            />
            <Stat
              label="Over-target days"
              value={d.adh.overDays}
              goodWhen="down"
            />
            <Stat
              label="Logging coverage"
              value={`${Math.round(d.adh.coverage * 100)}%`}
            />
          </Card>
        </>
      )}
    </Screen>
  )
}
