"use client"

import {
  Camera,
  Check,
  Dumbbell,
  Pencil,
  Play,
  Scale,
  Share2,
  Utensils,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { openCapture } from "../lib/capture"
import { dayKey, fmtDuration } from "../lib/day"
import { Btn, Card, Ring, TodayGroup } from "../ui/kit"
import {
  allPrs,
  dailyWeights,
  dayTotals,
  finished,
  fmtMin,
  isDone,
  isWorking,
  lastOfTemplate,
  nextTemplate,
  relDay,
  sessionsByWeek,
  suggestion,
  targetFor,
  weeklyRate,
  workoutTotals,
} from "./calc"
import { StartSheet, WeighInSheet } from "./sheets"
import { useFit } from "./store"
import { Pill, useNow } from "./ui"

// Today cards (IA §6), as two groups so training and eating read as separate
// goals: Fitness (workout · weigh-in) and Nutrition (macros left).

export function FitnessTodayCard({ evening }: { evening?: boolean }) {
  return (
    <>
      <TodayGroup
        title="Fitness"
        icon={<Dumbbell />}
        accent="fit"
        href="/fitness"
      >
        <WorkoutCard />
        <WeighInCard />
      </TodayGroup>
      <TodayGroup
        title="Nutrition"
        icon={<Utensils />}
        accent="nut"
        href="/fitness/nutrition"
      >
        <MacrosCard evening={evening} />
      </TodayGroup>
    </>
  )
}

function WorkoutCard() {
  const s = useFit()
  const [open, setOpen] = useState(false)
  const active = s.workouts.find(
    (w) => w.id === s.activeId && w.status === "in_progress",
  )
  const d = useMemo(() => {
    const today = finished(s)
      .filter((w) => dayKey(new Date(w.startedAt)) === dayKey())
      .at(-1)
    const next = nextTemplate(s)
    const last = next ? lastOfTemplate(s, next.id) : undefined
    const first = next?.items[0]
    const sug = first ? suggestion(s, first.exerciseId) : undefined
    const exName = s.exercises.find((e) => e.id === first?.exerciseId)?.name
    return {
      today,
      todayTotals: today ? workoutTotals(s, today) : undefined,
      todayPrs: today
        ? allPrs(s).filter((p) => p.workoutId === today.id).length
        : 0,
      next,
      last,
      sug,
      exName,
      week: sessionsByWeek(s, 1)[0]?.count ?? 0,
    }
  }, [s])
  if (active) return <ActivePill />
  if (d.today && d.todayTotals)
    return (
      <Card className="flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-good/15 text-good">
          <Check className="size-5" />
        </div>
        <Link
          href={`/fitness/workouts/${d.today.id}`}
          className="min-w-0 flex-1"
        >
          <div className="font-semibold">{d.today.name} done</div>
          <div className="text-muted-foreground text-sm">
            {fmtMin(d.todayTotals.durationSec)}
            {d.todayPrs
              ? ` · ${d.todayPrs} PR${d.todayPrs > 1 ? "s" : ""}`
              : ""}
          </div>
        </Link>
        <Btn
          variant="secondary"
          className="h-9"
          href={`/fitness/share/${d.today.id}`}
        >
          <Share2 className="size-4" /> Share
        </Btn>
      </Card>
    )
  if (!d.next || d.week >= s.settings.weeklyTarget) return null
  return (
    <>
      <Card>
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-fit/15 text-fit">
            <Dumbbell className="size-5" />
          </div>
          <Link href="/fitness" className="min-w-0 flex-1">
            <div className="font-semibold">
              {d.next.name}
              {d.last && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · last {relDay(d.last.startedAt)}
                </span>
              )}
            </div>
            <div className="truncate text-muted-foreground text-sm">
              {d.sug && d.sug.kind === "weight"
                ? `Suggested ${d.sug.badge} ${d.exName?.split(" ").slice(-2).join(" ").toLowerCase()}`
                : `${d.week} of ${s.settings.weeklyTarget} sessions this week`}
            </div>
          </Link>
          <Btn accent="fit" className="h-9" onClick={() => setOpen(true)}>
            <Play className="size-4" /> Start
          </Btn>
        </div>
      </Card>
      <StartSheet open={open} onOpenChange={setOpen} />
    </>
  )
}

