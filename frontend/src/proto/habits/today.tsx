"use client"

import { ChevronDown, ChevronRight, Play, Share2, Sparkles } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { dayKey, dayOffset, fmtDuration } from "../lib/day"
import { liveStore } from "../lib/live"
import { Btn, Card, Ring } from "../ui/kit"
import { checkHabit, timerHref } from "./actions"
import type { Habit, Routine } from "./data"
import {
  cellFor,
  isDue,
  lk,
  logIndex,
  plannedMin,
  runActualSec,
  slotFor,
  sortedHabits,
  streaks,
  type TodayGroup,
  todayGroup,
  toMin,
} from "./logic"
import { habitsStore } from "./store"
import {
  HabitIcon,
  HabitRow,
  LogSheet,
  useMounted,
  useStartGuard,
  useTick,
} from "./ui"

const GROUP_LABEL: Record<TodayGroup, string> = {
  now: "Now",
  later: "Later today",
  anytime: "Anytime",
  done: "Done",
}

/** HAB-C2: routine CTA — Start / Resume n/m / ✓ done. */
export function RoutineCta({
  routine,
  onStart,
}: {
  routine: Routine
  onStart: () => void
}) {
  const runs = habitsStore.use((s) => s.runs)
  const today = dayKey()
  const run = useMemo(
    () =>
      [...runs]
        .reverse()
        .find((r) => r.routineId === routine.id && r.day === today),
    [runs, routine.id, today],
  )
  const done = run?.state === "completed"
  const inProgress = run?.state === "in_progress"
  const slot = slotFor(routine.schedule, today)
  return (
    <Card className="flex items-center gap-3 bg-gradient-to-br from-hab/15 to-transparent">
      <HabitIcon icon={routine.icon} size="lg" />
      <Link href={`/habits/routines/${routine.id}`} className="min-w-0 flex-1">
        <div className="truncate font-semibold">{routine.name}</div>
        <div className="text-muted-foreground text-xs">
          {done
            ? `✓ Done in ${fmtDuration(runActualSec(run))} · planned ${plannedMin(routine)}m`
            : inProgress
              ? `Step ${Math.min(run.current + 1, run.steps.length)} of ${run.steps.length} · paused`
              : `${routine.steps.length} steps · ${plannedMin(routine)}m${slot?.time ? ` · ${slot.time}` : ""}`}
        </div>
        {inProgress && (
          <div className="mt-1.5 flex gap-1">
            {run.steps.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  i < run.current ? "bg-hab" : "bg-muted",
                )}
              />
            ))}
          </div>
        )}
      </Link>
      {done ? (
        <span className="grid size-11 place-items-center rounded-full bg-good/15 text-good text-lg">
          ✓
        </span>
      ) : (
        <Btn accent="hab" onClick={onStart} className="rounded-full px-4">
          <Play className="size-4 fill-current" />
          {inProgress ? `Resume ${run.current}/${run.steps.length}` : "Start"}
        </Btn>
      )}
    </Card>
  )
}

/** HAB-C1 + HAB-C2 + yesterday's loose ends — the module's Today card. */
export function HabitsTodayCard() {
  const mounted = useMounted()
  if (!mounted) return null
  return <TodayCardInner />
}

