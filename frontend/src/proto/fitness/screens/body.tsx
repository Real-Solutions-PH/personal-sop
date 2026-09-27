"use client"

import { Plus, Scale, Target } from "lucide-react"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { dayKey } from "../../lib/day"
import {
  Bar,
  Btn,
  Card,
  Empty,
  Screen,
  SectionTitle,
  Segmented,
  Stat,
} from "../../ui/kit"
import { updateSettings } from "../actions"
import { fmtDay, fmtTime, kg, weeklyRate, weightTrend } from "../calc"
import type { FitnessSettings, WeighIn } from "../data"
import { WeighInEditSheet, WeighInSheet } from "../sheets"
import { useFit } from "../store"
import {
  BottomSheet,
  ErrorState,
  LoadingState,
  Pill,
  Stepper,
  TrendChart,
  useViewState,
} from "../ui"

// FIT-20 Body weight (+ FIT-19 weigh-in sheet, FIT-21 edit sheet, goal editor)

type Range = "28" | "84" | "90"

export function BodyScreen() {
  const s = useFit()
  const view = useViewState()
  const [range, setRange] = useState<Range>("84")
  const [add, setAdd] = useState(false)
  const [edit, setEdit] = useState<WeighIn | null>(null)
  const [goalOpen, setGoalOpen] = useState(false)
  const [more, setMore] = useState(false)
  const d = useMemo(() => {
    const trend = weightTrend(s, Number(range))
    const rate = weeklyRate(s)
    const sorted = [...s.weighIns].sort((a, b) =>
      b.measuredAt.localeCompare(a.measuredAt),
    )
    const first = sorted.at(-1)
    const consistency =
      trend.filter((p) => p.raw !== undefined).length / trend.length
    return { trend, rate, sorted, first, consistency }
  }, [s, range])
  const { goalDirection: dir, goalWeight } = s.settings
  const empty = view === "empty" || !d.sorted.length
  const avg = d.rate?.avg ?? d.sorted[0]?.weightKg
  const rateGood = d.rate
    ? dir === "cut"
      ? d.rate.kg <= 0
      : dir === "bulk"
        ? d.rate.kg >= 0
        : Math.abs(d.rate.kg) < 0.25
    : true
  const tooFast = d.rate && Math.abs(d.rate.pct) > 1
  const progress =
    d.first &&
    goalWeight !== undefined &&
    avg !== undefined &&
    d.first.weightKg !== goalWeight
      ? (d.first.weightKg - avg) / (d.first.weightKg - goalWeight)
      : undefined
  return (
    <Screen
      back="/fitness?tab=body"
      title="Body weight"
      actions={
        <button
          type="button"
          aria-label="Add weigh-in"
          onClick={() => setAdd(true)}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Plus className="size-5" />
        </button>
      }
    >
      {view === "loading" ? (
        <LoadingState />
      ) : view === "error" ? (
        <ErrorState />
      ) : empty ? (
        <Empty
          icon={<Scale className="size-8" />}
          title="First weigh-in sets your starting point"
          body="Weigh in each morning — the 7-day average smooths out the daily noise."
          action={
            <Btn accent="fit" onClick={() => setAdd(true)}>
              Weigh in
            </Btn>
          }
        />
      ) : (
        <>
          <Card>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-muted-foreground text-xs">
                  7-day average
                </div>
                <div className="num font-semibold text-4xl tracking-tight">
                  {avg?.toFixed(1)}
                  <span className="ml-1 text-base text-muted-foreground">
                    kg
                  </span>
                </div>
              </div>
              {d.rate && (
                <div className="text-right">
                  <div
                    className={cn(
                      "num font-semibold",
                      rateGood ? "text-good" : "text-bad",
                    )}
                  >
                    {d.rate.kg > 0 ? "▲" : "▼"} {Math.abs(d.rate.kg).toFixed(2)}{" "}
                    kg/wk
                  </div>
                  <div className="num text-muted-foreground text-xs">
                    {d.rate.pct.toFixed(2)}% of bodyweight
                  </div>
                </div>
              )}
            </div>
            {tooFast && (
              <div className="mt-2 rounded-lg bg-warn/15 p-2 text-warn text-xs">
                Faster than ~1%/week — consider easing the deficit to keep your
                lifts.
              </div>
            )}
            <TrendChart
              className="mt-3"
              line={d.trend.map((p) => p.avg)}
              dots={d.trend.map((p) => p.raw)}
              goal={goalWeight}
              labels={[fmtDay(d.trend[0].day), "Today"]}
            />
            <div className="mt-3">
              <Segmented
                value={range}
                onChange={setRange}
                options={[
                  { value: "28", label: "4w" },
                  { value: "84", label: "12w" },
                  { value: "90", label: "All" },
                ]}
              />
            </div>
            <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-muted-foreground/50" />{" "}
                daily
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-3 bg-fit" /> 7-day avg
              </span>
              {goalWeight !== undefined && (
                <span className="flex items-center gap-1">
                  <span className="h-0.5 w-3 bg-good" /> goal
                </span>
              )}
            </div>
          </Card>

          <Card onClick={() => setGoalOpen(true)} className="mt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium text-sm">
                <Target className="size-4 text-fit" /> Goal
              </div>
              <Pill tone="fit">
                <span className="capitalize">
                  {
                    {
                      cut: "lose weight",
                      maintain: "maintain",
                      bulk: "gain weight",
                    }[dir]
                  }
                </span>
              </Pill>
            </div>
            {goalWeight !== undefined && avg !== undefined ? (
              <>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="num font-semibold text-xl">
                    {kg(goalWeight)}
                  </span>
                  <span className="num text-muted-foreground text-sm">
                    {Math.abs(avg - goalWeight).toFixed(1)} kg to go
                  </span>
                </div>
                {progress !== undefined && (
                  <Bar value={progress} accent="fit" className="mt-2" />
                )}
                {d.first && (
                  <div className="mt-1 text-muted-foreground text-xs">
                    Started at {kg(d.first.weightKg)} on{" "}
                    {fmtDay(dayKey(new Date(d.first.measuredAt)))}
                  </div>
                )}
              </>
            ) : (
              <div className="mt-1 text-muted-foreground text-sm">
                No goal weight — trend colours stay neutral. Tap to set.
              </div>
            )}
          </Card>

          <Card className="mt-3 grid grid-cols-3 gap-3">
            <Stat label="Latest" value={d.sorted[0].weightKg.toFixed(1)} />
            <Stat
              label="Lowest"
              value={Math.min(...d.sorted.map((w) => w.weightKg)).toFixed(1)}
            />
            <Stat
              label="Weigh-in days"
              value={`${Math.round(d.consistency * 100)}%`}
            />
          </Card>

          <SectionTitle>Entries</SectionTitle>
          <Card className="divide-y divide-border/60 p-0">
            {(more ? d.sorted : d.sorted.slice(0, 14)).map((w, i, arr) => {
              const prev = arr[i + 1] ?? d.sorted[i + 1]
              const diff = prev ? w.weightKg - prev.weightKg : 0
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setEdit(w)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted/60"
                >
                  <div className="flex-1">
                    <div className="text-sm">
                      {fmtDay(dayKey(new Date(w.measuredAt)))}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {fmtTime(w.measuredAt)}
                      {w.note ? ` · ${w.note}` : ""}
                    </div>
                  </div>
                  {!!diff && (
                    <span className="num text-muted-foreground text-xs">
                      {diff > 0 ? "+" : ""}
                      {diff.toFixed(1)}
                    </span>
                  )}
                  <span className="num w-16 text-right font-semibold">
                    {w.weightKg.toFixed(1)}
                  </span>
                </button>
              )
            })}
          </Card>
          {!more && d.sorted.length > 14 && (
            <Btn
              variant="ghost"
              className="mt-2 w-full"
              onClick={() => setMore(true)}
            >
              Show all {d.sorted.length}
            </Btn>
          )}
        </>
      )}
      <WeighInSheet open={add} onOpenChange={setAdd} />
      <WeighInEditSheet
        entry={edit}
        onOpenChange={(v) => !v && setEdit(null)}
      />
      <GoalSheet
        open={goalOpen}
        onOpenChange={setGoalOpen}
        settings={s.settings}
        current={avg}
      />
    </Screen>
  )
}

