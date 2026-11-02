// A routine or a workout that finishes away from its own page (from the Live
// Activity, the widget, or while the app was in the background) lands as a
// card over whatever screen is open, instead of the bar above the tabs just
// vanishing. A workout's card says its sets, time and any records; the rest
// of this note is the routine's.
// It says what was done: the routine, steps done of steps, the time it took,
// the streak it extends, and any steps skipped (in the warning colour, since
// a finish with skips is not a clean one). It plays once per run: the run id
// goes into the same on-device record the routine summary celebrates from,
// so opening the summary afterwards shows it settled, and a summary that
// already celebrated the run keeps this card from playing at all. Workouts
// go by the same record; one finished in the app's own logger is left to
// the summary it opens (see ``finishingHere``).

import * as C from "@domain/fitness/calc"
import type { Workout } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import type { Routine, RoutineRun } from "@domain/habits/data"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { fmtDuration } from "@domain/lib/day"
import { usePathname } from "expo-router"
import { Dumbbell } from "lucide-react-native"
import { useEffect, useState } from "react"
import { AppState, Text } from "react-native"
import { celebrateStore, markCelebrated } from "./celebration"
import { MomentCard, momentSlot } from "./moment"
import { go } from "./navigation"
import { fonts, useTheme } from "./theme"

/** How long a card stays: long enough to read its line of numbers. */
export const ROUTINE_MS = 4000
/** A run that ended longer ago than this is history, not news (the first
 * launch of this build, a run finished on another phone yesterday). */
const RECENT_MS = 6 * 60 * 60 * 1000

/** The pages that show a finish moment of their own: a routine's player
 * and summary, a workout's summary. */
const ownPage = (path: string) =>
  /^\/habits\/routines\/[^/]+\/(play|summary)/.test(path) ||
  /^\/fitness\/workouts\/[^/]+\/summary/.test(path)

/** Workouts finished from this phone's logger, which goes straight to the
 * summary that celebrates them: the card leaves them to it. */
const finishedHere = new Set<string>()
export function finishingHere(id: string) {
  finishedHere.add(id)
}

const foreground = (s: string | null | undefined) =>
  s !== "background" && s !== "inactive"

/** Completed runs to announce, oldest first: ended recently and not yet
 * celebrated on this phone. */
export function finishedRuns(
  runs: RoutineRun[],
  celebrated: string[],
  now = Date.now(),
): RoutineRun[] {
  const known = new Set(celebrated)
  return runs
    .filter(
      (x) =>
        x.state === "completed" &&
        !!x.endedAt &&
        now - new Date(x.endedAt).getTime() < RECENT_MS &&
        !known.has(x.id),
    )
    .sort((a, b) => (a.endedAt ?? "").localeCompare(b.endedAt ?? ""))
}

/** Workouts to announce, oldest first: finished recently, with a set
 * done, logged live (not told to Fern), not finished in the logger, and
 * not yet celebrated on this phone. */
export function finishedWorkouts(
  workouts: Workout[],
  celebrated: string[],
  now = Date.now(),
): Workout[] {
  const known = new Set(celebrated)
  return workouts
    .filter(
      (w) =>
        w.status === "finished" &&
        w.source !== "chat" &&
        !!w.endedAt &&
        now - new Date(w.endedAt).getTime() < RECENT_MS &&
        !known.has(w.id) &&
        !finishedHere.has(w.id) &&
        w.exercises.some((e) => e.sets.some((x) => !!x.completedAt)),
    )
    .sort((a, b) => (a.endedAt ?? "").localeCompare(b.endedAt ?? ""))
}

type Finish =
  | { kind: "routine"; id: string; at: string; run: RoutineRun }
  | { kind: "workout"; id: string; at: string; workout: Workout }

/** Scheduled days in a row, up to ``day``, with this routine completed. */
export function routineStreak(r: Routine, runs: RoutineRun[], day: string) {
  const done = new Set(
    runs
      .filter((x) => x.routineId === r.id && x.state === "completed")
      .map((x) => x.day),
  )
  let n = 0
  for (let i = 0; i < 366; i++) {
    const d = L.addDays(day, -i)
    if (d < r.createdAt) break
    if (!L.slotFor(r.schedule, d)) continue
    if (!done.has(d)) break
    n++
  }
  return n
}

