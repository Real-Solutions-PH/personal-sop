import { join } from "node:path"
import { derivedId } from "@domain/lib/ids"
import type { StorageAdapter } from "@domain/lib/store"
import {
  clearChecked,
  completeTask,
  createList,
  createTask,
  deleteList,
  deleteTask,
  removeTasks,
  restoreTask,
  setDue,
  snoozeTask,
  uncompleteTask,
  updateNotif,
  updateSettings,
  updateTask,
} from "@domain/tasks/actions"
import { seedTasks, type Task, type TasksState } from "@domain/tasks/data"
import { addDays, today } from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import { SyncEngine } from "../engine"
import type { Http } from "../http"
import type { Payload } from "../mapper"
import {
  listMapper,
  notifMapper,
  settingsMapper,
  taskMapper,
  tasksMappers,
} from "../mappers/tasks"
import { createOutbox, type SyncOp } from "../outbox"
import { writeStableFixture } from "./stable-fixture"

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"

// startLive's network side, stubbed: only its mapper list is under test.
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }))
jest.mock("../events", () => ({
  runEventStream: () => ({ stop: async () => {} }),
}))
jest.mock("@domain/lib/platform", () => ({
  ...jest.requireActual("@domain/lib/platform"),
  getConnectivity: () => false,
}))

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

// Push answers "applied" with no row; pull has nothing. Enough to drive
// capture(), which is where the mapping happens.
const quietHttp: Http = {
  request: async <T>(method: string, path: string): Promise<T> => {
    if (method === "POST" && path === "/sync/push") return { results: [] } as T
    return { changes: [], cursor: 0, truncated: false } as T
  },
  raw: async () => {
    throw new Error("unused")
  },
}

function engine() {
  const storage = memoryStorage()
  return new SyncEngine({
    http: quietHttp,
    storage,
    outbox: createOutbox(storage),
    mappers: tasksMappers(USER),
    online: () => false,
  })
}

const blank = (): TasksState => ({
  ...seedTasks(),
  lists: [],
  tasks: [],
  events: [],
})

const wire: { entity: string; kind: string; name: string; data: Payload }[] = []
const record = (ops: SyncOp[]) => {
  for (const o of ops)
    if (o.kind !== "delete")
      wire.push({
        entity: o.kind === "action" ? "" : o.name,
        kind: o.kind,
        name: o.name,
        data: o.data ?? {},
      })
  return ops
}
const names = (ops: SyncOp[]) =>
  ops.map((o) => (o.kind === "action" ? o.name : `${o.kind}:${o.name}`))
const upsertOf = (ops: SyncOp[], id: string) =>
  ops.find((o) => o.kind === "upsert" && o.id === id)?.data

beforeEach(() => tasksStore.set(blank()))

afterAll(() => {
  writeStableFixture(join(__dirname, "fixtures", "tasks-wire.json"), wire)
})

test("runtime.ts picks the tasks mappers up through its import", async () => {
  const rt = require("../runtime") as typeof import("../runtime")
  await Promise.resolve()
  const e = rt.startLive(USER, memoryStorage())
  const entities = (
    e as unknown as { deps: { mappers: { entity: string }[] } }
  ).deps.mappers.map((m) => m.entity)
  rt.stopLive()
  expect(entities).toEqual(
    expect.arrayContaining([
      "task_list",
      "task",
      "task_settings",
      "task_notif_state",
    ]),
  )
})

// ---------------------------------------------------------------- round trip

describe("round trip from the prototype seed", () => {
  const seed = seedTasks()

  test("every task survives toServer -> fromServer", () => {
    const m = taskMapper()
    // The seed's grocery history indexes its title pool with a negative
    // number on some days (title undefined); the server never sends that.
    const titled = seed.tasks.filter((t) => typeof t.title === "string")
    expect(titled.length).toBeGreaterThan(seed.tasks.length / 2)
    for (const t of titled) {
      const row = {
        ...m.toServer(t, seed),
        id: t.id,
        created_at: t.createdAt,
        deleted_at: t.deletedAt,
      }
      // A task made before tags reads back with none.
      expect(m.fromServer(row, seed)).toEqual({ ...t, tags: t.tags ?? [] })
    }
    expect(seed.tasks.some((t) => t.recurrence)).toBe(true)
    expect(seed.tasks.some((t) => t.remindAt)).toBe(true)
  })

  test("every list survives toServer -> fromServer", () => {
    const m = listMapper()
    for (const l of seed.lists)
      expect(m.fromServer({ ...m.toServer(l, seed), id: l.id }, seed)).toEqual(
        l,
      )
  })

  test("settings and notification state survive", () => {
    const s = settingsMapper(USER)
    const [srow] = s.list(seed)
    expect(s.fromServer(s.toServer(srow, seed), seed)?.value).toEqual(
      seed.settings,
    )
    const n = notifMapper(USER)
    const notif = {
      ...seed.notif,
      remindLaterAt: "2026-10-19T03:00:00.000Z",
      testSentAt: "2026-10-18T01:30:00.000Z",
    }
    const st = { ...seed, notif }
    const [nrow] = n.list(st)
    expect(n.fromServer(n.toServer(nrow, st), st)?.value).toEqual(notif)
  })

  test("a server instant with an offset comes back in the local format", () => {
    const m = taskMapper()
    const t = seed.tasks.find((x) => x.remindAt) as Task
    const iso = t.remindAt as string
    const local = m.fromServer(
      {
        ...m.toServer(t, seed),
        id: t.id,
        created_at: t.createdAt,
        remind_at: iso.replace(".000Z", "+00:00"),
      },
      seed,
    )
    expect(local?.remindAt).toBe(iso)
  })
})

