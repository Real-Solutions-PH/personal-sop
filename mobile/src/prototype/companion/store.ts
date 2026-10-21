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