/** Mounted once at the shell. */
export function FinishWatcher({ hidden = false }: { hidden?: boolean }) {
  const runs = habitsStore.use((s) => s.runs)
  const routines = habitsStore.use((s) => s.routines)
  const workouts = fitStore.use((s) => s.workouts)
  const celebrated = celebrateStore.use((s) => s.ids)
  const path = usePathname()
  const other = momentSlot.use(
    (s) =>
      s.holder !== null && s.holder !== "routine" && s.holder !== "workout",
  )
  const [active, setActive] = useState(foreground(AppState.currentState))
  const [current, setCurrent] = useState<Finish | null>(null)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) =>
      setActive(foreground(s)),
    )
    return () => sub.remove()
  }, [])
  const suppressed = hidden || other || !active || ownPage(path)
  useEffect(() => {
    if (current || suppressed) return
    const next = [
      ...finishedRuns(runs, celebrated)
        .filter((x) => routines.some((r) => r.id === x.routineId))
        .map(
          (run): Finish => ({
            kind: "routine",
            id: run.id,
            at: run.endedAt ?? "",
            run,
          }),
        ),
      ...finishedWorkouts(workouts, celebrated).map(
        (workout): Finish => ({
          kind: "workout",
          id: workout.id,
          at: workout.endedAt ?? "",
          workout,
        }),
      ),
    ].sort((a, b) => a.at.localeCompare(b.at))[0]
    if (!next) return
    // Recorded as it lands: a relaunch or the summary never replays it.
    markCelebrated(next.id)
    setCurrent(next)
  }, [current, suppressed, runs, routines, workouts, celebrated])
  // It leaves on its own; the clock stops while something hides it.
  useEffect(() => {
    if (!current || suppressed) return
    const id = setTimeout(() => setCurrent(null), ROUTINE_MS)
    return () => clearTimeout(id)
  }, [current, suppressed])
  if (!current || suppressed) return null
  if (current.kind === "workout")
    return (
      <WorkoutDoneCard
        key={current.id}
        workout={current.workout}
        onOpen={() => {
          setCurrent(null)
          go(`/fitness/workouts/${current.id}/summary`)
        }}
        onClose={() => setCurrent(null)}
      />
    )
  const run = current.run
  const r = routines.find((x) => x.id === run.routineId)
  if (!r) return null
  return (
    <RoutineDoneCard
      key={current.id}
      routine={r}
      run={run}
      streak={routineStreak(r, runs, run.day)}
      onOpen={() => {
        setCurrent(null)
        go(`/habits/routines/${r.id}/summary?run=${run.id}`)
      }}
      onClose={() => setCurrent(null)}
    />
  )
}

/** A workout finished from the lock screen: its sets, its time, and the
 * records it set, which are the reason to open it. */
export function WorkoutDoneCard({
  workout: w,
  onOpen,
  onClose,
}: {
  workout: Workout
  onOpen: () => void
  onClose: () => void
}) {
  const t = useTheme()
  const s = fitStore.get()
  const totals = C.workoutTotals(s, w)
  const prs = C.allPrs(s).filter((p) => p.workoutId === w.id).length
  const nb = (x: string) => x.replace(/ /g, "\u00a0")
  const sep = "\u00a0· "
  const parts = [
    `${totals.done} set${totals.done === 1 ? "" : "s"}`,
    ...(totals.durationSec > 0 ? [C.fmtMin(totals.durationSec)] : []),
    ...(totals.volume > 0 ? [C.fmtVolume(totals.volume)] : []),
  ]
  const pr = prs ? `${prs} PR${prs === 1 ? "" : "s"}` : ""
  return (
    <MomentCard
      kind="workout"
      testID="workout-done"
      label="Workout done"
      title={w.name}
      detail={
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 13,
            lineHeight: 18,
            color: t.muted,
            fontVariant: ["tabular-nums"],
          }}
        >
          {parts.map(nb).join(sep)}
          {pr ? (
            <Text style={{ color: t.good, fontFamily: fonts.medium }}>
              {`${sep}${nb(pr)}`}
            </Text>
          ) : null}
        </Text>
      }
      badge={<Dumbbell size={22} color={t.bg} />}
      tint={t.fit}
      say={`${w.name} done. ${parts.join(", ")}${pr ? `, ${pr}` : ""}.`}
      hint="Opens the workout summary"
      onOpen={onOpen}
      onClose={onClose}
    />
  )
}

export function RoutineDoneCard({
  routine,
  run,
  streak,
  onOpen,
  onClose,
}: {
  routine: Routine
  run: RoutineRun
  streak: number
  onOpen: () => void
  onClose: () => void
}) {
  const t = useTheme()
  const done = run.results.filter((x) => x.status === "done").length
  const skipped = run.results.filter((x) => x.status === "skipped").length
  const sec = L.runActualSec(run)
  // Each fact stays whole on its line; a separator never starts one. Steps
  // ticked through with no timer carry no time, so none is claimed.
  const nb = (x: string) => x.replace(/ /g, "\u00a0")
  const parts = [
    `${done} of ${run.steps.length} steps`,
    ...(sec > 0 ? [fmtDuration(sec)] : []),
    ...(streak > 1 ? [`${streak}-day streak`] : []),
  ]
  const sep = "\u00a0· "
  const skips = skipped ? `${skipped} skipped` : ""
  const say = `${routine.name} ${skipped ? "finished" : "done"}. ${parts.join(", ")}${skips ? `, ${skips}` : ""}.`
  return (
    <MomentCard
      kind="routine"
      testID="routine-done"
      label={skipped ? "Routine finished" : "Routine done"}
      title={routine.name}
      detail={
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 13,
            lineHeight: 18,
            color: t.muted,
            fontVariant: ["tabular-nums"],
          }}
        >
          {parts.map(nb).join(sep)}
          {skips ? (
            <Text style={{ color: t.warn, fontFamily: fonts.medium }}>
              {`${sep}${nb(skips)}`}
            </Text>
          ) : null}
        </Text>
      }
      badge={<Text style={{ fontSize: 22 }}>{routine.icon}</Text>}
      tint={t.hab}
      say={say}
      hint="Opens the routine summary"
      onOpen={onOpen}
      onClose={onClose}
    />
  )
}