// ---------------------------------------------------------------- diff

describe("store edits become sync ops", () => {
  test("create a list and a task in it: list first, every field sent", () => {
    const e = engine()
    e.capture()
    const l = createList({
      name: "Side project",
      kind: "standard",
      color: "life",
      icon: "laptop",
    })
    const t = createTask({
      title: "Draft the landing page",
      listId: l.id,
      dueDate: today(),
      dueTime: "14:00",
      remind: true,
      notes: "hero + pricing",
      starred: true,
    })
    const ops = record(e.capture())
    expect(names(ops)).toEqual(["upsert:task_list", "upsert:task"])
    expect(upsertOf(ops, l.id)).toEqual({
      name: "Side project",
      kind: "standard",
      color: "life",
      icon: "laptop",
      sort_order: 0,
      archived_at: null,
      is_default: false,
    })
    const data = upsertOf(ops, t.id)
    expect(data).toMatchObject({
      title: "Draft the landing page",
      list_id: l.id,
      due_date: today(),
      due_time: "14:00",
      notes: "hero + pricing",
      starred: true,
      source: "manual",
      parse_state: "parsed",
    })
    expect(typeof data?.remind_at).toBe("string")
    for (const owned of [
      "status",
      "completed_at",
      "original_due",
      "reschedule_count",
    ])
      expect(data).not.toHaveProperty(owned)
  })

  test("editing one field sends only that field", () => {
    const e = engine()
    const t = createTask({ title: "Call the bank" })
    e.capture()
    updateTask(t.id, { notes: "ask about the card fee" })
    const ops = record(e.capture())
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({
      kind: "upsert",
      name: "task",
      id: t.id,
      data: { notes: "ask about the card fee" },
    })
  })

  test("a later due date is a plain due_date write; the counts stay local", () => {
    const e = engine()
    const t = createTask({ title: "Renew passport", dueDate: today() })
    e.capture()
    setDue(t.id, addDays(today(), 3))
    const ops = record(e.capture())
    expect(ops).toHaveLength(1)
    expect(ops[0].data).toEqual({ due_date: addDays(today(), 3) })
    // Same rule as the server's set_due: later -> +1, original kept.
    const after = tasksStore.get().tasks.find((x) => x.id === t.id)
    expect(after).toMatchObject({ rescheduleCount: 1, originalDue: today() })
  })

  test("snooze and clear checked are field writes", () => {
    const e = engine()
    const l = createList({
      name: "Groceries",
      kind: "shopping",
      color: "fit",
      icon: "cart",
    })
    const t = createTask({ title: "Eggs", listId: l.id })
    const r = createTask({
      title: "Pay rent",
      dueDate: today(),
      dueTime: "09:00",
      remind: true,
    })
    e.capture()
    snoozeTask(r.id, 30)
    completeTask(t.id)
    e.capture()
    clearChecked(l.id)
    const ops = record(e.capture())
    expect(names(ops)).toEqual(["upsert:task"])
    expect(Object.keys(ops[0].data ?? {})).toEqual(["cleared_at"])
  })

  test("complete: the action first, status never a field write", () => {
    const e = engine()
    const t = createTask({ title: "Ship release notes" })
    e.capture()
    completeTask(t.id)
    const ops = record(e.capture())
    expect(names(ops)).toEqual(["tasks.complete"])
    const done = tasksStore.get().tasks.find((x) => x.id === t.id)
    expect(ops[0].data).toEqual({
      task_id: t.id,
      completed_at: done?.completedAt,
    })
  })

  test("completing a recurring task: complete, then the derived next occurrence", () => {
    const e = engine()
    const t = createTask({
      title: "Submit timesheet",
      dueDate: today(),
      recurrence: { rule: { kind: "daily" }, mode: "fixed" },
    })
    e.capture()
    const next = completeTask(t.id)
    const nextDue = addDays(today(), 1)
    expect(next?.dueDate).toBe(nextDue)
    expect(next?.id).toBe(derivedId("task-next", t.id, nextDue))
    const ops = record(e.capture())
    expect(names(ops)).toEqual(["tasks.complete", "upsert:task"])
    expect(ops[1].id).toBe(next?.id)
    expect(ops[1].data).toMatchObject({ due_date: nextDue })
  })

  test("uncomplete sends tasks.uncomplete", () => {
    const e = engine()
    const t = createTask({ title: "Book flights" })
    completeTask(t.id)
    e.capture()
    uncompleteTask(t.id)
    const ops = record(e.capture())
    expect(names(ops)).toEqual(["tasks.uncomplete"])
    expect(ops[0].data).toEqual({ task_id: t.id })
  })

  test("delete is a delete op; restore sends tasks.restore before the fields", () => {
    const e = engine()
    const t = createTask({ title: "Try new gym" })
    e.capture()
    deleteTask(t.id)
    const del = e.capture()
    expect(del).toEqual([
      expect.objectContaining({ kind: "delete", name: "task", id: t.id }),
    ])
    // Still on the device for Recently deleted.
    expect(tasksStore.get().tasks.find((x) => x.id === t.id)?.status).toBe(
      "deleted",
    )
    restoreTask(t.id)
    const ops = record(e.capture())
    expect(names(ops)).toEqual(["tasks.restore", "upsert:task"])
    expect(ops[0].data).toEqual({ task_id: t.id })
  })

  test("capture undo sends tasks.remove (not a user delete) before the delete", () => {
    const e = engine()
    const t = createTask({ title: "Pack bags", source: "capture-text" })
    e.capture()
    removeTasks([t.id])
    const ops = record(e.capture())
    // The server tombstones it with its status kept, so it stays out of
    // Recently deleted; the delete op that follows finds it gone.
    expect(names(ops)).toEqual(["tasks.remove", "delete:task"])
    expect(ops[0].data).toEqual({ task_ids: [t.id] })
  })

  test("deleting a list with its open tasks: task deletes and the list delete", () => {
    const e = engine()
    const l = createList({
      name: "Job 2",
      kind: "standard",
      color: "fin",
      icon: "laptop",
    })
    const open = createTask({ title: "Invoice", listId: l.id })
    const done = createTask({ title: "Onboard", listId: l.id })
    completeTask(done.id)
    e.capture()
    deleteList(l.id, "delete")
    const ops = record(e.capture())
    expect(
      ops.map((o) => `${o.kind}:${o.name}:${o.id === l.id ? "list" : o.id}`),
    ).toEqual([
      "delete:task_list:list",
      `upsert:task:${done.id}`,
      `delete:task:${open.id}`,
    ])
    expect(upsertOf(ops, done.id)).toEqual({ list_id: null })
  })

  test("settings and notification state go out as singleton field writes", () => {
    const e = engine()
    e.capture()
    updateSettings({ digestOn: true, quietStart: "23:00" })
    updateNotif({ permission: "granted" })
    const ops = record(e.capture())
    expect(ops).toEqual([
      expect.objectContaining({
        name: "task_settings",
        id: derivedId("singleton", USER, "task_settings"),
        data: { digest_on: true, quiet_start: "23:00" },
      }),
      expect.objectContaining({
        name: "task_notif_state",
        data: { permission: "granted" },
      }),
    ])
  })
})

