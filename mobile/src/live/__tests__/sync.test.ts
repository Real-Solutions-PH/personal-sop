import { derivedId } from "@domain/lib/ids"
import { createStore, type StorageAdapter } from "@domain/lib/store"
import { SyncEngine } from "../engine"
import { createSseParser } from "../events"
import type { Http } from "../http"
import { ApiError, NetworkError } from "../http"
import { diffEntity, type Mapper } from "../mapper"
import { createOutbox, type SyncOp } from "../outbox"

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

interface Todo {
  id: string
  title: string
  done: boolean
}
interface State {
  todos: Todo[]
}

const todoStore = createStore<State>("test-todos", () => ({ todos: [] }))

const todoMapper: Mapper<State, Todo> = {
  entity: "todo",
  store: todoStore,
  list: (s) => s.todos,
  id: (t) => t.id,
  toServer: (t) => ({ title: t.title, status: t.done ? "done" : "open" }),
  fromServer: (row) => ({
    id: String(row.id),
    title: String(row.title),
    done: row.status === "done",
  }),
  merge: (s, ups, dels) => {
    const map = new Map(s.todos.map((t) => [t.id, t]))
    for (const d of dels) map.delete(d)
    for (const u of ups) map.set(u.id, u)
    return { todos: [...map.values()] }
  },
  actionFields: ["status"],
  actions: (prev, next) =>
    prev && next && !prev.done && next.done
      ? [{ name: "todo.complete", data: { id: next.id } }]
      : [],
}

class FakeServer implements Http {
  rows = new Map<string, Record<string, unknown>>()
  version = 0
  pushes: SyncOp[][] = []
  down = false
  /** Answer a push containing a matching op with this status for the whole
   * request, as request-level validation does (no per-op receipts). */
  refuse: { match: (op: SyncOp) => boolean; status: number } | null = null
  /** Keep tombstones and refuse a plain upsert onto one, as the server does. */
  tombstones = false
  dead = new Set<string>()
  log: { id: string; version: number; deleted: boolean }[] = []

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (this.down) throw new NetworkError("offline")
    if (method === "POST" && path === "/sync/push") {
      const ops = (body as { ops: SyncOp[] }).ops
      this.pushes.push(ops)
      if (this.refuse && ops.some(this.refuse.match))
        throw new ApiError(this.refuse.status, "validation_error", "Invalid")
      const results = ops.map((op) => {
        if (this.tombstones && op.kind === "upsert" && op.id) {
          if (
            op.data?.deleted_at === null &&
            Object.keys(op.data).length === 1
          ) {
            if (!this.dead.delete(op.id))
              return { op_id: op.op_id, status: "rejected", code: "not_found" }
            this.rows.set(op.id, { id: op.id, status: "open" })
            this.log.push({
              id: op.id,
              version: ++this.version,
              deleted: false,
            })
            return { op_id: op.op_id, status: "applied" }
          }
          if (this.dead.has(op.id))
            return {
              op_id: op.op_id,
              status: "conflict",
              code: "deleted_on_server",
            }
        }
        if (this.tombstones && op.kind === "delete" && op.id)
          this.dead.add(op.id)
        if (op.kind === "upsert" && op.id) {
          const row = {
            ...(this.rows.get(op.id) ?? { id: op.id, status: "open" }),
            ...op.data,
          }
          this.rows.set(op.id, row)
          this.log.push({ id: op.id, version: ++this.version, deleted: false })
          return { op_id: op.op_id, status: "applied", row }
        }
        if (op.kind === "delete" && op.id) {
          this.rows.delete(op.id)
          this.log.push({ id: op.id, version: ++this.version, deleted: true })
        }
        if (op.kind === "action") {
          const id = String(op.data?.id)
          const row = { ...(this.rows.get(id) ?? {}), status: "done" }
          this.rows.set(id, row)
          this.log.push({ id, version: ++this.version, deleted: false })
        }
        return { op_id: op.op_id, status: "applied" }
      })
      return { results } as T
    }
    if (method === "GET" && path.startsWith("/sync/pull")) {
      const cursor = Number(
        new URL(`http://x${path}`).searchParams.get("cursor"),
      )
      const latest = new Map<
        string,
        { id: string; version: number; deleted: boolean }
      >()
      for (const e of this.log) if (e.version > cursor) latest.set(e.id, e)
      const changes = [...latest.values()]
        .sort((a, b) => a.version - b.version)
        .map((e) => ({
          entity: "todo",
          id: e.id,
          version: e.version,
          deleted: e.deleted,
          row: e.deleted ? null : this.rows.get(e.id),
        }))
      return {
        changes,
        cursor: changes.at(-1)?.version ?? cursor,
        truncated: false,
      } as T
    }
    throw new Error(`unexpected ${method} ${path}`)
  }
  async raw(): Promise<Response> {
    throw new Error("unused")
  }
}

