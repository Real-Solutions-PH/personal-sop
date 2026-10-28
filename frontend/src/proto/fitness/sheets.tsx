"use client"

import {
  Check,
  Dumbbell,
  History,
  Plus,
  Repeat,
  Scale,
  Search,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type ReactNode, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { dayKey, dayOffset } from "../lib/day"
import { Btn, Chip, Row } from "../ui/kit"
import {
  deleteWeighIn,
  logWeighIn,
  removeSet,
  restoreWeighIn,
  type StartFrom,
  setExerciseArchived,
  startWorkout,
  updateSet,
  updateWeighIn,
  upsertExercise,
} from "./actions"
import {
  avgOver,
  finished,
  kg,
  kgShort,
  lastOfTemplate,
  nextTemplate,
  relDay,
  suggestion,
} from "./calc"
import type {
  Equipment,
  Exercise,
  LoadType,
  Muscle,
  SetKind,
  WeighIn,
} from "./data"
import { fitStore, useFit } from "./store"
import { BottomSheet, Pill, Stepper, toast } from "./ui"

// ── FIT-04 Start workout sheet ──

export function StartSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const s = useFit()
  const router = useRouter()
  const [err, setErr] = useState<{ reason: string; href?: string } | null>(null)
  const next = useMemo(() => nextTemplate(s), [s])
  const rows = useMemo(
    () =>
      s.templates.map((t) => ({
        t,
        last: lastOfTemplate(s, t.id),
        sug: t.items[0] ? suggestion(s, t.items[0].exerciseId) : undefined,
      })),
    [s],
  )
  const go = (opts: StartFrom) => {
    const r = startWorkout(opts)
    if (!r.ok) return setErr(r)
    onOpenChange(false)
    router.push("/fitness/workout")
  }
  const exName = (id: string) =>
    s.exercises.find((e) => e.id === id)?.name ?? id
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Start workout"
      description="Sets prefill from last time, with the suggested weight or rep increase."
    >
      {err && (
        <div className="mb-3 rounded-xl bg-warn/15 p-3 text-sm text-warn">
          {err.reason}{" "}
          {err.href && (
            <Link href={err.href} className="font-semibold underline">
              Open it
            </Link>
          )}
        </div>
      )}
      <div className="space-y-2">
        {rows.map(({ t, last, sug }) =>
          last ? (
            <button
              key={t.id}
              type="button"
              onClick={() => go({ from: "repeat", workoutId: last.id })}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl border p-3 text-left active:bg-muted/60",
                next?.id === t.id
                  ? "border-fit bg-fit/10"
                  : "border-border/60 bg-card",
              )}
            >
              <div className="grid size-10 place-items-center rounded-xl bg-fit/15 text-fit">
                <Repeat className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  Repeat last {t.name}
                  {next?.id === t.id && <Pill tone="fit">Up next</Pill>}
                </div>
                <div className="truncate text-muted-foreground text-xs">
                  {relDay(last.startedAt)} · {t.items.length} exercises
                  {sug &&
                    sug.kind !== "new" &&
                    ` · ${exName(t.items[0].exerciseId).split(" ").slice(-2).join(" ")} ${sug.badge}`}
                </div>
              </div>
            </button>
          ) : (
            <Row
              key={t.id}
              onClick={() => go({ from: "template", templateId: t.id })}
              icon={
                <div className="grid size-10 place-items-center rounded-xl bg-muted">
                  <Dumbbell className="size-5" />
                </div>
              }
              title={t.name}
              subtitle={`Template · ${t.items.length} exercises · never done`}
            />
          ),
        )}
        <Row
          onClick={() => go({ from: "empty" })}
          icon={
            <div className="grid size-10 place-items-center rounded-xl bg-muted">
              <Plus className="size-5" />
            </div>
          }
          title="Empty workout"
          subtitle="Add exercises as you go"
        />
        <Link
          href="/fitness/templates"
          onClick={() => onOpenChange(false)}
          className="block pt-1 text-center text-muted-foreground text-sm"
        >
          Manage templates
        </Link>
      </div>
    </BottomSheet>
  )
}

// ── FIT-19 Weigh-in sheet (≤2 taps: open + save) ──

export function WeighInSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Weigh in"
      description="Prefilled from your last weigh-in."
    >
      {open && <WeighInForm onDone={() => onOpenChange(false)} />}
    </BottomSheet>
  )
}

