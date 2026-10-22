// Tasks module mappers: lists, tasks, settings and the notification state.
//
// How each local change reaches the server:
//   - complete / uncomplete: tasks.complete / tasks.uncomplete actions
//     (status is never a field write, so a recurring completion spawns its
//     next occurrence server-side, under the same derived id the device used)
//   - delete (status "deleted"): the task leaves ``list`` -> a delete op
//   - capture undo (the task leaves the store): tasks.remove, then the
//     delete op (a no-op on the server by then)
//   - restore: the task comes back into ``list`` with a local "restored"
//     event -> tasks.restore, then the usual create upsert of its fields
//   - due date changes (setDue, rescheduleBy, move overdue to today): a
//     ``due_date`` field write. The server counts a LATER date as a
//     reschedule exactly as setDue does, so reschedule_count and
//     original_due agree on both sides; the reschedule_by action would use
//     the server's today instead of the device's.
//   - snooze, clear checked, unclear, archive, reorder: field writes
//     (remind_at, cleared_at, archived_at, sort_order)
//   - list delete: a delete op (the server moves its tasks to the Inbox; the
//     open tasks the device deleted with it arrive as their own delete ops)
//
// task_event is server-written history and never pushed; local events stay
// local.

import type {
  NotifState,
  Recurrence,
  Task,
  TaskList,
  TaskSettings,
  TasksState,
} from "@domain/tasks/data"
import { tasksStore } from "@domain/tasks/store"
import type { ActionOp, Mapper, Payload } from "../mapper"
import { singleton } from "./helpers"

const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v)

/** One instant format locally, whatever offset the server renders. */
const instant = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(String(v)).toISOString()

/** Upsert by id (pulled rows win), then drop the pulled deletes. */
function mergeById<T extends { id: string }>(
  rows: T[],
  ups: T[],
  dels: string[],
  keep: (local: T) => boolean = () => false,
): T[] {
  const byId = new Map(ups.map((u) => [u.id, u]))
  const gone = new Set(dels)
  const out: T[] = []
  for (const r of rows) {
    const u = byId.get(r.id)
    if (u) {
      out.push(u)
      byId.delete(r.id)
    } else if (!gone.has(r.id) || keep(r)) out.push(r)
  }
  return [...out, ...byId.values()]
}

// ---------------------------------------------------------------- lists

export function listMapper(): Mapper<TasksState, TaskList> {
  return {
    entity: "task_list",
    store: tasksStore,
    list: (s) => s.lists,
    id: (l) => l.id,
    toServer: (l) => ({
      name: l.name,
      kind: l.kind,
      color: l.color,
      icon: l.icon,
      sort_order: l.sortOrder,
      archived_at: l.archivedAt,
      is_default: l.isDefault,
    }),
    fromServer: (row) => ({
      id: String(row.id),
      name: String(row.name),
      kind: row.kind === "shopping" ? "shopping" : "standard",
      color: row.color as TaskList["color"],
      icon: row.icon as TaskList["icon"],
      sortOrder: Number(row.sort_order ?? 0),
      archivedAt: instant(row.archived_at),
      isDefault: Boolean(row.is_default),
    }),
    merge: (s, ups, dels) => ({
      ...s,
      lists: mergeById(s.lists, ups, dels),
    }),
  }
}

// ---------------------------------------------------------------- tasks

const STATUSES: readonly Task["status"][] = ["open", "done", "deleted"]
const SOURCES: readonly Task["source"][] = [
  "manual",
  "capture-text",
  "capture-voice",
  "capture-photo",
]

/** Restored on this device since the snapshot dropped it. */
function restoredLocally(s: TasksState, id: string): boolean {
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i]
    if (e.taskId !== id) continue
    if (e.type === "restored") return true
    if (e.type === "deleted" || e.type === "created") return false
  }
  return false
}

