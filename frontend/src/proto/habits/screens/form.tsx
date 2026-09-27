"use client"

import {
  AlertTriangle,
  Archive,
  CalendarClock,
  Check,
  ChevronRight,
  Hash,
  Pause,
  Play,
  Timer,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Btn, Card, NumberInput, Screen, Segmented } from "../../ui/kit"
import {
  archiveHabit,
  createHabit,
  resumeHabit,
  setRoutineSteps,
  updateHabit,
} from "../actions"
import {
  EVERY_DAY,
  type Habit,
  type HabitType,
  ICONS,
  type ScheduleSlot,
} from "../data"
import { effectiveStatus, scheduleLabel } from "../logic"
import { habitsStore } from "../store"
import {
  ConfirmDialog,
  Gate,
  NotFound,
  ScheduleSheet,
  Toggle,
  useMounted,
} from "../ui"
import { PauseSheet } from "./detail"

export function useNotifStatus() {
  const mounted = useMounted()
  if (!mounted || typeof Notification === "undefined")
    return "unsupported" as const
  return Notification.permission
}

/** HAB-E2 inline warning under a reminder toggle. */
export function ReminderWarning() {
  const st = useNotifStatus()
  if (st === "granted") return null
  return (
    <Link
      href="/habits/settings?notify=1"
      className="mt-2 flex items-center gap-2 rounded-xl bg-warn/10 px-3 py-2 text-warn text-xs"
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1">
        Reminders need the app installed + notifications allowed.
      </span>
      <span className="font-semibold">Fix</span>
    </Link>
  )
}

export function Field({
  label,
  children,
  error,
}: {
  label: string
  children: React.ReactNode
  error?: string
}) {
  return (
    <div>
      <div className="mb-1.5 px-1 font-medium text-muted-foreground text-xs">
        {label}
      </div>
      {children}
      {error && <div className="mt-1 px-1 text-bad text-xs">{error}</div>}
    </div>
  )
}

export function IconPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {ICONS.map((i) => (
        <button
          key={i}
          type="button"
          aria-pressed={value === i}
          onClick={() => onChange(i)}
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-2xl text-xl",
            value === i ? "bg-hab/25 ring-2 ring-hab" : "bg-muted",
          )}
        >
          {i}
        </button>
      ))}
    </div>
  )
}

export function ScheduleField({
  value,
  onChange,
  error,
}: {
  value: ScheduleSlot[]
  onChange: (s: ScheduleSlot[]) => void
  error?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Field label="Schedule" error={error}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 w-full items-center gap-3 rounded-xl border border-border px-3 text-left"
      >
        <CalendarClock className="size-4 text-hab" />
        <span className="flex-1 truncate text-sm">
          {scheduleLabel(value) || "Pick days"}
        </span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </button>
      <ScheduleSheet
        open={open}
        onOpenChange={setOpen}
        value={value}
        onChange={onChange}
      />
    </Field>
  )
}

/** HAB-03 Habit form (create / edit). */
export function HabitFormScreen({ id }: { id?: string }) {
  const habit = habitsStore.use((s) =>
    id ? s.habits.find((h) => h.id === id) : undefined,
  )
  return (
    <Screen title={id ? "Edit habit" : "New habit"} back>
      <Gate rows={6}>
        {id && !habit ? <NotFound what="Habit" /> : <HabitForm habit={habit} />}
      </Gate>
    </Screen>
  )
}