function WeighInForm({ onDone }: { onDone: () => void }) {
  const s = fitStore.get()
  const last = [...s.weighIns]
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
    .at(-1)
  const [w, setW] = useState(last?.weightKg ?? 75)
  const lastBf = [...s.weighIns]
    .filter((x) => x.bodyFatPct !== undefined)
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
    .at(-1)?.bodyFatPct
  // Body fat is optional and collapsed, so the default log stays open → save.
  const [bf, setBf] = useState<number | null>(null)
  const [day, setDay] = useState(dayKey())
  const [confirm, setConfirm] = useState(false)
  const avg = avgOver(s, -6, 0)
  const outlier = avg !== undefined && Math.abs(w - avg) > 3
  const implausible = w < 30 || w > 250
  const save = () => {
    if (implausible) return
    if (outlier && !confirm) return setConfirm(true)
    const when =
      day === dayKey() ? undefined : new Date(`${day}T07:00:00`).toISOString()
    const rec = logWeighIn(w, when, undefined, bf ?? undefined)
    onDone()
    toast(
      `Logged ${kg(rec.weightKg)}${rec.bodyFatPct !== undefined ? ` · ${rec.bodyFatPct}% body fat` : ""}`,
      () => deleteWeighIn(rec.id),
    )
  }
  return (
    <div className="space-y-5 pt-2">
      <Stepper
        value={w}
        onChange={(v) => {
          setW(v)
          setConfirm(false)
        }}
        step={0.1}
        min={30}
        max={250}
        unit="kg"
      />
      <div className="text-center text-muted-foreground text-xs">
        {last
          ? `Last: ${kg(last.weightKg)} · ${relDay(last.measuredAt)}`
          : "First weigh-in sets your starting point"}
        {avg !== undefined && ` · 7-day avg ${avg.toFixed(1)}`}
      </div>
      <div className="flex gap-2 overflow-x-auto">
        <Chip
          active={day === dayKey()}
          accent="fit"
          onClick={() => setDay(dayKey())}
        >
          Today
        </Chip>
        <Chip
          active={day === dayOffset(-1)}
          accent="fit"
          onClick={() => setDay(dayOffset(-1))}
        >
          Yesterday
        </Chip>
        <label className="inline-flex h-9 items-center rounded-full border px-3 text-sm">
          <input
            type="date"
            value={day}
            max={dayKey()}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="bg-transparent outline-none"
            aria-label="Pick date"
          />
        </label>
      </div>
      {bf === null ? (
        <button
          type="button"
          onClick={() => setBf(lastBf ?? 20)}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-border border-dashed text-muted-foreground text-sm"
        >
          <Plus className="size-4" aria-hidden="true" /> Add body fat %
        </button>
      ) : (
        <div className="rounded-2xl bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Body fat</span>
            <button
              type="button"
              onClick={() => setBf(null)}
              className="h-9 px-2 text-muted-foreground text-xs"
            >
              Remove
            </button>
          </div>
          <Stepper
            value={bf}
            onChange={setBf}
            step={0.1}
            min={3}
            max={60}
            unit="%"
          />
          <div className="mt-1 text-center text-muted-foreground text-xs">
            {lastBf !== undefined
              ? `Last: ${lastBf}%`
              : "From a smart scale or calipers"}
          </div>
        </div>
      )}
      {implausible && (
        <div className="rounded-xl bg-bad/15 p-3 text-bad text-sm">
          That doesn’t look like a body weight.
        </div>
      )}
      {confirm && (
        <div className="rounded-xl bg-warn/15 p-3 text-sm text-warn">
          Sure? That’s {Math.abs(w - (avg ?? w)).toFixed(1)} kg off your 7-day
          average. Tap save again to keep it.
        </div>
      )}
      <Btn
        accent="fit"
        className="w-full"
        onClick={save}
        disabled={implausible}
      >
        <Scale className="size-4" /> {confirm ? "Yes, save" : "Save"}
      </Btn>
    </div>
  )
}

// ── FIT-21 Weigh-in edit sheet ──

export function WeighInEditSheet({
  entry,
  onOpenChange,
}: {
  entry: WeighIn | null
  onOpenChange: (v: boolean) => void
}) {
  return (
    <BottomSheet
      open={!!entry}
      onOpenChange={onOpenChange}
      title="Edit weigh-in"
    >
      {entry && (
        <WeighInEdit
          key={entry.id}
          entry={entry}
          onDone={() => onOpenChange(false)}
        />
      )}
    </BottomSheet>
  )
}

