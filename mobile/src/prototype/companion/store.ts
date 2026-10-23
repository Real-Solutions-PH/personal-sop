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
  /** The day's food against the target, as Fern pulled it up. */
  | { t: "nutrition"; day: string }
  /** Photos sent with a message: media ids, and links when known (local
   * while sending, signed by the server when read). */
  | { t: "photos"; media?: string[]; urls?: (string | null)[] }

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
  /** A call that wrote several cards (plain tasks and reminders apart). */
  cards?: { card_id: string; state: string; label: string }[]
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
  web_search: "Searching the web",
  read_photos: "Looking at your photos",
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
  /** Device-only, on a question the server has not stored yet: being sent,
   * waiting for a connection (sent on reconnect), or failed (Retry). The
   * server's copy (same id) replaces it and clears this. */
  status?: "sending" | "queued" | "failed"
  /** The question's capture hint, kept so a queued or retried ask sends it. */
  hint?: string
  /** The chat it belongs to; absent on messages from before chats. */
  threadId?: string
}
/** One chat with the companion. Its id is minted here, so a chat started
 * offline exists before the server hears of it. */
export type Thread = {
  id: string
  /** From the first message unless renamed; null until then. */
  title: string | null
  lastAt: number | null
  createdAt: number
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
/** One thing the companion keeps about the person. The fields after
 * ``at`` came with the memory layer: a memory saved before it lacks them and
 * reads as a fact the person said (memory-labels.ts). */
export type Memory = {
  id: string
  text: string
  at: number
  /** One of MEMORY_KINDS, or a newer kind the server knows. */
  kind?: string
  tags?: string[]
  /** 1 (minor) to 5 (central). */
  importance?: number
  /** Always in the companion's context, not only when recalled. */
  alwaysOn?: boolean
  /** "said", "inferred" (the companion noticed) or "app" (typed here). */
  source?: string
}
export type MemoryEdit = Partial<
  Pick<Memory, "text" | "kind" | "tags" | "alwaysOn">
>
export type CompanionState = {
  name: string
  messages: Msg[]
  trackers: Tracker[]
  /** Things the companion keeps about the user. */
  memories: Memory[]
  /** Absent in what an app from before chats saved. */
  threads?: Thread[]
  /** The chat on screen; null or absent: the most recent one. */
  activeThread?: string | null
}

/** The companion's default name (brand: docs/brand/fern.md). A user may
 * rename it; this is the fallback. */
export const COMPANION_NAME = "Fern"

const seed = (): CompanionState => ({
  name: COMPANION_NAME,
  messages: [],
  threads: [],
  activeThread: null,
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
      kind: "goal",
      tags: ["running"],
      importance: 4,
      alwaysOn: true,
      source: "said",
    },
    {
      id: "m2",
      text: "Paying off the BPI card in full every month",
      at: Date.now() - 20 * 86_400_000,
      kind: "routine",
      tags: ["money", "credit card"],
      source: "said",
    },
    {
      id: "m3",
      text: "Likes short answers in bullet points",
      at: Date.now() - 3 * 86_400_000,
      kind: "response_style",
      source: "inferred",
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
  photos?: string[],
) => void
let askBackend: AskBackend | null = null
export const setAskBackend = (b: AskBackend | null) => {
  askBackend = b
}
export const liveAsk = () => askBackend
let retryBackend: ((id: string) => void) | null = null
export const setRetryAsk = (b: ((id: string) => void) | null) => {
  retryBackend = b
}
/** Send a failed question again (live mode). */
export const retryAsk = (id: string) => retryBackend?.(id)

/** The next message was spoken (dictated): its reply is read aloud as soon
 * as it arrives, the way voice chat works in other assistants. */
let voiceTurn = false
export const markVoiceTurn = () => {
  voiceTurn = true
}
export const takeVoiceTurn = () => {
  const v = voiceTurn
  voiceTurn = false
  return v
}

/** Transient "Fern is thinking" indicator; not persisted. */
export const thinking = create<{ on: boolean }>(() => ({ on: false }))
/** The reply still being written: its orb keeps working until it ends. */
export const answering = create<{ id: string | null }>(() => ({ id: null }))

const set = companionStore.set

const threadsOf = (s: CompanionState) => s.threads ?? []
/** The chat on screen: the one opened, else the most recent (by its last
 * message, else when it was made), else the chat of the newest message. */
export function currentThread(s: CompanionState): string | null {
  const threads = threadsOf(s)
  if (s.activeThread && threads.some((t) => t.id === s.activeThread))
    return s.activeThread
  const latest = [...threads].sort(
    (a, b) => (b.lastAt ?? b.createdAt) - (a.lastAt ?? a.createdAt),
  )[0]
  return latest?.id ?? s.messages.at(-1)?.threadId ?? null
}
/** The messages of the chat on screen. */
export function chatMessages(s: CompanionState): Msg[] {
  const id = currentThread(s)
  return s.messages.filter((m) => (m.threadId ?? null) === id)
}
/** Chats, most recent first. */
export function chatList(s: CompanionState): Thread[] {
  return [...threadsOf(s)].sort(
    (a, b) => (b.lastAt ?? b.createdAt) - (a.lastAt ?? a.createdAt),
  )
}
/** Start a new chat and open it. An open chat with nothing in it yet is
 * reused rather than piling up empty ones. */
export function newChat(): string {
  const s = companionStore.get()
  const cur = currentThread(s)
  if (cur && !s.messages.some((m) => m.threadId === cur)) {
    set((x) => ({ ...x, activeThread: cur }))
    return cur
  }
  const t: Thread = {
    id: uid(),
    title: null,
    lastAt: null,
    createdAt: Date.now(),
  }
  set((x) => ({ ...x, threads: [...threadsOf(x), t], activeThread: t.id }))
  return t.id
}
/** The chat a new message goes to (making one when there is none). */
export function threadForSend(): string {
  return currentThread(companionStore.get()) ?? newChat()
}
export const openChat = (id: string) => set((s) => ({ ...s, activeThread: id }))
export const renameChat = (id: string, title: string) =>
  set((s) => ({
    ...s,
    threads: threadsOf(s).map((t) =>
      t.id === id ? { ...t, title: title.trim().slice(0, 80) || null } : t,
    ),
  }))
/** A deleted chat takes its messages with it. */
export const deleteChat = (id: string) =>
  set((s) => ({
    ...s,
    threads: threadsOf(s).filter((t) => t.id !== id),
    messages: s.messages.filter((m) => m.threadId !== id),
    activeThread: s.activeThread === id ? null : s.activeThread,
  }))
/** The chat's title from its first message, as the server words it. */
export function titleFrom(text: string): string {
  const words = text.split(/\s+/).filter(Boolean).join(" ")
  if (words.length <= 48) return words
  return `${words.slice(0, 47).replace(/\s+\S*$/, "")}…`
}
/** A message lands in its chat: it stamps the chat's last activity and, on
 * the first question, its title. */
export function touchThread(id: string, m: Pick<Msg, "role" | "text">) {
  set((s) => ({
    ...s,
    threads: threadsOf(s).map((t) =>
      t.id === id
        ? {
            ...t,
            lastAt: Date.now(),
            title:
              t.title ?? (m.role === "me" && m.text ? titleFrom(m.text) : null),
          }
        : t,
    ),
  }))
}
export function addMessage(m: Omit<Msg, "id" | "at">) {
  const threadId = m.threadId ?? threadForSend()
  const msg: Msg = { id: uid(), at: Date.now(), ...m, threadId }
  set((s) => ({ ...s, messages: [...s.messages, msg] }))
  touchThread(threadId, msg)
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
/** Keep a memory: from the conversation by default, or typed by hand
 * (``source: "app"``) with its kind, tags and always-on flag. */
export function remember(
  text: string,
  extra: MemoryEdit & { source?: string } = {},
): Memory {
  const m: Memory = { id: uid(), text, at: Date.now(), ...extra }
  set((s) => ({ ...s, memories: [...s.memories, m] }))
  return m
}
export const editMemory = (id: string, patch: MemoryEdit) =>
  set((s) => ({
    ...s,
    memories: s.memories.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  }))
export const forget = (id: string) =>
  set((s) => ({ ...s, memories: s.memories.filter((m) => m.id !== id) }))
/** Undo of a forget: the same memory back where it was. */
export const restoreMemory = (m: Memory, index: number) =>
  set((s) => {
    if (s.memories.some((x) => x.id === m.id)) return s
    const memories = [...s.memories]
    memories.splice(Math.min(index, memories.length), 0, m)
    return { ...s, memories }
  })
export const renameCompanion = (name: string) =>
  set((s) => ({ ...s, name: name.trim() || COMPANION_NAME }))
export const clearConversation = () => set((s) => ({ ...s, messages: [] }))
