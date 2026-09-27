"use client"

import { dayKey } from "../lib/day"
import { uid } from "../lib/store"
import type {
  ListColor,
  ListIcon,
  ListKind,
  NotifState,
  Recurrence,
  Task,
  TaskEvent,
  TaskEventType,
  TaskList,
  TaskSettings,
  TaskSource,
  TasksState,
} from "./data"
import { addDays, doneDay, isOverdue, isoAt, nextDue, today } from "./logic"
import { type CaptureDraft, splitCapture } from "./parse"
import { tasksStore } from "./store"

// Write API for M2 Tasks. Screens, the Today card and Capture (M5) call these.
// ponytail: each becomes an API call when the contract lands (ADR-0009).

const set = tasksStore.set
const nowIso = () => new Date().toISOString()

function event(
  taskId: string,
  type: TaskEventType,
  extra: Partial<TaskEvent> = {},
): TaskEvent {
  return { id: uid(), taskId, type, at: nowIso(), ...extra }
}

function patchTask(
  s: TasksState,
  id: string,
  fn: (t: Task) => Task,
  events: TaskEvent[] = [],
): TasksState {
  return {
    ...s,
    tasks: s.tasks.map((t) => (t.id === id ? fn(t) : t)),
    events: events.length ? [...s.events, ...events] : s.events,
  }
}

export const getTask = (id: string) =>
  tasksStore.get().tasks.find((t) => t.id === id)

export interface NewTask {
  title: string
  listId?: string | null
  dueDate?: string | null
  dueTime?: string | null
  /** true = remind at due time (or the default time for date-only tasks). */
  remind?: boolean
  remindAt?: string | null
  recurrence?: Recurrence | null
  notes?: string | null
  starred?: boolean
  source?: TaskSource
}

function build(input: NewTask, order: number): Task {
  const s = tasksStore.get()
  const dueDate = input.dueDate ?? null
  const dueTime = input.dueTime ?? null
  const remindAt =
    input.remindAt ??
    (input.remind && dueDate
      ? isoAt(dueDate, dueTime ?? s.settings.defaultRemindTime)
      : null)
  return {
    id: uid(),
    title: input.title.trim() || "Untitled",
    listId: input.listId ?? null,
    dueDate,
    dueTime,
    remindAt,
    recurrence: input.recurrence ?? null,
    notes: input.notes ?? null,
    starred: !!input.starred,
    status: "open",
    completedAt: null,
    deletedAt: null,
    clearedAt: null,
    createdAt: nowIso(),
    source: input.source ?? "manual",
    parseState: "parsed",
    originalDue: dueDate,
    rescheduleCount: 0,
    order,
  }
}

/** Create one task; only `title` is required. Returns the created record. */
export function createTask(input: NewTask): Task {
  const t = build(input, tasksStore.get().tasks.length)
  set((s) => ({
    ...s,
    tasks: [...s.tasks, t],
    events: [...s.events, event(t.id, "created")],
  }))
  return t
}

/** Create several tasks at once (Capture result). Returns them in order. */
export function createTasks(inputs: NewTask[]): Task[] {
  const n = tasksStore.get().tasks.length
  const made = inputs.map((i, k) => build(i, n + k))
  set((s) => ({
    ...s,
    tasks: [...s.tasks, ...made],
    events: [...s.events, ...made.map((t) => event(t.id, "created"))],
  }))
  return made
}

/**
 * Simulated AI capture (J1): split a brain-dump, infer lists/dates, auto-save.
 * Returns the created tasks plus the id of the one task (if any) that deserves a
 * single "remind at?" follow-up. Render them with <CaptureResultCard/>.
 */
export function captureTasks(
  text: string,
  source: TaskSource = "capture-text",
): { tasks: Task[]; followUp?: string } {
  const lists = tasksStore
    .get()
    .lists.filter((l) => !l.archivedAt)
    .map((l) => l.id)
  const drafts: CaptureDraft[] = splitCapture(text, source, lists)
  const tasks = createTasks(
    drafts.map((d) => ({
      title: d.title,
      listId: d.listId,
      dueDate: d.dueDate,
      dueTime: d.dueTime,
      recurrence: d.recurrence,
      remind: !!d.dueDate && !d.vague && d.listId !== "groceries",
      source,
    })),
  )
  const i = drafts.findIndex((d) => d.vague)
  return { tasks, followUp: i >= 0 ? tasks[i].id : undefined }
}

/** Hard-remove tasks (undo of a capture/quick-add — no stats impact, F-TSK-05). */
export function removeTasks(ids: string[]): void {
  const drop = new Set(ids)
  set((s) => ({
    ...s,
    tasks: s.tasks.filter((t) => !drop.has(t.id)),
    events: s.events.filter((e) => !drop.has(e.taskId)),
  }))
}

