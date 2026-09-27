"use client"

import { useSyncExternalStore } from "react"

// Prototype mock store (ADR-0009). Each module owns one store created here:
// seeded deterministically, mutated in-session, persisted to localStorage so a
// reload keeps what the owner did during a walkthrough. `resetAll()` restores seeds.
// ponytail: localStorage is the whole "backend"; swap each store's actions for
// API calls when the contract lands.

type Listener = () => void

export interface Store<T> {
  get: () => T
  set: (next: T | ((prev: T) => T)) => void
  /** `select` must return a stored reference or a primitive — derive new
   * arrays/objects with useMemo in the component, or React loops. */
  use: <S>(select: (state: T) => S) => S
  reset: () => void
}

const registry: Store<unknown>[] = []
const PREFIX = "sop-proto:"

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function load<T>(key: string, seed: () => T): T {
  if (typeof window === "undefined") return seed()
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (!raw) return seed()
    const saved = JSON.parse(raw) as T
    const base = seed()
    // Layer saved state over fresh defaults so fields added or renamed since
    // the save still get a value (a missing field rendered as NaN otherwise).
    return isPlainObject(base) && isPlainObject(saved)
      ? ({ ...base, ...saved } as T)
      : saved
  } catch {
    return seed()
  }
}

export function createStore<T>(key: string, seed: () => T): Store<T> {
  let state: T | undefined
  const server = seed()
  const listeners = new Set<Listener>()

  const get = () => {
    if (state === undefined) state = load(key, seed)
    return state
  }
  const emit = () => {
    for (const l of listeners) l()
  }
  const set: Store<T>["set"] = (next) => {
    state =
      typeof next === "function" ? (next as (p: T) => T)(get()) : (next as T)
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(state))
    } catch {
      // storage full / private mode: state still lives for the session
    }
    emit()
  }
  const subscribe = (l: Listener) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }
  const use = <S>(select: (s: T) => S) =>
    useSyncExternalStore(
      subscribe,
      () => select(get()),
      () => select(server),
    )
  const reset = () => {
    try {
      window.localStorage.removeItem(PREFIX + key)
    } catch {}
    state = seed()
    emit()
  }

  const store = { get, set, use, reset }
  registry.push(store as Store<unknown>)
  return store
}

export function resetAll() {
  for (const s of registry) s.reset()
}

/** Short random id for records created in-session. */
export const uid = () => Math.random().toString(36).slice(2, 10)
