import { useMemo } from "react"
import { dayKey } from "./day"

// Derived statistics (rates, metrics, calendars over months of history) are
// worked out from a store's whole state. A `useMemo` keeps the result only
// while its component is mounted, and every tab switch mounts the screen
// again, so the same numbers were recomputed on each visit. These caches
// outlive the component: an entry is reused while its inputs are the very
// same values (a store state is replaced on every change) on the same day
// (several results read "today").

interface Entry {
  deps: readonly unknown[]
  day: string
  value: unknown
}
const caches = new Map<string, Entry[]>()
// Per name: enough for the ranges a screen asks for at once (7, 30, 90,
// 365 days, and each one's previous period).
const SIZE = 12

const same = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

/** `fn()` for these inputs, from the cache when they are unchanged. The
 * first input is the store state the result is derived from. */
export function sharedMemo<T>(
  name: string,
  fn: () => T,
  deps: readonly unknown[],
): T {
  const day = dayKey()
  const list = caches.get(name) ?? []
  const hit = list.find((e) => e.day === day && same(e.deps, deps))
  if (hit) return hit.value as T
  const value = fn()
  // Results for an older state (the first input) are dropped: they can never
  // be asked for again, and each would keep a whole old copy of a store.
  const kept = list.filter(
    (e) => e.day === day && Object.is(e.deps[0], deps[0]),
  )
  kept.unshift({ deps, day, value })
  if (kept.length > SIZE) kept.length = SIZE
  caches.set(name, kept)
  return value
}

/** `useMemo` whose result survives the component: a screen mounted again
 * with the same store state gets the numbers it had, without recomputing. */
export function useSharedMemo<T>(
  name: string,
  fn: () => T,
  deps: readonly unknown[],
): T {
  return useMemo(() => sharedMemo(name, fn, deps), deps)
}

/** Forget every cached result (tests; an account switch). */
export function clearSharedMemo() {
  caches.clear()
}
