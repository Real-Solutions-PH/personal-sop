import type { StorageAdapter } from "@domain/lib/store"
import type { ServerEvent } from "../events"

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"

// startLive with its network seams replaced: a recording http, an event
// stream whose handler the test drives, push registration stubbed.
const requests: string[] = []
let onEvent: ((e: ServerEvent) => void) | null = null
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }))
jest.mock("../auth", () => ({
  tokens: { current: async () => "t", refresh: async () => "t" },
  http: {
    request: async (method: string, path: string) => {
      requests.push(`${method} ${path}`)
      if (path === "/sync/push") return { results: [] }
      if (path.startsWith("/sync/pull"))
        return { changes: [], cursor: 0, truncated: false }
      return {}
    },
    raw: async () => {
      throw new Error("unused")
    },
  },
}))
jest.mock("../events", () => ({
  runEventStream: (deps: { onEvent: (e: ServerEvent) => void }) => {
    onEvent = deps.onEvent
    return { stop: async () => {} }
  },
}))
jest.mock("../push", () => ({ registerPushDevice: jest.fn(async () => null) }))
jest.mock("@domain/lib/platform", () => ({
  ...jest.requireActual("@domain/lib/platform"),
  getConnectivity: () => true,
}))

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

// A failing assertion must not leave startLive's interval keeping jest alive.
afterEach(() => {
  ;(require("../runtime") as typeof import("../runtime")).stopLive()
})

test("runtime registers the dash mappers, push and pulls on a notification", async () => {
  const rt = require("../runtime") as typeof import("../runtime")
  const push = require("../push") as typeof import("../push")
  const e = rt.startLive(USER, memoryStorage())
  const entities = (
    e as unknown as { deps: { mappers: { entity: string }[] } }
  ).deps.mappers.map((m) => m.entity)
  expect(entities).toEqual(
    expect.arrayContaining([
      "profile",
      "identity",
      "setup_skip",
      "goal",
      "review",
      "wrap_up",
      "miss_note",
      "notification",
      "share_default",
    ]),
  )
  expect(push.registerPushDevice).toHaveBeenCalledTimes(1)
  await flush()
  const pulls = () => requests.filter((r) => r.includes("/sync/pull")).length
  const before = pulls()
  expect(before).toBeGreaterThan(0)
  onEvent?.({ id: "1", type: "chat.message", data: {} })
  await flush()
  expect(pulls()).toBe(before)
  // A watched statistic is refetched after every sync.
  rt.liveStats()?.source.watch("today")
  await flush()
  const todays = () => requests.filter((r) => r === "GET /dashboard/today")
  expect(todays()).toHaveLength(1)
  onEvent?.({ id: "2", type: "dashboard.notification", data: {} })
  await flush()
  expect(pulls()).toBe(before + 1)
  expect(todays()).toHaveLength(2)
  expect(rt.liveStats()).not.toBeNull()
  rt.stopLive()
  expect(rt.liveStats()).toBeNull()
})

test("a brand-new account is ready at once; a new device waits for its pull", () => {
  const rt = require("../runtime") as typeof import("../runtime")
  const { syncReady } = require("../ready") as typeof import("../ready")
  rt.startLive(USER, memoryStorage(), true)
  expect(syncReady.getState().ready).toBe(true)
  rt.stopLive()
  rt.startLive(USER, memoryStorage())
  expect(syncReady.getState().ready).toBe(false)
})