function WeighInEdit({
  entry,
  onDone,
}: {
  entry: WeighIn
  onDone: () => void
}) {
  const [w, setW] = useState(entry.weightKg)
  const d = new Date(entry.measuredAt)
  const [date, setDate] = useState(dayKey(d))
  const [time, setTime] = useState(d.toTimeString().slice(0, 5))
  const [note, setNote] = useState(entry.note ?? "")
  return (
    <div className="space-y-4 pt-2">
      <Stepper
        value={w}
        onChange={setW}
        step={0.1}
        min={30}
        max={250}
        unit="kg"
      />
      <div className="flex gap-2">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
        />
        <Input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="Time"
        />
      </div>
      <Input
        placeholder="Note (e.g. after cheat day)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Btn
          variant="danger"
          onClick={() => {
            const r = deleteWeighIn(entry.id)
            onDone()
            if (r) toast("Weigh-in deleted", () => restoreWeighIn(r))
          }}
        >
          Delete
        </Btn>
        <Btn
          accent="fit"
          className="flex-1"
          onClick={() => {
            updateWeighIn(entry.id, {
              weightKg: Math.round(w * 10) / 10,
              measuredAt: new Date(`${date}T${time}:00`).toISOString(),
              note: note || undefined,
            })
            onDone()
            toast("Saved")
          }}
        >
          Save
        </Btn>
      </div>
    </div>
  )
}

// ── FIT-06 Set edit sheet ──

export interface SetRef {
  workoutId: string
  weId: string
  setId: string
}

export function SetEditSheet({
  target,
  onOpenChange,
}: {
  target: SetRef | null
  onOpenChange: (v: boolean) => void
}) {
  return (
    <BottomSheet open={!!target} onOpenChange={onOpenChange} title="Edit set">
      {target && (
        <SetEdit
          key={target.setId}
          target={target}
          onDone={() => onOpenChange(false)}
        />
      )}
    </BottomSheet>
  )
}

const KINDS: { v: SetKind; l: string }[] = [
  { v: "working", l: "Working" },
  { v: "warmup", l: "Warm-up" },
  { v: "drop", l: "Drop" },
  { v: "failure", l: "Failure" },
]

function SetEdit({ target, onDone }: { target: SetRef; onDone: () => void }) {
  const s = fitStore.get()
  const w = s.workouts.find((x) => x.id === target.workoutId)
  const we = w?.exercises.find((e) => e.id === target.weId)
  const idx = we?.sets.findIndex((x) => x.id === target.setId) ?? -1
  const set = we?.sets[idx]
  const ex = s.exercises.find((e) => e.id === we?.exerciseId)
  const [weight, setWeight] = useState(set?.weight ?? 0)
  const [reps, setReps] = useState(set?.reps ?? 8)
  const [kind, setKind] = useState<SetKind>(set?.kind ?? "working")
  if (!we || !set || !ex) return null
  const prev = idx > 0 ? we.sets[idx - 1] : undefined
  const best = Math.max(
    0,
    ...finished(s).flatMap((x) =>
      x.exercises
        .filter((e) => e.exerciseId === ex.id)
        .flatMap((e) => e.sets.map((y) => y.weight)),
    ),
  )
  const typo = best > 0 && weight > best * 2
  return (
    <div className="space-y-5 pt-1">
      <div className="text-muted-foreground text-sm">
        {ex.name} · set {idx + 1}
      </div>
      <Stepper
        label={ex.loadType === "bodyweight" ? "Added weight" : "Weight"}
        value={weight}
        onChange={setWeight}
        step={ex.increment || 1}
        min={0}
        max={500}
        unit="kg"
        decimals={2}
      />
      <Stepper
        label={ex.loadType === "time" ? "Seconds" : "Reps"}
        value={reps}
        onChange={setReps}
        step={1}
        min={0}
        max={100}
        decimals={0}
      />
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <Chip
            key={k.v}
            active={kind === k.v}
            accent="fit"
            onClick={() => setKind(k.v)}
          >
            {k.l}
          </Chip>
        ))}
      </div>
      {prev && (
        <button
          type="button"
          onClick={() => {
            setWeight(prev.weight)
            setReps(prev.reps)
          }}
          className="text-fit text-sm"
        >
          Same as last set ({kgShort(prev.weight)} × {prev.reps})
        </button>
      )}
      {typo && (
        <div className="rounded-xl bg-warn/15 p-3 text-sm text-warn">
          That’s over 2× your best ({kg(best)}). Typo? PRs won’t count until you
          confirm by saving.
        </div>
      )}
      <div className="flex gap-2">
        <Btn
          variant="danger"
          onClick={() => {
            removeSet(target.workoutId, target.weId, target.setId)
            onDone()
          }}
        >
          Delete
        </Btn>
        <Btn
          accent="fit"
          className="flex-1"
          onClick={() => {
            updateSet(target.workoutId, target.weId, target.setId, {
              weight,
              reps,
              kind,
            })
            onDone()
          }}
        >
          <Check className="size-4" /> Save
        </Btn>
      </div>
    </div>
  )
}