export function GoalSheet({
  open,
  onOpenChange,
  settings,
  current,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  settings: FitnessSettings
  current?: number
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Body goal"
      description="Sets whether the trend reads as good or bad."
    >
      {open && (
        <GoalForm
          settings={settings}
          current={current}
          onDone={() => onOpenChange(false)}
        />
      )}
    </BottomSheet>
  )
}

function GoalForm({
  settings,
  current,
  onDone,
}: {
  settings: FitnessSettings
  current?: number
  onDone: () => void
}) {
  const [dir, setDir] = useState(settings.goalDirection)
  const [w, setW] = useState(settings.goalWeight ?? Math.round(current ?? 75))
  return (
    <div className="space-y-5 pt-1">
      <Segmented
        value={dir}
        onChange={setDir}
        options={[
          { value: "cut", label: "Lose" },
          { value: "maintain", label: "Maintain" },
          { value: "bulk", label: "Gain" },
        ]}
      />
      <Stepper
        label="Goal weight"
        value={w}
        onChange={setW}
        step={0.5}
        min={30}
        max={250}
        unit="kg"
      />
      <div className="flex gap-2">
        <Btn
          variant="secondary"
          onClick={() => {
            updateSettings({ goalDirection: dir, goalWeight: undefined })
            onDone()
          }}
        >
          No goal weight
        </Btn>
        <Btn
          accent="fit"
          className="flex-1"
          onClick={() => {
            updateSettings({ goalDirection: dir, goalWeight: w })
            onDone()
          }}
        >
          Save
        </Btn>
      </div>
    </div>
  )
}