function engine(
  server: FakeServer,
  storage = memoryStorage(),
  online = () => true,
) {
  return new SyncEngine({
    http: server,
    storage,
    outbox: createOutbox(storage),
    mappers: [todoMapper],
    online,
  })
}

beforeEach(() => todoStore.set({ todos: [] }))

test("diff: create sends everything but action-owned fields; edits send only changes", () => {
  const snap: Record<string, Record<string, unknown>> = {}
  const created = diffEntity(
    todoMapper,
    { todos: [{ id: "a", title: "Pay", done: false }] },
    snap,
    {},
  )
  expect(created.upserts).toEqual([
    { id: "a", data: { title: "Pay" }, create: true },
  ])
  snap.a = { title: "Pay", status: "open" }
  const edited = diffEntity(
    todoMapper,
    { todos: [{ id: "a", title: "Pay rent", done: true }] },
    snap,
    { a: { id: "a", title: "Pay", done: false } },
  )
  expect(edited.upserts).toEqual([
    { id: "a", data: { title: "Pay rent" }, create: false },
  ])
  expect(edited.actions).toEqual([{ name: "todo.complete", data: { id: "a" } }])
  const gone = diffEntity(todoMapper, { todos: [] }, snap, {})
  expect(gone.deletes).toEqual(["a"])
})

test("offline edits wait in the outbox and reach the server on reconnect", async () => {
  const server = new FakeServer()
  let online = false
  const e = engine(server, memoryStorage(), () => online)
  todoStore.set({ todos: [{ id: "a", title: "Buy milk", done: false }] })
  e.capture()
  await e.sync()
  expect(server.pushes).toHaveLength(0)
  expect(e.pending()).toBe(1)
  online = true
  await e.sync()
  expect(e.pending()).toBe(0)
  expect(server.rows.get("a")).toMatchObject({ title: "Buy milk" })
})

test("completing runs the action before the field write and echoes nothing back", async () => {
  const server = new FakeServer()
  const e = engine(server)
  todoStore.set({ todos: [{ id: "a", title: "Run", done: false }] })
  e.capture()
  await e.sync()
  todoStore.set({ todos: [{ id: "a", title: "Run 5k", done: true }] })
  const ops = e.capture()
  expect(ops.map((o) => o.kind)).toEqual(["action", "upsert"])
  await e.sync()
  expect(server.rows.get("a")).toMatchObject({
    status: "done",
    title: "Run 5k",
  })
  // after the pull merged the server row, a new capture has nothing to send
  expect(e.capture()).toEqual([])
})

test("pull brings another device's rows in, including deletes", async () => {
  const server = new FakeServer()
  const e = engine(server)
  server.rows.set("b", { id: "b", title: "From the laptop", status: "open" })
  server.log.push({ id: "b", version: ++server.version, deleted: false })
  await e.sync()
  expect(todoStore.get().todos).toEqual([
    { id: "b", title: "From the laptop", done: false },
  ])
  expect(e.capture()).toEqual([])
  server.rows.delete("b")
  server.log.push({ id: "b", version: ++server.version, deleted: true })
  await e.sync()
  expect(todoStore.get().todos).toEqual([])
  expect(e.capture()).toEqual([])
})

test("the outbox and cursor survive a restart", async () => {
  const server = new FakeServer()
  const storage = memoryStorage()
  let online = false
  const first = engine(server, storage, () => online)
  todoStore.set({ todos: [{ id: "a", title: "Keep me", done: false }] })
  first.capture()
  const second = engine(server, storage, () => true)
  expect(second.pending()).toBe(1)
  await second.sync()
  online = true
  expect(server.rows.get("a")).toMatchObject({ title: "Keep me" })
})

