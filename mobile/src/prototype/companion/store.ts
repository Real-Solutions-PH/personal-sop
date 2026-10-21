import { createStore, uid } from "@domain/lib/store"
import { create } from "zustand"

// ponytail: the companion is simulated on-device. `brain.ts` routes intents
// and the blocks compute answers from local data; a real model replaces the
// router later, behind `ask()`.

export type Metric =
  | "life"
  | "habits"
  | "tasks"
  | "spend"
  | "spendCats"
  | "netWorth"
  | "workouts"
  | "weight"
  | "nutrition"

export type Block =
  | { t: "text"; text: string }
  | { t: "chart"; metric: Metric; days: number }
  | { t: "insights" }
  | { t: "coach"; mood?: string }
  | { t: "plan" }
  | { t: "tracker"; id: string }
  | { t: "memory" }
  | { t: "chips"; prompts: string[] }
  | { t: "steps"; items: StepItem[] }

/** One thing Fern did during a reply: a tool call, running or finished
 * (ADR-0015). A write carries its card, so the row can offer Undo or
 * Confirm. */
export type StepItem = {
  id: string
  tool: string
  label: string
  running?: boolean
  ok?: boolean
  summary?: string
  card_id?: string
  state?: string
}

// What a running step says before its result arrives; the finished step
// shows the server's own sentence (companion/turn.py RUNNING).
const STEP_LABELS: Record<string, string> = {
  create_tasks: "Adding to your tasks",
  complete_task: "Marking a task done",
  log_expense: "Logging an expense",
  log_income: "Logging income",
  log_transfer: "Logging a transfer",
  add_planned: "Adding a planned payment",
  log_habit: "Checking off a habit",
  create_habit: "Creating a habit",
  start_routine: "Starting a routine",
  log_workout: "Logging a workout",
  log_weigh_in: "Logging your weight",
  log_meal: "Logging a meal",
  save_journal: "Saving to your journal",
  edit_last: "Changing the last entry",
  delete_last: "Removing the last entry",
  lookup: "Looking it up",
  stats_overview: "Checking your Life Score",
  show_chart: "Drawing a chart",
  show_insights: "Finding patterns",
  coach: "Reviewing how you're doing",
  plan_day: "Planning your day",
  track: "Setting up tracking",
  remember_fact: "Remembering that",
  forget_fact: "Forgetting that",
  show_memories: "Gathering what I remember",
  suggest: "Suggesting next questions",
}
export const stepLabel = (tool: string) =>
  STEP_LABELS[tool] ?? tool.replace(/_/g, " ")

export type Msg = {
  id: string
  role: "me" | "sol"
  at: number
  text?: string
  blocks?: Block[]
}
export type Tracker = {
  id: string
  metric: Metric
  label: string
  /** Optional threshold, e.g. keep daily spend below 800. */
  goal?: number
  direction?: "below" | "above"
  createdAt: number
}
export type CompanionState = {
  name: string
  messages: Msg[]
  trackers: Tracker[]
  /** Things the user asked the companion to remember. */
  memories: { id: string; text: string; at: number }[]
}

/** The companion's default name (brand: docs/brand/fern.md). A user may
 * rename it; this is the fallback. */
export const COMPANION_NAME = "Fern"

const seed = (): CompanionState => ({
  name: COMPANION_NAME,
  messages: [],
  trackers: [
    {
      id: "t-spend",
      metric: "spend",
      label: "Daily spending",
      goal: 1500,
      direction: "below",
      createdAt: Date.now() - 5 * 86_400_000,
    },
  ],
  memories: [
    {
      id: "m1",
      text: "Training for a 10K before December",
      at: Date.now() - 9 * 86_400_000,
    },
    {
      id: "m2",
      text: "Paying off the BPI card in full every month",
      at: Date.now() - 20 * 86_400_000,
    },
  ],
})

export const companionStore = createStore<CompanionState>("companion", seed)
/**
 * The companion's mode switch. Prototype mode answers on the device (`brain.ts`);
 * live mode installs the server's streaming ask at sign-in
 * (mobile/src/live/capture.ts). `routedToCapture` is the on-device router's
 * verdict, used only when the phone is offline.
 */
export type AskBackend = (
  text: string,
  hint: string | undefined,
  routedToCapture: boolean,
) => void
let askBackend: AskBackend | null = null
export const setAskBackend = (b: AskBackend | null) => {
  askBackend = b
}
export const liveAsk = () => askBackend

/** Transient "Fern is thinking" indicator; not persisted. */
export const thinking = create<{ on: boolean }>(() => ({ on: false }))

const set = companionStore.set
export function addMessage(m: Omit<Msg, "id" | "at">) {
  const msg: Msg = { id: uid(), at: Date.now(), ...m }
  set((s) => ({ ...s, messages: [...s.messages, msg] }))
  return msg
}
export function addTracker(t: Omit<Tracker, "id" | "createdAt">) {
  const existing = companionStore
    .get()
    .trackers.find((x) => x.metric === t.metric)
  if (existing) {
    set((s) => ({
      ...s,
      trackers: s.trackers.map((x) =>
        x.id === existing.id ? { ...x, ...t } : x,
      ),
    }))
    return existing.id
  }
  const tracker: Tracker = { id: uid(), createdAt: Date.now(), ...t }
  set((s) => ({ ...s, trackers: [...s.trackers, tracker] }))
  return tracker.id
}
export const removeTracker = (id: string) =>
  set((s) => ({ ...s, trackers: s.trackers.filter((t) => t.id !== id) }))
export const remember = (text: string) =>
  set((s) => ({
    ...s,
    memories: [...s.memories, { id: uid(), text, at: Date.now() }],
  }))
export const forget = (id: string) =>
  set((s) => ({ ...s, memories: s.memories.filter((m) => m.id !== id) }))
export const renameCompanion = (name: string) =>
  set((s) => ({ ...s, name: name.trim() || COMPANION_NAME }))
export const clearConversation = () => set((s) => ({ ...s, messages: [] }))
