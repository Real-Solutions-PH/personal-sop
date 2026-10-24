"use client"

import { ArrowLeft, Check, ChevronRight, PartyPopper, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { ModuleKey } from "../contract"
import { startFresh } from "../finance/actions"
import { FinanceSetup } from "../finance/screens/settings"
import { finStore } from "../finance/store"
import {
  logWeighIn,
  updateSettings as updateFitSettings,
  upsertTemplate,
} from "../fitness/actions"
import type { FitnessSettings } from "../fitness/data"
import { fitStore } from "../fitness/store"
import { createHabit, type HabitInput } from "../habits/actions"
import { habitsStore } from "../habits/store"
import { captureTasks } from "../tasks/actions"
import { tasksStore } from "../tasks/store"
import { Btn, Card, Chip, NumberInput, Segmented } from "../ui/kit"
import { AREA } from "./data"
import { useEnabled } from "./hooks"
import { dashStore, setSetupHidden, skipSetup } from "./store"
import { AreaIcon, useQueryParam } from "./ui"

// Data setup for new users: bring each module's starting data in, one small
// step at a time. Every step is skippable; the hub (/setup) and Today's card
// pick up where the user left off. A step counts as done once its module holds
// data — so demo users with seeded data never see it.

const ORDER: ModuleKey[] = ["finance", "habits", "fitness", "tasks"]

const STEP: Record<ModuleKey, { title: string; why: string; time: string }> = {
  finance: {
    title: "Your accounts & balances",
    why: "Where your money lives today — the starting point for net worth and savings.",
    time: "1 min",
  },
  habits: {
    title: "A few starter habits",
    why: "Pick two or three. Small ones stick.",
    time: "30 sec",
  },
  fitness: {
    title: "Your training baseline",
    why: "Today's weight and the split you run, so progress has a day 1.",
    time: "30 sec",
  },
  // Not in ORDER: the web prototype keeps meals inside Fitness (the native
  // app has Nutrition as its own module, ADR-0024).
  nutrition: {
    title: "Your daily targets",
    why: "Calories and protein to aim for.",
    time: "30 sec",
  },
  // Not in ORDER either: the focus timer is native only (ADR-0025).
  focus: {
    title: "Your daily focus goal",
    why: "Hours of deep work a day.",
    time: "15 sec",
  },
  tasks: {
    title: "What's on your plate",
    why: "Dump what's in your head. Dates like 'friday' are picked up for you.",
    time: "1 min",
  },
}

/** Which modules already hold data (a step is done when its module does). */
export function useSetupStatus() {
  const enabled = useEnabled()
  const skipped = dashStore.use((s) => s.setupSkipped)
  const has: Record<ModuleKey, boolean> = {
    finance: finStore.use((s) => s.accounts.length > 0),
    habits: habitsStore.use((s) => s.habits.length > 0),
    fitness: fitStore.use(
      (s) => s.templates.length + s.workouts.length + s.weighIns.length > 0,
    ),
    nutrition: fitStore.use((s) => s.targets.length > 0),
    focus: true,
    tasks: tasksStore.use((s) => s.tasks.length > 0),
  }
  const steps = ORDER.filter((k) => enabled[k])
  const pending = steps.filter((k) => !has[k])
  return { steps, has, pending, skipped }
}

/** Demo: wipe every module to a brand-new account, keeping libraries/settings. */
export function startAsNewUser() {
  startFresh()
  habitsStore.set((s) => ({
    ...s,
    habits: [],
    logs: [],
    routines: [],
    runs: [],
    timer: null,
  }))
  tasksStore.set((s) => ({ ...s, tasks: [], events: [] }))
  fitStore.set((s) => ({
    ...s,
    templates: [],
    workouts: [],
    weighIns: [],
    meals: [],
    activeId: null,
    rest: null,
  }))
  dashStore.set((s) => ({
    ...s,
    goals: [],
    reviews: {},
    notifs: [],
    missNotes: {},
    wrapups: {},
    onboarded: false,
    setupSkipped: [],
    setupHidden: false,
    profile: { ...s.profile, identities: [] },
  }))
}

// ------------------------------------------------------------------ Today card

export function SetupCard() {
  const { steps, pending } = useSetupStatus()
  const hidden = dashStore.use((s) => s.setupHidden)
  if (hidden || !pending.length) return null
  const done = steps.length - pending.length
  return (
    <Card className="relative">
      <button
        type="button"
        aria-label="Hide setup reminder"
        onClick={() => {
          setSetupHidden(true)
          toast("Setup hidden — find it anytime in Me → Set up my data")
        }}
        className="absolute top-2 right-2 grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
      >
        <X className="size-4" />
      </button>
      <Link href="/setup" className="block pr-8">
        <div className="font-semibold">Finish setting up</div>
        <div className="text-muted-foreground text-sm">
          {done} of {steps.length} done · next: {STEP[pending[0]].title}
        </div>
        <div className="mt-3 flex gap-1.5">
          {steps.map((k) => (
            <span
              key={k}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                pending.includes(k) ? "bg-muted" : "bg-primary",
              )}
            />
          ))}
        </div>
      </Link>
    </Card>
  )
}

