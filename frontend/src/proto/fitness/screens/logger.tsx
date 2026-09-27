"use client"

import {
  ArrowDown,
  ArrowUp,
  Check,
  CloudOff,
  Dumbbell,
  History,
  MoreHorizontal,
  Plus,
  Replace,
  StickyNote,
  Timer,
  Trash2,
  TrendingUp,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { fmtDuration } from "../../lib/day"
import { Btn, Empty, Screen } from "../../ui/kit"
import {
  addExercises,
  addSet,
  adjustRest,
  discardWorkout,
  finishWorkout,
  lastActivity,
  moveExercise,
  removeExercise,
  replaceExercise,
  setExerciseNote,
  skipRest,
  toggleSet,
  updateSettings,
  updateWorkoutMeta,
} from "../actions"
import {
  exerciseHistory,
  fmtMin,
  fmtVolume,
  isDone,
  isWorking,
  kgShort,
  relDay,
  suggestion,
  workoutTotals,
} from "../calc"
import type { Exercise, FitnessState, Workout, WorkoutExercise } from "../data"
import {
  ExercisePicker,
  SetEditSheet,
  type SetRef,
  StartSheet,
} from "../sheets"
import { useFit } from "../store"
import { BottomSheet, Pill, toast, useNow } from "../ui"

// FIT-05 Active workout (+ FIT-08 rest banner, FIT-24 resume sheet, unfinished-set prompt).
// `?edit=<id>` reuses the logger for a finished workout (FIT-03 → Edit).

export function LoggerScreen() {
  const s = useFit()
  const qs = useSearchParams()
  const editId = qs.get("edit")
  const router = useRouter()
  const workout = s.workouts.find((w) =>
    editId
      ? w.id === editId
      : w.id === s.activeId && w.status === "in_progress",
  )
  const [startOpen, setStartOpen] = useState(false)

  if (!workout)
    return (
      <Screen title="Workout" back="/fitness">
        <Empty
          icon={<Dumbbell className="size-8" />}
          title="No workout running"
          body="Start from a template, repeat your last session, or go empty."
          action={
            <Btn accent="fit" onClick={() => setStartOpen(true)}>
              Start workout
            </Btn>
          }
        />
        <StartSheet open={startOpen} onOpenChange={setStartOpen} />
      </Screen>
    )
  return (
    <Logger
      key={workout.id}
      s={s}
      workout={workout}
      edit={!!editId}
      forceResume={qs.get("resume") === "1"}
      offline={qs.get("state") === "error"}
      onExit={(href) => router.replace(href)}
    />
  )
}

function Logger({
  s,
  workout,
  edit,
  forceResume,
  offline,
  onExit,
}: {
  s: FitnessState
  workout: Workout
  edit: boolean
  forceResume: boolean
  offline: boolean
  onExit: (href: string) => void
}) {
  const now = useNow(1000)
  const [editing, setEditing] = useState<SetRef | null>(null)
  const [picker, setPicker] = useState<
    null | { mode: "add" } | { mode: "replace"; weId: string }
  >(null)
  const [finishAsk, setFinishAsk] = useState(false)
  const [discardAsk, setDiscardAsk] = useState(false)
  const [resume, setResume] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const totals = useMemo(() => workoutTotals(s, workout), [s, workout])
  const exById = useMemo(
    () => new Map(s.exercises.map((e) => [e.id, e])),
    [s.exercises],
  )

  // FIT-24: reopening after a long gap (≥3 h idle) offers resume / finish / discard.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only check
  useEffect(() => {
    if (edit) return
    const idle = Date.now() - new Date(lastActivity(workout)).getTime()
    if (forceResume || idle > 3 * 3600_000) setResume(true)
  }, [])

  const unfinished = workout.exercises.flatMap((e) =>
    e.sets.filter((x) => !isDone(x)),
  ).length
  const doFinish = (unf: "remove" | "done" = "remove", endAt?: string) => {
    const w = finishWorkout(workout.id, { unfinished: unf, endAt })
    // Back to Train, where the "done today" card replaces Up next (summary is one tap away).
    if (w) onExit("/fitness?tab=train")
  }

  return (
    <Screen
      back={edit ? `/fitness/workouts/${workout.id}` : "/fitness"}
      title={
        renaming ? (
          <Input
            autoFocus
            defaultValue={workout.name}
            onBlur={(e) => {
              updateWorkoutMeta(workout.id, {
                name: e.target.value || workout.name,
              })
              setRenaming(false)
            }}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.target as HTMLInputElement).blur()
            }
            className="h-9"
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            className="truncate"
          >
            {edit ? `Edit · ${workout.name}` : workout.name}
          </button>
        )
      }
      actions={
        edit ? (
          <Btn
            accent="fit"
            className="h-9"
            onClick={() => {
              toast("Workout updated — PRs recomputed")
              onExit(`/fitness/workouts/${workout.id}`)
            }}
          >
            Done
          </Btn>
        ) : (
          <Btn
            accent="fit"
            className="h-9"
            onClick={() => (unfinished ? setFinishAsk(true) : doFinish())}
          >
            Finish
          </Btn>
        )
      }
      className="pb-40"
    >
      {!edit && (
        <div className="mb-3 grid grid-cols-3 gap-2 rounded-2xl bg-card p-3 text-center">
          <div>
            <div className="num font-semibold text-xl text-fit">
              {fmtDuration(
                (now - new Date(workout.startedAt).getTime()) / 1000,
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">Elapsed</div>
          </div>
          <div>
            <div className="num font-semibold text-xl">
              {totals.done}/{totals.planned}
            </div>
            <div className="text-[11px] text-muted-foreground">Sets</div>
          </div>
          <div>
            <div className="num font-semibold text-xl">
              {fmtVolume(totals.volume)}
            </div>
            <div className="text-[11px] text-muted-foreground">Volume</div>
          </div>
          {offline && (
            <div className="col-span-3 flex items-center justify-center gap-1.5 text-warn text-xs">
              <CloudOff className="size-3.5" /> Saved on device · syncs when
              online
            </div>
          )}
        </div>
      )}

      {!edit && s.rest && (
        <RestBanner
          now={now}
          endsAt={s.rest.endsAt}
          duration={s.rest.durationSec}
          restSec={s.settings.restSec}
        />
      )}

      {!workout.exercises.length && (
        <Empty
          icon={<Dumbbell className="size-8" />}
          title="No exercises yet"
          body="Add your first exercise — recents are on top."
        />
      )}

      <div className="space-y-3">
        {workout.exercises.map((we, i) => (
          <ExerciseCard
            key={we.id}
            s={s}
            workout={workout}
            we={we}
            ex={exById.get(we.exerciseId)}
            first={i === 0}
            last={i === workout.exercises.length - 1}
            onEditSet={(setId) =>
              setEditing({ workoutId: workout.id, weId: we.id, setId })
            }
            onReplace={() => setPicker({ mode: "replace", weId: we.id })}
          />
        ))}
      </div>

      <Btn
        variant="secondary"
        className="mt-4 w-full"
        onClick={() => setPicker({ mode: "add" })}
      >
        <Plus className="size-4" /> Add exercise
      </Btn>
      {!edit && (
        <Btn
          variant="ghost"
          className="mt-2 w-full text-bad"
          onClick={() => setDiscardAsk(true)}
        >
          Discard workout
        </Btn>
      )}

      <SetEditSheet
        target={editing}
        onOpenChange={(v) => !v && setEditing(null)}
      />
      <ExercisePicker
        open={!!picker}
        onOpenChange={(v) => !v && setPicker(null)}
        multi={picker?.mode !== "replace"}
        title={
          picker?.mode === "replace" ? "Replace exercise" : "Add exercises"
        }
        onPick={(ids) => {
          if (picker?.mode === "replace")
            replaceExercise(workout.id, picker.weId, ids[0])
          else addExercises(workout.id, ids)
        }}
      />

      <BottomSheet
        open={finishAsk}
        onOpenChange={setFinishAsk}
        title={`${unfinished} set${unfinished === 1 ? "" : "s"} not done`}
        description="Planned sets you never checked off."
      >
        <div className="space-y-2 pt-1">
          <Btn
            accent="fit"
            className="w-full"
            onClick={() => doFinish("remove")}
          >
            Remove them & finish
          </Btn>
          <Btn
            variant="secondary"
            className="w-full"
            onClick={() => doFinish("done")}
          >
            Mark all done & finish
          </Btn>
          <Btn
            variant="ghost"
            className="w-full"
            onClick={() => setFinishAsk(false)}
          >
            Keep logging
          </Btn>
        </div>
      </BottomSheet>

      <BottomSheet
        open={discardAsk}
        onOpenChange={setDiscardAsk}
        title="Discard this workout?"
        description="Nothing from this session will be saved."
      >
        <div className="space-y-2 pt-1">
          <Btn
            variant="danger"
            className="w-full"
            onClick={() => {
              discardWorkout(workout.id)
              onExit("/fitness")
            }}
          >
            Discard
          </Btn>
          <Btn
            variant="ghost"
            className="w-full"
            onClick={() => setDiscardAsk(false)}
          >
            Keep it
          </Btn>
        </div>
      </BottomSheet>

      <BottomSheet
        open={resume}
        onOpenChange={setResume}
        title={`${workout.name} is still running`}
        description={`Started ${relDay(workout.startedAt).toLowerCase()} at ${new Date(workout.startedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} · last set ${fmtMin((Date.now() - new Date(lastActivity(workout)).getTime()) / 1000)} ago`}
      >
        <div className="space-y-2 pt-1">
          <Btn
            accent="fit"
            className="w-full"
            onClick={() => doFinish("remove", lastActivity(workout))}
          >
            Finish at last set time
          </Btn>
          <Btn
            variant="secondary"
            className="w-full"
            onClick={() => setResume(false)}
          >
            Resume
          </Btn>
          <Btn
            variant="ghost"
            className="w-full text-bad"
            onClick={() => {
              discardWorkout(workout.id)
              onExit("/fitness")
            }}
          >
            Discard
          </Btn>
        </div>
      </BottomSheet>
    </Screen>
  )
}

function RestBanner({
  now,
  endsAt,
  duration,
  restSec,
}: {
  now: number
  endsAt: string
  duration: number
  restSec: number
}) {
  const left = (new Date(endsAt).getTime() - now) / 1000
  const over = left <= 0
  return (
    <div
      className={cn(
        "sticky top-14 z-10 mb-3 overflow-hidden rounded-2xl border p-3 shadow-lg backdrop-blur-md",
        over ? "border-good/40 bg-good/15" : "border-fit/40 bg-card/95",
      )}
    >
      <div className="flex items-center gap-3">
        <Timer className={cn("size-5", over ? "text-good" : "text-fit")} />
        <div className="flex-1">
          <div className="num font-semibold text-2xl leading-none">
            {over ? `+${fmtDuration(-left)}` : fmtDuration(left)}
          </div>
          <div className="text-muted-foreground text-xs">
            {over ? "Rest over — next set" : `Rest · ${duration}s`}
          </div>
        </div>
        {!over && (
          <>
            <button
              type="button"
              onClick={() => adjustRest(-15)}
              className="h-9 rounded-xl bg-muted px-2.5 font-medium text-sm"
            >
              −15
            </button>
            <button
              type="button"
              onClick={() => adjustRest(15)}
              className="h-9 rounded-xl bg-muted px-2.5 font-medium text-sm"
            >
              +15
            </button>
          </>
        )}
        <button
          type="button"
          onClick={skipRest}
          className="h-9 rounded-xl bg-muted px-3 font-medium text-sm"
        >
          {over ? "OK" : "Skip"}
        </button>
      </div>
      {!over && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-fit transition-[width] duration-1000 ease-linear"
            style={{ width: `${(left / Math.max(1, duration)) * 100}%` }}
          />
        </div>
      )}
      {!over && duration !== restSec && (
        <button
          type="button"
          onClick={() => updateSettings({ restSec: duration })}
          className="mt-1.5 text-fit text-xs"
        >
          Make {duration}s my default
        </button>
      )}
    </div>
  )
}