function ActivePill() {
  const s = useFit()
  const now = useNow(1000)
  const w = s.workouts.find((x) => x.id === s.activeId)
  if (!w) return null
  const sets = w.exercises.flatMap((e) => e.sets.filter(isWorking))
  return (
    <Card
      href="/fitness/workout"
      className="flex items-center gap-3 border-fit/50 bg-fit/10"
    >
      <span className="relative flex size-3">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-fit/60" />
        <span className="relative inline-flex size-3 rounded-full bg-fit" />
      </span>
      <span className="flex-1 font-semibold">{w.name}</span>
      <span className="num text-sm" suppressHydrationWarning>
        {fmtDuration((now - new Date(w.startedAt).getTime()) / 1000)}
      </span>
      <Pill tone="fit">
        {sets.filter(isDone).length}/{sets.length}
      </Pill>
    </Card>
  )
}

function MacrosCard({ evening }: { evening?: boolean }) {
  const s = useFit()
  const d = useMemo(
    () => ({ ...dayTotals(s, dayKey()), target: targetFor(s, dayKey()) }),
    [s],
  )
  const kLeft = d.target ? d.target.kcal - d.totals.kcal : undefined
  const pLeft = d.target ? d.target.protein - d.totals.protein : undefined
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Link
          href="/fitness/nutrition"
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <Ring
            value={d.target ? d.totals.kcal / d.target.kcal : 0}
            size={48}
            stroke={5}
            accent="nut"
          >
            <span className="num font-semibold text-[11px]">
              {Math.round(d.target ? (d.totals.kcal / d.target.kcal) * 100 : 0)}
              %
            </span>
          </Ring>
          <Ring
            value={d.target ? d.totals.protein / d.target.protein : 0}
            size={48}
            stroke={5}
            accent="tsk"
          >
            <span className="font-semibold text-[11px]">P</span>
          </Ring>
          <div className="min-w-0">
            <div
              className={cn(
                "num font-semibold",
                evening && kLeft !== undefined && kLeft < 0 && "text-bad",
              )}
            >
              {kLeft === undefined
                ? `${Math.round(d.totals.kcal)} kcal eaten`
                : evening
                  ? `${Math.round(Math.abs(kLeft))} kcal ${kLeft >= 0 ? "under" : "over"}`
                  : kLeft >= 0
                    ? `${Math.round(kLeft)} kcal left`
                    : `${Math.round(-kLeft)} kcal over`}
            </div>
            <div
              className={cn(
                "num text-muted-foreground text-sm",
                !evening && "truncate",
              )}
            >
              {pLeft === undefined ? (
                "Set targets"
              ) : evening ? (
                <span className={pLeft <= 0 ? "text-good" : "text-bad"}>
                  {pLeft <= 0
                    ? "Protein target hit"
                    : `${Math.round(pLeft)} g protein short`}
                </span>
              ) : (
                `${Math.max(0, Math.round(pLeft))} g protein left`
              )}
              {!!d.pending && ` · +${d.pending} pending`}
              {!!d.toReview && ` · ${d.toReview} to review`}
            </div>
          </div>
        </Link>
        <button
          type="button"
          aria-label="Log meal by photo"
          onClick={() => openCapture({ mode: "photo", hint: "meal" })}
          className="grid size-10 place-items-center rounded-xl bg-nut/15 text-nut"
        >
          <Camera className="size-5" />
        </button>
        <Link
          href="/fitness/nutrition/new"
          aria-label="Log meal manually"
          className="grid size-10 place-items-center rounded-xl bg-muted"
        >
          <Pencil className="size-4" />
        </Link>
      </div>
    </Card>
  )
}

function WeighInCard() {
  const s = useFit()
  const [open, setOpen] = useState(false)
  const d = useMemo(
    () => ({ today: dailyWeights(s).get(dayKey()), rate: weeklyRate(s) }),
    [s],
  )
  if (d.today !== undefined)
    return (
      <Card href="/fitness/body" className="flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-muted">
          <Scale className="size-5" />
        </div>
        <div className="flex-1">
          <div className="num font-semibold">{d.today.toFixed(1)} kg</div>
          <div className="num text-muted-foreground text-sm">
            7-day avg {d.rate?.avg.toFixed(1)}{" "}
            {d.rate && (d.rate.kg <= 0 ? "↓" : "↑")}
            {d.rate && Math.abs(d.rate.kg).toFixed(1)}
          </div>
        </div>
      </Card>
    )
  return (
    <>
      <Card className="flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-fit/15 text-fit">
          <Scale className="size-5" />
        </div>
        <div className="flex-1">
          <div className="font-semibold">Weigh in</div>
          <div className="text-muted-foreground text-sm">
            Morning weight keeps the trend honest
          </div>
        </div>
        <Btn accent="fit" className="h-9" onClick={() => setOpen(true)}>
          Log
        </Btn>
      </Card>
      <WeighInSheet open={open} onOpenChange={setOpen} />
    </>
  )
}