// ---------------------------------------------------------------- pull

describe("pulled rows", () => {
  const row = (t: Partial<Payload>): Payload => ({
    id: "5d3c8a40-0b8e-4c3a-9a6f-1a2b3c4d5e6f",
    title: "From the laptop",
    list_id: null,
    due_date: null,
    due_time: null,
    remind_at: null,
    recurrence: null,
    notes: null,
    starred: false,
    status: "open",
    completed_at: null,
    cleared_at: null,
    deleted_at: null,
    created_at: "2026-10-19T01:00:00Z",
    source: "manual",
    parse_state: "parsed",
    original_due: null,
    reschedule_count: 0,
    sort_order: 4,
    series_parent_id: null,
    version: 7,
    ...t,
  })

  test("merge without echo, and a server-completed task sends no action", () => {
    const e = engine()
    e.capture()
    e.apply([
      {
        entity: "task",
        id: String(row({}).id),
        version: 7,
        deleted: false,
        row: row({}),
      },
    ])
    expect(tasksStore.get().tasks).toHaveLength(1)
    expect(e.capture()).toEqual([])
    e.apply([
      {
        entity: "task",
        id: String(row({}).id),
        version: 8,
        deleted: false,
        row: row({ status: "done", completed_at: "2026-10-19T02:00:00Z" }),
      },
    ])
    expect(tasksStore.get().tasks[0]).toMatchObject({
      status: "done",
      completedAt: "2026-10-19T02:00:00.000Z",
    })
    expect(e.capture()).toEqual([])
  })

  test("a pulled delete drops the row, but keeps one this device deleted", () => {
    const e = engine()
    const mine = createTask({ title: "Mine" })
    e.capture()
    e.apply([
      {
        entity: "task",
        id: String(row({}).id),
        version: 7,
        deleted: false,
        row: row({}),
      },
    ])
    deleteTask(mine.id)
    e.capture()
    e.apply([
      { entity: "task", id: mine.id, version: 9, deleted: true, row: null },
      {
        entity: "task",
        id: String(row({}).id),
        version: 10,
        deleted: true,
        row: null,
      },
    ])
    expect(tasksStore.get().tasks.map((t) => [t.id, t.status])).toEqual([
      [mine.id, "deleted"],
    ])
    expect(e.capture()).toEqual([])
  })
})
