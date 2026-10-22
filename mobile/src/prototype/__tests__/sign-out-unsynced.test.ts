// Live mode: signing out clears the device only once every queued change
// reached the server. Offline, or when the push fails, the changes stay and
// the person is told how many are waiting; only an explicit discard drops
// them.
import { createStore, type StorageAdapter } from "@domain/lib/store"
import { SyncEngine } from "@/live/engine"
import { type Http, NetworkError } from "@/live/http"
import type { Mapper } from "@/live/mapper"
import { createOutbox } from "@/live/outbox"

jest.mock("@/live/config", () => ({
  liveMode: true,
  API_URL: "http://api.test",
  API_PREFIX: "/api/v1",
}))
const mockAuthSignOut = jest.fn(() => Promise.resolve())
jest.mock("@/live/auth", () => ({ signOut: () => mockAuthSignOut() }))
jest.mock("@/live/blank", () => ({ clearToBlank: () => {} }))
let mockEngine: SyncEngine | null = null
const mockStopLive = jest.fn()
jest.mock("@/live/runtime", () => ({
  engine: () => mockEngine,
  stopLive: () => mockStopLive(),
}))
const mockKeys = new Map<string, string>()
const storage: StorageAdapter = {
  getItem: (k) => mockKeys.get(k) ?? null,
  setItem: (k, v) => void mockKeys.set(k, v),
  removeItem: (k) => void mockKeys.delete(k),
}
jest.mock("../storage", () => ({ prototypeStorage: () => storage }))

const { signOut, sessionStore, unsyncedChanges } =
  require("../session") as typeof import("../session")

interface Note {
  id: string
  text: string
}
const notes = createStore<{ notes: Note[] }>("test-notes", () => ({
  notes: [],
}))
const mapper: Mapper<{ notes: Note[] }, Note> = {
  entity: "note",
  store: notes,
  list: (s) => s.notes,
  id: (n) => n.id,
  toServer: (n) => ({ text: n.text }),
  fromServer: (row) => ({ id: String(row.id), text: String(row.text) }),
  merge: (s) => s,
}

let online = true
let down = false
const http: Http = {
  async request<T>(_method: string, path: string): Promise<T> {
    if (down) throw new NetworkError("unreachable")
    if (path === "/sync/push") return { results: [] } as T
    return { changes: [], cursor: 0, truncated: false } as T
  },
  raw: () => Promise.reject(new Error("unused")),
}

beforeEach(() => {
  jest.useFakeTimers()
  mockKeys.clear()
  mockStopLive.mockReset()
  mockAuthSignOut.mockClear()
  online = true
  down = false
  notes.set({ notes: [] })
  const outbox = createOutbox(storage)
  mockEngine = new SyncEngine({
    http: {
      ...http,
      // The fake server acknowledges every op it is sent.
      async request<T>(method: string, path: string, body?: unknown) {
        if (down) throw new NetworkError("unreachable")
        if (path === "/sync/push")
          return {
            results: (body as { ops: { op_id: string }[] }).ops.map((o) => ({
              op_id: o.op_id,
              status: "applied",
            })),
          } as T
        return http.request<T>(method, path)
      },
    },
    storage,
    outbox,
    mappers: [mapper],
    online: () => online,
  })
  storage.setItem("sop-live:owner", "u1")
  sessionStore.set((s) => ({
    ...s,
    signedIn: true,
    user: { name: "Kai", username: "kai", email: "kai@example.com" },
  }))
})
afterEach(() => jest.useRealTimers())

const edit = () => {
  notes.set({ notes: [{ id: "n1", text: "written offline" }] })
  mockEngine?.capture()
}

test("offline: keeps the outbox and the session, and reports the count", async () => {
  edit()
  online = false
  const result = await signOut()
  expect(result).toEqual({ ok: false, unsynced: 1 })
  expect(sessionStore.get().signedIn).toBe(true)
  expect(JSON.parse(mockKeys.get("sop-live:outbox") ?? "[]")).toHaveLength(1)
  expect(mockKeys.get("sop-live:owner")).toBe("u1")
  expect(mockStopLive).not.toHaveBeenCalled()
  expect(mockAuthSignOut).not.toHaveBeenCalled()
})

test("a push that fails on the network keeps everything too", async () => {
  edit()
  down = true
  const result = await signOut()
  expect(result).toEqual({ ok: false, unsynced: 1 })
  expect(sessionStore.get().signedIn).toBe(true)
  expect(mockKeys.has("sop-live:outbox")).toBe(true)
})

test("an edit still inside the debounce window counts as unsynced", async () => {
  online = false
  notes.set({ notes: [{ id: "n2", text: "just typed" }] })
  mockEngine?.schedule()
  expect(unsyncedChanges()).toBe(1)
  expect((await signOut()).ok).toBe(false)
})

test("discard signs out and clears the device", async () => {
  edit()
  online = false
  expect(await signOut({ discard: true })).toEqual({ ok: true })
  expect(sessionStore.get().signedIn).toBe(false)
  expect(mockKeys.has("sop-live:outbox")).toBe(false)
  expect(mockKeys.has("sop-live:owner")).toBe(false)
  expect(mockStopLive).toHaveBeenCalled()
  expect(mockAuthSignOut).toHaveBeenCalled()
})

test("online: pushes first, then clears the device", async () => {
  edit()
  expect(await signOut()).toEqual({ ok: true })
  expect(sessionStore.get().signedIn).toBe(false)
  expect(mockKeys.has("sop-live:outbox")).toBe(false)
})

test("no engine (offline launch): counts the persisted outbox", async () => {
  mockEngine = null
  mockKeys.set("sop-live:outbox", '[{"op_id":"a"},{"op_id":"b"}]')
  expect(await signOut()).toEqual({ ok: false, unsynced: 2 })
  expect(mockKeys.get("sop-live:outbox")).toBe('[{"op_id":"a"},{"op_id":"b"}]')
})
