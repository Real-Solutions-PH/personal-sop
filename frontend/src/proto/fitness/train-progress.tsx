"use client"

import { ChevronRight, TrendingUp, Trophy } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { dayKey, dayOffset } from "../lib/day"
import { Bars, Card, SectionTitle, Sparkline } from "../ui/kit"
import {
  addDays,
  allPrs,
  exerciseHistory,
  finished,
  fmtVolume,
  isStalled,
  overloadRate,
  weekStart,
  workoutTotals,
} from "./calc"
import { useFit } from "./store"
import { Pill } from "./ui"

const WEEKS = 8
const KEY_LIFTS = 4

/** Train-tab progress: headline stats, key lifts' est. 1RM trends, weekly volume. */
export function TrainProgress() {
  const s = useFit()
  const d = useMemo(() => {
    const from = dayOffset(-WEEKS * 7)
    const day = (iso: string) => dayKey(new Date(iso))

    // key lifts: barbell compounds first (squat, bench, deadlift, press), then most-trained
    const lifts = s.exercises
      .filter((e) => !e.archived)
      .map((ex) => {
        const all = exerciseHistory(s, ex.id)
        const hist = all.filter(
          (h) => day(h.workout.startedAt) >= from && h.stats.bestE1rm > 0,
        )
        return { ex, all, hist }
      })
      .filter((l) => l.hist.length >= 2)
      .sort(
        (a, b) =>
          Number(b.ex.equipment === "barbell") -
            Number(a.ex.equipment === "barbell") ||
          b.hist.length - a.hist.length,
      )
      .slice(0, KEY_LIFTS)
      .map(({ ex, all, hist }) => {
        const first = hist[0].stats.bestE1rm
        const last = hist.at(-1)?.stats.bestE1rm ?? first
        return {
          ex,
          series: hist.map((h) => h.stats.bestE1rm),
          last,
          change: last - first,
          pct: first ? (last - first) / first : 0,
          stalled: isStalled(all),
        }
      })

    // weekly volume
    const thisWeek = weekStart(dayKey())
    const weeks = Array.from({ length: WEEKS }, (_, i) => ({
      start: addDays(thisWeek, -7 * (WEEKS - 1 - i)),
      volume: 0,
    }))
    for (const w of finished(s)) {
      const slot = weeks.find((x) => x.start === weekStart(day(w.startedAt)))
      if (slot) slot.volume += workoutTotals(s, w).volume
    }
    const cur = weeks.at(-1)?.volume ?? 0
    // compare the last two *complete* weeks — the current one is still filling up
    const lastFull = weeks.at(-2)?.volume ?? 0
    const before = weeks.at(-3)?.volume ?? 0

    const prCutoff = dayOffset(-30)
    return {
      lifts,
      weeks,
      cur,
      lastFull,
      volDelta: before ? (lastFull - before) / before : null,
      prs30: allPrs(s).filter((p) => day(p.at) >= prCutoff).length,
      overload: overloadRate(s, WEEKS * 7),
    }
  }, [s])

  if (!d.lifts.length) return null

  return (
    <>
      <SectionTitle
        action={
          <Link href="/fitness/stats" className="text-fit text-xs">
            All stats
          </Link>
        }
      >
        Progress · {WEEKS} weeks
      </SectionTitle>

      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3">
          <div className="num flex items-center gap-1 font-display font-semibold text-2xl">
            <Trophy className="size-4 text-warn" aria-hidden="true" />
            {d.prs30}
          </div>
          <div className="text-muted-foreground text-xs">PRs · 30 days</div>
        </Card>
        <Card className="p-3">
          <div className="num font-display font-semibold text-2xl">
            {Math.round(d.overload * 100)}%
          </div>
          <div className="text-muted-foreground text-xs">Lifts going up</div>
        </Card>
        <Card className="p-3">
          <div className="num font-display font-semibold text-2xl">
            {fmtVolume(d.lastFull)}
          </div>
          <div className="text-muted-foreground text-xs">
            Volume last wk
            {d.volDelta !== null && (
              <span
                className={cn(
                  "num ml-1",
                  d.volDelta >= 0 ? "text-good" : "text-bad",
                )}
              >
                {d.volDelta >= 0 ? "▲" : "▼"}
                {Math.abs(Math.round(d.volDelta * 100))}%
              </span>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-3 p-0">
        <div className="px-4 pt-3 text-muted-foreground text-xs">
          Key lifts · estimated 1-rep max
        </div>
        <ul className="divide-y divide-border/60">
          {d.lifts.map((l) => (
            <li key={l.ex.id}>
              <Link
                href={`/fitness/exercises/${l.ex.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-2.5 outline-none focus-visible:bg-muted active:bg-muted/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-sm">
                      {l.ex.name}
                    </span>
                    {l.stalled && <Pill tone="warn">Stalled</Pill>}
                  </div>
                  <div className="num text-muted-foreground text-xs">
                    {Math.round(l.last)} kg
                    <span
                      className={cn(
                        "ml-1.5",
                        l.change > 0.01
                          ? "text-good"
                          : l.change < -0.01
                            ? "text-bad"
                            : "",
                      )}
                    >
                      {l.change > 0.01 ? "+" : l.change < -0.01 ? "−" : "±"}
                      {Math.abs(l.change).toFixed(1)} kg (
                      {Math.round(l.pct * 100)}%)
                    </span>
                  </div>
                </div>
                <div
                  className="w-24"
                  role="img"
                  aria-label={`${l.ex.name} estimated max trend, now ${Math.round(l.last)} kg`}
                >
                  <Sparkline
                    data={l.series}
                    height={32}
                    accent="fit"
                    area={false}
                  />
                </div>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <TrendingUp className="size-3.5 text-fit" aria-hidden="true" />
            Weekly volume
          </span>
          <span className="num text-muted-foreground">
            {fmtVolume(d.cur)} this week
          </span>
        </div>
        <div
          role="img"
          aria-label={`Weekly training volume for the last ${WEEKS} weeks, ${fmtVolume(d.cur)} this week`}
        >
          <Bars
            data={d.weeks.map((w) => w.volume)}
            labels={d.weeks.map((w, i) =>
              i === d.weeks.length - 1 ? "Now" : `${Number(w.start.slice(8))}`,
            )}
            height={72}
            accent="fit"
          />
        </div>
      </Card>
    </>
  )
}
