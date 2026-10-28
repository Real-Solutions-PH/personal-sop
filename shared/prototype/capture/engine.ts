"use client"
import {
  addPlanned,
  deletePlanned,
  deleteRecords,
  logExpense,
  logIncome,
  logTransfer,
} from "../finance/actions"
import { finStore } from "../finance/store"
import {
  deleteMeal,
  deleteWeighIn,
  deleteWorkout,
  logMeal,
  logWeighIn,
  logWorkoutFromChat,
  macrosLeftToday,
  upsertExercise,
} from "../fitness/actions"
import { fitStore } from "../fitness/store"
import {
  checkHabit,
  createHabit,
  deleteHabit,
  deleteLog,
  logHabit,
  restoreLog,
  startRoutine,
} from "../habits/actions"
import type { HabitLog } from "../habits/data"
import { lk, logIndex, streaks } from "../habits/logic"
import { habitsStore } from "../habits/store"
import { dayKey } from "../lib/day"
import { money } from "../lib/money"
import { uid } from "../lib/store"
import {
  completeTask,
  createTasks,
  removeTasks,
  uncompleteTask,
} from "../tasks/actions"
import { tasksStore } from "../tasks/store"
import type {
  Capture,
  CaptureSource,
  CaptureStatus,
  JournalEntry,
  Mood,
  Payload,
  RecordCard,
  ReplyItem,
  Tier,
} from "./data"
import { CHECK_IN, MOODS } from "./data"
import { type Draft, draftDay, parseCapture } from "./parse"
import { answer, budgetNote } from "./qa"
import { captureStore, isOnline } from "./store"
import { toast } from "./toast"

const S = captureStore
const nowIso = () => new Date().toISOString()

/** What a capture send carries. ``audio`` and ``fileUri`` are local file
 * URIs the live path uploads; the on-device engine ignores them. */
export interface SendInput {
  text: string
  source?: CaptureSource
  hint?: string
  photo?: string
  /** More photos read together with ``photo`` (one capture). */
  photos?: string[]
  durationSec?: number
  fileName?: string
  fileUri?: string
  fileMime?: string
  audio?: string
}

/**
 * The capture actions' mode switch. The prototype (and the whole web build)
 * never installs a backend, so every action below runs the on-device engine.
 * Live mode on the phone installs one at sign-in (mobile/src/live/capture.ts):
 * captures then stream from the server and card decisions go to its card
 * endpoints, while the stores stay what the screens read.
 */
export interface CaptureBackend {
  send(input: SendInput): string
  confirm(cardId: string): void
  confirmAll(captureId: string): void
  discard(cardId: string): void
  undo(cardId: string, quiet: boolean): void
  redo(cardId: string): void
  edit(cardId: string, payload: Payload): void
  answer(cardId: string, value: string): void
  skip(cardId: string): void
  retry(id: string): void
  rerun(id: string, text?: string): void
  processQueue(): number
  resumeStuck(): void
  quickAdd(
    text: string,
    payload: Payload,
    target: RecordCard["target"],
  ): RecordCard
}
let backend: CaptureBackend | null = null
export function setCaptureBackend(b: CaptureBackend | null) {
  backend = b
}
/** Run ``fn`` against this device's stores only, bypassing an installed
 * backend: a live quick add made offline writes its record straight into
 * the module store (which syncs it), and that card's later decisions stay
 * local too. Synchronous, so nothing else runs while the backend is off. */
