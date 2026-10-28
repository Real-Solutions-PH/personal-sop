// A brand-new account gets the gym library and splits after its first
// sync, even when that pull is empty (cursor 0), exactly once per device,
// and the rows reach the server as ordinary creates.
import { STARTER_EXERCISES, STARTER_SPLITS } from "@domain/fitness/starter"
import { fitStore } from "@domain/fitness/store"
import type { StorageAdapter } from "@domain/lib/store"
import type { SyncOp } from "../outbox"

const USER = "4c9e2b1a-7d3f-4e8a-9b2c-1f0e6d5a3b47"
const mockPushed: SyncOp[] = []
let mockOnline = true

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }))
jest.mock("../events", () => ({
  runEventStream: () => ({ stop: async () => {} }),
}))
jest.mock("../social", () => ({ startSocialLive: () => () => {} }))
jest.mock("../push", () => ({ registerPushDevice: async () => {} }))
jest.mock("../journal-audio", () => ({ transcribePending: async () => {} }))
jest.mock("@domain/lib/platform", () => ({
  ...jest.requireActual("@domain/lib/platform"),
  getConnectivity: () => mockOnline,
}))
jest.mock("../auth", () => ({
  tokens: { current: async () => "t", refresh: async () => {} },
  http: {
    request: async (method: string, path: string, body?: { ops: SyncOp[] }) => {
      if (method === "POST" && path === "/sync/push") {
        mockPushed.push(...(body?.ops ?? []))
        return {
          results: (body?.ops ?? []).map((o) => ({
            op_id: o.op_id,
            status: "applied",
          })),
        }
      }
      if (path.startsWith("/sync/pull"))
        return { changes: [], cursor: 0, truncated: false }
      return {}
    },
    raw: async () => {
      throw new Error("unused")
    },
  },
}))

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

afterEach(() => {
  ;(require("../runtime") as typeof import("../runtime")).stopLive()
})

test("an empty first pull still installs the starter, once, and pushes it", async () => {
  const rt = require("../runtime") as typeof import("../runtime")
  const storage = memoryStorage()
  const e = rt.startLive(USER, storage)
  await e.sync()
  const s = fitStore.get()
  expect(s.exercises).toHaveLength(STARTER_EXERCISES.length)
  expect(s.templates).toHaveLength(STARTER_SPLITS.length)
  // The starter rows go up on the next push.
  e.flush()
  await e.sync()
  const creates = (entity: string) =>
    new Set(
      mockPushed
        .filter((o) => o.kind === "upsert" && o.name === entity)
        .map((o) => o.id),
    )
  expect(creates("exercise").size).toBe(STARTER_EXERCISES.length)
  expect(creates("workout_template").size).toBe(STARTER_SPLITS.length)
  expect(creates("template_item").size).toBeGreaterThan(
    STARTER_SPLITS.length * 4,
  )

  // A split the person deletes stays deleted across later syncs.
  fitStore.set((st) => ({ ...st, templates: st.templates.slice(1) }))
  await e.sync()
  await e.sync()
  expect(fitStore.get().templates).toHaveLength(STARTER_SPLITS.length - 1)
})

test("offline, nothing is installed until a sync reaches the server", async () => {
  mockOnline = false
  const rt = require("../runtime") as typeof import("../runtime")
  const storage = memoryStorage()
  const e = rt.startLive("1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a80", storage)
  await e.sync()
  expect(fitStore.get().exercises).toHaveLength(0)
  mockOnline = true
  await e.sync()
  expect(fitStore.get().exercises).toHaveLength(STARTER_EXERCISES.length)
})
