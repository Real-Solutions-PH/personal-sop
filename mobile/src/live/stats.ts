// Live mode's server statistics: the source behind the shared dashboard
// hooks (shared/prototype/dash/server-stats.ts).
//
// Each key a mounted hook needs is fetched into the persisted ``statsCache``
// and refreshed after every sync (push + pull), when a screen showing it
// regains focus, and whenever it is older than STALE_MS or than the last
// local edit. Only watched keys are fetched. A request is stamped with the
// time it STARTED, so an edit made while it was in flight keeps the local
// value on screen until the next refresh.

import {
  connectStatsSource,
  installStatsFocus,
  type StatEntry,
  type StatsSource,
  statsCache,
} from "@domain/dash/server-stats"
import { type Http, NetworkError } from "./http"

const STALE_MS = 15_000
const PAGE = 100
// Calendar and misses are paged (100 a page). A screen's window is at most
// a year; five pages cover any real one, and a longer list is marked
// ``truncated`` rather than walked to the end.
const MAX_PAGES = 5

interface Spec {
  path: string
  paged?: boolean
}

const q = encodeURIComponent

/** The request behind a cache key, or null for an unknown key. */
export function specFor(key: string): Spec | null {
  const [kind, ...rest] = key.split(":")
  switch (kind) {
    case "overview":
      return { path: `/stats/overview?range=${q(rest[0])}` }
    case "today":
      return { path: "/dashboard/today" }
    case "achievements":
      return { path: "/stats/achievements" }
    case "calendar":
      return {
        path: `/stats/calendar?from=${q(rest[0])}&to=${q(rest[1])}`,
        paged: true,
      }
    case "misses":
      return {
        path: `/stats/misses?from=${q(rest[0])}&to=${q(rest[1])}`,
        paged: true,
      }
    case "metric":
      return { path: `/stats/metrics/${q(rest.join(":"))}` }
    case "series": {
      const days = rest.pop()
      return {
        path: `/stats/series?metric=${q(rest.join(":"))}&days=${q(days ?? "")}`,
      }
    }
    default:
      return null
  }
}

export interface StatsDeps {
  http: Http
  online: () => boolean
  now?: () => number
  /** Every local edit has reached the server (the sync engine's view). A
   * fetch started before that may return figures the edit has not changed
   * yet, so it is kept as stale and the local numbers stay on screen until
   * the refetch after the push. */
  settled?: () => boolean
}

export function createStats(deps: StatsDeps) {
  const now = deps.now ?? Date.now
  const watched = new Map<string, number>()
  const inflight = new Map<string, Promise<void>>()

  const patch = (key: string, p: Partial<StatEntry>) =>
    statsCache.set((s) => ({
      ...s,
      entries: { ...s.entries, [key]: { ...s.entries[key], ...p } },
    }))

  async function fetchPaged(path: string) {
    const rows: unknown[] = []
    let count = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await deps.http.request<{ data: unknown[]; count: number }>(
        "GET",
        `${path}&skip=${page * PAGE}&limit=${PAGE}`,
      )
      rows.push(...res.data)
      count = res.count
      if (rows.length >= count || res.data.length < PAGE) break
    }
    return { rows, truncated: rows.length < count }
  }

  function load(key: string): Promise<void> {
    const running = inflight.get(key)
    if (running) return running
    const spec = specFor(key)
    if (!spec) return Promise.resolve()
    if (!deps.online()) {
      patch(key, { pending: false, error: "offline" })
      return Promise.resolve()
    }
    // Stamped 0 (stale) when an edit was still on its way to the server:
    // its answer may predate that edit.
    const startedAt = deps.settled && !deps.settled() ? 0 : now()
    patch(key, { pending: true })
    const p = (async () => {
      try {
        if (spec.paged) {
          const { rows, truncated } = await fetchPaged(spec.path)
          patch(key, {
            data: rows,
            at: startedAt,
            pending: false,
            error: undefined,
            truncated,
          })
        } else {
          const data = await deps.http.request<unknown>("GET", spec.path)
          patch(key, { data, at: startedAt, pending: false, error: undefined })
        }
      } catch (e) {
        patch(key, {
          pending: false,
          error: e instanceof NetworkError ? "offline" : "failed",
        })
      }
    })().finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }

  const stale = (key: string) => {
    const s = statsCache.get()
    const e = s.entries[key]
    if (e?.data === undefined) return true
    const at = e.at ?? 0
    return now() - at > STALE_MS || at < s.editedAt
  }

  const source: StatsSource = {
    watch(key) {
      watched.set(key, (watched.get(key) ?? 0) + 1)
      if (stale(key)) void load(key)
      return () => {
        const n = (watched.get(key) ?? 1) - 1
        if (n > 0) watched.set(key, n)
        else watched.delete(key)
      }
    },
    touch(key) {
      if (stale(key)) void load(key)
    },
  }

  return {
    source,
    load,
    /** Refetch every watched key (after a sync). */
    refreshAll: () => Promise.all([...watched.keys()].map((k) => load(k))),
    /** A synced store changed on this device. */
    markEdited: () => statsCache.set((s) => ({ ...s, editedAt: now() })),
    /** Serve ``userId``'s statistics; another account's cache is dropped. */
    start(userId: string) {
      if (statsCache.get().owner !== userId)
        statsCache.set({ owner: userId, editedAt: 0, entries: {} })
      connectStatsSource(source)
    },
    stop() {
      connectStatsSource(null)
    },
    watching: () => [...watched.keys()],
  }
}

export type LiveStats = ReturnType<typeof createStats>

/**
 * Refresh on screen focus. Called once at module load of the app's root
 * providers (live mode), before any screen renders.
 */
export function installFocusRefresh() {
  const { useFocusEffect } =
    require("expo-router") as typeof import("expo-router")
  return installStatsFocus(useFocusEffect)
}