// ── FIT-07 Exercise picker ──

export const MUSCLES: Muscle[] = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "quads",
  "hamstrings",
  "glutes",
  "core",
  "calves",
  "forearms",
  "cardio",
]

export function ExercisePicker({
  open,
  onOpenChange,
  onPick,
  multi = true,
  title = "Add exercises",
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: (ids: string[]) => void
  multi?: boolean
  title?: string
}) {
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={title}>
      {open && (
        <Picker
          multi={multi}
          onPick={(ids) => {
            onPick(ids)
            onOpenChange(false)
          }}
        />
      )}
    </BottomSheet>
  )
}

function Picker({
  multi,
  onPick,
}: {
  multi: boolean
  onPick: (ids: string[]) => void
}) {
  const s = useFit()
  const [q, setQ] = useState("")
  const [muscle, setMuscle] = useState<Muscle | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [creating, setCreating] = useState<string | null>(null)
  const recents = useMemo(() => {
    const seen: string[] = []
    for (const w of finished(s).reverse())
      for (const e of w.exercises)
        if (!seen.includes(e.exerciseId)) seen.push(e.exerciseId)
    return seen
  }, [s])
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return s.exercises
      .filter((e) => !e.archived)
      .filter((e) => !muscle || e.muscle === muscle)
      .filter((e) => !ql || e.name.toLowerCase().includes(ql))
      .sort((a, b) => {
        const ra = recents.indexOf(a.id)
        const rb = recents.indexOf(b.id)
        return (
          (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb) ||
          a.name.localeCompare(b.name)
        )
      })
  }, [s, q, muscle, recents])
  const toggle = (id: string) => {
    if (!multi) return onPick([id])
    setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
  }
  if (creating !== null)
    return (
      <ExerciseForm
        initial={{ name: creating }}
        onSaved={(e) => onPick([...sel, e.id])}
        onCancel={() => setCreating(null)}
      />
    )
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search exercises"
          className="pl-9"
        />
      </div>
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        <Chip active={!muscle} accent="fit" onClick={() => setMuscle(null)}>
          All
        </Chip>
        {MUSCLES.map((m) => (
          <Chip
            key={m}
            active={muscle === m}
            accent="fit"
            onClick={() => setMuscle(m)}
            className="capitalize"
          >
            {m}
          </Chip>
        ))}
      </div>
      {!q && !muscle && (
        <div className="px-1 text-muted-foreground text-xs uppercase tracking-wider">
          Recent first
        </div>
      )}
      <div>
        {list.map((e) => (
          <Row
            key={e.id}
            onClick={() => toggle(e.id)}
            icon={
              <div
                className={cn(
                  "grid size-9 place-items-center rounded-full border",
                  sel.includes(e.id)
                    ? "border-fit bg-fit text-background"
                    : "border-border",
                )}
              >
                {sel.includes(e.id) ? (
                  <Check className="size-4" />
                ) : recents.includes(e.id) ? (
                  <History className="size-4 text-muted-foreground" />
                ) : (
                  <Dumbbell className="size-4 text-muted-foreground" />
                )}
              </div>
            }
            title={e.name}
            subtitle={
              <span className="capitalize">
                {e.muscle} · {e.equipment}
              </span>
            }
          />
        ))}
        {!list.length && (
          <div className="py-8 text-center text-muted-foreground text-sm">
            No exercise matches “{q}”.
          </div>
        )}
      </div>
      {q.trim() && (
        <Btn
          variant="secondary"
          className="w-full"
          onClick={() => setCreating(q.trim())}
        >
          <Plus className="size-4" /> Create “{q.trim()}”
        </Btn>
      )}
      {multi && (
        <div className="sticky bottom-0 bg-background pt-2">
          <Btn
            accent="fit"
            className="w-full"
            disabled={!sel.length}
            onClick={() => onPick(sel)}
          >
            Add {sel.length || ""} exercise{sel.length === 1 ? "" : "s"}
          </Btn>
        </div>
      )}
    </div>
  )
}

