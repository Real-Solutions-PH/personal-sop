"use client"

import {
  Check,
  Pause,
  Play,
  Share2,
  SkipBack,
  SkipForward,
  Trophy,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { dayKey, dayOffset, fmtDuration } from "../../lib/day"
import { liveStore } from "../../lib/live"
import { Btn, Card, Screen, SectionTitle, Stat } from "../../ui/kit"
import {
  exitRoutine,
  playerHref,
  startRoutine,
  stepAddMinute,
  stepBack,
  stepContinue,
  stepDone,
  stepSkip,
  toggleRunPause,
} from "../actions"
import type { Routine, RoutineRun } from "../data"
import {
  lk,
  logIndex,
  plannedMin,
  runActualSec,
  runState,
  stepElapsed,
  streaks,
} from "../logic"
import { habitsStore } from "../store"
import {
  ConfirmDialog,
  fmtDay,
  Gate,
  HabitIcon,
  NotFound,
  StreakChip,
  useMounted,
  useStartGuard,
  useTick,
} from "../ui"
import { FullScreen } from "./timer"

/** HAB-14 Routine player (full screen). */
export function PlayerScreen({ id }: { id: string }) {
  const mounted = useMounted()
  const routine = habitsStore.use((s) => s.routines.find((r) => r.id === id))
  if (!mounted)
    return (
      <FullScreen>
        <div className="m-auto size-64 animate-pulse rounded-full bg-muted/50" />
      </FullScreen>
    )
  if (!routine)
    return (
      <FullScreen>
        <NotFound what="Routine" />
      </FullScreen>
    )
  return <Player routine={routine} />
}

function Player({ routine }: { routine: Routine }) {
  const router = useRouter()
  const runs = habitsStore.use((s) => s.runs)
  const live = liveStore.use((s) => s.live)
  const guard = useStartGuard()
  const today = dayKey()
  const run = useMemo(
    () =>
      [...runs]
        .reverse()
        .find(
          (r) =>
            r.routineId === routine.id &&
            r.day === today &&
            r.state !== "abandoned",
        ),
    [runs, routine.id, today],
  )
  const [justFinished, setJustFinished] = useState<string | null>(null)
  const leaving = useRef(false)

  // Resuming a run left mid-way: re-attach the Live bar if nothing else runs.
  useEffect(() => {
    if (run?.state === "in_progress" && !live && !leaving.current)
      startRoutine(routine.id)
  }, [run?.state, live, routine.id])

  useEffect(() => {
    if (run?.state === "completed" && justFinished === run.id)
      router.replace(`/habits/routines/${routine.id}/summary?run=${run.id}`)
  }, [run, justFinished, routine.id, router])

  if (!run || (run.state === "completed" && justFinished !== run.id))
    return (
      <FullScreen>
        <div className="flex h-14 items-center px-2">
          <button
            type="button"
            aria-label="Close"
            onClick={() => router.back()}
            className="grid size-10 place-items-center rounded-full hover:bg-muted"
          >
            <X className="size-6" />
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <HabitIcon icon={routine.icon} size="xl" />
          <div>
            <div className="font-semibold text-2xl">{routine.name}</div>
            <div className="text-muted-foreground">
              {routine.steps.length} steps · {plannedMin(routine)} min
            </div>
          </div>
          {run?.state === "completed" && (
            <Link
              href={`/habits/routines/${routine.id}/summary?run=${run.id}`}
              className="rounded-full bg-good/15 px-3 py-1 text-good text-sm"
            >
              ✓ Done today in {fmtDuration(runActualSec(run))} — see summary
            </Link>
          )}
          <StepList routine={routine} />
          <Btn
            accent="hab"
            className="h-14 w-full max-w-xs text-base"
            disabled={routine.steps.length === 0}
            onClick={() => {
              setJustFinished(null)
              guard.tryRoutine(routine.id)
            }}
          >
            <Play className="size-5 fill-current" />
            {run?.state === "completed" ? "Run again" : "Start"}
          </Btn>
        </div>
        {guard.dialog}
      </FullScreen>
    )

  return (
    <Running
      routine={routine}
      run={run}
      onFinish={() => setJustFinished(run.id)}
      onExit={() => {
        leaving.current = true
        exitRoutine()
        router.push("/today")
      }}
      conflict={!!live && live.href !== playerHref(routine.id)}
    />
  )
}

function StepList({ routine }: { routine: Routine }) {
  const habits = habitsStore.use((s) => s.habits)
  return (
    <div className="w-full max-w-xs space-y-1 text-left">
      {routine.steps.map((s, i) => {
        const h = habits.find((x) => x.id === s.habitId)
        return h ? (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="num w-5 text-muted-foreground">{i + 1}</span>
            <span>{h.icon}</span>
            <span className="flex-1 truncate">{h.name}</span>
            <span className="num text-muted-foreground">{s.minutes}m</span>
          </div>
        ) : null
      })}
    </div>
  )
}

function Running({
  routine,
  run,
  onFinish,
  onExit,
  conflict,
}: {
  routine: Routine
  run: RoutineRun
  onFinish: () => void
  onExit: () => void
  conflict: boolean
}) {
  useTick(1000)
  const state = habitsStore.use((s) => s)
  const [leave, setLeave] = useState(false)
  const [redo, setRedo] = useState<string | null>(null)
  const step = run.steps[run.current]
  const habit = step && state.habits.find((h) => h.id === step.habitId)
  const next = run.steps[run.current + 1]
  const nextHabit = next && state.habits.find((h) => h.id === next.habitId)
  const log = step
    ? logIndex(state.logs).get(lk(step.habitId, run.day))
    : undefined
  const alreadyDone =
    log?.status === "done" && log.source !== "routine" && redo !== step?.habitId

  if (!step || !habit) return null
  const planned = step.minutes * 60 + run.stepBonusSec
  const elapsed = stepElapsed(run)
  const remaining = planned - elapsed
  const over = remaining < 0
  const totalPlanned = run.steps.reduce((a, s) => a + s.minutes * 60, 0)
  const totalElapsed =
    ((run.pausedAt ? new Date(run.pausedAt).getTime() : Date.now()) -
      new Date(run.startedAt).getTime()) /
    1000
  const frac = Math.min(1, elapsed / planned)
  const size = 240
  const stroke = 10
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const last = run.current === run.steps.length - 1
  const act = (fn: (r: RoutineRun) => void) => {
    fn(run)
    if (last) onFinish()
  }

  return (
    <FullScreen>
      <div className="flex h-14 items-center gap-2 px-2">
        <button
          type="button"
          aria-label="Leave routine"
          onClick={() => setLeave(true)}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <X className="size-6" />
        </button>
        <div className="flex-1 truncate text-center font-medium text-sm">
          {routine.icon} {routine.name}
        </div>
        <div className="num w-10 text-center text-muted-foreground text-sm">
          {run.current + 1}/{run.steps.length}
        </div>
      </div>
      <div className="flex gap-1 px-4">
        {run.steps.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              i < run.current
                ? run.results[i]?.status === "skipped"
                  ? "bg-warn/60"
                  : "bg-hab"
                : i === run.current
                  ? "animate-pulse bg-hab/50"
                  : "bg-muted",
            )}
          />
        ))}
      </div>

      {conflict && (
        <div className="mx-4 mt-3 rounded-xl bg-warn/10 px-3 py-2 text-warn text-xs">
          Another activity is running — this run is kept and its time still
          counts.
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <HabitIcon icon={habit.icon} size="lg" />
          <div className="font-semibold text-2xl">{habit.name}</div>
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            Planned {step.minutes} min
            {run.stepBonusSec > 0 && ` +${run.stepBonusSec / 60}`}
            <StreakChip n={streaks(habit, logIndex(state.logs)).current} />
          </div>
        </div>

        {alreadyDone ? (
          <Card className="w-full max-w-xs text-center">
            <div className="font-semibold text-good">✓ Already done today</div>
            <div className="mb-3 text-muted-foreground text-sm">
              Logged via {log?.source}. Skip ahead or redo it.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Btn variant="secondary" onClick={() => setRedo(step.habitId)}>
                Redo
              </Btn>
              <Btn accent="hab" onClick={() => act(stepContinue)}>
                Continue
              </Btn>
            </div>
          </Card>
        ) : (
          <div className="relative" style={{ width: size, height: size }}>
            <svg
              width={size}
              height={size}
              className="-rotate-90"
              aria-hidden="true"
            >
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                strokeWidth={stroke}
                className="stroke-muted"
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={c * (1 - frac)}
                className={cn(
                  "transition-[stroke-dashoffset] duration-1000 ease-linear",
                  over ? "stroke-warn" : "stroke-hab",
                )}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div
                className={cn(
                  "num font-semibold text-5xl tracking-tight",
                  over && "text-warn",
                  run.pausedAt && "animate-pulse opacity-60",
                )}
              >
                {over ? `+${fmtDuration(-remaining)}` : fmtDuration(remaining)}
              </div>
              <div
                className={cn(
                  "text-sm",
                  over ? "text-warn" : "text-muted-foreground",
                )}
              >
                {run.pausedAt ? "paused" : over ? "over plan" : "left"}
              </div>
            </div>
          </div>
        )}

        <div className="w-full max-w-xs text-center text-muted-foreground text-sm">
          {nextHabit ? (
            <>
              Up next · {nextHabit.icon} {nextHabit.name} · {next.minutes}m
            </>
          ) : (
            "Last step"
          )}
          <div className="num mt-1 text-xs">
            Total {fmtDuration(Math.max(0, totalElapsed))} /{" "}
            {fmtDuration(totalPlanned)} planned
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 pb-6">
        <div className="grid grid-cols-4 gap-2">
          {[
            {
              label: "Back",
              icon: SkipBack,
              on: () => stepBack(run),
              disabled: run.current === 0,
            },
            { label: "Skip", icon: SkipForward, on: () => act(stepSkip) },
            {
              label: run.pausedAt ? "Resume" : "Pause",
              icon: run.pausedAt ? Play : Pause,
              on: () => toggleRunPause(run),
            },
            { label: "+1 min", icon: null, on: () => stepAddMinute(run) },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              disabled={b.disabled}
              onClick={b.on}
              className="flex h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-muted font-medium text-xs disabled:opacity-30"
            >
              {b.icon ? (
                <b.icon className="size-5" />
              ) : (
                <span className="font-semibold text-base">+1</span>
              )}
              {b.label}
            </button>
          ))}
        </div>
        {!alreadyDone && (
          <Btn
            accent="hab"
            className="h-16 w-full text-lg"
            onClick={() => act(stepDone)}
          >
            <Check className="size-6" strokeWidth={3} /> Done
          </Btn>
        )}
      </div>

      <ConfirmDialog
        open={leave}
        onOpenChange={setLeave}
        title="Leave routine?"
        body={`Progress is kept (${run.current}/${run.steps.length} steps). Resume from Today until the day ends; after that, unreached steps count as missed.`}
        confirmLabel="Leave"
        onConfirm={onExit}
      />
    </FullScreen>
  )
}