test("a transition made before the engine starts still sends its action", async () => {
  const server = new FakeServer()
  const storage = memoryStorage()
  const first = engine(server, storage)
  todoStore.set({ todos: [{ id: "a", title: "Run", done: false }] })
  first.capture()
  await first.sync()
  first.stop()
  // App relaunched offline: the task is completed before sign-in finishes,
  // so no engine is watching the store yet.
  todoStore.set({ todos: [{ id: "a", title: "Run", done: true }] })
  const second = engine(server, storage)
  const ops = second.capture()
  expect(ops).toEqual([
    expect.objectContaining({
      kind: "action",
      name: "todo.complete",
      data: { id: "a" },
    }),
  ])
  await second.sync()
  expect(server.rows.get("a")).toMatchObject({ status: "done" })
})

test("without a stored baseline the current rows are the baseline", () => {
  todoStore.set({ todos: [{ id: "a", title: "Run", done: true }] })
  const e = engine(new FakeServer())
  expect(e.capture().filter((o) => o.kind === "action")).toEqual([])
})

test("derived ids match the backend's uuid5", () => {
  // Value computed by backend app.shared.ids.derived_id (same inputs).
  expect(
    derivedId(
      "task-next",
      "00000000-0000-4000-8000-000000000001",
      "2026-10-19",
    ),
  ).toBe("39497adb-3065-5ba1-a834-a2e93ac30d5e")
})

test("sse parser handles split chunks, comments and multi-line data", () => {
  const got: unknown[] = []
  const feed = createSseParser((e) => got.push(e))
  feed("retry: 3000\n\n: ping\n\nid: 1-0\nevent: chat.mes")
  feed('sage\ndata: {"a":\ndata: 1}\n\nid: 2-0\ndata: plain\n\n')
  expect(got).toEqual([
    { id: "1-0", type: "chat.message", data: { a: 1 } },
    { id: "2-0", type: "message", data: "plain" },
  ])
})

test("an edit captured while a sync is in flight is pushed right after it", async () => {
  const server = new FakeServer()
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const slow: Http = {
    request: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      if (path.startsWith("/sync/pull")) await gate
      return server.request<T>(method, path, body)
    },
    raw: server.raw,
  }
  const storage = memoryStorage()
  const e = new SyncEngine({
    http: slow,
    storage,
    outbox: createOutbox(storage),
    mappers: [todoMapper],
    online: () => true,
  })
  const first = e.sync() // blocks in its pull
  todoStore.set({
    todos: [{ id: "late", title: "Arrived mid-sync", done: false }],
  })
  e.capture()
  const second = e.sync() // must not be dropped
  release()
  await first
  await second
  expect(server.rows.get("late")).toMatchObject({ title: "Arrived mid-sync" })
  expect(e.pending()).toBe(0)
})

test("one malformed op is dead-lettered; the ops around it still sync", async () => {
  const server = new FakeServer()
  // Request-level validation: a non-UUID id fails the whole batch.
  server.refuse = { match: (op) => op.id === "not-a-uuid", status: 422 }
  const storage = memoryStorage()
  const e = engine(server, storage)
  todoStore.set({
    todos: [
      { id: "a", title: "Before", done: false },
      { id: "not-a-uuid", title: "Bad", done: false },
      { id: "c", title: "After", done: false },
    ],
  })
  e.capture()
  await e.sync()
  expect(e.pending()).toBe(0)
  expect(server.rows.get("a")).toMatchObject({ title: "Before" })
  expect(server.rows.get("c")).toMatchObject({ title: "After" })
  expect(server.rows.has("not-a-uuid")).toBe(false)
  expect(e.deadLetters().map((d) => [d.op.id, d.status])).toEqual([
    ["not-a-uuid", 422],
  ])
  // The queue is not wedged: a later edit goes straight through.
  todoStore.set({
    todos: [...todoStore.get().todos, { id: "d", title: "Later", done: false }],
  })
  e.capture()
  await e.sync()
  expect(server.rows.get("d")).toMatchObject({ title: "Later" })
  expect(e.pending()).toBe(0)
})

test("a server error is retried, never dead-lettered", async () => {
  jest.useFakeTimers()
  try {
    const server = new FakeServer()
    server.refuse = { match: () => true, status: 500 }
    const e = engine(server)
    todoStore.set({ todos: [{ id: "a", title: "Keep me", done: false }] })
    e.capture()
    await e.sync()
    expect(e.pending()).toBe(1)
    expect(e.deadLetters()).toEqual([])
    server.refuse = null
    await jest.advanceTimersByTimeAsync(2_000)
    await e.sync()
    expect(e.pending()).toBe(0)
    expect(server.rows.get("a")).toMatchObject({ title: "Keep me" })
  } finally {
    jest.useRealTimers()
  }
})

