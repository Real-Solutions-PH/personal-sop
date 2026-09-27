"use client"

import {
  AlertTriangle,
  Archive,
  Dumbbell,
  Pencil,
  Plus,
  Search,
  Share2,
  TrendingUp,
  Trophy,
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { dayKey, dayOffset } from "../../lib/day"
import {
  Btn,
  Card,
  Chip,
  Empty,
  Row,
  Screen,
  SectionTitle,
  Segmented,
  Stat,
} from "../../ui/kit"
import { setExerciseArchived } from "../actions"
import {
  allPrs,
  exerciseHistory,
  fmtVolume,
  isStalled,
  kg,
  kgShort,
  prLabel,
  relDay,
  suggestion,
} from "../calc"
import type { Exercise } from "../data"
import { ExerciseEditSheet, MUSCLES } from "../sheets"
import { useFit } from "../store"
import {
  ErrorState,
  LoadingState,
  Pill,
  TrendChart,
  toast,
  useViewState,
} from "../ui"

// FIT-10 Exercise library · FIT-11 Exercise detail (FIT-12 edit sheet lives in sheets.tsx)

export function LibraryScreen() {
  const s = useFit()
  const view = useViewState()
  const [q, setQ] = useState("")
  const [archived, setArchived] = useState(false)
  const [edit, setEdit] = useState<{ ex?: Exercise } | null>(null)
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const list = s.exercises
      .filter((e) => (archived ? true : !e.archived))
      .filter((e) => !ql || e.name.toLowerCase().includes(ql))
    return MUSCLES.map((m) => ({
      m,
      list: list
        .filter((e) => e.muscle === m)
        .sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.list.length)
  }, [s, q, archived])
  return (
    <Screen
      title="Exercises"
      back="/fitness/settings"
      actions={
        <button
          type="button"
          aria-label="New exercise"
          onClick={() => setEdit({})}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Plus className="size-5" />
        </button>
      }
    >
      <div className="relative">
        <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search exercises"
          className="pl-9"
        />
      </div>
      <div className="mt-3 flex gap-2">
        <Chip
          active={archived}
          accent="fit"
          onClick={() => setArchived((x) => !x)}
        >
          <Archive className="size-4" /> Show archived
        </Chip>
      </div>
      {view === "loading" ? (
        <LoadingState />
      ) : view === "error" ? (
        <ErrorState />
      ) : !groups.length ? (
        <Empty
          icon={<Search className="size-8" />}
          title={`No exercise matches “${q}”`}
          action={
            <Btn accent="fit" onClick={() => setEdit({ ex: undefined })}>
              <Plus className="size-4" /> Create “{q}”
            </Btn>
          }
        />
      ) : (
        groups.map((g) => (
          <div key={g.m}>
            <SectionTitle>
              <span className="capitalize">{g.m}</span>
            </SectionTitle>
            {g.list.map((e) => (
              <Row
                key={e.id}
                href={`/fitness/exercises/${e.id}`}
                icon={
                  <div className="grid size-10 place-items-center rounded-xl bg-muted">
                    <Dumbbell className="size-5 text-muted-foreground" />
                  </div>
                }
                title={e.name}
                subtitle={
                  <span className="capitalize">
                    {e.equipment} · {e.repMin}–{e.repMax} reps · +{e.increment}{" "}
                    kg
                  </span>
                }
                right={e.archived ? <Pill>Archived</Pill> : undefined}
              />
            ))}
          </div>
        ))
      )}
      <ExerciseEditSheet
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        exercise={edit?.ex}
      />
    </Screen>
  )
}

type Range = "4w" | "12w" | "1y" | "all"
type Metric = "e1rm" | "top" | "volume"
const RANGE_DAYS: Record<Range, number> = {
  "4w": 28,
  "12w": 84,
  "1y": 365,
  all: 100000,
}

export function ExerciseDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const s = useFit()
  const view = useViewState()
  const [range, setRange] = useState<Range>("12w")
  const [metric, setMetric] = useState<Metric>("e1rm")
  const [edit, setEdit] = useState(false)
  const ex = s.exercises.find((e) => e.id === id)
  const d = useMemo(() => {
    const hist = view === "empty" ? [] : exerciseHistory(s, id)
    const from = range === "all" ? "" : dayOffset(-RANGE_DAYS[range])
    const inRange = hist.filter(
      (h) => dayKey(new Date(h.workout.startedAt)) >= from,
    )
    const prs = allPrs(s)
      .filter((p) => p.exerciseId === id)
      .reverse()
    const best = hist.reduce(
      (b, h) => (h.stats.bestE1rm > (b?.stats.bestE1rm ?? 0) ? h : b),
      hist[0],
    )
    return {
      hist,
      inRange,
      prs,
      best,
      sug: suggestion(s, id),
      stalled: isStalled(hist),
    }
  }, [s, id, range, view])
  if (!ex)
    return (
      <Screen back title="Exercise">
        <Empty
          title="Exercise not found"
          action={
            <Btn href="/fitness/exercises" variant="secondary">
              Library
            </Btn>
          }
        />
      </Screen>
    )
  const series = d.inRange.map((h) =>
    metric === "e1rm"
      ? h.stats.bestE1rm
      : metric === "top"
        ? h.stats.heaviest
        : h.stats.volume,
  )
  const first = series[0]
  const lastV = series.at(-1)
  const change = first && lastV ? lastV - first : undefined
  return (
    <Screen
      back
      title={ex.name}
      actions={
        <button
          type="button"
          aria-label="Edit exercise"
          onClick={() => setEdit(true)}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Pencil className="size-5" />
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-sm">
        <span className="capitalize">
          {ex.muscle} · {ex.equipment}
        </span>
        <span>
          · {ex.repMin}–{ex.repMax} reps · +{ex.increment} kg
        </span>
        {ex.archived && <Pill>Archived</Pill>}
      </div>

      {view === "loading" ? (
        <LoadingState rows={3} />
      ) : view === "error" ? (
        <ErrorState />
      ) : !d.hist.length ? (
        <Empty
          icon={<Dumbbell className="size-8" />}
          title="No sets logged yet"
          body="Add it to a workout — your progress chart starts with the first set."
          action={
            <Btn accent="fit" href="/fitness?start=1">
              Start workout
            </Btn>
          }
        />
      ) : (
        <>
          <Card className="mt-4 border-fit/40 bg-fit/10">
            <div className="flex items-center gap-2 text-fit text-xs uppercase tracking-wider">
              <TrendingUp className="size-4" /> Next session · suggested
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <div className="num font-semibold text-2xl">
                {kgShort(d.sug.weight)} kg × {d.sug.reps}
              </div>
              <Pill tone="fit">{d.sug.badge}</Pill>
            </div>
            <div className="mt-1 text-muted-foreground text-sm">
              {d.sug.detail}
            </div>
          </Card>

          {d.stalled && (
            <Card className="mt-3 flex gap-3 border-warn/40 bg-warn/10">
              <AlertTriangle className="size-5 shrink-0 text-warn" />
              <div className="text-sm">
                <div className="font-medium">Stalled for 3 weeks</div>
                <div className="text-muted-foreground">
                  No strength gain since{" "}
                  {relDay(
                    d.hist
                      .filter(
                        (h) =>
                          dayKey(new Date(h.workout.startedAt)) <
                          dayOffset(-21),
                      )
                      .at(-1)?.workout.startedAt ?? "",
                  )}
                  . Go 10% lighter for a week, or switch to{" "}
                  {Math.max(3, ex.repMin - 2)}–{ex.repMin + 1} reps.
                </div>
              </div>
            </Card>
          )}

          <Card className="mt-3 grid grid-cols-3 gap-3">
            <Stat
              label="Best est. 1-rep max"
              value={kgShort(
                Math.round((d.best?.stats.bestE1rm ?? 0) * 10) / 10,
              )}
              accent="fit"
            />
            <Stat
              label="Best set"
              value={
                d.best?.stats.top
                  ? `${kgShort(d.best.stats.top.weight)}×${d.best.stats.top.reps}`
                  : "—"
              }
            />
            <Stat label="Sessions" value={d.hist.length} />
          </Card>

          <Card className="mt-3">
            <Segmented
              value={metric}
              onChange={setMetric}
              options={[
                { value: "e1rm", label: "Est. max" },
                { value: "top", label: "Top weight" },
                { value: "volume", label: "Volume" },
              ]}
            />
            <div className="mt-3 flex items-baseline justify-between">
              <div className="num font-semibold text-xl">
                {lastV === undefined
                  ? "—"
                  : metric === "volume"
                    ? fmtVolume(lastV)
                    : kg(Math.round(lastV * 10) / 10)}
              </div>
              {change !== undefined && (
                <div
                  className={
                    change >= 0
                      ? "num text-good text-sm"
                      : "num text-muted-foreground text-sm"
                  }
                >
                  {change >= 0 ? "▲" : "▼"}{" "}
                  {metric === "volume"
                    ? fmtVolume(Math.abs(change))
                    : kg(Math.round(Math.abs(change) * 10) / 10)}{" "}
                  in range
                </div>
              )}
            </div>
            <TrendChart
              className="mt-2"
              line={series}
              dots={series}
              height={150}
              fmt={(n) =>
                metric === "volume"
                  ? `${Math.round(n / 100) / 10}t`
                  : n.toFixed(0)
              }
              labels={
                d.inRange.length
                  ? [
                      relDay(d.inRange[0].workout.startedAt),
                      relDay(d.inRange.at(-1)?.workout.startedAt ?? ""),
                    ]
                  : undefined
              }
            />
            <div className="mt-3">
              <Segmented
                value={range}
                onChange={setRange}
                options={[
                  { value: "4w", label: "4w" },
                  { value: "12w", label: "12w" },
                  { value: "1y", label: "1y" },
                  { value: "all", label: "All" },
                ]}
              />
            </div>
          </Card>

          <SectionTitle>PR history</SectionTitle>
          {d.prs.length ? (
            <Card className="divide-y divide-border/60 p-0">
              {d.prs.slice(0, 8).map((p) => (
                <div
                  key={`${p.workoutId}-${p.kind}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <Trophy className="size-4 text-warn" />
                  <div className="flex-1 text-sm">
                    {prLabel[p.kind]}{" "}
                    <span className="text-muted-foreground">
                      · {relDay(p.at)}
                    </span>
                  </div>
                  <div className="num font-semibold text-sm">
                    {p.kind === "volume"
                      ? fmtVolume(p.value)
                      : kg(Math.round(p.value * 10) / 10)}
                  </div>
                  <Link
                    href={`/fitness/share/${p.workoutId}?template=pr&exercise=${id}`}
                    aria-label="Share PR"
                    className="text-muted-foreground"
                  >
                    <Share2 className="size-4" />
                  </Link>
                </div>
              ))}
            </Card>
          ) : (
            <Card className="text-muted-foreground text-sm">
              No PRs yet — your first session set the starting point.
            </Card>
          )}

          <SectionTitle>Last 5 sessions</SectionTitle>
          <Card className="divide-y divide-border/60 p-0">
            {d.hist
              .slice(-5)
              .reverse()
              .map((h) => (
                <Link
                  key={h.workout.id}
                  href={`/fitness/workouts/${h.workout.id}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="w-20 text-muted-foreground text-sm">
                    {relDay(h.workout.startedAt)}
                  </div>
                  <div className="num flex-1 truncate text-sm">
                    {h.we.sets
                      .filter((x) => x.kind !== "warmup")
                      .map((x) => `${kgShort(x.weight)}×${x.reps}`)
                      .join("  ")}
                  </div>
                  <div className="num text-muted-foreground text-xs">
                    {kgShort(Math.round(h.stats.bestE1rm))}
                  </div>
                </Link>
              ))}
          </Card>
        </>
      )}

      <Btn
        variant="ghost"
        className="mt-4 w-full text-muted-foreground"
        onClick={() => {
          setExerciseArchived(ex.id, !ex.archived)
          toast(ex.archived ? "Unarchived" : "Archived — history kept", () =>
            setExerciseArchived(ex.id, !!ex.archived),
          )
        }}
      >
        <Archive className="size-4" />{" "}
        {ex.archived ? "Unarchive" : "Archive exercise"}
      </Btn>
      <ExerciseEditSheet open={edit} onOpenChange={setEdit} exercise={ex} />
    </Screen>
  )
}
