// A routine that finishes away from its own page (from the Live Activity, the
// widget, or while the app was in the background) lands as a card over
// whatever screen is open, instead of the bar above the tabs just vanishing.
// It says what was done: the routine, steps done of steps, the time it took,
// the streak it extends, and any steps skipped (in the warning colour, since
// a finish with skips is not a clean one). It plays once per run: the run id
// goes into the same on-device record the routine summary celebrates from,
// so opening the summary afterwards shows it settled, and a summary that
// already celebrated the run keeps this card from playing at all.

import type { Routine, RoutineRun } from "@domain/habits/data"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { fmtDuration } from "@domain/lib/day"
import { usePathname } from "expo-router"
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

/** The routine's own pages show their own finish moment. */
const ownPage = (path: string) =>
  /^\/habits\/routines\/[^/]+\/(play|summary)/.test(path)

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
export function RoutineDoneWatcher({ hidden = false }: { hidden?: boolean }) {
  const runs = habitsStore.use((s) => s.runs)
  const routines = habitsStore.use((s) => s.routines)
  const celebrated = celebrateStore.use((s) => s.ids)
  const path = usePathname()
  const other = momentSlot.use(
    (s) => s.holder !== null && s.holder !== "routine",
  )
  const [active, setActive] = useState(foreground(AppState.currentState))
  const [current, setCurrent] = useState<RoutineRun | null>(null)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) =>
      setActive(foreground(s)),
    )
    return () => sub.remove()
  }, [])
  const suppressed = hidden || other || !active || ownPage(path)
  useEffect(() => {
    if (current || suppressed) return
    const next = finishedRuns(runs, celebrated).find((x) =>
      routines.some((r) => r.id === x.routineId),
    )
    if (!next) return
    // Recorded as it lands: a relaunch or the summary never replays it.
    markCelebrated(next.id)
    setCurrent(next)
  }, [current, suppressed, runs, routines, celebrated])
  // It leaves on its own; the clock stops while something hides it.
  useEffect(() => {
    if (!current || suppressed) return
    const id = setTimeout(() => setCurrent(null), ROUTINE_MS)
    return () => clearTimeout(id)
  }, [current, suppressed])
  const r = current && routines.find((x) => x.id === current.routineId)
  if (!current || !r || suppressed) return null
  return (
    <RoutineDoneCard
      key={current.id}
      routine={r}
      run={current}
      streak={routineStreak(r, runs, current.day)}
      onOpen={() => {
        setCurrent(null)
        go(`/habits/routines/${r.id}/summary?run=${current.id}`)
      }}
      onClose={() => setCurrent(null)}
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
  const took = fmtDuration(L.runActualSec(run))
  const parts = [
    `${done} of ${run.steps.length} steps`,
    took,
    ...(streak > 1 ? [`${streak}-day streak`] : []),
  ]
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
          {parts.join(" · ")}
          {skips ? (
            <Text style={{ color: t.warn, fontFamily: fonts.medium }}>
              {` · ${skips}`}
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