export function runLocally<T>(fn: () => T): T {
  const installed = backend
  backend = null
  try {
    return fn()
  } finally {
    backend = installed
  }
}
export function addJournalEntry(input: {
  body: string
  day?: string
  source?: JournalEntry["source"]
  mood?: Mood
  area?: string
  tags?: string[]
  private?: boolean
  transcript?: string
  captureId?: string
}): JournalEntry {
  const e: JournalEntry = {
    id: uid(),
    day: input.day ?? dayKey(),
    createdAt: nowIso(),
    body: input.body.trim(),
    source: input.source ?? "text",
    mood: input.mood,
    area: input.area,
    tags: input.tags ?? [],
    private: input.private ?? true,
    transcript: input.transcript,
    captureId: input.captureId,
  }
  S.set((s) => ({ ...s, journal: [...s.journal, e] }))
  if (e.tags.includes(CHECK_IN)) return e
  const h = habitsStore
    .get()
    .habits.find((x) => x.status === "active" && /journal/i.test(x.name))
  if (h && !logIndex(habitsStore.get().logs).get(lk(h.id, e.day)))
    checkHabit(h.id, e.day, "capture")
  return e
}
/** Today's mood check-in: one entry a day, changed in place on a retap. */
export function checkInMood(mood: Mood, day = dayKey()): JournalEntry {
  const body = `Mood check-in: ${MOODS.find((m) => m.v === mood)?.label}`,
    had = S.get().journal.find(
      (j) => j.day === day && j.tags.includes(CHECK_IN),
    )
  if (!had) return addJournalEntry({ body, day, mood, tags: [CHECK_IN] })
  updateJournalEntry(had.id, { body, mood })
  return { ...had, body, mood }
}
export function updateJournalEntry(
  id: string,
  patch: Partial<Omit<JournalEntry, "id">>,
) {
  S.set((s) => ({
    ...s,
    journal: s.journal.map((j) => (j.id === id ? { ...j, ...patch } : j)),
  }))
}
export function deleteJournalEntry(id: string): JournalEntry | undefined {
  const j = S.get().journal.find((x) => x.id === id)
  S.set((s) => ({ ...s, journal: s.journal.filter((x) => x.id !== id) }))
  return j
}
export function restoreJournalEntry(j: JournalEntry) {
  S.set((s) => ({ ...s, journal: [...s.journal, j] }))
}
export function findCard(cardId: string): {
  cap: Capture
  card: RecordCard
} | null {
  for (const cap of S.get().captures)
    for (const it of cap.reply?.items ?? [])
      if (it.t === "record" && it.id === cardId) return { cap, card: it }
  return null
}
function statusOf(items: ReplyItem[]): CaptureStatus {
  const recs = items.filter((i): i is RecordCard => i.t === "record")
  if (recs.some((r) => r.state === "needs_input")) return "needs_input"
  if (!recs.length)
    return items.some((i) => i.t === "answer") ? "answered" : "done"
  return "done"
}
function patchCapture(id: string, fn: (c: Capture) => Capture) {
  S.set((s) => ({
    ...s,
    captures: s.captures.map((c) => (c.id === id ? fn(c) : c)),
  }))
}
function patchCard(cardId: string, fn: (c: RecordCard) => RecordCard) {
  const hit = findCard(cardId)
  if (!hit) return
  patchCapture(hit.cap.id, (c) => {
    const items = (c.reply?.items ?? []).map((it) =>
      it.t === "record" && it.id === cardId ? fn(it) : it,
    )
    return {
      ...c,
      status: statusOf(items),
      reply: c.reply ? { ...c.reply, items } : c.reply,
    }
  })
}
const logged = (
  c: RecordCard,
  action: RecordCard["log"][number]["action"],
  actor: "ai" | "user" = "user",
) => ({
  ...c,
  log: [...c.log, { at: nowIso(), action, actor }],
})
function recordAt(capAt: string, offset = 0): string {
  const d = new Date(capAt)
  d.setDate(d.getDate() + offset)
  return d.toISOString()
}
const ensureRun = () => {
  const s = fitStore.get()
  const hit = s.exercises.find((e) => e.name === "Run")
  if (hit) return hit
  return upsertExercise({
    name: "Run",
    equipment: "bodyweight",
    muscle: "quads",
    loadType: "time",
    repMin: 20,
    repMax: 60,
    increment: 0,
  })
}
function execute(
  card: RecordCard,
  capAt: string,
  source: CaptureSource,
): {
  refs: string[]
  prior?: unknown
  note?: string
} {
  const p = card.payload
  const at = recordAt(capAt, card.dayOffset)
  const day = draftDay(capAt, card.dayOffset)
  const finSource =
    source === "photo" ? "photo" : source === "quick_add" ? "quick-add" : "chat"
  switch (p.kind) {
    case "expense": {
      const r = logExpense({
        amount: p.amount,
        accountId: p.accountId,
        categoryId: p.categoryId,
        payee: p.payee,
        note: p.note ?? (p.currency ? `${p.currency} converted` : undefined),
        at,
        source: finSource,
      })
      if (p.fromReceipt)
        finStore.set((s) => ({
          ...s,
          records: s.records.map((x) =>
            x.id === r.id ? { ...x, receipt: true } : x,
          ),
        }))
      return { refs: [r.id], note: budgetNote(p.categoryId) }
    }
    case "income": {
      const r = logIncome({
        amount: p.amount,
        accountId: p.accountId,
        categoryId: p.categoryId,
        payee: p.payee,
        at,
        source: finSource,
      })
      return { refs: [r.id] }
    }
    case "transfer": {
      if (!p.from || !p.to) return { refs: [] }
      const { transfer, fee } = logTransfer({
        from: p.from,
        to: p.to,
        amount: p.amount,
        at,
        source: finSource,
      })
      return { refs: [transfer.id, ...(fee ? [fee.id] : [])] }
    }
    case "planned": {
      const pl = addPlanned({
        name: p.name,
        type: p.type ?? "expense",
        amount: p.amount,
        estimated: false,
        accountId: p.accountId,
        categoryId: p.categoryId,
        schedule: p.date
          ? { kind: "once", date: p.date }
          : { kind: "monthly", day: p.day ?? 1 },
        end: { kind: "never" },
        autoLog: false,
        isWhatIf: false,
        inProjection: true,
      })
      return {
        refs: [pl.id],
        note: "Shows on your Plan calendar and in the projection.",
      }
    }
    case "task": {
      const made = createTasks(
        p.tasks.map((t) => ({
          title: t.title,
          listId: t.listId,
          dueDate: t.dueDate,
          dueTime: t.dueTime,
          remind: t.remind,
          source:
            source === "voice"
              ? "capture-voice"
              : source === "photo"
                ? "capture-photo"
                : "capture-text",
        })),
      )
      return { refs: made.map((t) => t.id) }
    }
    case "taskComplete": {
      if (!p.taskId) return { refs: [] }
      completeTask(p.taskId)
      const left = tasksStore
        .get()
        .tasks.filter(
          (t) => t.status === "open" && t.dueDate && t.dueDate <= dayKey(),
        ).length
      return {
        refs: [p.taskId],
        note: left ? `${left} left for today` : "Nothing else due today",
      }
    }
    case "habitLog": {
      const prior =
        logIndex(habitsStore.get().logs).get(lk(p.habitId, day)) ?? null
      const l = logHabit({
        habitId: p.habitId,
        day,
        value: p.value,
        add: p.add,
        source: "capture",
      })
      if (!l) return { refs: [] }
      const h = habitsStore.get().habits.find((x) => x.id === p.habitId)
      const st = h ? streaks(h, logIndex(habitsStore.get().logs)).current : 0
      return {
        refs: [l.id],
        prior,
        note: st > 1 ? `${st}-day streak` : undefined,
      }
    }
    case "habitCreate": {
      const h = createHabit({
        name: p.name,
        icon: p.icon,
        type: p.type,
        target: p.target,
        unit: p.unit,
        schedule: [{ days: p.days, time: p.time }],
      })
      if (p.logToday) checkHabit(h.id, day, "capture")
      return {
        refs: [h.id],
        note: p.logToday ? "Created and checked for today." : undefined,
      }
    }
    case "routineStart": {
      if (!p.routineId) return { refs: [] }
      const run = startRoutine(p.routineId)
      return {
        refs: [p.routineId],
        note: run
          ? "Routine player is running — it's in the Live bar."
          : "Something else is running — finish it first.",
      }
    }
    case "workout": {
      let w: ReturnType<typeof logWorkoutFromChat>
      if (p.cardio) {
        const run = ensureRun()
        w = logWorkoutFromChat({
          name: p.name,
          day,
          exercises: [
            {
              exercise: run.id,
              sets: [{ reps: p.cardio.min ?? 30, weight: 0 }],
            },
          ],
        })
      } else
        w = logWorkoutFromChat({ name: p.name, day, exercises: p.exercises })
      const week = fitStore
        .get()
        .workouts.filter(
          (x) =>
            x.status === "finished" &&
            Date.now() - new Date(x.startedAt).getTime() < 7 * 86400000,
        ).length
      const pace =
        p.cardio?.km && p.cardio.min ? p.cardio.min / p.cardio.km : undefined
      return {
        refs: [w.id],
        note: pace
          ? `${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, "0")} /km · ${week} sessions in 7 days`
          : `${week} sessions in the last 7 days`,
      }
    }
    case "weighIn": {
      const w = logWeighIn(p.kg, at)
      const d = p.prevKg ? p.kg - p.prevKg : 0
      return {
        refs: [w.id],
        note: p.prevKg
          ? `${d <= 0 ? "▼" : "▲"} ${Math.abs(d).toFixed(1)} kg vs last`
          : undefined,
      }
    }
    case "meal": {
      const m = logMeal({
        items: p.items,
        label: p.label,
        eatenAt: at,
        source:
          source === "photo"
            ? "photo"
            : source === "voice"
              ? "voice"
              : source === "quick_add"
                ? "manual"
                : "text",
        rawInput: p.raw,
      })
      const left = macrosLeftToday()
      return {
        refs: [m.id],
        note: left
          ? `${Math.round(left.kcal)} kcal · ${Math.round(left.protein)} g protein left today`
          : undefined,
      }
    }
    case "journal": {
      const cap = S.get().captures.find((c) => c.at === capAt)
      const e = addJournalEntry({
        body: p.body,
        day,
        source: source === "voice" ? "voice" : "text",
        mood: p.mood as Mood | undefined,
        area: p.area,
        tags: p.tags,
        transcript: p.transcript,
        captureId: cap?.id,
      })
      return { refs: [e.id], note: "Private · only you can see it" }
    }
    case "command": {
      const target = p.recordId ? findCard(p.recordId) : null
      if (!target) return { refs: [] }
      if (p.op === "delete") undoCard(target.card.id, true)
      else if (p.amount !== undefined && "amount" in target.card.payload)
        editCard(target.card.id, {
          ...target.card.payload,
          amount: p.amount,
        } as Payload)
      return { refs: [target.card.id] }
    }
    case "photo":
      return { refs: [] }
  }
}
function revert(card: RecordCard): boolean {
  const p = card.payload
  const [ref] = card.refs
  switch (p.kind) {
    case "expense":
    case "income":
    case "transfer": {
      const gone = deleteRecords(card.refs)
      return gone.length > 0
    }
    case "planned":
      return deletePlanned(ref)
    case "task":
      removeTasks(card.refs)
      return true
    case "taskComplete":
      uncompleteTask(ref)
      return true
    case "habitLog": {
      const prior = card.prior as HabitLog | null | undefined
      if (prior) restoreLog(prior)
      else deleteLog(ref)
      return true
    }
    case "habitCreate":
      deleteHabit(ref)
      return true
    case "workout":
      return !!deleteWorkout(ref)
    case "weighIn":
      return !!deleteWeighIn(ref)
    case "meal":
      return !!deleteMeal(ref)
    case "journal":
      return !!deleteJournalEntry(ref)
    default:
      return true
  }
}
function saveCard(
  card: RecordCard,
  cap: Capture,
  actor: "ai" | "user",
): RecordCard {
  try {
    const r = execute(card, cap.at, cap.source)
    return {
      ...logged(card, "saved", actor),
      state: "saved",
      refs: r.refs,
      prior: r.prior,
      note: r.note ?? card.note,
    }
  } catch {
    return { ...card, warn: "Couldn't save — try again or edit." }
  }
}
export function confirmCard(cardId: string) {
  if (backend) return backend.confirm(cardId)
  const hit = findCard(cardId)
  if (hit?.card.state !== "proposed") return
  const saved = saveCard(hit.card, hit.cap, "user")
  patchCard(cardId, () => saved)
}
export function confirmAll(captureId: string) {
  if (backend) return backend.confirmAll(captureId)
  const cap = S.get().captures.find((c) => c.id === captureId)
  for (const it of cap?.reply?.items ?? [])
    if (it.t === "record" && it.state === "proposed") confirmCard(it.id)
}
export function discardCard(cardId: string) {
  if (backend) return backend.discard(cardId)
  patchCard(cardId, (c) => ({
    ...logged(c, "discarded"),
    state: "discarded",
    ask: undefined,
  }))
}
export function undoCard(cardId: string, quiet = false) {
  if (backend) return backend.undo(cardId, quiet)
  const hit = findCard(cardId)
  if (!hit || (hit.card.state !== "saved" && hit.card.state !== "edited"))
    return
  const ok = revert(hit.card)
  patchCard(cardId, (c) =>
    ok
      ? { ...logged(c, "undone"), state: "undone" }
      : {
          ...c,
          warn: "Changed or deleted since — open the entry instead.",
        },
  )
  if (!quiet && ok)
    toast("Undone", {
      action: { label: "Redo", onClick: () => redoCard(cardId) },
    })
}
export function redoCard(cardId: string) {
  if (backend) return backend.redo(cardId)
  const hit = findCard(cardId)
  if (hit?.card.state !== "undone") return
  const saved = saveCard(hit.card, hit.cap, "user")
  patchCard(cardId, () => ({
    ...saved,
    log: [...hit.card.log, { at: nowIso(), action: "redone", actor: "user" }],
  }))
}
export function editCard(cardId: string, payload: Payload) {
  if (backend) return backend.edit(cardId, payload)
  const hit = findCard(cardId)
  if (!hit) return
  const { card, cap } = hit
  if (card.state === "saved" || card.state === "edited") {
    revert(card)
    const next = saveCard({ ...card, kind: payload.kind, payload }, cap, "user")
    patchCard(cardId, () => ({
      ...next,
      state: "edited",
      log: [...card.log, { at: nowIso(), action: "edited", actor: "user" }],
    }))
  } else
    patchCard(cardId, (c) => ({
      ...c,
      kind: payload.kind,
      payload,
      warn: undefined,
    }))
}
export function answerCard(cardId: string, value: string) {
  if (backend) return backend.answer(cardId, value)
  const hit = findCard(cardId)
  if (!hit?.card.ask) return
  const { card, cap } = hit
  const p = { ...card.payload } as Payload
  const field = card.ask?.field
  let kind = card.kind
  let target = card.target
  let nextPayload: Payload = p
  if (p.kind === "expense" && field === "categoryId") {
    const cats = finStore.get().categories
    const hitCat =
      cats.find((c) => c.id === value) ??
      cats.find(
        (c) =>
          c.kind === "expense" &&
          c.name.toLowerCase().includes(value.toLowerCase()),
      )
    nextPayload = {
      ...p,
      categoryId: hitCat?.id ?? "shopping",
      note: hitCat ? p.note : value,
    }
  } else if (p.kind === "income" && field === "accountId")
    nextPayload = { ...p, accountId: value }
  else if (p.kind === "transfer" && (field === "from" || field === "to")) {
    nextPayload = { ...p, [field]: value }
    const still = !nextPayload.from || !nextPayload.to
    if (still) {
      const missing = !nextPayload.from ? "from" : "to"
      patchCard(cardId, (c) => ({
        ...c,
        payload: nextPayload,
        ask: {
          question:
            missing === "to" ? "To which account?" : "From which account?",
          field: missing,
          options: finStore
            .get()
            .accounts.filter(
              (a) => !a.archived && a.type !== "investment" && a.id !== value,
            )
            .map((a) => ({ label: a.name, value: a.id })),
        },
      }))
      return
    }
  } else if (p.kind === "taskComplete" && field === "taskId")
    nextPayload = { ...p, taskId: value }
  else if (p.kind === "routineStart" && field === "routineId")
    nextPayload = { ...p, routineId: value }
  else if (p.kind === "task" && field === "due") {
    const [d, time] = value.split("|")
    const off = d === "sat" ? (6 - new Date().getDay() + 7) % 7 || 7 : Number(d)
    const dd = new Date()
    dd.setDate(dd.getDate() + off)
    nextPayload = {
      ...p,
      tasks: p.tasks.map((t) => ({
        ...t,
        dueDate: t.dueDate ?? dayKey(dd),
        dueTime: t.dueTime ?? time,
        remind: true,
      })),
    }
  } else if (p.kind === "meal" && (field === "rice" || field === "servings")) {
    const n = Number.parseFloat(value) || 1
    nextPayload = {
      ...p,
      confidence: Math.min(0.95, p.confidence + 0.1),
      items: p.items.map((it) => {
        if (field === "rice" && !/rice/i.test(it.name)) return it
        const f = field === "rice" ? n / (it.qty || 1) : n
        return {
          ...it,
          qty: field === "rice" ? n : it.qty * n,
          kcal: Math.round(it.kcal * f),
          protein: Math.round(it.protein * f),
          carbs: Math.round(it.carbs * f),
          fat: Math.round(it.fat * f),
          assumption:
            field === "rice"
              ? `${value}, you said`
              : `${n} serving${n === 1 ? "" : "s"}`,
        }
      }),
    }
  } else if (p.kind === "photo") {
    const drafts = photoDrafts(value, p.caption, cap)
    const items: ReplyItem[] = drafts.map((d) => fromDraft(d, cap))
    patchCapture(cap.id, (c) => {
      const all = (c.reply?.items ?? []).flatMap((it) =>
        it.t === "record" && it.id === cardId ? items : [it],
      )
      return {
        ...c,
        hint: value,
        status: statusOf(all),
        reply: c.reply ? { ...c.reply, items: all } : c.reply,
      }
    })
    for (const it of items)
      if (it.t === "record" && it.tier === "auto" && it.state === "proposed")
        confirmCard(it.id)
    return
  }
  kind = card.kind
  target = card.target
  const ready: RecordCard = {
    ...card,
    kind,
    target,
    payload: nextPayload,
    ask: undefined,
    state: "proposed",
  }
  if (ready.tier === "auto")
    patchCard(cardId, () => saveCard(ready, cap, "user"))
  else patchCard(cardId, () => ready)
}
export function skipAsk(cardId: string) {
  if (backend) return backend.skip(cardId)
  patchCard(cardId, (c) => ({
    ...c,
    warn: "Skipped — waiting in History until you answer.",
  }))
}
function tierFor(
  d: Extract<
    Draft,
    {
      t: "record"
    }
  >,
  source: CaptureSource,
): Tier {
  const st = S.get().settings
  if (d.confirm || source === "photo") return "confirm"
  if (d.payload.kind === "expense") {
    if (d.payload.amount > st.moneyThreshold) return "confirm"
    if (!d.payload.categoryId) return "confirm"
  }
  return st.rules[d.rule]
}
function lastMoneyCard(): RecordCard | undefined {
  const caps = [...S.get().captures].reverse()
  for (const c of caps)
    for (const it of [...(c.reply?.items ?? [])].reverse())
      if (
        it.t === "record" &&
        (it.state === "saved" || it.state === "edited") &&
        it.kind !== "command"
      )
        return it
  return undefined
}
function fromDraft(d: Draft, cap: Capture): ReplyItem {
  if (d.t === "question") return { ...answer(d.text), id: uid() } as ReplyItem
  if (d.t === "info") return { ...d.card, t: "info", id: uid() }
  let payload = d.payload
  let warn = d.warn
  let forceConfirm = false
  if (payload.kind === "command") {
    const last = lastMoneyCard()
    payload = { ...payload, recordId: last?.id }
    warn = last ? undefined : "I couldn't find a recent entry to change."
  }
  if (payload.kind === "expense") {
    const amt = payload.amount
    const dup = finStore
      .get()
      .records.find(
        (r) =>
          r.type === "expense" &&
          r.amount === amt &&
          Math.abs(new Date(r.at).getTime() - new Date(cap.at).getTime()) <
            86400000,
      )
    if (dup) {
      warn = `Looks like the ${money(amt)} you logged at ${new Date(dup.at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}${dup.payee ? ` (${dup.payee})` : ""}. Keep both?`
      forceConfirm = true
    }
  }
  const tier = tierFor(forceConfirm ? { ...d, confirm: true } : d, cap.source)
  return {
    t: "record",
    id: uid(),
    kind: d.kind,
    target: d.target,
    tier,
    state: d.ask ? "needs_input" : "proposed",
    payload,
    refs: [],
    ask: d.ask,
    warn,
    confidence: d.confidence,
    dayOffset: d.dayOffset,
    log: [{ at: nowIso(), action: "proposed", actor: "ai" }],
  }
}
const RECEIPTS = [
  { payee: "Puregold", amount: 1240, cat: "groceries" },
  { payee: "Mercury Drug", amount: 486, cat: "health" },
  { payee: "Jollibee", amount: 289, cat: "dining" },
]
function photoDrafts(hint: string, caption: string, cap: Capture): Draft[] {
  const acct =
    finStore.get().settings.lastAccountId ??
    finStore.get().settings.defaultAccountId
  if (hint === "meal") {
    const d = parseCapture(caption || "", {
      hint: "meal",
      source: "photo",
      photo: true,
      at: cap.at,
    })
    const meal = d.find((x) => x.t === "record" && x.kind === "meal")
    if (meal) return [meal]
    const plate = parseCapture("chicken adobo, rice", {
      hint: "meal",
      source: "photo",
      photo: true,
      at: cap.at,
    })
    return plate.map((x) =>
      x.t === "record"
        ? {
            ...x,
            confirm: true,
            warn: "Estimated from the photo — portions are a guess.",
          }
        : x,
    )
  }
  if (hint === "receipt") {
    const n = S.get().captures.filter((c) => c.source === "photo").length
    const r = RECEIPTS[n % RECEIPTS.length]
    return [
      {
        t: "record",
        kind: "expense",
        target: "finance",
        rule: "expense",
        confirm: true,
        confidence: 0.9,
        warn: "Read from the receipt · date from receipt",
        payload: {
          kind: "expense",
          amount: r.amount,
          categoryId: r.cat,
          accountId: acct,
          payee: r.payee,
          fromReceipt: true,
        },
      },
    ]
  }
  if (hint === "label") {
    const d = parseCapture("skyflakes", {
      hint: "meal",
      source: "photo",
      photo: true,
      at: cap.at,
    })
    return d.map((x) =>
      x.t === "record" && x.kind === "meal"
        ? {
            ...x,
            confirm: true,
            ask: {
              question: "How many servings did you eat?",
              field: "servings",
              options: ["1", "2", "3"].map((v) => ({
                label: `${v} pack${v === "1" ? "" : "s"}`,
                value: v,
              })),
            },
          }
        : x,
    )
  }
  if (hint === "whiteboard")
    return parseCapture("bench 3x5 60, overhead press 3x8 40, row 3x8 55", {
      source: "photo",
      photo: true,
      at: cap.at,
    }).map((x) =>
      x.t === "record"
        ? {
            ...x,
            confirm: true,
            warn: "Read from the gym board — check the numbers.",
          }
        : x,
    )
  if (hint === "statement")
    return [
      {
        t: "info",
        card: {
          tone: "handoff",
          title:
            "That's a statement — Finance matches those to your transactions",
          body: "Import reads every line and shows you the differences before anything changes.",
          actions: [
            {
              label: "Open import",
              do: "link",
              href: "/finance/import?account=gcash",
            },
          ],
        },
      },
    ]
  if (hint === "both")
    return [
      ...photoDrafts("meal", caption, cap),
      ...photoDrafts("receipt", caption, cap),
    ]
  if (hint === "note")
    return [
      {
        t: "info",
        card: {
          tone: "journal-suggest",
          title: "Saved as a note",
          body: "Kept in Capture history — nothing logged.",
          actions: [
            {
              label: "Save as journal",
              do: "journal",
              prompt: caption || "Photo note",
            },
          ],
        },
      },
    ]
  if (caption.trim()) {
    const d = parseCapture(caption, {
      source: "photo",
      photo: true,
      at: cap.at,
    })
    if (d.some((x) => x.t === "record")) return d
  }
  return [
    {
      t: "record",
      kind: "photo",
      target: "fitness",
      rule: "meal",
      confirm: true,
      payload: { kind: "photo", caption },
      ask: {
        question: "What should I log from this photo?",
        field: "hint",
        options: [
          { label: "🍽️ Meal", value: "meal" },
          { label: "🧾 Receipt", value: "receipt" },
          { label: "Both", value: "both" },
          { label: "Just a note", value: "note" },
        ],
      },
    },
  ]
}
function replyText(items: ReplyItem[]): string {
  const recs = items.filter((i): i is RecordCard => i.t === "record")
  const saved = recs.filter((r) => r.state === "saved").length
  const toConfirm = recs.filter((r) => r.state === "proposed").length
  const asks = recs.filter((r) => r.state === "needs_input").length
  const answers = items.filter((i) => i.t === "answer").length
  const parts: string[] = []
  if (saved) parts.push(`Logged ${saved === 1 ? "it" : `${saved} things`}`)
  if (toConfirm) parts.push(`${toConfirm === 1 ? "one" : toConfirm} to confirm`)
  if (asks)
    parts.push(`${asks === 1 ? "one quick question" : `${asks} questions`}`)
  if (!parts.length && answers) return "Here's what your data says."
  if (!parts.length)
    return items.some((i) => i.t === "info" && i.tone === "journal-suggest")
      ? "Heard you."
      : "Hmm."
  const s = parts.join(", ")
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`
}
function interpret(cap: Capture): ReplyItem[] {
  const hint = cap.hint?.toLowerCase()
  if (cap.source === "photo")
    return photoDrafts(hint ?? "auto", cap.text, cap).map((d) =>
      fromDraft(d, cap),
    )
  if (cap.source === "file")
    return [
      {
        t: "info",
        id: uid(),
        tone: "handoff",
        title: `Statement: ${cap.fileName ?? "file"}`,
        body: "Finance's import reads it, matches it against your transactions and lets you review every difference. Nothing changes until you confirm.",
        actions: [
          {
            label: "Review in Finance",
            do: "link",
            href: `/finance/import?account=${cap.hint ?? "gcash"}`,
          },
        ],
      },
    ]
  const drafts = parseCapture(cap.text, {
    hint: hint === "journal" ? "journal" : hint,
    source: cap.source,
    at: cap.at,
  })
  return drafts.map((d) => fromDraft(d, cap))
}
const THINK_MS = (text: string) => 650 + Math.min(1400, text.length * 12)
export function processCapture(id: string) {
  const cap = S.get().captures.find((c) => c.id === id)
  if (!cap) return
  const st = S.get().settings
  if (!st.aiEnabled || S.get().spend.amount >= st.spendCap) {
    patchCapture(id, (c) => ({
      ...c,
      status: "failed",
      error: !st.aiEnabled
        ? "AI is switched off (kill switch in AI settings)."
        : // AI spend is the service's cost, kept in pesos for every user.
          `Monthly AI spend cap (₱${st.spendCap}) reached.`,
      reply: {
        text: "I kept your message.",
        items: [
          {
            t: "info",
            id: uid(),
            tone: "error",
            title: !st.aiEnabled ? "AI is off" : "Spend cap reached",
            body: "Your input is saved. Log it by hand, or retry once AI is back.",
            actions: [
              { label: "Quick add", do: "quickadd" },
              { label: "Retry", do: "retry" },
              { label: "Save as journal", do: "journal", prompt: c.text },
            ],
          },
        ],
      },
    }))
    return
  }
  patchCapture(id, (c) => ({
    ...c,
    status: "processing",
    startedAt: nowIso(),
    error: undefined,
    reply: undefined,
  }))
  setTimeout(() => {
    const cur = S.get().captures.find((c) => c.id === id)
    if (cur?.status !== "processing") return
    let items: ReplyItem[]
    try {
      items = interpret(cur)
    } catch {
      patchCapture(id, (c) => ({
        ...c,
        status: "failed",
        error: "The AI couldn't read that.",
        reply: {
          text: "Something went wrong.",
          items: [
            {
              t: "info",
              id: uid(),
              tone: "error",
              title: "Couldn't process that",
              body: "Your input is kept.",
              actions: [
                { label: "Retry", do: "retry" },
                { label: "Quick add", do: "quickadd" },
              ],
            },
          ],
        },
      }))
      return
    }
    items = items.map((it) =>
      it.t === "record" && it.tier === "auto" && it.state === "proposed"
        ? saveCard(it, cur, "ai")
        : it,
    )
    const saved = items.filter(
      (it): it is RecordCard => it.t === "record" && it.state === "saved",
    )
    patchCapture(id, (c) => ({
      ...c,
      status: statusOf(items),
      reply: { text: replyText(items), items },
    }))
    S.set((s) => ({
      ...s,
      spend: {
        ...s.spend,
        amount:
          Math.round(
            (s.spend.amount +
              0.2 +
              cur.text.length * 0.003 +
              (cur.photo ? 0.9 : 0)) *
              100,
          ) / 100,
        calls: s.spend.calls + 1,
      },
    }))
    if (saved.length)
      toast.success(
        `Saved ${saved.length} entr${saved.length === 1 ? "y" : "ies"}`,
        {
          duration: 5000,
          action: {
            label: "Undo",
            onClick: () => {
              for (const r of saved) undoCard(r.id, true)
              toast("Undone")
            },
          },
        },
      )
  }, THINK_MS(cap.text))
}
export function sendCapture(input: SendInput): string {
  if (backend) return backend.send(input)
  const cap: Capture = {
    id: `c-${uid()}`,
    at: nowIso(),
    source: input.source ?? "text",
    text: input.text.trim(),
    hint: input.hint,
    photo: input.photo,
    ...(input.photos?.length ? { photos: input.photos } : {}),
    durationSec: input.durationSec,
    fileName: input.fileName,
    status: isOnline() ? "processing" : "queued",
    clientUuid: uid() + uid(),
  }
  S.set((s) => ({ ...s, captures: [...s.captures, cap] }))
  if (cap.status === "queued")
    toast("Queued — will process when you're back online")
  else processCapture(cap.id)
  return cap.id
}
export function processQueue(): number {
  if (backend) return backend.processQueue()
  const q = S.get().captures.filter((c) => c.status === "queued")
  if (!q.length || !isOnline()) return 0
  const seen = new Set<string>()
  q.forEach((c, i) => {
    if (seen.has(c.clientUuid)) return
    seen.add(c.clientUuid)
    setTimeout(() => processCapture(c.id), i * 400)
  })
  return q.length
}
export function retryCapture(id: string) {
  if (backend) return backend.retry(id)
  if (!isOnline()) {
    toast("Still offline — it stays queued")
    return
  }
  processCapture(id)
}
export function rerunCapture(id: string, text?: string) {
  if (backend) return backend.rerun(id, text)
  const cap = S.get().captures.find((c) => c.id === id)
  if (!cap) return
  for (const it of cap.reply?.items ?? [])
    if (it.t === "record" && (it.state === "saved" || it.state === "edited"))
      revert(it)
  if (text !== undefined) patchCapture(id, (c) => ({ ...c, text }))
  processCapture(id)
}
export function deleteCapture(id: string) {
  S.set((s) => ({ ...s, captures: s.captures.filter((c) => c.id !== id) }))
}
export function clearThread() {
  S.set((s) => ({ ...s, captures: [] }))
}
export function resumeStuck() {
  if (backend) return backend.resumeStuck()
  for (const c of S.get().captures)
    if (
      c.status === "processing" &&
      Date.now() - new Date(c.startedAt ?? c.at).getTime() > 4000
    )
      processCapture(c.id)
}
export function logQuickAdd(
  text: string,
  payload: Payload,
  target: RecordCard["target"],
): RecordCard {
  if (backend) return backend.quickAdd(text, payload, target)
  const cap: Capture = {
    id: `c-${uid()}`,
    at: nowIso(),
    source: "quick_add",
    text,
    status: "done",
    clientUuid: uid(),
  }
  const card: RecordCard = {
    t: "record",
    id: uid(),
    kind: payload.kind,
    target,
    tier: "confirm",
    state: "proposed",
    payload,
    refs: [],
    log: [{ at: nowIso(), action: "proposed", actor: "user" }],
  }
  const saved = saveCard(card, cap, "user")
  S.set((s) => ({
    ...s,
    captures: [
      ...s.captures,
      { ...cap, reply: { text: "Added by hand.", items: [saved] } },
    ],
  }))
  toast.success(`Saved · ${text}`, {
    duration: 5000,
    action: { label: "Undo", onClick: () => undoCard(saved.id, true) },
  })
  return saved
}
