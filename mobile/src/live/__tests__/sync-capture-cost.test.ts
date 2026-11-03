// The capture after a tap does work in proportion to what the tap changed,
// not to everything the device holds: other stores' entities are not
// diffed, unchanged rows of a long history are not serialised, and only
// the entities that moved are written back to storage.

import { createStore, type StorageAdapter } from "@domain/lib/store"
import { forgetSyncState, SyncEngine } from "../engine"
import type { Http } from "../http"
import type { Mapper } from "../mapper"
import { createOutbox } from "../outbox"

function memoryStorage() {
  const m = new Map<string, string>()
  const writes: string[] = []
  const adapter: StorageAdapter = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      writes.push(k)
      m.set(k, v)
    },
    removeItem: (k) => void m.delete(k),
  }
  return { adapter, writes, m }
}

interface Row {
  id: string
  v: number
}
interface S {
  rows: Row[]
}
const offline: Http = {
  request: async () => {
    throw new Error("offline")
  },
  raw: async () => {
    throw new Error("offline")
  },
}

let n = 0
function setup(opts: { pure?: boolean; a?: Partial<Mapper<S, Row>> } = {}) {
  n += 1
  const a = createStore<S>(`cost-a-${n}`, () => ({ rows: [] }))
  const b = createStore<S>(`cost-b-${n}`, () => ({ rows: [] }))
  const flag = createStore<{ on: boolean }>(`cost-flag-${n}`, () => ({
    on: false,
  }))
  const toServer = jest.fn((r: Row) => ({ v: r.v }))
  const mapper = (
    entity: string,
    store: typeof a,
    extra: Partial<Mapper<S, Row>> = {},
  ): Mapper<S, Row> => ({
    entity,
    store,
    list: (s) => s.rows,
    id: (r) => r.id,
    toServer,
    fromServer: (row) => ({ id: String(row.id), v: Number(row.v) }),
    merge: (s, ups) => ({
      rows: [...s.rows.filter((r) => !ups.some((u) => u.id === r.id)), ...ups],
    }),
    ...extra,
  })
  const listB = jest.fn((s: S) => s.rows)
  // Reads another store while it diffs, as a run reads the Live bar.
  const crossList = jest.fn((s: S) =>
    flag.get().on ? s.rows.map((r) => ({ ...r, v: r.v + 100 })) : s.rows,
  )
  const mappers = [
    mapper("ent_a", a, { pureRows: opts.pure, ...opts.a }),
    mapper("ent_b", b, { list: listB }),
    mapper("ent_cross", b, { list: crossList }),
  ]
  const storage = memoryStorage()
  const outbox = createOutbox(storage.adapter)
  const engine = new SyncEngine({
    http: offline,
    storage: storage.adapter,
    outbox,
    mappers,
    online: () => false,
  })
  return { a, b, flag, engine, outbox, storage, toServer, listB, crossList }
}

const rows = (count: number, v = 0) =>
  Array.from({ length: count }, (_, i) => ({ id: `r${i}`, v }))

test("a change to one store diffs only the entities that read it", () => {
  const t = setup()
  t.a.set({ rows: rows(3) })
  t.b.set({ rows: rows(3) })
  t.engine.capture()
  t.listB.mockClear()
  t.crossList.mockClear()
  t.a.set((s) => ({ rows: [...s.rows, { id: "new", v: 1 }] }))
  const ops = t.engine.capture()
  expect(ops.map((o) => [o.name, o.id])).toEqual([["ent_a", "new"]])
  expect(t.listB).not.toHaveBeenCalled()
  expect(t.crossList).not.toHaveBeenCalled()
})

test("an entity that reads another store is diffed when that store changes", () => {
  const t = setup()
  t.b.set({ rows: rows(2) })
  t.engine.capture()
  t.flag.set({ on: true })
  const ops = t.engine.capture()
  expect(ops.filter((o) => o.name === "ent_cross").map((o) => o.data)).toEqual([
    { v: 100 },
    { v: 100 },
  ])
  // The other entity on that store did not read the flag.
  expect(ops.some((o) => o.name === "ent_b")).toBe(false)
})

