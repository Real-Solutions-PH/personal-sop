"use client"

import {
  Copy,
  Dumbbell,
  MoreHorizontal,
  Pencil,
  Repeat,
  Search,
  Share2,
  Trash2,
  Trophy,
} from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { dayKey } from "../../lib/day"
import {
  Btn,
  Card,
  Chip,
  Empty,
  Row,
  Screen,
  SectionTitle,
  Stat,
} from "../../ui/kit"
import {
  deleteWorkout,
  restoreWorkout,
  saveAsTemplate,
  startWorkout,
  updateWorkoutMeta,
} from "../actions"
import {
  allPrs,
  exerciseHistory,
  exStats,
  finished,
  fmtMin,
  fmtVolume,
  isStalled,
  isWorking,
  kg,
  kgShort,
  latestBodyweight,
  type Pr,
  prLabel,
  prsByWorkout,
  relDay,
  sessionsByWeek,
  weekStart,
  workoutTotals,
} from "../calc"
import type { FitnessState, Workout } from "../data"
import { useFit } from "../store"
import {
  BottomSheet,
  ErrorState,
  LoadingState,
  Pill,
  toast,
  useViewState,
} from "../ui"

// FIT-02 history · FIT-03 detail · FIT-09 summary

export function HistoryScreen() {
  const s = useFit()
  const view = useViewState()
  const [q, setQ] = useState("")
  const [tpl, setTpl] = useState<string | null>(null)
  const prMap = useMemo(() => prsByWorkout(allPrs(s)), [s])
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const names = new Map(s.exercises.map((e) => [e.id, e.name.toLowerCase()]))
    return finished(s)
      .reverse()
      .filter((w) => !tpl || w.templateId === tpl)
      .filter(
        (w) =>
          !ql ||
          w.name.toLowerCase().includes(ql) ||
          w.exercises.some((e) => names.get(e.exerciseId)?.includes(ql)),
      )
  }, [s, q, tpl])
  const rows = view === "empty" ? [] : list
  return (
    <Screen title="Workouts" back="/fitness?tab=train">
      <div className="relative">
        <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or exercise"
          className="pl-9"
        />
      </div>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
        <Chip active={!tpl} accent="fit" onClick={() => setTpl(null)}>
          All
        </Chip>
        {s.templates.map((t) => (
          <Chip
            key={t.id}
            active={tpl === t.id}
            accent="fit"
            onClick={() => setTpl(t.id)}
          >
            {t.name}
          </Chip>
        ))}
      </div>
      {view === "loading" ? (
        <LoadingState />
      ) : view === "error" ? (
        <ErrorState />
      ) : !rows.length ? (
        <Empty
          icon={<Dumbbell className="size-8" />}
          title={
            q || tpl ? "No matching workouts" : "No workouts yet — start one"
          }
          body={
            q || tpl
              ? "Try another name or clear the filter."
              : "Your sessions, volume and PRs will land here."
          }
          action={
            !q &&
            !tpl && (
              <Btn accent="fit" href="/fitness?start=1">
                Start workout
              </Btn>
            )
          }
        />
      ) : (
        <div className="mt-3">
          {rows.map((w, i) => {
            const t = workoutTotals(s, w)
            const prs = prMap.get(w.id)?.length ?? 0
            const wk = weekStart(dayKey(new Date(w.startedAt)))
            const newWeek =
              i === 0 ||
              weekStart(dayKey(new Date(rows[i - 1].startedAt))) !== wk
            return (
              <div key={w.id}>
                {newWeek && (
                  <SectionTitle>
                    Week of{" "}
                    {new Date(`${wk}T12:00:00`).toLocaleDateString("en-PH", {
                      month: "short",
                      day: "numeric",
                    })}
                  </SectionTitle>
                )}
                <Row
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
                />
              </div>
            )
          })}
        </div>
      )}
    </Screen>
  )
}

function useWorkoutParam(): Workout | undefined {
  const { id } = useParams<{ id: string }>()
  return useFit().workouts.find((w) => w.id === id)
}

