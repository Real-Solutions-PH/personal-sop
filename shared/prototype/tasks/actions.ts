"use client"
import { dayKey } from "../lib/day"
import { derivedId } from "../lib/ids"
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
  remind?: boolean
  remindAt?: string | null
  recurrence?: Recurrence | null
  notes?: string | null
  starred?: boolean
  source?: TaskSource
  tags?: string[]
}
/** Tags as kept (the server applies the same rule): trimmed, inner spaces
 * collapsed, a leading # dropped, at most 24 characters each and 8 in all,
 * the first spelling kept when one repeats in another case. */
export function cleanTags(tags: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of tags) {
    const tag = raw
      .trim()
      .replace(/^#+/, "")
      .split(/\s+/)
      .join(" ")
      .slice(0, 24)
      .trim()
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase())
      out.push(tag)
    }
  }
  return out.slice(0, 8)
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
    tags: cleanTags(input.tags ?? []),
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
export function createTask(input: NewTask): Task {
  const t = build(input, tasksStore.get().tasks.length)
  set((s) => ({
    ...s,
    tasks: [...s.tasks, t],
    events: [...s.events, event(t.id, "created")],
  }))
  return t
}
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
/** The capture router's keys (work, job2, life, groceries) mapped onto the
 * live lists by name, the server's rule: groceries falls back to the first
 * shopping list. */
export function listKeys(lists: TaskList[]): Record<string, string> {
  const live = lists
    .filter((l) => !l.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const byName: Record<string, string> = {
    work: "work",
    "job 2": "job2",
    job2: "job2",
    life: "life",
    groceries: "groceries",
  }
  const keys: Record<string, string> = {}
  for (const l of live) {
    const key = byName[l.name.toLowerCase().split(/\s+/).join(" ").trim()]
    if (key && !keys[key]) keys[key] = l.id
  }
  if (!keys.groceries) {
    const shop = live.find((l) => l.kind === "shopping")
    if (shop) keys.groceries = shop.id
  }
  return keys
}
export function captureTasks(
  text: string,
  source: TaskSource = "capture-text",
): {
  tasks: Task[]
  followUp?: string
} {
  const keys = listKeys(tasksStore.get().lists)
  const drafts: CaptureDraft[] = splitCapture(text, source, Object.keys(keys))
  const tasks = createTasks(
    drafts.map((d) => ({
      title: d.title,
      listId: d.listId ? (keys[d.listId] ?? null) : null,
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
export function removeTasks(ids: string[]): void {
  const drop = new Set(ids)
  set((s) => ({
    ...s,
    tasks: s.tasks.filter((t) => !drop.has(t.id)),
    events: s.events.filter((e) => !drop.has(e.taskId)),
  }))
}
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
            86400000,
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
          tags: t.tags,
          source: t.source,
        },
        t.order,
      ),
      // The server spawns the same occurrence under the same id
      // (tasks ops.next_occurrence_id), so an offline tick and its replay
      // never make two.
      id: derivedId("task-next", t.id, due),
      remindAt: t.remindAt
        ? new Date(
            new Date(t.remindAt).getTime() + shift * 86400000,
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
export function toggleTask(id: string): Task | null {
  const t = getTask(id)
  if (!t) return null
  if (t.status === "done") uncompleteTask(id)
  else return completeTask(id)
  return null
}
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
      | "tags"
      | "estimateMin"
    >
  >,
): void {
  set((s) => patchTask(s, id, (x) => ({ ...x, ...patch })))
}
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
export function rescheduleBy(id: string, days: number): void {
  const t = getTask(id)
  if (!t) return
  setDue(id, addDays(today(), days))
}
export function moveAllOverdueToToday(): number {
  const tk = today()
  const ids = tasksStore
    .get()
    .tasks.filter((t) => isOverdue(t, tk))
    .map((t) => t.id)
  for (const id of ids) setDue(id, tk)
  return ids.length
}
export function snoozeTask(id: string, minutes = 60): void {
  const t = getTask(id)
  if (!t) return
  const base = Math.max(
    Date.now(),
    t.remindAt ? new Date(t.remindAt).getTime() : 0,
  )
  const remindAt = new Date(base + minutes * 60000).toISOString()
  set((s) =>
    patchTask(s, id, (x) => ({ ...x, remindAt }), [event(id, "snoozed")]),
  )
}
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
    tags: t.tags,
  })
}
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
export function unclear(ids: string[]): void {
  const back = new Set(ids)
  set((s) => ({
    ...s,
    tasks: s.tasks.map((t) => (back.has(t.id) ? { ...t, clearedAt: null } : t)),
  }))
}
export interface ListInput {
  name: string
  kind: ListKind
  color: ListColor
  icon: ListIcon
}
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
/** The lists a new account starts with, as the server seeds them. */
export const STARTER_LISTS: ListInput[] = [
  { name: "Work", kind: "standard", color: "tsk", icon: "briefcase" },
  { name: "Life", kind: "standard", color: "hab", icon: "home" },
  { name: "Groceries", kind: "shopping", color: "fit", icon: "cart" },
]
/** Work, Life and Groceries for an account without them; a name already
 * taken (any case, archived too) is skipped. */
export function addStarterLists(): TaskList[] {
  const taken = new Set(
    tasksStore.get().lists.map((l) => l.name.trim().toLowerCase()),
  )
  return STARTER_LISTS.filter((l) => !taken.has(l.name.toLowerCase())).map(
    (l) => createList(l),
  )
}
export function updateList(id: string, patch: Partial<ListInput>): void {
  set((s) => ({
    ...s,
    lists: s.lists.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  }))
}
export function setListArchived(id: string, archived: boolean): void {
  set((s) => ({
    ...s,
    lists: s.lists.map((l) =>
      l.id === id ? { ...l, archivedAt: archived ? nowIso() : null } : l,
    ),
  }))
}
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
export function updateSettings(patch: Partial<TaskSettings>): void {
  set((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
}
export function updateNotif(patch: Partial<NotifState>): void {
  set((s) => ({ ...s, notif: { ...s.notif, ...patch } }))
}
export const isDoneToday = (t: Task) => doneDay(t) === dayKey()
