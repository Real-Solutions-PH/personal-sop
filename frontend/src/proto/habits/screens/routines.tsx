"use client"

import {
  Archive,
  Check,
  ChevronRight,
  Minus,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { dayKey, dayOffset, fmtDuration } from "../../lib/day"
import {
  Btn,
  Card,
  Chip,
  Empty,
  Screen,
  SectionTitle,
  Stat,
} from "../../ui/kit"
import { moveItem, SortableList } from "../../ui/sortable"
import {
  archiveRoutine,
  createRoutine,
  deleteRoutine,
  setRoutineSteps,
  updateRoutine,
} from "../actions"
import { EVERY_DAY, type Routine, type ScheduleSlot } from "../data"
import {
  pct,
  plannedMin,
  routineStats,
  runActualSec,
  runState,
  scheduleLabel,
  slotFor,
} from "../logic"
import { habitsStore } from "../store"
import {
  BottomSheet,
  ConfirmDialog,
  fmtDay,
  Gate,
  HabitIcon,
  NotFound,
  Toggle,
  useStartGuard,
} from "../ui"
import { Field, IconPicker, ReminderWarning, ScheduleField } from "./form"

const emptyRoutines = (
  <Empty
    icon={<span className="text-5xl">🌅</span>}
    title="Stack habits into one guided flow"
    body="A routine plays your habits back one step at a time, with a countdown, and logs each step as you go."
    action={
      <Btn accent="hab" href="/habits/routines/new?name=Morning%20routine">
        <Plus className="size-4" /> Build Morning routine
      </Btn>
    }
  />
)

function RunDots({ routine }: { routine: Routine }) {
  const runs = habitsStore.use((s) => s.runs)
  const today = dayKey()
  return (
    <div className="flex gap-1" role="img" aria-label="Last 7 days">
      {Array.from({ length: 7 }, (_, i) => {
        const d = dayOffset(i - 6)
        const run = runs.find((r) => r.routineId === routine.id && r.day === d)
        const st = run ? runState(run, today) : null
        const due = !!slotFor(routine.schedule, d) && d >= routine.createdAt
        return (
          <span
            key={d}
            className={cn(
              "size-2 rounded-full",
              st === "completed"
                ? "bg-hab"
                : st === "abandoned"
                  ? "bg-warn/60"
                  : st === "in_progress"
                    ? "bg-hab/50"
                    : due && d < today
                      ? "bg-bad/40"
                      : "bg-muted",
            )}
          />
        )
      })}
    </div>
  )
}

/** HAB-10 Routines list (+ HAB-10a empty). */
export function RoutinesListScreen() {
  return (
    <Screen
      title="Routines"
      back
      actions={
        <Link
          href="/habits/routines/new"
          aria-label="New routine"
          className="grid size-10 place-items-center rounded-full bg-hab text-background"
        >
          <Plus className="size-5" />
        </Link>
      }
    >
      <Gate empty={emptyRoutines}>
        <RoutinesBody />
      </Gate>
    </Screen>
  )
}

function RoutinesBody() {
  const state = habitsStore.use((s) => s)
  const [archived, setArchived] = useState(false)
  const guard = useStartGuard()
  const today = dayKey()
  const list = state.routines.filter((r) =>
    archived ? r.status === "archived" : r.status === "active",
  )
  const archivedCount = state.routines.filter(
    (r) => r.status === "archived",
  ).length
  if (!archived && list.length === 0 && archivedCount === 0)
    return emptyRoutines

  return (
    <div className="space-y-3 pt-1">
      <div className="flex gap-2">
        <Chip
          accent="hab"
          active={!archived}
          onClick={() => setArchived(false)}
        >
          Active
        </Chip>
        <Chip accent="hab" active={archived} onClick={() => setArchived(true)}>
          Archived · {archivedCount}
        </Chip>
      </div>
      {list.length === 0 && (
        <Card className="text-center text-muted-foreground text-sm">
          {archived ? "No archived routines." : "No active routines."}
        </Card>
      )}
      {list.map((r) => {
        const last = [...state.runs].reverse().find((x) => x.routineId === r.id)
        const st = last ? runState(last, today) : null
        return (
          <Card key={r.id} className="p-0">
            <Link
              href={`/habits/routines/${r.id}`}
              className="flex items-center gap-3 p-4 pb-2"
            >
              <HabitIcon icon={r.icon} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{r.name}</div>
                <div className="truncate text-muted-foreground text-xs">
                  {scheduleLabel(r.schedule)}
                </div>
                <div className="text-muted-foreground text-xs">
                  {r.steps.length} steps · {plannedMin(r)}m planned
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
            <div className="flex items-center gap-3 px-4 pb-3">
              <RunDots routine={r} />
              <span className="flex-1 truncate text-muted-foreground text-xs">
                {last
                  ? `Last: ${fmtDay(last.day, { weekday: "short" })} · ${st === "completed" ? `✓ ${fmtDuration(runActualSec(last))}` : st === "abandoned" ? `abandoned ${last.current}/${last.steps.length}` : "in progress"}`
                  : "Never run"}
              </span>
              {r.status === "active" && r.steps.length > 0 && (
                <Btn
                  accent="hab"
                  className="h-9 rounded-full px-3"
                  onClick={() => guard.tryRoutine(r.id)}
                >
                  <Play className="size-3.5 fill-current" /> Start
                </Btn>
              )}
            </div>
          </Card>
        )
      })}
      {guard.dialog}
    </div>
  )
}

/** HAB-11 Routine detail / steps (+ HAB-13 add-step picker). */
export function RoutineDetailScreen({ id }: { id: string }) {
  const routine = habitsStore.use((s) => s.routines.find((r) => r.id === id))
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null)
  const iconBtn =
    "grid size-10 place-items-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  return (
    <Screen
      title={routine?.name ?? "Routine"}
      back
      actions={
        routine ? (
          <>
            <Link
              href={`/habits/share?t=routine&routine=${id}`}
              aria-label="Share routine"
              className={iconBtn}
            >
              <Share2 className="size-5" />
            </Link>
            <Link
              href={`/habits/routines/${id}/edit`}
              aria-label="Edit routine"
              className={iconBtn}
            >
              <Pencil className="size-5" />
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="More actions"
                className={iconBtn}
              >
                <MoreVertical className="size-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem
                  className="min-h-11"
                  onSelect={() => setConfirm("archive")}
                >
                  <Archive /> Archive
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  className="min-h-11"
                  onSelect={() => setConfirm("delete")}
                >
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null
      }
    >
      <Gate>
        {routine ? (
          <RoutineDetail
            routine={routine}
            confirm={confirm}
            setConfirm={setConfirm}
          />
        ) : (
          <NotFound what="Routine" />
        )}
      </Gate>
    </Screen>
  )
}