/** Mark done; a recurring task spawns its next instance. Returns the spawned task if any. */
export function completeTask(id: string): Task | null {
  const t = getTask(id)
  if (t?.status !== "open") return null
  const tk = today()
  let next: Task | null = null
  if (t.recurrence) {
    const due = nextDue(t.recurrence, t.dueDate ?? tk, tk)
    const shift = t.dueDate
      ? Math.round(
          (new Date(`${due}T12:00`).getTime() -
            new Date(`${t.dueDate}T12:00`).getTime()) /
            86_400_000,
        )
      : 0
    next = {
      ...build(
        {
          title: t.title,
          listId: t.listId,
          dueDate: due,
          dueTime: t.dueTime,
          recurrence: t.recurrence,
          notes: t.notes,
          starred: t.starred,
          source: t.source,
        },
        t.order,
      ),
      remindAt: t.remindAt
        ? new Date(
            new Date(t.remindAt).getTime() + shift * 86_400_000,
          ).toISOString()
        : null,
    }
  }
  set((s) => {
    const done = patchTask(
      s,
      id,
      (x) => ({ ...x, status: "done", completedAt: nowIso() }),
      [event(id, "completed")],
    )
    return next
      ? {
          ...done,
          tasks: [...done.tasks, next],
          events: [...done.events, event(next.id, "created")],
        }
      : done
  })
  return next
}

/** Reopen a done task (removes its completion from stats). */
export function uncompleteTask(id: string): void {
  set((s) =>
    patchTask(
      s,
      id,
      (x) => ({ ...x, status: "open", completedAt: null, clearedAt: null }),
      [event(id, "uncompleted")],
    ),
  )
}

/** Toggle done/open — the tap-the-circle action. */
export function toggleTask(id: string): Task | null {
  const t = getTask(id)
  if (!t) return null
  if (t.status === "done") uncompleteTask(id)
  else return completeTask(id)
  return null
}

/** Edit fields other than due date (title, notes, list, star, repeat, reminder). */
export function updateTask(
  id: string,
  patch: Partial<
    Pick<
      Task,
      | "title"
      | "notes"
      | "listId"
      | "starred"
      | "recurrence"
      | "remindAt"
      | "dueTime"
    >
  >,
): void {
  set((s) => patchTask(s, id, (x) => ({ ...x, ...patch })))
}

/**
 * Set/clear the due date (+ optional time/reminder). Moving it later counts as
 * a reschedule (OQ-TSK-3 default a); earlier or first-set does not.
 */
export function setDue(
  id: string,
  dueDate: string | null,
  dueTime?: string | null,
  remindAt?: string | null,
): void {
  const t = getTask(id)
  if (!t) return
  const later = !!t.dueDate && !!dueDate && dueDate > t.dueDate
  set((s) =>
    patchTask(
      s,
      id,
      (x) => ({
        ...x,
        dueDate,
        dueTime: dueTime === undefined ? x.dueTime : dueTime,
        remindAt: remindAt === undefined ? x.remindAt : remindAt,
        originalDue: x.originalDue ?? dueDate,
        rescheduleCount: x.rescheduleCount + (later ? 1 : 0),
      }),
      later
        ? [event(id, "rescheduled", { fromDue: t.dueDate, toDue: dueDate })]
        : [],
    ),
  )
}

/** Move a task to today + N days — "Tomorrow" / "+1 week" buttons (later = reschedule). */
export function rescheduleBy(id: string, days: number): void {
  const t = getTask(id)
  if (!t) return
  setDue(id, addDays(today(), days))
}

/** Move every overdue task to today — one reschedule event per task (F-TSK-34). */
export function moveAllOverdueToToday(): number {
  const tk = today()
  const ids = tasksStore
    .get()
    .tasks.filter((t) => isOverdue(t, tk))
    .map((t) => t.id)
  for (const id of ids) setDue(id, tk)
  return ids.length
}

/** Snooze moves remind_at only; not a reschedule (F-TSK-37). */
export function snoozeTask(id: string, minutes = 60): void {
  const t = getTask(id)
  if (!t) return
  const base = Math.max(
    Date.now(),
    t.remindAt ? new Date(t.remindAt).getTime() : 0,
  )
  const remindAt = new Date(base + minutes * 60_000).toISOString()
  set((s) =>
    patchTask(s, id, (x) => ({ ...x, remindAt }), [event(id, "snoozed")]),
  )
}

/** Soft delete (30-day Recently deleted). Undo with restoreTask. */
export function deleteTask(id: string): void {
  set((s) =>
    patchTask(
      s,
      id,
      (x) => ({ ...x, status: "deleted", deletedAt: nowIso() }),
      [event(id, "deleted")],
    ),
  )
}