export function taskMapper(): Mapper<TasksState, Task> {
  return {
    entity: "task",
    store: tasksStore,
    // A deleted task stays in the store for Recently deleted, but it is not
    // a live server row: leaving the list is what sends its delete op.
    list: (s) => s.tasks.filter((t) => t.status !== "deleted"),
    id: (t) => t.id,
    toServer: (t) => ({
      title: t.title,
      list_id: t.listId,
      due_date: t.dueDate,
      due_time: t.dueTime,
      remind_at: t.remindAt,
      recurrence: t.recurrence,
      notes: t.notes,
      starred: t.starred,
      tags: t.tags ?? [],
      cleared_at: t.clearedAt,
      source: t.source,
      parse_state: t.parseState,
      sort_order: t.order,
      // Server-owned: changed only by actions or derived from due_date.
      status: t.status,
      completed_at: t.completedAt,
      original_due: t.originalDue,
      reschedule_count: t.rescheduleCount,
    }),
    fromServer: (row) => {
      const status = row.status as Task["status"]
      const source = row.source as Task["source"]
      return {
        id: String(row.id),
        title: String(row.title),
        listId: str(row.list_id),
        dueDate: str(row.due_date),
        dueTime: str(row.due_time),
        remindAt: instant(row.remind_at),
        recurrence: (row.recurrence as Recurrence | null) ?? null,
        notes: str(row.notes),
        starred: Boolean(row.starred),
        tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
        status: STATUSES.includes(status) ? status : "open",
        completedAt: instant(row.completed_at),
        deletedAt: instant(row.deleted_at),
        clearedAt: instant(row.cleared_at),
        createdAt: instant(row.created_at) ?? new Date().toISOString(),
        source: SOURCES.includes(source) ? source : "manual",
        parseState: row.parse_state === "pending" ? "pending" : "parsed",
        originalDue: str(row.original_due),
        rescheduleCount: Number(row.reschedule_count ?? 0),
        order: Number(row.sort_order ?? 0),
      }
    },
    // A pulled delete drops the row, except one this device deleted itself
    // (it stays in Recently deleted). A capture undo or an uncomplete that
    // removed the spawned occurrence arrives the same way, and vanishes.
    merge: (s, ups, dels) => ({
      ...s,
      tasks: mergeById(s.tasks, ups, dels, (t) => t.status === "deleted"),
    }),
    actionFields: [
      "status",
      "completed_at",
      "original_due",
      "reschedule_count",
    ],
    actions: (prev, next, s) => {
      const ops: ActionOp[] = []
      if (!next) {
        // Gone from the store altogether (capture undo), not soft-deleted
        // (that keeps the row with status "deleted"): tasks.remove keeps it
        // out of the server's Recently deleted and stats.
        if (prev && !s.tasks.some((t) => t.id === prev.id))
          ops.push({ name: "tasks.remove", data: { task_ids: [prev.id] } })
        return ops
      }
      if (!prev) {
        if (restoredLocally(s, next.id))
          ops.push({ name: "tasks.restore", data: { task_id: next.id } })
        return ops
      }
      if (prev.status === "open" && next.status === "done")
        ops.push({
          name: "tasks.complete",
          data: { task_id: next.id, completed_at: next.completedAt },
        })
      else if (prev.status === "done" && next.status === "open")
        ops.push({ name: "tasks.uncomplete", data: { task_id: next.id } })
      return ops
    },
  }
}

// ---------------------------------------------------------------- singletons

export function settingsMapper(userId: string) {
  return singleton<TasksState, TaskSettings>({
    entity: "task_settings",
    userId,
    store: tasksStore,
    read: (s) => s.settings,
    write: (s, settings) => ({ ...s, settings }),
    toServer: (v) => ({
      default_remind_time: v.defaultRemindTime,
      digest_on: v.digestOn,
      digest_time: v.digestTime,
      quiet_start: v.quietStart,
      quiet_end: v.quietEnd,
      count_groceries: v.countGroceries,
      week_start: v.weekStart,
    }),
    fromServer: (row: Payload, cur) => ({
      ...cur,
      defaultRemindTime: String(row.default_remind_time),
      digestOn: Boolean(row.digest_on),
      digestTime: String(row.digest_time),
      quietStart: String(row.quiet_start),
      quietEnd: String(row.quiet_end),
      countGroceries: Boolean(row.count_groceries),
      weekStart: Number(row.week_start) === 0 ? 0 : 1,
    }),
  })
}

export function notifMapper(userId: string) {
  return singleton<TasksState, NotifState>({
    entity: "task_notif_state",
    userId,
    store: tasksStore,
    read: (s) => s.notif,
    write: (s, notif) => ({ ...s, notif }),
    toServer: (v) => ({
      platform: v.platform,
      installed: v.installed,
      permission: v.permission,
      remind_later_at: v.remindLaterAt,
      test_sent_at: v.testSentAt,
    }),
    fromServer: (row: Payload, cur) => ({
      ...cur,
      platform:
        row.platform === "android" || row.platform === "desktop"
          ? row.platform
          : "ios",
      installed: Boolean(row.installed),
      permission:
        row.permission === "granted" || row.permission === "denied"
          ? row.permission
          : "default",
      remindLaterAt: instant(row.remind_later_at),
      testSentAt: instant(row.test_sent_at),
    }),
  })
}

/** Lists before tasks: a task created in a new list needs the list first. */
export const tasksMappers = (userId: string) => [
  listMapper(),
  taskMapper(),
  settingsMapper(userId),
  notifMapper(userId),
]