function RoutineDetail({
  routine,
  confirm,
  setConfirm,
}: {
  routine: Routine
  confirm: "archive" | "delete" | null
  setConfirm: (c: "archive" | "delete" | null) => void
}) {
  const state = habitsStore.use((s) => s)
  const router = useRouter()
  const sp = useSearchParams()
  const guard = useStartGuard()
  const [pickerOpen, setPickerOpen] = useState(sp.get("add") === "1")
  const today = dayKey()
  const stats = useMemo(
    () => routineStats(routine, state.runs, 30),
    [routine, state.runs],
  )
  const run = state.runs.find(
    (x) =>
      x.routineId === routine.id && x.day === today && x.state !== "abandoned",
  )
  const habitsById = new Map(state.habits.map((h) => [h.id, h]))
  const archivedSteps = routine.steps.filter(
    (s) => habitsById.get(s.habitId)?.status === "archived",
  ).length
  const lastRuns = [...stats.runs].reverse().slice(0, 7)

  const reorder = (from: number, to: number) =>
    setRoutineSteps(routine.id, moveItem(routine.steps, from, to))
  const setMin = (i: number, m: number) =>
    setRoutineSteps(
      routine.id,
      routine.steps.map((s, j) =>
        j === i ? { ...s, minutes: Math.max(1, m) } : s,
      ),
    )
  const remove = (i: number) => {
    const prev = routine.steps
    setRoutineSteps(
      routine.id,
      prev.filter((_, j) => j !== i),
    )
    toast("Step removed", {
      action: {
        label: "Undo",
        onClick: () => setRoutineSteps(routine.id, prev),
      },
    })
  }

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center gap-4">
        <HabitIcon icon={routine.icon} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground text-sm">
            {scheduleLabel(routine.schedule)}
          </div>
          <div className="text-muted-foreground text-sm">
            {routine.steps.length} steps · {plannedMin(routine)} min planned
          </div>
        </div>
      </div>

      {routine.status === "active" && (
        <Btn
          accent="hab"
          className="h-14 w-full text-base"
          disabled={routine.steps.length === 0 || run?.state === "completed"}
          onClick={() => guard.tryRoutine(routine.id)}
        >
          <Play className="size-5 fill-current" />
          {run?.state === "completed"
            ? `Done today in ${fmtDuration(runActualSec(run))}`
            : run?.state === "in_progress"
              ? `Resume · step ${run.current + 1}/${run.steps.length}`
              : "Start routine"}
        </Btn>
      )}

      <Card className="grid grid-cols-3 gap-3">
        <Stat label="Completion 30d" value={pct(stats.rate)} accent="hab" />
        <Stat
          label="Pace vs plan"
          value={stats.pace ? pct(stats.pace) : "—"}
          goodWhen="down"
        />
        <Stat label="Runs 30d" value={stats.runs.length} />
      </Card>
      {stats.pace > 1.15 && (
        <p className="px-1 text-warn text-xs">
          You usually run {Math.round((stats.pace - 1) * 100)}% over plan —
          consider raising the planned minutes.
        </p>
      )}

      <SectionTitle
        action={
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="text-hab text-xs"
          >
            + Add step
          </button>
        }
      >
        Steps
      </SectionTitle>
      <Card className="p-1">
        {routine.steps.length === 0 ? (
          <div className="p-6 text-center">
            <div className="font-medium">No steps yet</div>
            <div className="mb-3 text-muted-foreground text-sm">
              Every step is a habit, so each one is tracked.
            </div>
            <Btn accent="hab" onClick={() => setPickerOpen(true)}>
              <Plus className="size-4" /> Add steps
            </Btn>
          </div>
        ) : (
          <SortableList
            items={routine.steps}
            keyOf={(s, i) => `${s.habitId}-${i}`}
            labelOf={(s) => habitsById.get(s.habitId)?.name ?? "step"}
            onReorder={reorder}
            renderItem={(s, i, handle) => {
              const h = habitsById.get(s.habitId)
              if (!h) return null
              return (
                <div
                  className={cn(
                    "flex items-center gap-1 py-1.5 pr-1",
                    h.status === "archived" && "opacity-40",
                  )}
                >
                  {handle}
                  <span className="text-lg">{h.icon}</span>
                  <div className="ml-1 min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{h.name}</div>
                    {h.status === "archived" && (
                      <div className="text-muted-foreground text-xs">
                        archived — hidden in player
                      </div>
                    )}
                  </div>
                  <div className="flex items-center rounded-full bg-muted">
                    <button
                      type="button"
                      aria-label={`Less time for ${h.name}`}
                      onClick={() => setMin(i, s.minutes - 1)}
                      className="grid size-9 place-items-center"
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="num w-9 text-center text-sm">
                      {s.minutes}m
                    </span>
                    <button
                      type="button"
                      aria-label={`More time for ${h.name}`}
                      onClick={() => setMin(i, s.minutes + 1)}
                      className="grid size-9 place-items-center"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${h.name}`}
                    onClick={() => remove(i)}
                    className="grid size-11 place-items-center text-muted-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )
            }}
          />
        )}
        {routine.steps.length > 0 && (
          <div className="flex justify-between border-border/60 border-t px-3 py-2 text-muted-foreground text-xs">
            <span>
              {archivedSteps ? `${archivedSteps} archived step` : "Total"}
            </span>
            <span className="num">{plannedMin(routine)} min</span>
          </div>
        )}
      </Card>

      <SectionTitle>Last runs</SectionTitle>
      <Card className="p-1">
        {lastRuns.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            Never run — start it once to see pace and history here.
          </div>
        ) : (
          lastRuns.map((x) => {
            const st = runState(x, today)
            const planned = x.steps.reduce((a, s) => a + s.minutes * 60, 0)
            return (
              <Link
                key={x.id}
                href={`/habits/routines/${routine.id}/summary?run=${x.id}`}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 active:bg-muted/60"
              >
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-xs",
                    st === "completed"
                      ? "bg-hab text-background"
                      : "bg-warn/20 text-warn",
                  )}
                >
                  {st === "completed" ? <Check className="size-3.5" /> : "!"}
                </span>
                <div className="flex-1 text-sm">
                  {fmtDay(x.day)}
                  <div className="text-muted-foreground text-xs">
                    {st === "completed"
                      ? `${x.results.filter((r) => r.status === "done").length}/${x.steps.length} done · ${fmtDuration(runActualSec(x))} vs ${fmtDuration(planned)}`
                      : st === "abandoned"
                        ? `Abandoned at ${x.current}/${x.steps.length}`
                        : `In progress ${x.current}/${x.steps.length}`}
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            )
          })
        )}
      </Card>

      <StepPicker
        key={String(pickerOpen)}
        routine={routine}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm === "delete"
            ? `Delete ${routine.name}?`
            : `Archive ${routine.name}?`
        }
        body={
          confirm === "delete"
            ? `Deletes the routine and its ${stats.runs.length}+ past runs. Its habits and their logs stay.`
            : "It leaves Today and Plan. Restore it any time from Archived."
        }
        confirmLabel={confirm === "delete" ? "Delete" : "Archive"}
        danger={confirm === "delete"}
        onConfirm={() => {
          if (confirm === "delete") deleteRoutine(routine.id)
          else archiveRoutine(routine.id)
          router.push("/habits/routines")
        }}
      />
      {guard.dialog}
    </div>
  )
}

/** HAB-13 add-step picker: search + multi-select + inline New habit. */
function StepPicker({
  routine,
  open,
  onOpenChange,
}: {
  routine: Routine
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const habits = habitsStore.use((s) => s.habits)
  const [q, setQ] = useState("")
  const [sel, setSel] = useState<string[]>([])
  const list = habits.filter(
    (h) =>
      h.status !== "archived" && h.name.toLowerCase().includes(q.toLowerCase()),
  )
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add steps"
      description="Pick habits — a habit can be in more than one routine."
    >
      <div className="space-y-3 pb-2">
        <label className="flex h-11 items-center gap-2 rounded-xl border border-border px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search habits"
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <div className="max-h-[45dvh] overflow-y-auto">
          <Link
            href={`/habits/new?addToRoutine=${routine.id}${q ? `&name=${encodeURIComponent(q)}` : ""}`}
            className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-hab"
          >
            <span className="grid size-8 place-items-center rounded-xl bg-hab/15">
              <Plus className="size-4" />
            </span>
            <span className="font-medium text-sm">
              New habit{q ? ` “${q}”` : ""}
            </span>
          </Link>
          {list.map((h) => {
            const on = sel.includes(h.id)
            const inRoutine = routine.steps.some((s) => s.habitId === h.id)
            return (
              <button
                key={h.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setSel((s) =>
                    on ? s.filter((x) => x !== h.id) : [...s, h.id],
                  )
                }
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-muted/60"
              >
                <span className="text-lg">{h.icon}</span>
                <span className="flex-1 text-sm">
                  {h.name}
                  {inRoutine && (
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      · already a step
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full border-2",
                    on
                      ? "border-hab bg-hab text-background"
                      : "border-muted-foreground/30",
                  )}
                >
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              </button>
            )
          })}
        </div>
        <Btn
          accent="hab"
          className="w-full"
          disabled={!sel.length}
          onClick={() => {
            setRoutineSteps(routine.id, [
              ...routine.steps,
              ...sel.map((id) => {
                const h = habits.find((x) => x.id === id)
                return {
                  habitId: id,
                  minutes: h?.type === "duration" ? (h.target ?? 5) : 5,
                }
              }),
            ])
            onOpenChange(false)
          }}
        >
          Add {sel.length || ""} step{sel.length === 1 ? "" : "s"}
        </Btn>
      </div>
    </BottomSheet>
  )
}

/** HAB-12 Routine form (create / edit). */
export function RoutineFormScreen({ id }: { id?: string }) {
  const routine = habitsStore.use((s) =>
    id ? s.routines.find((r) => r.id === id) : undefined,
  )
  return (
    <Screen title={id ? "Edit routine" : "New routine"} back>
      <Gate>
        {id && !routine ? (
          <NotFound what="Routine" />
        ) : (
          <RoutineForm routine={routine} />
        )}
      </Gate>
    </Screen>
  )
}

function RoutineForm({ routine }: { routine?: Routine }) {
  const router = useRouter()
  const sp = useSearchParams()
  const settings = habitsStore.use((s) => s.settings)
  const [name, setName] = useState(routine?.name ?? sp.get("name") ?? "")
  const [icon, setIcon] = useState(routine?.icon ?? "🌅")
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(
    routine?.schedule ?? [{ days: EVERY_DAY, time: "06:00" }],
  )
  const [reminder, setReminder] = useState(
    routine?.reminder ?? settings.defaultReminder,
  )
  const [tried, setTried] = useState(false)
  const errName = !name.trim() ? "Give it a name." : undefined
  const errSched = schedule.every((s) => !s.days.length)
    ? "Pick at least one day."
    : undefined

  return (
    <form
      className="space-y-5 pt-2"
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (errName || errSched) return
        const data = { name: name.trim(), icon, schedule, reminder }
        if (routine) {
          updateRoutine(routine.id, data)
          toast.success("Saved — applies from the next run")
          router.back()
        } else {
          const r = createRoutine(data)
          router.replace(`/habits/routines/${r.id}?add=1`)
        }
      }}
    >
      <Field label="Name" error={tried ? errName : undefined}>
        <div className="flex gap-2">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-hab/12 text-2xl">
            {icon}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Morning routine"
            className="h-12 min-w-0 flex-1 rounded-xl border border-border bg-transparent px-3 outline-none focus:border-hab"
          />
        </div>
      </Field>
      <IconPicker value={icon} onChange={setIcon} />
      <ScheduleField
        value={schedule}
        onChange={setSchedule}
        error={tried ? errSched : undefined}
      />
      <Card>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="font-medium text-sm">Reminder</div>
            <div className="text-muted-foreground text-xs">
              Opens the player ready to start
            </div>
          </div>
          <Toggle checked={reminder} onChange={setReminder} label="Reminder" />
        </div>
        {reminder && <ReminderWarning />}
      </Card>
      <Btn type="submit" accent="hab" className="w-full">
        {routine ? "Save changes" : "Create & add steps"}
      </Btn>
    </form>
  )
}