function TodayCardInner() {
  useTick(60_000)
  const state = habitsStore.use((s) => s)
  const live = liveStore.use((s) => s.live)
  const [showDone, setShowDone] = useState(false)
  const [sheet, setSheet] = useState<Habit | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const guard = useStartGuard()
  const today = dayKey()

  const data = useMemo(() => {
    const idx = logIndex(state.logs)
    const active = sortedHabits(
      state.habits.filter((h) => h.status !== "archived"),
    )
    const due = active.filter((h) => isDue(h, today))
    const groups: Record<TodayGroup, Habit[]> = {
      now: [],
      later: [],
      anytime: [],
      done: [],
    }
    for (const h of due)
      groups[todayGroup(h, idx.get(lk(h.id, today)), today)].push(h)
    const byTime = (a: Habit, b: Habit) =>
      toMin(slotFor(a.schedule, today)?.time ?? "99:99") -
      toMin(slotFor(b.schedule, today)?.time ?? "99:99")
    groups.now.sort(byTime)
    groups.later.sort(byTime)
    const doneCount = due.filter(
      (h) => idx.get(lk(h.id, today))?.status === "done",
    ).length
    const skipped = due.filter(
      (h) => idx.get(lk(h.id, today))?.status === "skipped",
    ).length
    const yesterday = dayOffset(-1)
    const loose = active.filter(
      (h) => cellFor(h, yesterday, idx, today) === "missed",
    )
    const streak = new Map(
      active.map((h) => [h.id, streaks(h, idx, today).current]),
    )
    const routines = state.routines.filter(
      (r) =>
        r.status === "active" &&
        r.steps.length > 0 &&
        slotFor(r.schedule, today) &&
        r.createdAt <= today,
    )
    return {
      idx,
      active,
      due,
      groups,
      doneCount,
      skipped,
      loose,
      streak,
      routines,
      yesterday,
    }
  }, [state, today])

  const hour = new Date().getHours()
  const dueCount = data.due.length - data.skipped
  const perfect = dueCount > 0 && data.doneCount >= dueCount
  const loose =
    hour < 12 ? data.loose.filter((h) => !dismissed.includes(h.id)) : []

  if (data.active.length === 0)
    return (
      <Card href="/habits/manage" className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-hab/12 text-hab">
          <Sparkles aria-hidden="true" className="size-5" />
        </div>
        <div className="flex-1">
          <div className="font-semibold">Track your first habit</div>
          <div className="text-muted-foreground text-sm">
            Or just tell Capture: “new habit: stretch weekdays 7am”
          </div>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Card>
    )

  return (
    <div className="space-y-3">
      {data.routines.map((r) => (
        <RoutineCta
          key={r.id}
          routine={r}
          onStart={() => guard.tryRoutine(r.id)}
        />
      ))}

      <Card className="pb-2">
        <div className="mb-1 flex items-center gap-3">
          <Ring
            value={dueCount ? data.doneCount / dueCount : 0}
            accent="hab"
            size={44}
            stroke={5}
          >
            <span className="num font-semibold text-[11px]">
              {data.doneCount}/{dueCount}
            </span>
          </Ring>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Habits</div>
            <div className="text-muted-foreground text-xs">
              {perfect
                ? "Perfect day ✓"
                : dueCount === 0
                  ? "Nothing scheduled — rest day"
                  : `${dueCount - data.doneCount} left today${data.skipped ? ` · ${data.skipped} skipped` : ""}`}
            </div>
          </div>
          <Link href="/habits/manage" className="font-medium text-hab text-sm">
            Manage
          </Link>
        </div>

        {perfect ? (
          <div className="flex items-center gap-3 rounded-xl bg-hab/10 p-3">
            <Sparkles className="size-5 text-hab" />
            <div className="flex-1 text-sm">
              <b>
                {data.doneCount}/{dueCount} ✓ Perfect day.
              </b>{" "}
              Every scheduled habit done.
            </div>
            <Link
              href="/habits/share?t=scoreboard"
              aria-label="Share perfect day"
              className="grid size-9 place-items-center rounded-full bg-hab text-background"
            >
              <Share2 className="size-4" />
            </Link>
          </div>
        ) : null}

        {(["now", "later", "anytime"] as const).map((g) =>
          data.groups[g].length ? (
            <div key={g} className="mt-2">
              <div className="px-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                {GROUP_LABEL[g]}
              </div>
              {data.groups[g].map((h) => (
                <HabitRow
                  key={h.id}
                  habit={h}
                  log={data.idx.get(lk(h.id, today))}
                  streak={data.streak.get(h.id)}
                  onMore={() => setSheet(h)}
                  onTimer={() => guard.tryTimer(h.id)}
                  running={live?.href === timerHref(h.id)}
                />
              ))}
            </div>
          ) : null,
        )}

        {data.groups.done.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="flex w-full items-center gap-1 px-1 py-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wider"
            >
              Done · {data.groups.done.length}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  showDone && "rotate-180",
                )}
              />
            </button>
            {showDone &&
              data.groups.done.map((h) => (
                <HabitRow
                  key={h.id}
                  habit={h}
                  log={data.idx.get(lk(h.id, today))}
                  streak={data.streak.get(h.id)}
                  onMore={() => setSheet(h)}
                />
              ))}
          </div>
        )}
      </Card>

      {loose.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold text-sm">
              {loose.length} habit{loose.length > 1 ? "s" : ""} not logged
              yesterday
            </div>
            <Link
              href={`/habits/day/${data.yesterday}`}
              className="text-hab text-xs"
            >
              Open day
            </Link>
          </div>
          {loose.map((h) => (
            <div key={h.id} className="flex items-center gap-2 py-1.5">
              <span aria-hidden>{h.icon}</span>
              <span className="flex-1 truncate text-sm">{h.name}</span>
              <button
                type="button"
                onClick={() => checkHabit(h.id, data.yesterday)}
                className="h-8 rounded-full bg-hab/15 px-3 font-medium text-hab text-xs"
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => setDismissed((d) => [...d, h.id])}
                className="h-8 rounded-full bg-bad/10 px-3 font-medium text-bad text-xs"
              >
                Missed
              </button>
            </div>
          ))}
        </Card>
      )}

      <LogSheet
        habit={sheet}
        open={!!sheet}
        onOpenChange={(o) => !o && setSheet(null)}
      />
      {guard.dialog}
    </div>
  )
}