test("an edit made while a push response is in flight is not overwritten", async () => {
  const server = new FakeServer()
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  let hold = true
  const slow: Http = {
    request: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      const res = await server.request<T>(method, path, body)
      if (hold && path === "/sync/push") await gate // response held
      return res
    },
    raw: server.raw,
  }
  const storage = memoryStorage()
  const e = new SyncEngine({
    http: slow,
    storage,
    outbox: createOutbox(storage),
    mappers: [todoMapper],
    online: () => true,
    debounceMs: 30,
  })
  e.start((m, onChange) => m.store.subscribe(onChange))
  todoStore.set({ todos: [{ id: "a", title: "Pay rent", done: false }] })
  e.capture()
  const first = e.sync() // its push response is held
  // The user edits again while that response is in flight; the debounced
  // capture has not run yet when the response lands.
  todoStore.set({ todos: [{ id: "a", title: "Pay rent today", done: false }] })
  hold = false
  release()
  await first
  await new Promise((r) => setTimeout(r, 120)) // debounce + follow-up sync
  await e.sync()
  e.stop()
  expect(todoStore.get().todos[0].title).toBe("Pay rent today")
  expect(server.rows.get("a")).toMatchObject({ title: "Pay rent today" })
  expect(e.pending()).toBe(0)
})

test("flush queues an edit still in the debounce window, durably", () => {
  const server = new FakeServer()
  const storage = memoryStorage()
  const e = new SyncEngine({
    http: server,
    storage,
    outbox: createOutbox(storage),
    mappers: [todoMapper],
    online: () => false, // the page is going away; nothing reaches the server
    debounceMs: 60_000,
  })
  e.start((m, onChange) => m.store.subscribe(onChange))
  todoStore.set({
    todos: [{ id: "a", title: "Typed then reloaded", done: false }],
  })
  expect(e.pending()).toBe(0) // still waiting out the debounce
  e.flush()
  e.stop()
  // A fresh engine on the same storage (the reloaded page) still has it.
  const reloaded = engine(server, storage)
  expect(reloaded.pending()).toBe(1)
})

test("undoing this device's delete restores the row instead of conflicting", async () => {
  const server = new FakeServer()
  server.tombstones = true
  const e = engine(server)
  const row = { id: "a", title: "Rest day", done: false }
  todoStore.set({ todos: [row] })
  e.capture()
  await e.sync()
  todoStore.set({ todos: [] }) // delete
  e.capture()
  await e.sync()
  expect(server.dead.has("a")).toBe(true)
  todoStore.set({ todos: [row] }) // undo
  const ops = e.capture()
  expect(ops.map((o) => [o.kind, o.data])).toEqual([
    ["upsert", { deleted_at: null }],
    ["upsert", { title: "Rest day" }],
  ])
  await e.sync()
  expect(e.rejected).toEqual([])
  expect(server.rows.get("a")).toMatchObject({ title: "Rest day" })
  expect(todoStore.get().todos).toEqual([row])
})

test("a brand-new row is never sent a restore", () => {
  const e = engine(new FakeServer())
  todoStore.set({ todos: [{ id: "n", title: "New", done: false }] })
  expect(e.capture().map((o) => o.data)).toEqual([{ title: "New" }])
})

test("re-upload sends every row again to a server that lost them, and no actions", async () => {
  const server = new FakeServer()
  const e = engine(server, memoryStorage(), () => true)
  todoStore.set({
    todos: [
      { id: "a", title: "Pay rent", done: true },
      { id: "b", title: "Buy milk", done: false },
    ],
  })
  e.capture()
  await e.sync()
  // The server is wiped (rows gone, no tombstones): the device still has
  // both and nothing it pulls removes them.
  server.rows.clear()
  server.pushes = []
  expect(e.reupload()).toBe(2)
  await e.sync()
  const sent = server.pushes.flat()
  expect(sent.map((op) => [op.kind, op.id])).toEqual([
    ["upsert", "a"],
    ["upsert", "b"],
  ])
  expect([...server.rows.keys()].sort()).toEqual(["a", "b"])
  expect(todoStore.get().todos).toHaveLength(2)
})