function PrList({ prs, s }: { prs: Pr[]; s: FitnessState }) {
  const names = new Map(s.exercises.map((e) => [e.id, e.name]))
  return (
    <div className="space-y-2">
      {prs.map((p) => (
        <Link
          key={`${p.exerciseId}-${p.kind}`}
          href={`/fitness/exercises/${p.exerciseId}`}
          className="flex items-center gap-3 rounded-xl bg-warn/10 p-3"
        >
          <Trophy className="size-5 text-warn" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">
              {names.get(p.exerciseId)}
            </div>
            <div className="text-muted-foreground text-xs">
              {prLabel[p.kind]} PR
            </div>
          </div>
          <div className="text-right">
            <div className="num font-semibold">
              {p.kind === "volume"
                ? fmtVolume(p.value)
                : kg(Math.round(p.value * 10) / 10)}
            </div>
            <div className="num text-good text-xs">
              +
              {p.kind === "volume"
                ? fmtVolume(p.value - p.prev)
                : kg(Math.round((p.value - p.prev) * 10) / 10)}
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}

function SetsTable({ s, w }: { s: FitnessState; w: Workout }) {
  const bw = latestBodyweight(s) ?? 0
  return (
    <div className="space-y-3">
      {w.exercises.map((we) => {
        const ex = s.exercises.find((e) => e.id === we.exerciseId)
        const st = exStats(we, ex, bw)
        let n = 0
        return (
          <Card key={we.id} href={`/fitness/exercises/${we.exerciseId}`}>
            <div className="flex items-center justify-between">
              <div className="font-semibold">{ex?.name}</div>
              <div className="num text-muted-foreground text-xs">
                {st.bestE1rm
                  ? `Est. 1-rep max ${kgShort(Math.round(st.bestE1rm * 10) / 10)}`
                  : ""}
              </div>
            </div>
            {we.note && (
              <div className="mt-1 text-muted-foreground text-xs">
                “{we.note}”
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {we.sets.map((x) => (
                <span
                  key={x.id}
                  className={cn(
                    "num rounded-lg px-2 py-1 text-xs",
                    isWorking(x) ? "bg-muted" : "bg-warn/10 text-warn",
                  )}
                >
                  {isWorking(x) ? `${++n}.` : "W"} {kgShort(x.weight)}×{x.reps}
                </span>
              ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

export function WorkoutDetailScreen() {
  const s = useFit()
  const w = useWorkoutParam()
  const view = useViewState()
  const router = useRouter()
  const [confirmDel, setConfirmDel] = useState(false)
  const prs = useMemo(
    () => (w ? allPrs(s).filter((p) => p.workoutId === w.id) : []),
    [s, w],
  )
  if (view === "loading")
    return (
      <Screen back title="Workout">
        <LoadingState />
      </Screen>
    )
  if (view === "error")
    return (
      <Screen back title="Workout">
        <ErrorState />
      </Screen>
    )
  if (!w)
    return (
      <Screen back="/fitness/workouts" title="Workout">
        <Empty
          title="Workout not found"
          body="It may have been deleted."
          action={
            <Btn href="/fitness/workouts" variant="secondary">
              All workouts
            </Btn>
          }
        />
      </Screen>
    )
  const t = workoutTotals(s, w)
  return (
    <Screen
      back="/fitness/workouts"
      title={w.name}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger
            className="grid size-10 place-items-center rounded-full hover:bg-muted"
            aria-label="Workout options"
          >
            <MoreHorizontal className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/fitness/workout?edit=${w.id}`}>
                <Pencil className="size-4" /> Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const r = startWorkout({ from: "repeat", workoutId: w.id })
                if (r.ok) router.push("/fitness/workout")
                else toast(r.reason)
              }}
            >
              <Repeat className="size-4" /> Repeat
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const tpl = saveAsTemplate(w.id, w.name)
                if (tpl) router.push(`/fitness/templates/${tpl.id}`)
              }}
            >
              <Copy className="size-4" /> Save as template
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/fitness/share/${w.id}`}>
                <Share2 className="size-4" /> Share
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmDel(true)}
            >
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="text-muted-foreground text-sm">
        {new Date(w.startedAt).toLocaleString("en-PH", {
          weekday: "long",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
        {w.source === "chat" && " · logged from chat"}
      </div>
      <Card className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Duration" value={fmtMin(t.durationSec)} />
        <Stat label="Volume" value={fmtVolume(t.volume)} />
        <Stat label="Sets" value={t.done} />
      </Card>
      {!!prs.length && (
        <>
          <SectionTitle>Personal records</SectionTitle>
          <PrList prs={prs} s={s} />
        </>
      )}
      <SectionTitle>Exercises</SectionTitle>
      <SetsTable s={s} w={w} />
      {w.notes && (
        <>
          <SectionTitle>Notes</SectionTitle>
          <Card className="text-sm">{w.notes}</Card>
        </>
      )}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Btn variant="secondary" href={`/fitness/share/${w.id}`}>
          <Share2 className="size-4" /> Share
        </Btn>
        <Btn
          accent="fit"
          onClick={() => {
            const r = startWorkout({ from: "repeat", workoutId: w.id })
            if (r.ok) router.push("/fitness/workout")
            else toast(r.reason)
          }}
        >
          <Repeat className="size-4" /> Repeat
        </Btn>
      </div>
      <BottomSheet
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title="Delete this workout?"
        description={
          prs.length
            ? `It holds ${prs.length} PR${prs.length > 1 ? "s" : ""} — they’ll be recomputed.`
            : "You can undo right after."
        }
      >
        <div className="space-y-2 pt-1">
          <Btn
            variant="danger"
            className="w-full"
            onClick={() => {
              const del = deleteWorkout(w.id)
              router.replace("/fitness/workouts")
              if (del) toast(`Deleted ${del.name}`, () => restoreWorkout(del))
            }}
          >
            Delete
          </Btn>
          <Btn
            variant="ghost"
            className="w-full"
            onClick={() => setConfirmDel(false)}
          >
            Cancel
          </Btn>
        </div>
      </BottomSheet>
    </Screen>
  )
}

export function SummaryScreen() {
  const s = useFit()
  const w = useWorkoutParam()
  const router = useRouter()
  const view = useViewState()
  const data = useMemo(() => {
    if (!w) return null
    const t = workoutTotals(s, w)
    const prev = finished(s)
      .filter(
        (x) => x.id !== w.id && x.name === w.name && x.startedAt < w.startedAt,
      )
      .at(-1)
    const prevVol = prev ? workoutTotals(s, prev).volume : undefined
    const prs = allPrs(s).filter((p) => p.workoutId === w.id)
    const stalled = w.exercises
      .map((e) => e.exerciseId)
      .filter((id) => isStalled(exerciseHistory(s, id)))
      .map((id) => s.exercises.find((e) => e.id === id)?.name)
    const week = sessionsByWeek(s, 1)[0]?.count ?? 0
    return { t, prevVol, prs, stalled, week }
  }, [s, w])
  if (!w || !data)
    return (
      <Screen back="/fitness" title="Summary">
        <Empty
          title="Workout not found"
          action={
            <Btn href="/fitness" variant="secondary">
              Back to Fitness
            </Btn>
          }
        />
      </Screen>
    )
  const { t, prevVol, prs, stalled, week } = data
  const volDelta = prevVol
    ? Math.round(((t.volume - prevVol) / prevVol) * 100)
    : undefined
  return (
    <Screen back="/fitness" title="Workout complete">
      {view === "error" && (
        <div className="mb-3 rounded-xl bg-warn/15 p-3 text-sm text-warn">
          Saved on device — will sync when you’re back online.
        </div>
      )}
      <div className="rounded-3xl bg-gradient-to-br from-fit/30 via-fit/10 to-transparent p-5">
        <Input
          defaultValue={w.name}
          onBlur={(e) =>
            updateWorkoutMeta(w.id, { name: e.target.value || w.name })
          }
          className="h-auto border-none bg-transparent p-0 font-semibold text-2xl shadow-none focus-visible:ring-0 dark:bg-transparent"
          aria-label="Workout name"
        />
        <div className="text-muted-foreground text-sm">
          {relDay(w.startedAt)} · session {week}/{s.settings.weeklyTarget} this
          week
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Duration" value={fmtMin(t.durationSec)} />
          <Stat label="Sets" value={`${t.done}/${t.planned}`} />
          <div>
            <div className="num font-semibold text-2xl tracking-tight">
              {fmtVolume(t.volume)}
            </div>
            <div className="text-muted-foreground text-xs">
              Volume{" "}
              {volDelta !== undefined && (
                <span
                  className={cn(
                    "num",
                    volDelta >= 0 ? "text-good" : "text-muted-foreground",
                  )}
                >
                  {volDelta >= 0 ? "▲" : "▼"}
                  {Math.abs(volDelta)}% vs last
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      <SectionTitle>
        {prs.length
          ? `${prs.length} new PR${prs.length > 1 ? "s" : ""}`
          : "Personal records"}
      </SectionTitle>
      {prs.length ? (
        <PrList prs={prs} s={s} />
      ) : (
        <Card className="text-muted-foreground text-sm">
          No PRs this time — consistency is what makes the next one.
        </Card>
      )}
      {!!stalled.length && (
        <>
          <SectionTitle>Stalled lifts</SectionTitle>
          <Card className="text-sm">
            <span className="font-medium">{stalled.join(", ")}</span>
            <span className="text-muted-foreground">
              {" "}
              — no strength gain in 3 weeks. Try 10% lighter for a week or a new
              rep range.
            </span>
          </Card>
        </>
      )}
      <SectionTitle>Notes</SectionTitle>
      <textarea
        defaultValue={w.notes}
        onBlur={(e) => updateWorkoutMeta(w.id, { notes: e.target.value })}
        placeholder="How did it feel? (optional)"
        className="min-h-20 w-full rounded-2xl border border-border/60 bg-card p-3 text-sm outline-none"
      />
      <SectionTitle>Exercises</SectionTitle>
      <SetsTable s={s} w={w} />
      <div className="sticky bottom-0 mt-5 grid grid-cols-2 gap-2 bg-background/90 py-3 backdrop-blur">
        <Btn variant="secondary" href={`/fitness/share/${w.id}`}>
          <Share2 className="size-4" /> Share
        </Btn>
        <Btn
          accent="fit"
          onClick={() => {
            toast("Workout saved")
            router.push("/fitness")
          }}
        >
          Save
        </Btn>
      </div>
      <Btn
        variant="ghost"
        className="w-full text-bad"
        onClick={() => {
          const del = deleteWorkout(w.id)
          router.replace("/fitness")
          if (del) toast("Workout discarded", () => restoreWorkout(del))
        }}
      >
        Discard workout
      </Btn>
    </Screen>
  )
}
