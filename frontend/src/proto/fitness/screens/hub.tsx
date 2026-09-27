"use client"

import {
  BarChart3,
  ChevronRight,
  Dumbbell,
  LayoutList,
  Play,
  Scale,
  Settings,
  Trophy,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { dayKey } from "../../lib/day"
import {
  Btn,
  Card,
  Empty,
  Row,
  Screen,
  SectionTitle,
  Segmented,
  Sparkline,
  Stat,
} from "../../ui/kit"
import {
  allPrs,
  consistencyStreak,
  dailyWeights,
  dayTotals,
  finished,
  fmtMin,
  fmtVolume,
  lastOfTemplate,
  nextTemplate,
  prsByWorkout,
  relDay,
  sessionsByWeek,
  suggestion,
  targetFor,
  weeklyRate,
  weightTrend,
  workoutTotals,
} from "../calc"
import { StartSheet, WeighInSheet } from "../sheets"
import { useFit } from "../store"
import {
  ErrorState,
  LoadingState,
  MacroRings,
  Pill,
  TrendChart,
  useViewState,
} from "../ui"
import { LogMealButtons } from "./nutrition"

// FIT-01 Fitness hub — Train · Eat · Body

type Tab = "train" | "eat" | "body"

export function HubScreen() {
  const qs = useSearchParams()
  const router = useRouter()
  const view = useViewState()
  const tab = (qs.get("tab") as Tab) || "train"
  const [start, setStart] = useState(qs.get("start") === "1")
  const [weigh, setWeigh] = useState(qs.get("weigh") === "1")
  return (
    <Screen
      title="Fitness"
      back
      actions={
        <>
          <Link
            href="/fitness/stats"
            aria-label="Fitness stats"
            className="grid size-10 place-items-center rounded-full hover:bg-muted"
          >
            <BarChart3 className="size-5" />
          </Link>
          <Link
            href="/fitness/settings"
            aria-label="Fitness settings"
            className="grid size-10 place-items-center rounded-full hover:bg-muted"
          >
            <Settings className="size-5" />
          </Link>
        </>
      }
    >
      <Segmented
        value={tab}
        onChange={(v) => router.replace(`/fitness?tab=${v}`)}
        options={[
          { value: "train", label: "Train" },
          { value: "eat", label: "Eat" },
          { value: "body", label: "Body" },
        ]}
      />
      {view === "loading" ? (
        <LoadingState />
      ) : view === "error" ? (
        <ErrorState />
      ) : tab === "train" ? (
        <Train empty={view === "empty"} onStart={() => setStart(true)} />
      ) : tab === "eat" ? (
        <Eat />
      ) : (
        <Body empty={view === "empty"} onWeigh={() => setWeigh(true)} />
      )}
      <StartSheet open={start} onOpenChange={setStart} />
      <WeighInSheet open={weigh} onOpenChange={setWeigh} />
    </Screen>
  )
}

function Train({ empty, onStart }: { empty: boolean; onStart: () => void }) {
  const s = useFit()
  const d = useMemo(() => {
    const next = nextTemplate(s)
    const last = next ? lastOfTemplate(s, next.id) : undefined
    const sugs = (next?.items ?? []).slice(0, 3).map((it) => ({
      ex: s.exercises.find((e) => e.id === it.exerciseId),
      sug: suggestion(s, it.exerciseId),
    }))
    const week = sessionsByWeek(s, 1)[0]
    const recent = finished(s).slice(-3).reverse()
    const prMap = prsByWorkout(allPrs(s))
    return {
      next,
      last,
      sugs,
      week,
      recent,
      prMap,
      streak: consistencyStreak(s),
    }
  }, [s])
  const active = s.workouts.find(
    (w) => w.id === s.activeId && w.status === "in_progress",
  )
  if (empty)
    return (
      <Empty
        icon={<Dumbbell className="size-8" />}
        title="No workouts yet — start one"
        body="Pick a template or go empty. Sets prefill from last time once you have history."
        action={
          <Btn accent="fit" onClick={onStart}>
            Start workout
          </Btn>
        }
      />
    )
  return (
    <>
      {active ? (
        <Card href="/fitness/workout" className="mt-4 border-fit/50 bg-fit/10">
          <div className="flex items-center gap-3">
            <span className="relative flex size-3">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-fit/60" />
              <span className="relative inline-flex size-3 rounded-full bg-fit" />
            </span>
            <div className="flex-1">
              <div className="font-semibold">{active.name} in progress</div>
              <div className="text-muted-foreground text-sm">
                Started{" "}
                {new Date(active.startedAt).toLocaleTimeString("en-PH", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            </div>
            <span className="inline-flex h-9 items-center rounded-xl bg-fit px-4 font-semibold text-sm text-background">
              Resume
            </span>
          </div>
        </Card>
      ) : (
        d.next && (
          <Card className="mt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-muted-foreground text-xs uppercase tracking-wider">
                  Up next
                </div>
                <div className="font-semibold text-xl">{d.next.name}</div>
                <div className="text-muted-foreground text-sm">
                  {d.last
                    ? `Last done ${relDay(d.last.startedAt)}`
                    : "Never done"}{" "}
                  · {d.next.items.length} exercises
                </div>
              </div>
              <Btn accent="fit" onClick={onStart}>
                <Play className="size-4" /> Start
              </Btn>
            </div>
            <div className="mt-3 space-y-1.5">
              {d.sugs.map(({ ex, sug }) => (
                <div
                  key={ex?.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="truncate">{ex?.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="num text-muted-foreground">
                      {sug.weight} kg × {sug.reps}
                    </span>
                    <Pill tone={sug.kind === "weight" ? "fit" : "muted"}>
                      {sug.badge}
                    </Pill>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )
      )}

      <Card className="mt-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-muted-foreground text-xs">This week</div>
            <div className="num font-semibold text-2xl">
              {d.week.count}
              <span className="text-base text-muted-foreground">
                /{s.settings.weeklyTarget} sessions
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="num font-semibold text-2xl">{d.streak}</div>
            <div className="text-muted-foreground text-xs">week streak</div>
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          {Array.from({ length: s.settings.weeklyTarget }, (_, i) => (
            <div
              key={i}
              className={cn(
                "h-2 flex-1 rounded-full",
                i < d.week.count ? "bg-fit" : "bg-muted",
              )}
            />
          ))}
        </div>
      </Card>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Btn variant="secondary" href="/fitness/templates" className="px-2">
          <LayoutList className="size-4" /> Templates
        </Btn>
        <Btn variant="secondary" href="/fitness/exercises" className="px-2">
          <Dumbbell className="size-4" /> Exercises
        </Btn>
        <Btn variant="secondary" href="/fitness/stats" className="px-2">
          <BarChart3 className="size-4" /> Stats
        </Btn>
      </div>

      <SectionTitle
        action={
          <Link href="/fitness/workouts" className="text-fit text-xs">
            All
          </Link>
        }
      >
        Recent
      </SectionTitle>
      <Card className="p-1">
        {d.recent.map((w) => {
          const t = workoutTotals(s, w)
          const prs = d.prMap.get(w.id)?.length ?? 0
          return (
            <Row
              key={w.id}
              href={`/fitness/workouts/${w.id}`}
              icon={
                <div className="grid size-10 place-items-center rounded-xl bg-fit/15 text-fit">
                  <Dumbbell className="size-5" />
                </div>
              }
              title={w.name}
              subtitle={`${relDay(w.startedAt)} · ${fmtMin(t.durationSec)} · ${fmtVolume(t.volume)}`}
              right={
                prs ? (
                  <Pill tone="warn">
                    <Trophy className="size-3" /> {prs}
                  </Pill>
                ) : undefined
              }
              className="px-3"
            />
          )
        })}
      </Card>
    </>
  )
}

function Eat() {
  const s = useFit()
  const today = dayKey()
  const d = useMemo(
    () => ({ ...dayTotals(s, today), target: targetFor(s, today) }),
    [s, today],
  )
  return (
    <>
      <Card href="/fitness/nutrition" className="mt-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-semibold">Today</div>
          <span className="flex items-center gap-1 text-muted-foreground text-xs">
            {!!d.toReview && <Pill tone="fit">{d.toReview} to review</Pill>}
            {!!d.pending && <Pill tone="warn">+{d.pending} pending</Pill>}
            <ChevronRight className="size-4" />
          </span>
        </div>
        <MacroRings totals={d.totals} target={d.target} />
      </Card>
      <Card className="mt-3 p-2">
        <LogMealButtons />
      </Card>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Btn variant="secondary" href="/fitness/nutrition/history">
          History
        </Btn>
        <Btn variant="secondary" href="/fitness/nutrition/targets">
          Targets
        </Btn>
      </div>
    </>
  )
}

function Body({ empty, onWeigh }: { empty: boolean; onWeigh: () => void }) {
  const s = useFit()
  const d = useMemo(() => {
    const trend = weightTrend(s, 28)
    return { trend, rate: weeklyRate(s), today: dailyWeights(s).get(dayKey()) }
  }, [s])
  if (empty)
    return (
      <Empty
        icon={<Scale className="size-8" />}
        title="First weigh-in sets your starting point"
        action={
          <Btn accent="fit" onClick={onWeigh}>
            Weigh in
          </Btn>
        }
      />
    )
  const good =
    d.rate &&
    (s.settings.goalDirection === "cut" ? d.rate.kg <= 0 : d.rate.kg >= 0)
  return (
    <>
      <Card href="/fitness/body" className="mt-4">
        <div className="flex items-end justify-between">
          <Stat
            label="7-day average"
            value={`${d.rate?.avg.toFixed(1) ?? "—"} kg`}
            accent="fit"
          />
          {d.rate && (
            <span
              className={cn("num text-sm", good ? "text-good" : "text-bad")}
            >
              {d.rate.kg > 0 ? "▲" : "▼"} {Math.abs(d.rate.kg).toFixed(2)} kg/wk
            </span>
          )}
        </div>
        <TrendChart
          className="mt-2"
          height={110}
          line={d.trend.map((p) => p.avg)}
          dots={d.trend.map((p) => p.raw)}
          goal={s.settings.goalWeight}
        />
      </Card>
      {d.today !== undefined ? (
        <Card className="mt-3 flex items-center justify-between">
          <span className="text-sm">Weighed in today</span>
          <span className="num font-semibold">{d.today.toFixed(1)} kg</span>
        </Card>
      ) : (
        <Btn accent="fit" className="mt-3 w-full" onClick={onWeigh}>
          <Scale className="size-4" /> Weigh in
        </Btn>
      )}
      <Card
        href="/fitness/body"
        className="mt-3 flex items-center justify-between"
      >
        <span className="text-sm">All entries & goal</span>
        <Sparkline
          data={d.trend
            .map((p) => p.avg)
            .filter((v): v is number => v !== undefined)}
          className="w-24"
          height={24}
          area={false}
          accent="fit"
        />
      </Card>
    </>
  )
}
