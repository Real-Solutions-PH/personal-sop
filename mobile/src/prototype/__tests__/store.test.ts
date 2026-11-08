import {
  configureStorage,
  createStore,
  retryStoreReads,
} from "../../../../shared/prototype/lib/store"

describe("prototype persistence", () => {
  const values = new Map<string, string>()
  beforeEach(() => {
    values.clear()
    configureStorage({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
      removeItem: (key) => {
        values.delete(key)
      },
    })
  })
  it("loads existing data, preserves new defaults and persists changes across instances", () => {
    values.set("sop-proto:counter", JSON.stringify({ count: 7 }))
    const counter = createStore("counter", () => ({ count: 0, enabled: true }))
    expect(counter.get()).toEqual({ count: 7, enabled: true })
    counter.set((s) => ({ ...s, count: s.count + 1 }))
    expect(createStore("counter", () => ({ count: 0 })).get().count).toBe(8)
    counter.reset()
    expect(counter.get().count).toBe(0)
    expect(values.has("sop-proto:counter")).toBe(false)
  })
  it("recovers from malformed data without overwriting the saved value at startup", () => {
    values.set("sop-proto:broken", "{")
    const onError = jest.fn()
    configureStorage(
      {
        getItem: (key) => values.get(key) ?? null,
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
      onError,
    )
    expect(createStore("broken", () => ({ count: 0 })).get()).toEqual({
      count: 0,
    })
    expect(values.get("sop-proto:broken")).toBe("{")
    expect(onError).toHaveBeenCalled()
  })
  it("keeps edits in memory and reports storage failures", () => {
    const onError = jest.fn()
    configureStorage(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("disk full")
        },
        removeItem: jest.fn(),
      },
      onError,
    )
    const counter = createStore("full", () => ({ count: 0 }))
    counter.set({ count: 2 })
    expect(counter.get().count).toBe(2)
    expect(onError).toHaveBeenCalled()
  })
})

it("rejects malformed collection shapes before a screen reads them", () => {
  const onError = jest.fn()
  configureStorage(
    {
      getItem: () => JSON.stringify({ tasks: null }),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    },
    onError,
  )
  expect(createStore("shape", () => ({ tasks: [] })).get().tasks).toEqual([])
  expect(onError).toHaveBeenCalled()
})
it("retries the latest unsaved edit after storage recovers", () => {
  const writes = new Map<string, string>()
  let offline = true
  configureStorage({
    getItem: () => null,
    setItem: (key, value) => {
      if (offline) throw Error("full")
      writes.set(key, value)
    },
    removeItem: () => {},
  })
  const store = createStore("retry", () => ({ count: 0 }))
  store.set({ count: 4 })
  store.set({ count: 7 })
  offline = false
  expect(store.flush()).toBe(true)
  expect(JSON.parse(writes.get("sop-proto:retry")!)).toEqual({ count: 7 })
})

test("a memory-only store never writes to storage and starts fresh", () => {
  const { configureStorage, createStore } =
    require("@domain/lib/store") as typeof import("@domain/lib/store")
  const saved = new Map<string, string>()
  configureStorage({
    getItem: (k) => saved.get(k) ?? null,
    setItem: (k, v) => void saved.set(k, v),
    removeItem: (k) => void saved.delete(k),
  })
  saved.set("sop-proto:ui-test", JSON.stringify({ open: true }))
  const ui = createStore("ui-test", () => ({ open: false }), { persist: false })
  // A saved "open" from an earlier launch is ignored...
  expect(ui.get().open).toBe(false)
  ui.set({ open: true })
  // ...and this launch's is never saved.
  expect(saved.get("sop-proto:ui-test")).toBe(JSON.stringify({ open: true }))
  ui.set({ open: false })
  expect(saved.get("sop-proto:ui-test")).toBe(JSON.stringify({ open: true }))
})

describe("a saved value the loader cannot read", () => {
  const saved = new Map<string, string>()
  const memory = {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => void saved.set(k, v),
    removeItem: (k: string) => void saved.delete(k),
  }
  beforeEach(() => saved.clear())

  // Build 40: Home's layout store defaults to null ("never edited"). The
  // loader refused every saved value whose default was not an object, so
  // each launch after editing Home raised the storage banner and showed the
  // default card order.
  it("loads a store whose default is null", () => {
    const onError = jest.fn()
    configureStorage(memory, onError)
    const layout = { order: ["goals", "plan"], hidden: ["weather"] }
    saved.set("sop-proto:null-default", JSON.stringify(layout))
    const store = createStore<typeof layout | null>("null-default", () => null)
    expect(store.get()).toEqual(layout)
    expect(onError).not.toHaveBeenCalled()
  })

  it("keeps the unreadable value aside before any edit is saved over it", () => {
    const onError = jest.fn()
    configureStorage(memory, onError)
    saved.set("sop-proto:bad", JSON.stringify({ count: "seven" }))
    const store = createStore("bad", () => ({ count: 0 }))
    expect(store.get()).toEqual({ count: 0 })
    store.set({ count: 1 })
    expect(onError).toHaveBeenCalled()
    expect(saved.get("sop-proto:bad:unreadable")).toBe(
      JSON.stringify({ count: "seven" }),
    )
  })

  it("never writes over saved data it could not read at all", () => {
    const onError = jest.fn()
    let failing = true
    saved.set("sop-proto:busy", JSON.stringify({ count: 9 }))
    configureStorage(
      {
        ...memory,
        getItem: (k) => {
          if (failing) throw new Error("database is locked")
          return memory.getItem(k)
        },
      },
      onError,
    )
    const store = createStore("busy", () => ({ count: 0 }))
    expect(store.get()).toEqual({ count: 0 })
    store.set((s) => ({ ...s, count: s.count + 1 }))
    expect(store.flush()).toBe(false)
    expect(saved.get("sop-proto:busy")).toBe(JSON.stringify({ count: 9 }))
    expect(onError).toHaveBeenCalled()
    // Retry storage: the next read comes from disk, not from the stand-in.
    failing = false
    expect(retryStoreReads()).toBe(true)
    expect(store.get()).toEqual({ count: 9 })
    store.set({ count: 10 })
    expect(store.flush()).toBe(true)
    expect(saved.get("sop-proto:busy")).toBe(JSON.stringify({ count: 10 }))
  })
})