function HabitForm({ habit }: { habit?: Habit }) {
  const router = useRouter()
  const sp = useSearchParams()
  const settings = habitsStore.use((s) => s.settings)
  const addToRoutine = sp.get("addToRoutine")
  const saveError = sp.get("state") === "save-error"
  const [name, setName] = useState(habit?.name ?? sp.get("name") ?? "")
  const [icon, setIcon] = useState(habit?.icon ?? sp.get("icon") ?? "✅")
  const [type, setType] = useState<HabitType>(
    habit?.type ?? (sp.get("type") as HabitType | null) ?? "check",
  )
  const [target, setTarget] = useState(
    String(habit?.target ?? sp.get("target") ?? (type === "duration" ? 30 : 1)),
  )
  const [unit, setUnit] = useState(habit?.unit ?? sp.get("unit") ?? "")
  const [step, setStep] = useState(String(habit?.step ?? 1))
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(
    habit?.schedule ?? [{ days: EVERY_DAY }],
  )
  const [reminder, setReminder] = useState(
    habit?.reminder ?? settings.defaultReminder,
  )
  const [linkWorkout, setLinkWorkout] = useState(habit?.linkWorkout ?? false)
  const [tried, setTried] = useState(false)
  const [pauseOpen, setPauseOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [failed, setFailed] = useState(saveError)

  const errors = {
    name: !name.trim() ? "Give it a name." : undefined,
    schedule: schedule.every((s) => s.days.length === 0)
      ? "Pick at least one day."
      : undefined,
    target:
      type !== "check" && !(Number(target) > 0)
        ? "Target must be more than 0."
        : undefined,
  }
  const valid = !errors.name && !errors.schedule && !errors.target

  const save = () => {
    setTried(true)
    if (!valid) return
    if (failed) {
      // walkthrough: first save fails (HAB-E4), form is preserved; retry succeeds
      setFailed(false)
      toast.error("Couldn't save — your changes are kept. Tap Save to retry.")
      return
    }
    const data = {
      name: name.trim(),
      icon,
      type,
      target: type === "check" ? undefined : Number(target),
      unit: type === "count" ? unit || undefined : undefined,
      step: type === "count" ? Number(step) || 1 : undefined,
      schedule: schedule.filter((s) => s.days.length),
      reminder,
      linkWorkout,
    }
    if (habit) {
      updateHabit(habit.id, data)
      toast.success("Saved — schedule changes apply from today")
      router.back()
    } else {
      const h = createHabit(data)
      if (addToRoutine) {
        const r = habitsStore.get().routines.find((x) => x.id === addToRoutine)
        if (r)
          setRoutineSteps(r.id, [
            ...r.steps,
            {
              habitId: h.id,
              minutes: h.type === "duration" ? (h.target ?? 5) : 5,
            },
          ])
        router.replace(`/habits/routines/${addToRoutine}`)
      } else router.replace(`/habits/${h.id}`)
      toast.success(`Created ${h.name}`)
    }
  }

  const paused = habit && effectiveStatus(habit) === "paused"

  return (
    <form
      className="space-y-5 pt-2"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      {failed && (
        <div className="rounded-xl bg-bad/10 px-3 py-2 text-bad text-xs">
          Walkthrough: the next save will fail to show the error state.
        </div>
      )}
      <Field label="Name" error={tried ? errors.name : undefined}>
        <div className="flex gap-2">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-hab/12 text-2xl">
            {icon}
          </div>
          <input
            // biome-ignore lint/a11y/noAutofocus: primary field of a create form
            autoFocus={!habit}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Stretch"
            className={cn(
              "h-12 min-w-0 flex-1 rounded-xl border bg-transparent px-3 outline-none focus:border-hab",
              tried && errors.name ? "border-bad" : "border-border",
            )}
          />
        </div>
      </Field>
      <IconPicker value={icon} onChange={setIcon} />

      <Field label="Type">
        <Segmented
          value={type}
          onChange={(t) => {
            setType(t)
            if (t === "duration" && !habit) setTarget("30")
            if (t === "count" && !habit) setTarget("8")
          }}
          options={[
            {
              value: "check",
              label: (
                <span className="inline-flex items-center gap-1">
                  <Check aria-hidden="true" className="size-4" /> Check
                </span>
              ),
            },
            {
              value: "duration",
              label: (
                <span className="inline-flex items-center gap-1">
                  <Timer aria-hidden="true" className="size-4" /> Timed
                </span>
              ),
            },
            {
              value: "count",
              label: (
                <span className="inline-flex items-center gap-1">
                  <Hash aria-hidden="true" className="size-4" /> Count
                </span>
              ),
            },
          ]}
        />
      </Field>

      {type !== "check" && (
        <div className="grid grid-cols-3 gap-2">
          <Field
            label={type === "duration" ? "Target (min)" : "Target"}
            error={tried ? errors.target : undefined}
          >
            <NumberInput
              inputMode="numeric"
              value={target}
              onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))}
              className="num h-12 w-full rounded-xl border border-border bg-transparent px-3 outline-none focus:border-hab"
            />
          </Field>
          {type === "count" && (
            <>
              <Field label="Unit">
                <input
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="pages"
                  className="h-12 w-full rounded-xl border border-border bg-transparent px-3 outline-none focus:border-hab"
                />
              </Field>
              <Field label="“+” adds">
                <NumberInput
                  inputMode="numeric"
                  value={step}
                  onChange={(e) => setStep(e.target.value.replace(/\D/g, ""))}
                  className="num h-12 w-full rounded-xl border border-border bg-transparent px-3 outline-none focus:border-hab"
                />
              </Field>
            </>
          )}
        </div>
      )}

      <ScheduleField
        value={schedule}
        onChange={setSchedule}
        error={tried ? errors.schedule : undefined}
      />

      <Card className="space-y-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="font-medium text-sm">Reminder</div>
              <div className="text-muted-foreground text-xs">
                Push at the scheduled time
              </div>
            </div>
            <Toggle
              checked={reminder}
              onChange={setReminder}
              label="Reminder"
            />
          </div>
          {reminder && <ReminderWarning />}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="font-medium text-sm">Link to workouts</div>
            <div className="text-muted-foreground text-xs">
              Auto-check when any workout is logged in Fitness
            </div>
          </div>
          <Toggle
            checked={linkWorkout}
            onChange={setLinkWorkout}
            label="Link to workouts"
          />
        </div>
      </Card>

      <Btn type="submit" accent="hab" className="w-full">
        {habit ? "Save changes" : "Create habit"}
      </Btn>

      {habit && (
        <div className="grid grid-cols-2 gap-2">
          {paused ? (
            <Btn variant="secondary" onClick={() => resumeHabit(habit.id)}>
              <Play className="size-4" /> Resume
            </Btn>
          ) : (
            <Btn variant="secondary" onClick={() => setPauseOpen(true)}>
              <Pause className="size-4" /> Pause
            </Btn>
          )}
          <Btn variant="danger" onClick={() => setArchiveOpen(true)}>
            <Archive className="size-4" /> Archive
          </Btn>
          <PauseSheet
            habit={habit}
            open={pauseOpen}
            onOpenChange={setPauseOpen}
          />
          <ConfirmDialog
            open={archiveOpen}
            onOpenChange={setArchiveOpen}
            title={`Archive ${habit.name}?`}
            body="It leaves Today and your lists. History and stats are kept, and you can restore it."
            confirmLabel="Archive"
            onConfirm={() => {
              archiveHabit(habit.id)
              router.push("/habits/manage")
            }}
          />
        </div>
      )}
    </form>
  )
}