test("unchanged rows of a pure entity are not serialised again", () => {
  const t = setup({ pure: true })
  t.a.set({ rows: rows(500) })
  t.engine.capture()
  t.toServer.mockClear()
  t.a.set((s) => ({
    rows: s.rows.map((r) => (r.id === "r7" ? { ...r, v: 9 } : r)),
  }))
  const ops = t.engine.capture()
  expect(ops.map((o) => [o.id, o.data])).toEqual([["r7", { v: 9 }]])
  // The changed row, plus once more for its new snapshot.
  expect(t.toServer).toHaveBeenCalledTimes(2)
})

test("a pure row a pull moved on is compared again on the next diff", () => {
  // A merge that keeps the device's rows as they are (the very objects),
  // while the snapshot takes the server's value.
  const t = setup({ pure: true, a: { merge: (s) => s } })
  t.a.set({ rows: rows(2) })
  // Pushed and answered: nothing of this device's is waiting any more.
  t.outbox.ack(t.engine.capture().map((o) => o.op_id))
  t.engine.apply([
    {
      entity: "ent_a",
      id: "r1",
      version: 2,
      deleted: false,
      row: { id: "r1", v: 5 },
    },
  ])
  expect(t.a.get().rows.find((r) => r.id === "r1")?.v).toBe(0)
  // The device's row differs from what the server now holds, so the next
  // diff sends it, though the row is the same object as before the pull.
  const ops = t.engine.capture()
  expect(ops.map((o) => [o.id, o.data])).toEqual([["r1", { v: 0 }]])
})

test("only the entities that changed are written back", () => {
  const t = setup({ pure: true })
  t.a.set({ rows: rows(3) })
  t.b.set({ rows: rows(3) })
  t.engine.capture()
  t.storage.writes.length = 0
  t.a.set((s) => ({ rows: [...s.rows, { id: "x", v: 1 }] }))
  t.engine.capture()
  const entityWrites = t.storage.writes.filter((k) =>
    /^sop-live:(snapshot|previous):/.test(k),
  )
  expect(entityWrites.sort()).toEqual([
    "sop-live:previous:ent_a",
    "sop-live:snapshot:ent_a",
  ])
})

test("state saved in the single-key format is read and rewritten per entity", () => {
  const storage = memoryStorage()
  const store = createStore<S>(`cost-legacy-${++n}`, () => ({
    rows: [{ id: "r0", v: 1 }],
  }))
  storage.adapter.setItem(
    "sop-live:snapshot",
    JSON.stringify({ ent_l: { r0: { v: 1 } } }),
  )
  storage.adapter.setItem(
    "sop-live:previous",
    JSON.stringify({ ent_l: { r0: { id: "r0", v: 1 } } }),
  )
  const m: Mapper<S, Row> = {
    entity: "ent_l",
    store,
    list: (s) => s.rows,
    id: (r) => r.id,
    toServer: (r) => ({ v: r.v }),
    fromServer: (row) => ({ id: String(row.id), v: Number(row.v) }),
    merge: (s) => s,
  }
  const engine = new SyncEngine({
    http: offline,
    storage: storage.adapter,
    outbox: createOutbox(storage.adapter),
    mappers: [m],
    online: () => false,
  })
  // What the old build had synced is not sent again.
  expect(engine.capture()).toEqual([])
  expect(storage.m.has("sop-live:snapshot")).toBe(false)
  expect(storage.m.has("sop-live:previous")).toBe(false)
  expect(JSON.parse(storage.m.get("sop-live:snapshot:ent_l") ?? "")).toEqual({
    r0: { v: 1 },
  })
  forgetSyncState(storage.adapter)
  expect(
    [...storage.m.keys()].filter((k) => k.startsWith("sop-live:")),
  ).toEqual([])
})