/** HAB-15 Routine summary. */
export function SummaryScreen({ id, runId }: { id: string; runId?: string }) {
  return (
    <Screen title="Routine summary" back={`/habits/routines/${id}`}>
      <Gate>
        <Summary id={id} runId={runId} />
      </Gate>
    </Screen>
  )
}

function Summary({ id, runId }: { id: string; runId?: string }) {
  const state = habitsStore.use((s) => s)
  const routine = state.routines.find((r) => r.id === id)
  const run =
    state.runs.find((r) => r.id === runId) ??
    [...state.runs].reverse().find((r) => r.routineId === id)
  const data = useMemo(() => {
    if (!run) return null
    const monthAgo = dayOffset(-30)
    const completed = state.runs.filter(
      (x) =>
        x.routineId === id && x.day >= monthAgo && runState(x) === "completed",
    )
    const actual = runActualSec(run)
    const fastest =
      runState(run) === "completed" &&
      completed.length > 2 &&
      completed.every((x) => x.id === run.id || runActualSec(x) >= actual)
    return { actual, fastest }
  }, [run, state.runs, id])
  if (!routine || !run || !data) return <NotFound what="Run" />
  const idx = logIndex(state.logs)
  const planned = run.steps.reduce((a, s) => a + s.minutes * 60, 0)
  const done = run.results.filter((r) => r.status === "done").length
  const st = runState(run)

  return (
    <div className="space-y-3 pt-1">
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <div className="relative">
          <HabitIcon icon={routine.icon} size="xl" />
          {st === "completed" && (
            <span className="-right-2 -bottom-2 absolute grid size-10 place-items-center rounded-full bg-good text-background ring-4 ring-background">
              <Check className="size-5" strokeWidth={3} />
            </span>
          )}
        </div>
        <div className="mt-2 font-semibold text-2xl">
          {st === "completed"
            ? `${routine.name} done!`
            : `${routine.name} — ${st.replace("_", " ")}`}
        </div>
        <div className="text-muted-foreground text-sm">{fmtDay(run.day)}</div>
        {data.fastest && (
          <div className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-3 py-1 text-warn text-sm">
            <Trophy className="size-4" /> Fastest this month
          </div>
        )}
      </div>

      <Card className="grid grid-cols-3 gap-3">
        <Stat
          label="Steps done"
          value={`${done}/${run.steps.length}`}
          accent="hab"
        />
        <Stat label="Actual" value={fmtDuration(data.actual)} />
        <Stat
          label="vs planned"
          value={fmtDuration(planned)}
          delta={Math.round((data.actual - planned) / 60)}
          goodWhen="down"
        />
      </Card>

      <SectionTitle>Steps</SectionTitle>
      <Card className="p-1">
        {run.steps.map((s, i) => {
          const h = state.habits.find((x) => x.id === s.habitId)
          const res = run.results[i]
          const streak = h ? streaks(h, idx).current : 0
          return (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full text-xs",
                  res?.status === "done"
                    ? "bg-hab text-background"
                    : res?.status === "skipped"
                      ? "bg-warn/20 text-warn"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {res?.status === "done" ? (
                  <Check className="size-3.5" />
                ) : res?.status === "skipped" ? (
                  "–"
                ) : (
                  "·"
                )}
              </span>
              <span>{h?.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  {h?.name ?? "Deleted habit"}
                </div>
                <div className="text-muted-foreground text-xs">
                  {res?.status === "done"
                    ? `${fmtDuration(res.actualSec)} of ${s.minutes}m`
                    : res?.status === "skipped"
                      ? "skipped"
                      : "not reached"}
                </div>
              </div>
              {res?.status === "done" && <StreakChip n={streak} />}
            </div>
          )
        })}
      </Card>

      <div className="grid grid-cols-2 gap-2 pt-2">
        <Btn
          variant="secondary"
          href={`/habits/share?t=routine&routine=${id}&run=${run.id}`}
        >
          <Share2 className="size-4" /> Share
        </Btn>
        <Btn accent="hab" href="/today">
          Done
        </Btn>
      </div>
    </div>
  )
}