// ------------------------------------------------------------------ screen

export function SetupScreen() {
  const router = useRouter()
  const param = useQueryParam("step") as ModuleKey | null
  const { steps, has, pending, skipped } = useSetupStatus()
  const [step, setStep] = useState<ModuleKey | null>(null)
  useEffect(() => {
    if (param && ORDER.includes(param)) setStep(param)
  }, [param])

  const go = (k: ModuleKey | null) => {
    setStep(k)
    window.history.replaceState(null, "", k ? `/setup?step=${k}` : "/setup")
  }
  // Next unfinished step after `k`, else back to the hub.
  const advance = (k: ModuleKey) => {
    const rest = steps.slice(steps.indexOf(k) + 1)
    go(rest.find((x) => pending.includes(x) && x !== k) ?? null)
  }
  const skip = (k: ModuleKey) => {
    skipSetup(k)
    advance(k)
  }

  if (step)
    return (
      <div className="flex min-h-full flex-col px-5 pt-safe pb-8">
        <div className="flex h-14 items-center gap-3">
          <button
            type="button"
            aria-label="Back to setup"
            onClick={() => go(null)}
            className="grid size-11 place-items-center rounded-full hover:bg-muted"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="flex flex-1 gap-1.5">
            {steps.map((k) => (
              <span
                key={k}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  k === step || has[k] ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => skip(step)}
            className="px-2 text-muted-foreground text-sm"
          >
            Skip
          </button>
        </div>
        <div className="mt-2 mb-4 flex items-center gap-3">
          <AreaIcon k={step} size="lg" />
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight">
              {STEP[step].title}
            </h1>
            <p className="text-muted-foreground text-sm">{STEP[step].why}</p>
          </div>
        </div>
        <div className="flex flex-1 flex-col">
          {step === "finance" && <FinanceSetup onDone={() => advance(step)} />}
          {step === "habits" && <HabitsStep onDone={() => advance(step)} />}
          {step === "fitness" && <FitnessStep onDone={() => advance(step)} />}
          {step === "tasks" && <TasksStep onDone={() => advance(step)} />}
        </div>
      </div>
    )

  const allDone = steps.length > 0 && !pending.length
  return (
    <div className="flex min-h-full flex-col px-5 pt-safe pb-8">
      <div className="flex h-14 items-center">
        <button
          type="button"
          aria-label="Close"
          onClick={() => router.push("/today")}
          className="grid size-11 place-items-center rounded-full hover:bg-muted"
        >
          <X className="size-5" />
        </button>
      </div>
      <h1 className="font-display font-bold text-2xl tracking-tight">
        {allDone ? "You're all set" : "Bring your life in"}
      </h1>
      <p className="mt-1 mb-5 text-muted-foreground">
        {allDone
          ? "Every section has its starting data. Change any of it later from the section itself."
          : "A few quick steps so every section starts with your real numbers. Skip anything — it waits here until you're ready."}
      </p>
      <div className="space-y-2">
        {steps.map((k) => (
          <Card
            key={k}
            onClick={has[k] ? undefined : () => go(k)}
            className={cn("flex items-center gap-3", has[k] && "opacity-70")}
          >
            <AreaIcon k={k} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{STEP[k].title}</div>
              <div className="text-muted-foreground text-xs">
                {has[k]
                  ? `${AREA[k].label} is set up`
                  : skipped.includes(k)
                    ? `Skipped · ${STEP[k].time}`
                    : STEP[k].time}
              </div>
            </div>
            {has[k] ? (
              <span className="grid size-6 place-items-center rounded-full bg-primary text-background">
                <Check className="size-4" />
              </span>
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </Card>
        ))}
      </div>
      <div className="mt-auto pt-6">
        {allDone ? (
          <Btn className="h-12 w-full" href="/today">
            <PartyPopper className="size-5" /> Go to Today
          </Btn>
        ) : (
          <>
            <Btn className="h-12 w-full" onClick={() => go(pending[0])}>
              {pending.length === steps.length ? "Start" : "Continue"}
            </Btn>
            <Btn
              variant="ghost"
              className="mt-1 w-full"
              onClick={() => router.push("/today")}
            >
              I'll finish later
            </Btn>
          </>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ steps

const HABIT_PICKS: (Partial<HabitInput> & { name: string })[] = [
  {
    name: "Drink water",
    icon: "💧",
    type: "count",
    target: 8,
    unit: "glasses",
    step: 1,
  },
  {
    name: "Read",
    icon: "📖",
    type: "count",
    target: 10,
    unit: "pages",
    step: 5,
  },
  { name: "Meditate", icon: "🧘", type: "duration", target: 5 },
  {
    name: "Work out",
    icon: "🏋️",
    linkWorkout: true,
    schedule: [{ days: [1, 3, 5] }],
  },
  {
    name: "Journal",
    icon: "✍️",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "21:30" }],
  },
  { name: "No phone first hour", icon: "📵" },
  {
    name: "Sleep by 11",
    icon: "🌙",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "23:00" }],
  },
]

function HabitsStep({ onDone }: { onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const [custom, setCustom] = useState("")
  const toggle = (n: string) =>
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]))
  const addCustom = () => {
    const n = custom.trim()
    if (n && !picked.includes(n)) setPicked((p) => [...p, n])
    setCustom("")
  }
  const save = () => {
    for (const n of picked)
      createHabit(HABIT_PICKS.find((h) => h.name === n) ?? { name: n })
    toast(`${picked.length} habit${picked.length > 1 ? "s" : ""} added`)
    onDone()
  }
  const customs = picked.filter((n) => !HABIT_PICKS.some((h) => h.name === n))
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {HABIT_PICKS.map((h) => (
          <Chip
            key={h.name}
            accent="hab"
            active={picked.includes(h.name)}
            onClick={() => toggle(h.name)}
          >
            {h.icon} {h.name}
          </Chip>
        ))}
        {customs.map((n) => (
          <Chip key={n} accent="hab" active onClick={() => toggle(n)}>
            ✅ {n}
          </Chip>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          addCustom()
        }}
      >
        <input
          aria-label="Your own habit"
          placeholder="Or type your own…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 outline-none focus:border-hab"
        />
        <Btn type="submit" variant="secondary" disabled={!custom.trim()}>
          Add
        </Btn>
      </form>
      <Btn
        accent="hab"
        className="mt-auto h-12 w-full"
        disabled={!picked.length}
        onClick={save}
      >
        {picked.length ? `Add ${picked.length} habits` : "Pick at least one"}
      </Btn>
    </>
  )
}

// Exercise ids come from the built-in library (fitness/data.ts).
const SPLITS: Record<string, { label: string; days: [string, string[]][] }> = {
  full: {
    label: "Full body",
    days: [["Full body", ["squat", "bench", "row", "ohp", "curl"]]],
  },
  ul: {
    label: "Upper / Lower",
    days: [
      ["Upper", ["bench", "row", "ohp", "pulldown", "curl"]],
      ["Lower", ["squat", "rdl", "legpress"]],
    ],
  },
  ppl: {
    label: "Push / Pull / Legs",
    days: [
      ["Push", ["bench", "ohp", "incline-db", "lateral", "pushdown"]],
      ["Pull", ["row", "pulldown", "pullup", "facepull", "curl"]],
      ["Legs", ["squat", "rdl", "legpress"]],
    ],
  },
  none: { label: "Not lifting yet", days: [] },
}

function FitnessStep({ onDone }: { onDone: () => void }) {
  const units = fitStore.use((s) => s.settings.units)
  const [weight, setWeight] = useState("")
  const [goal, setGoal] = useState<FitnessSettings["goalDirection"]>("maintain")
  const [split, setSplit] = useState("full")
  const [perWeek, setPerWeek] = useState(3)
  const save = () => {
    const w = Number(weight)
    if (w) logWeighIn(units === "lb" ? w / 2.2046 : w)
    for (const [name, ids] of SPLITS[split].days)
      upsertTemplate({
        name,
        items: ids.map((exerciseId) => ({ exerciseId, sets: 3 })),
      })
    updateFitSettings({ goalDirection: goal, weeklyTarget: perWeek })
    toast("Training baseline saved")
    onDone()
  }
  return (
    <>
      <div>
        <span className="mb-1 block font-medium text-sm">Today's weight</span>
        <div className="flex items-center gap-2">
          <NumberInput
            aria-label="Today's weight"
            placeholder="e.g. 72.5"
            value={weight}
            onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, ""))}
            className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 outline-none focus:border-fit"
          />
          <span className="text-muted-foreground">{units}</span>
        </div>
      </div>
      <div className="mt-4 mb-1 font-medium text-sm">Goal</div>
      <Segmented
        value={goal}
        onChange={setGoal}
        options={[
          { value: "cut", label: "Lose" },
          { value: "maintain", label: "Maintain" },
          { value: "bulk", label: "Gain" },
        ]}
      />
      <div className="mt-4 mb-1 font-medium text-sm">How do you train?</div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(SPLITS).map(([k, s]) => (
          <Chip
            key={k}
            accent="fit"
            active={split === k}
            onClick={() => setSplit(k)}
          >
            {s.label}
          </Chip>
        ))}
      </div>
      <div className="mt-4 mb-1 font-medium text-sm">Sessions per week</div>
      <div className="flex gap-2">
        {[2, 3, 4, 5, 6].map((n) => (
          <Chip
            key={n}
            accent="fit"
            active={perWeek === n}
            onClick={() => setPerWeek(n)}
          >
            {n}
          </Chip>
        ))}
      </div>
      <Btn
        accent="fit"
        className="mt-auto h-12 w-full"
        disabled={!weight && split === "none"}
        onClick={save}
      >
        Save baseline
      </Btn>
    </>
  )
}

function TasksStep({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("")
  const save = () => {
    const { tasks } = captureTasks(text, "manual")
    toast(`${tasks.length} task${tasks.length > 1 ? "s" : ""} added`)
    onDone()
  }
  return (
    <>
      <textarea
        aria-label="Your tasks, one per line"
        rows={7}
        placeholder={"pay rent friday\nrenew passport\nbuy groceries"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-xl border border-border bg-card p-3 outline-none focus:border-tsk"
      />
      <p className="mt-1 text-muted-foreground text-xs">One per line.</p>
      <Btn
        accent="tsk"
        className="mt-auto h-12 w-full"
        disabled={!text.trim()}
        onClick={save}
      >
        Add tasks
      </Btn>
    </>
  )
}
