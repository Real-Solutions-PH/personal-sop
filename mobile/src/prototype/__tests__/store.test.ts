import {
  configureStorage,
  createStore,
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
