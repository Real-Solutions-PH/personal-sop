"use client"

import {
  Archive,
  Dumbbell,
  Flame,
  Pause,
  Pencil,
  Play,
  PlayCircle,
  Plus,
  Share2,
  Trophy,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { dayKey, dayOffset } from "../../lib/day"
import { Bars, Btn, Card, Chip, Screen, SectionTitle, Stat } from "../../ui/kit"
import { archiveHabit, pauseHabit, resumeHabit } from "../actions"
import type { Habit } from "../data"
import {
  addDays,
  currentPause,
  effectiveStatus,
  fmtMinutes,
  habitStats,
  logIndex,
  pct,
  scheduleLabel,
  streaks,
  targetLabel,
  valueLabel,
} from "../logic"
import { habitsStore } from "../store"
import {
  BottomSheet,
  ConfirmDialog,
  fmtDay,
  Gate,
  HabitIcon,
  Legend,
  LogSheet,
  MonthHeatmap,
  NotFound,
  quickIncrement,
  quickToggle,
  StatusGlyph,
  useStartGuard,
} from "../ui"

/** HAB-02 Habit detail. */
export function HabitDetailScreen({ id }: { id: string }) {
  const habit = habitsStore.use((s) => s.habits.find((h) => h.id === id))
  return (
    <Screen
      title={habit?.name ?? "Habit"}
      back
      actions={habit ? <Overflow habit={habit} /> : null}
    >
      <Gate rows={5}>
        {habit ? <DetailBody habit={habit} /> : <NotFound what="Habit" />}
      </Gate>
    </Screen>
  )
}

function Overflow({ habit }: { habit: Habit }) {
  const router = useRouter()
  const [pauseOpen, setPauseOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const paused = effectiveStatus(habit) === "paused"
  return (
    <>
      <Link
        href={`/habits/${habit.id}/edit`}
        aria-label="Edit habit"
        className="grid size-10 place-items-center rounded-full hover:bg-muted"
      >
        <Pencil className="size-5" />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More"
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <span className="font-bold text-lg leading-none">⋯</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              router.push(`/habits/share?t=streak&habit=${habit.id}`)
            }
          >
            <Share2 className="size-4" /> Share
          </DropdownMenuItem>
          {paused ? (
            <DropdownMenuItem onSelect={() => resumeHabit(habit.id)}>
              <Play className="size-4" /> Resume now
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setPauseOpen(true)}>
              <Pause className="size-4" /> Pause…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
            <Archive className="size-4" /> Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PauseSheet habit={habit} open={pauseOpen} onOpenChange={setPauseOpen} />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive ${habit.name}?`}
        body="It leaves Today and your lists. History and stats are kept, and you can restore it from Archived."
        confirmLabel="Archive"
        onConfirm={() => {
          archiveHabit(habit.id)
          router.push("/habits/manage")
        }}
      />
    </>
  )
}

export function PauseSheet({
  habit,
  open,
  onOpenChange,
}: {
  habit: Habit
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const today = dayKey()
  const [until, setUntil] = useState(addDays(today, 7))
  const [reason, setReason] = useState("")
  const opts: [string, string | undefined][] = [
    ["3 days", addDays(today, 3)],
    ["1 week", addDays(today, 7)],
    ["2 weeks", addDays(today, 14)],
    ["Until I resume", undefined],
  ]
  const [pick, setPick] = useState<string | undefined>(addDays(today, 7))
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Pause ${habit.name}`}
      description="Paused days leave Today and never count against your rate or streak."
    >
      <div className="space-y-4 pb-2">
        <div className="flex flex-wrap gap-2">
          {opts.map(([l, v]) => (
            <Chip
              key={l}
              accent="hab"
              active={pick === v}
              onClick={() => setPick(v)}
            >
              {l}
            </Chip>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Resume on</span>
          <input
            type="date"
            min={addDays(today, 1)}
            value={pick ?? until}
            onChange={(e) => {
              setUntil(e.target.value)
              setPick(e.target.value)
            }}
            className="h-10 flex-1 rounded-xl border border-border bg-transparent px-3"
          />
        </label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional) — sick, travel…"
          className="h-11 w-full rounded-xl border border-border bg-transparent px-3 text-sm outline-none focus:border-hab"
        />
        <Btn
          accent="hab"
          className="w-full"
          onClick={() => {
            pauseHabit(habit.id, pick, reason || undefined)
            onOpenChange(false)
          }}
        >
          Pause {pick ? `until ${fmtDay(pick)}` : "until I resume"}
        </Btn>
      </div>
    </BottomSheet>
  )
}

function DetailBody({ habit }: { habit: Habit }) {
  const state = habitsStore.use((s) => s)
  const [sheet, setSheet] = useState<{ day: string } | null>(null)
  const guard = useStartGuard()
  const today = dayKey()

  const d = useMemo(() => {
    const idx = logIndex(state.logs)
    const s30 = habitStats(habit, idx, dayOffset(-29), today, today)
    const prev30 = habitStats(habit, idx, dayOffset(-59), dayOffset(-30), today)
    const s90 = habitStats(habit, idx, dayOffset(-89), today, today)
    const st = streaks(habit, idx, today)
    // weekly completion rate, last 12 weeks
    const weekly = Array.from({ length: 12 }, (_, i) => {
      const to = dayOffset(-(11 - i) * 7)
      return habitStats(habit, idx, addDays(to, -6), to, today).rate
    })
    const recent = state.logs
      .filter((l) => l.habitId === habit.id)
      .sort((a, b) => (a.day < b.day ? 1 : -1))
      .slice(0, 10)
    const todayLog = idx.get(`${habit.id}|${today}`)
    return { s30, prev30, s90, st, weekly, recent, todayLog }
  }, [state.logs, habit, today])

  const pause = currentPause(habit, today)
  const routinesWith = state.routines.filter(
    (r) => r.status === "active" && r.steps.some((s) => s.habitId === habit.id),
  )
  const log = d.todayLog

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center gap-4">
        <HabitIcon icon={habit.icon} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground text-sm">
            {scheduleLabel(habit.schedule)}
          </div>
          <div className="text-muted-foreground text-sm">
            Target · {targetLabel(habit)}
          </div>
          {habit.linkWorkout && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-fit/15 px-2 py-0.5 text-fit text-xs">
              <Dumbbell className="size-3" /> Auto-checks when a workout is
              logged
            </div>
          )}
        </div>
      </div>

      {pause && (
        <Card className="flex items-center gap-3 border-warn/30 bg-warn/10">
          <Pause className="size-5 text-warn" />
          <div className="flex-1 text-sm">
            Paused{pause.to ? ` until ${fmtDay(addDays(pause.to, 1))}` : ""}
            {pause.reason ? ` · ${pause.reason}` : ""}
          </div>
          <Btn
            variant="secondary"
            onClick={() => resumeHabit(habit.id)}
            className="h-9"
          >
            Resume
          </Btn>
        </Card>
      )}

      {/* Log today */}
      {!pause && (
        <div className="flex gap-2">
          {habit.type === "duration" ? (
            <Btn
              accent="hab"
              className="flex-1"
              onClick={() => guard.tryTimer(habit.id)}
            >
              <PlayCircle className="size-5" /> Start timer
            </Btn>
          ) : habit.type === "count" ? (
            <Btn
              accent="hab"
              className="flex-1"
              onClick={() => quickIncrement(habit)}
            >
              <Plus className="size-5" /> {habit.step ?? 1} {habit.unit}
              {log?.value !== undefined && (
                <span className="num opacity-80">
                  · {log.value}/{habit.target}
                </span>
              )}
            </Btn>
          ) : (
            <Btn
              accent="hab"
              variant={log?.status === "done" ? "secondary" : "primary"}
              className="flex-1"
              onClick={() => quickToggle(habit)}
            >
              {log?.status === "done"
                ? "✓ Done today — undo"
                : "Mark done today"}
            </Btn>
          )}
          <Btn variant="secondary" onClick={() => setSheet({ day: today })}>
            Log…
          </Btn>
        </div>
      )}

      <Card className="grid grid-cols-3 gap-3">
        <Stat
          label="Current streak"
          value={
            <span className="inline-flex items-center gap-1">
              <Flame aria-hidden="true" className="size-5 text-warn" />
              {d.st.current}-day
            </span>
          }
          accent="hab"
        />
        <Stat label="Best streak" value={d.st.best} />
        <Stat
          label="30-day rate"
          value={pct(d.s30.rate)}
          delta={Math.round((d.s30.rate - d.prev30.rate) * 100)}
        />
        <Stat label="Skip rate" value={pct(d.s30.skipRate)} />
        <Stat label="Missed (30d)" value={d.s30.missed} />
        {habit.schedule.some((s) => s.time) ? (
          <Stat label="On time" value={pct(d.s30.onTime)} />
        ) : (
          <Stat label="Done (30d)" value={d.s30.done} />
        )}
        {habit.type === "duration" && (
          <Stat
            label="Time (90d)"
            value={fmtMinutes(d.s90.minutes)}
            className="col-span-2"
          />
        )}
        {habit.type === "count" && (
          <Stat
            label={`${habit.unit ?? "total"} (90d)`}
            value={d.s90.countTotal.toLocaleString()}
            className="col-span-2"
          />
        )}
      </Card>

      {d.st.current > 0 && d.st.current >= d.st.best && (
        <div className="rounded-xl bg-hab/10 px-3 py-2 text-hab text-sm">
          <Trophy
            aria-hidden="true"
            className="mr-1.5 inline size-4 align-[-2px]"
          />
          New best — this is your longest streak yet.
        </div>
      )}

      <SectionTitle>Calendar</SectionTitle>
      <Card>
        <MonthHeatmap
          habit={habit}
          logs={state.logs}
          weekStart={state.settings.weekStart}
        />
        <div className="mt-3">
          <Legend
            items={["done", "partial", "skipped", "missed", "paused", "bonus"]}
          />
        </div>
      </Card>

      <SectionTitle>Weekly completion · 12 weeks</SectionTitle>
      <Card>
        <Bars
          data={d.weekly.map((x) => Math.round(x * 100))}
          accent="hab"
          height={72}
        />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>12w ago</span>
          <span>this week</span>
        </div>
      </Card>

      {d.st.broken.length > 0 && (
        <>
          <SectionTitle>Broken streaks</SectionTitle>
          <Card className="space-y-1 text-sm">
            {d.st.broken
              .slice(-3)
              .reverse()
              .map((b) => (
                <div key={b.day} className="flex justify-between">
                  <span>Lost a {b.length}-day streak</span>
                  <span className="text-muted-foreground">{fmtDay(b.day)}</span>
                </div>
              ))}
          </Card>
        </>
      )}

      {routinesWith.length > 0 && (
        <>
          <SectionTitle>In routines</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {routinesWith.map((r) => (
              <Link
                key={r.id}
                href={`/habits/routines/${r.id}`}
                className="rounded-full border border-border px-3 py-1.5 text-sm"
              >
                {r.icon} {r.name}
              </Link>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Recent logs</SectionTitle>
      <Card className="p-1">
        {d.recent.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            No logs yet — check it off from Today or tell Capture.
          </div>
        ) : (
          d.recent.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setSheet({ day: l.day })}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-muted/60"
            >
              <StatusGlyph cell={l.status} />
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  {fmtDay(l.day)}
                  {l.value !== undefined && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {valueLabel(habit, l.value)}
                    </span>
                  )}
                </div>
                <div className="truncate text-muted-foreground text-xs">
                  {new Date(l.loggedAt).toLocaleTimeString("en-PH", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  · via {l.source}
                  {l.note && ` · “${l.note}”`}
                </div>
              </div>
              <span
                className={cn(
                  "text-xs capitalize",
                  l.status === "skipped"
                    ? "text-warn"
                    : "text-muted-foreground",
                )}
              >
                {l.status}
              </span>
            </button>
          ))
        )}
      </Card>

      <LogSheet
        habit={habit}
        day={sheet?.day}
        open={!!sheet}
        onOpenChange={(o) => !o && setSheet(null)}
      />
      {guard.dialog}
    </div>
  )
}