// ── FIT-12 Exercise edit sheet ──

export function ExerciseEditSheet({
  open,
  onOpenChange,
  exercise,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  exercise?: Exercise
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={exercise ? "Edit exercise" : "New exercise"}
    >
      {open && (
        <ExerciseForm
          initial={exercise ?? {}}
          onSaved={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      )}
    </BottomSheet>
  )
}

const EQUIP: Equipment[] = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
]
const LOADS: { v: LoadType; l: string }[] = [
  { v: "weight", l: "Weight" },
  { v: "bodyweight", l: "Bodyweight + added" },
  { v: "reps", l: "Reps only" },
  { v: "time", l: "Time" },
]

function ExerciseForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: Partial<Exercise>
  onSaved: (e: Exercise) => void
  onCancel: () => void
}) {
  const s = useFit()
  const [f, setF] = useState<Partial<Exercise>>({
    equipment: "barbell",
    muscle: "chest",
    loadType: "weight",
    repMin: 8,
    repMax: 12,
    increment: 2.5,
    ...initial,
  })
  const set = (p: Partial<Exercise>) => setF((x) => ({ ...x, ...p }))
  const dup = s.exercises.some(
    (e) =>
      e.id !== f.id &&
      e.name.toLowerCase() === (f.name ?? "").trim().toLowerCase(),
  )
  return (
    <div className="space-y-4 pt-1">
      <div>
        <Input
          value={f.name ?? ""}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Exercise name"
          autoFocus
        />
        {dup && (
          <div className="mt-1 text-warn text-xs">
            An exercise with this name already exists.
          </div>
        )}
      </div>
      <Field label="Equipment">
        {EQUIP.map((e) => (
          <Chip
            key={e}
            active={f.equipment === e}
            accent="fit"
            onClick={() =>
              set({
                equipment: e,
                increment: e === "dumbbell" ? 2 : e === "machine" ? 5 : 2.5,
              })
            }
            className="capitalize"
          >
            {e}
          </Chip>
        ))}
      </Field>
      <Field label="Primary muscle">
        {MUSCLES.map((m) => (
          <Chip
            key={m}
            active={f.muscle === m}
            accent="fit"
            onClick={() => set({ muscle: m })}
            className="capitalize"
          >
            {m}
          </Chip>
        ))}
      </Field>
      <Field label="Load type">
        {LOADS.map((l) => (
          <Chip
            key={l.v}
            active={f.loadType === l.v}
            accent="fit"
            onClick={() => set({ loadType: l.v })}
          >
            {l.l}
          </Chip>
        ))}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Stepper
          label="Rep min"
          value={f.repMin ?? 8}
          onChange={(v) => set({ repMin: v })}
          step={1}
          min={1}
          max={100}
          decimals={0}
        />
        <Stepper
          label="Rep max"
          value={f.repMax ?? 12}
          onChange={(v) => set({ repMax: v })}
          step={1}
          min={1}
          max={100}
          decimals={0}
        />
      </div>
      <Field label="Weight increment">
        {[1, 2, 2.5, 5].map((n) => (
          <Chip
            key={n}
            active={f.increment === n}
            accent="fit"
            onClick={() => set({ increment: n })}
          >
            {n} kg
          </Chip>
        ))}
      </Field>
      {(f.repMin ?? 0) > (f.repMax ?? 0) && (
        <div className="text-bad text-xs">Rep min is above rep max.</div>
      )}
      <div className="flex gap-2">
        {f.id ? (
          <Btn
            variant="danger"
            onClick={() => {
              setExerciseArchived(f.id as string, !f.archived)
              onCancel()
            }}
          >
            {f.archived ? "Unarchive" : "Archive"}
          </Btn>
        ) : (
          <Btn variant="secondary" onClick={onCancel}>
            Cancel
          </Btn>
        )}
        <Btn
          accent="fit"
          className="flex-1"
          disabled={!f.name?.trim() || dup || (f.repMin ?? 0) > (f.repMax ?? 0)}
          onClick={() => onSaved(upsertExercise({ ...f, name: f.name ?? "" }))}
        >
          Save
        </Btn>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-muted-foreground text-xs uppercase tracking-wider">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}