function ExerciseCard({
  s,
  workout,
  we,
  ex,
  first,
  last,
  onEditSet,
  onReplace,
}: {
  s: FitnessState
  workout: Workout
  we: WorkoutExercise
  ex: Exercise | undefined
  first: boolean
  last: boolean
  onEditSet: (setId: string) => void
  onReplace: () => void
}) {
  const [noteOpen, setNoteOpen] = useState(!!we.note)
  const { prev, sug } = useMemo(() => {
    const sOther = {
      ...s,
      workouts: s.workouts.filter((w) => w.id !== workout.id),
    }
    return {
      prev: exerciseHistory(sOther, we.exerciseId).at(-1),
      sug: suggestion(sOther, we.exerciseId),
    }
  }, [s, workout.id, we.exerciseId])
  const prevWorking = prev?.we.sets.filter(isWorking) ?? []
  const prevWarm = prev?.we.sets.filter((x) => !isWorking(x)) ?? []
  let wIdx = 0
  let uIdx = 0
  const doneCount = we.sets.filter((x) => isDone(x) && isWorking(x)).length
  const allDone = doneCount > 0 && we.sets.every(isDone)
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-3",
        allDone ? "border-fit/40" : "border-border/60",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/fitness/exercises/${we.exerciseId}`}
            className="block truncate font-semibold"
          >
            {ex?.name ?? "Unknown exercise"}
          </Link>
          <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
            {sug.kind !== "new" ? (
              <Pill tone="fit">
                <TrendingUp className="size-3" /> {sug.badge}
              </Pill>
            ) : (
              <Pill>New</Pill>
            )}
            <span className="truncate">{sug.detail}</span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="grid size-8 place-items-center rounded-full hover:bg-muted"
            aria-label="Exercise options"
          >
            <MoreHorizontal className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/fitness/exercises/${we.exerciseId}`}>
                <History className="size-4" /> History
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onReplace}>
              <Replace className="size-4" /> Replace
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNoteOpen(true)}>
              <StickyNote className="size-4" /> Note
            </DropdownMenuItem>
            {!first && (
              <DropdownMenuItem
                onSelect={() => moveExercise(workout.id, we.id, -1)}
              >
                <ArrowUp className="size-4" /> Move up
              </DropdownMenuItem>
            )}
            {!last && (
              <DropdownMenuItem
                onSelect={() => moveExercise(workout.id, we.id, 1)}
              >
                <ArrowDown className="size-4" /> Move down
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => removeExercise(workout.id, we.id)}
            >
              <Trash2 className="size-4" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {noteOpen && (
        <Input
          defaultValue={we.note}
          placeholder="Note (seat 4, grip width…)"
          onBlur={(e) => setExerciseNote(workout.id, we.id, e.target.value)}
          className="mt-2 h-9 text-sm"
        />
      )}

      <div className="mt-3 grid grid-cols-[2rem_1fr_1fr_1fr_2.75rem] items-center gap-x-2 px-1 text-[10px] text-muted-foreground uppercase tracking-wider">
        <span>Set</span>
        <span>Last</span>
        <span className="text-center">
          {ex?.loadType === "bodyweight" ? "+kg" : "kg"}
        </span>
        <span className="text-center">
          {ex?.loadType === "time" ? "sec" : "reps"}
        </span>
        <span />
      </div>
      <div className="mt-1 space-y-1">
        {we.sets.map((set) => {
          const warm = !isWorking(set)
          const ghost = warm ? prevWarm[uIdx++] : prevWorking[wIdx++]
          const label = warm
            ? "W"
            : set.kind === "drop"
              ? "D"
              : set.kind === "failure"
                ? "F"
                : String(wIdx)
          const needsWeight =
            !isDone(set) && set.weight === 0 && ex?.loadType === "weight"
          return (
            <div
              key={set.id}
              className={cn(
                "grid grid-cols-[2rem_1fr_1fr_1fr_2.75rem] items-center gap-x-2 rounded-xl px-1 py-1 transition-colors",
                isDone(set) && "bg-fit/10",
              )}
            >
              <span
                className={cn(
                  "num text-center font-semibold text-sm",
                  warm ? "text-warn" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              <span className="num truncate text-muted-foreground text-xs">
                {ghost ? `${kgShort(ghost.weight)}×${ghost.reps}` : "—"}
              </span>
              <button
                type="button"
                onClick={() => onEditSet(set.id)}
                className={cn(
                  "num h-10 rounded-lg bg-muted/60 font-semibold",
                  needsWeight && "text-muted-foreground",
                )}
              >
                {needsWeight ? "—" : kgShort(set.weight)}
              </button>
              <button
                type="button"
                onClick={() => onEditSet(set.id)}
                className="num h-10 rounded-lg bg-muted/60 font-semibold"
              >
                {set.reps}
              </button>
              <button
                type="button"
                aria-label={isDone(set) ? "Undo set" : "Complete set"}
                onClick={() =>
                  needsWeight
                    ? onEditSet(set.id)
                    : toggleSet(workout.id, we.id, set.id)
                }
                className={cn(
                  "grid size-10 place-items-center rounded-xl border-2 transition-all active:scale-90",
                  isDone(set)
                    ? "border-fit bg-fit text-background"
                    : "border-border text-muted-foreground",
                )}
              >
                <Check className="size-5" strokeWidth={3} />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => addSet(workout.id, we.id)}
        className="mt-2 flex h-9 w-full items-center justify-center gap-1 rounded-xl text-muted-foreground text-sm hover:bg-muted"
      >
        <Plus className="size-4" /> Add set
      </button>
    </div>
  )
}
