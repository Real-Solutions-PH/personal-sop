import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useReducer,
  useSyncExternalStore,
} from "react"
export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
export interface Store<T> {
  get(): T
  set(next: T | ((previous: T) => T)): void
  use<S>(select: (state: T) => S): S
  reset(): void
  flush(): boolean
  /** Plain (non-React) change subscription; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}
const browserStorage: StorageAdapter = {
  getItem: (key) =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: (key, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value)
  },
  removeItem: (key) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(key)
  },
}
let storage = browserStorage
let report: (error: unknown) => void = () => {}
let defer: ((write: () => void) => void) | null = null
export function configureStorage(
  adapter: StorageAdapter,
  onError: (error: unknown) => void = () => {},
  opts: {
    /** Writes a change later instead of inside `set`. A store is the whole
     * domain serialised, so writing it on every tick blocks the tap that
     * made the change; memory stays the source of truth meanwhile, and
     * `flushStores` writes anything still waiting (call it on background). */
    defer?: (write: () => void) => void
  } = {},
) {
  storage = adapter
  report = onError
  defer = opts.defer ?? null
}
const registry: Array<{
  key: string
  get(): unknown
  reset(): void
  flush(): boolean
}> = []
/** Inside a provider set to true, `store.use` re-renders for a change in a
 * transition instead of with it: for read-only summaries (a year of
 * statistics) that must not hold up the tap that changed the store. The tap's
 * own control re-renders first and is painted; the summary follows, and React
 * sets its render aside for the next tap. */
export const LaggingReads = createContext(false)
const ignore = () => () => {}

// Stores read while `trackReads` runs (null: not tracking).
let reads: Set<string> | null = null
/** Runs `fn` and returns the keys of every store it read. For work derived
 * from several stores (the sync engine's diff), so it can be skipped while
 * none of them changed. */
export function trackReads<T>(fn: () => T): { value: T; keys: Set<string> } {
  const outer = reads
  const keys = new Set<string>()
  reads = keys
  try {
    return { value: fn(), keys }
  } finally {
    reads = outer
    if (outer) for (const k of keys) outer.add(k)
  }
}
/** A store's current state by key (undefined for an unknown key). */
export function storeState(key: string): unknown {
  return registry.find((store) => store.key === key)?.get()
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
export function createStore<T>(
  key: string,
  seed: () => T,
  opts: {
    /** false: kept in memory only. For screen state (a sheet or drawer
     * being open) that must not come back on the next launch. */
    persist?: boolean
    /** Brings state saved by an older build up to the current shape (a
     * nested record that gained a key, a renamed reference). */
    upgrade?: (saved: T) => T
  } = {},
): Store<T> {
  const storageKey = `sop-proto:${key}`
  const persist = opts.persist !== false
  let state: T | undefined
  let pending: "set" | "remove" | null = null
  let queued = false
  const server = seed()
  const listeners = new Set<() => void>()
  const get = (): T => {
    reads?.add(key)
    if (state !== undefined) return state
    const defaults = seed()
    try {
      const raw = persist ? storage.getItem(storageKey) : null
      if (raw !== null) {
        const saved: unknown = JSON.parse(raw)
        if (!isObject(saved) || !isObject(defaults))
          throw new Error(`Invalid saved state: ${key}`)
        for (const [field, value] of Object.entries(defaults)) {
          const previous = saved[field]
          if (previous === undefined || value === null) continue
          if (
            (Array.isArray(value) && !Array.isArray(previous)) ||
            (isObject(value) && !isObject(previous)) ||
            (!Array.isArray(value) &&
              !isObject(value) &&
              typeof value !== typeof previous)
          ) {
            throw new Error(`Invalid saved field: ${key}.${field}`)
          }
        }
        state = { ...defaults, ...saved } as T
        if (opts.upgrade) state = opts.upgrade(state)
      }
    } catch (error) {
      report(error)
    }
    state ??= defaults
    return state
  }
  const emit = () => {
    for (const listener of listeners) listener()
  }
  const set: Store<T>["set"] = (next) => {
    state =
      typeof next === "function" ? (next as (previous: T) => T)(get()) : next
    pending = "set"
    if (!defer) flush()
    else if (!queued) {
      queued = true
      defer(() => {
        queued = false
        flush()
      })
    }
    emit()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const use = <S>(select: (value: T) => S) => {
    const lagging = useContext(LaggingReads)
    const [, refresh] = useReducer((n: number) => n + 1, 0)
    useEffect(
      () =>
        lagging ? subscribe(() => startTransition(() => refresh())) : undefined,
      [lagging],
    )
    return useSyncExternalStore(
      lagging ? ignore : subscribe,
      () => select(get()),
      () => select(server),
    )
  }
  const flush = () => {
    if (!pending) return true
    if (!persist) {
      pending = null
      return true
    }
    try {
      if (pending === "remove") storage.removeItem(storageKey)
      else storage.setItem(storageKey, JSON.stringify(state))
      pending = null
      return true
    } catch (error) {
      report(error)
      return false
    }
  }
  const reset = () => {
    state = seed()
    // A waiting write (its timer may never fire, e.g. a test's fake clock)
    // must not keep the next change from scheduling its own.
    queued = false
    pending = "remove"
    flush()
    emit()
  }
  const store = { get, set, use, reset, flush, subscribe }
  registry.push({ key, get, reset, flush })
  return store
}
export function flushStores() {
  return registry.map((store) => store.flush()).every(Boolean)
}
export function resetAll() {
  for (const store of registry) store.reset()
}
/** Every store's current state by key, for "Export my data". */
export function snapshotStores(
  exclude: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const store of registry)
    if (!exclude.includes(store.key)) out[store.key] = store.get()
  return out
}
// UUID v4: the backend accepts device-minted ids (ADR-0011), so every row
// created on the device keeps its id through sync.
export { newId as uid } from "./ids"
