import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CalendarItem } from "@domain/contract"
import type { StorageAdapter } from "@domain/lib/store"
import { moveItem, resetItem } from "@domain/schedule/actions"
import { overrideId } from "@domain/schedule/logic"
import { scheduleStore } from "@domain/schedule/store"
import { SyncEngine } from "../engine"
import type { Http } from "../http"
import { scheduleMappers, scheduleOverrideMapper } from "../mappers/schedule"
import { createOutbox, type SyncOp } from "../outbox"

const H = "8f5e2c1a-0b7d-4c3e-9a21-6d4f0e8b2a10"
const DAY = "2026-11-12"
const item: CalendarItem = {
  id: `habit-${H}-${DAY}`,
  day: DAY,
  time: "09:00",
  title: "Read",
  module: "habits",
  href: `/habits/${H}`,
}

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}
const noHttp: Http = {
  request: async () => {
    throw new Error("unused")
  },
  raw: async () => {
    throw new Error("unused")
  },
}
function engine() {
  const storage = memoryStorage()
  return new SyncEngine({
    http: noHttp,
    storage,
    outbox: createOutbox(storage),
    mappers: scheduleMappers(),
    online: () => false,
  })
}

// Every op, for the backend's wire-format check (tests/modules/schedule).
const wire: (Omit<SyncOp, "op_id" | "at"> & { create?: boolean })[] = []

beforeEach(() => scheduleStore.reset())

afterAll(() => {
  const dir = join(__dirname, "fixtures")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "schedule-wire.json"),
    `${JSON.stringify(wire, null, 2)}\n`,
  )
})

it("a move is one create; a second move sends only the time; a reset deletes", () => {
  const e = engine()
  e.capture()
  moveItem(item, "14:30")
  const [create] = e.capture()
  expect(create).toMatchObject({
    kind: "upsert",
    name: "schedule_override",
    id: overrideId("habit", H, DAY),
    data: { kind: "habit", ref_id: H, day: DAY, time: "14:30" },
  })
  wire.push({ ...strip(create), create: true })
  moveItem({ ...item, time: "14:30", movedFrom: "09:00" }, "16:00")
  const [edit] = e.capture()
  expect(edit).toMatchObject({ kind: "upsert", data: { time: "16:00" } })
  wire.push({ ...strip(edit), create: false })
  resetItem(item)
  const [del] = e.capture()
  expect(del).toMatchObject({ kind: "delete", id: overrideId("habit", H, DAY) })
  wire.push(strip(del))
})

it("a pulled row replaces this phone's row for the same item and day", () => {
  moveItem(item, "14:30")
  const m = scheduleOverrideMapper()
  const pulled = m.fromServer(
    {
      id: "srv-1",
      kind: "habit",
      ref_id: H,
      day: DAY,
      time: "07:00",
    },
    scheduleStore.get(),
  )
  expect(pulled).not.toBeNull()
  const next = m.merge(scheduleStore.get(), [pulled!], [])
  expect(next.overrides).toEqual([
    { id: "srv-1", kind: "habit", refId: H, day: DAY, time: "07:00" },
  ])
  expect(m.merge(next, [], ["srv-1"]).overrides).toEqual([])
  expect(
    m.fromServer(
      { id: "x", kind: "meal", ref_id: H, day: DAY, time: "07:00" },
      next,
    ),
  ).toBeNull()
})

function strip(op: SyncOp) {
  // No op id or clock: the fixture stays byte-stable across runs.
  const { op_id: _o, at: _a, ...rest } = op
  return rest
}