/** Restore a soft-deleted task as open (or done if it had a completion). */
export function restoreTask(id: string): void {
  set((s) =>
    patchTask(
      s,
      id,
      (x) => ({
        ...x,
        status: x.completedAt ? "done" : "open",
        deletedAt: null,
      }),
      [event(id, "restored")],
    ),
  )
}

/** Copy a task as a new open task (groceries re-buy). */
export function duplicateTask(id: string): Task | null {
  const t = getTask(id)
  if (!t) return null
  return createTask({
    title: t.title,
    listId: t.listId,
    dueDate: t.dueDate && t.dueDate >= today() ? t.dueDate : null,
    dueTime: t.dueTime,
    recurrence: t.recurrence,
    notes: t.notes,
    starred: t.starred,
  })
}

/** Manual reorder: swap with the neighbour in `ids` (the visible order). */
export function moveTask(id: string, dir: -1 | 1, ids: string[]): void {
  const i = ids.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return
  const next = [...ids]
  ;[next[i], next[j]] = [next[j], next[i]]
  const rank = new Map(next.map((x, k) => [x, k]))
  set((s) => ({
    ...s,
    tasks: s.tasks.map((t) =>
      rank.has(t.id) ? { ...t, order: rank.get(t.id) ?? t.order } : t,
    ),
  }))
}

/** Shopping list: bulk-complete checked items and hide them (F-TSK-32). Returns ids for undo. */
export function clearChecked(listId: string): string[] {
  const ids = tasksStore
    .get()
    .tasks.filter(
      (t) => t.listId === listId && t.status === "done" && !t.clearedAt,
    )
    .map((t) => t.id)
  const at = nowIso()
  const drop = new Set(ids)
  set((s) => ({
    ...s,
    tasks: s.tasks.map((t) => (drop.has(t.id) ? { ...t, clearedAt: at } : t)),
  }))
  return ids
}

/** Undo for clearChecked. */
export function unclear(ids: string[]): void {
  const back = new Set(ids)
  set((s) => ({
    ...s,
    tasks: s.tasks.map((t) => (back.has(t.id) ? { ...t, clearedAt: null } : t)),
  }))
}

// ---------------------------------------------------------------- lists

export interface ListInput {
  name: string
  kind: ListKind
  color: ListColor
  icon: ListIcon
}

/** Create a list (bucket). */
export function createList(input: ListInput): TaskList {
  const l: TaskList = {
    id: uid(),
    ...input,
    sortOrder: tasksStore.get().lists.length,
    archivedAt: null,
    isDefault: false,
  }
  set((s) => ({ ...s, lists: [...s.lists, l] }))
  return l
}

/** Edit name / colour / icon / shopping mode. */
export function updateList(id: string, patch: Partial<ListInput>): void {
  set((s) => ({
    ...s,
    lists: s.lists.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  }))
}

/** Archive (hide; tasks kept) or unarchive. */
export function setListArchived(id: string, archived: boolean): void {
  set((s) => ({
    ...s,
    lists: s.lists.map((l) =>
      l.id === id ? { ...l, archivedAt: archived ? nowIso() : null } : l,
    ),
  }))
}

/** Delete a list; open tasks move to Inbox or get soft-deleted. */
export function deleteList(id: string, openTasks: "inbox" | "delete"): void {
  const at = nowIso()
  set((s) => ({
    ...s,
    lists: s.lists.filter((l) => l.id !== id),
    tasks: s.tasks.map((t) =>
      t.listId !== id
        ? t
        : openTasks === "delete" && t.status === "open"
          ? { ...t, status: "deleted", deletedAt: at, listId: null }
          : { ...t, listId: null },
    ),
  }))
}

/** Reorder lists: swap with neighbour. */
export function moveList(id: string, dir: -1 | 1): void {
  set((s) => {
    const ordered = [...s.lists].sort((a, b) => a.sortOrder - b.sortOrder)
    const i = ordered.findIndex((l) => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ordered.length) return s
    ;[ordered[i], ordered[j]] = [ordered[j], ordered[i]]
    return { ...s, lists: ordered.map((l, k) => ({ ...l, sortOrder: k })) }
  })
}

// ---------------------------------------------------------------- settings & notifications

export function updateSettings(patch: Partial<TaskSettings>): void {
  set((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
}

/** Mock device notification state (permission / installed / platform). */
export function updateNotif(patch: Partial<NotifState>): void {
  set((s) => ({ ...s, notif: { ...s.notif, ...patch } }))
}

/** Shopping helper for Today: open items in shopping lists. */
export const isDoneToday = (t: Task) => doneDay(t) === dayKey()
