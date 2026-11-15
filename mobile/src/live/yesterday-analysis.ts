// Fern's short read of yesterday's misses (POST
// /dashboard/misses/yesterday/analysis). Asked for in the background once a
// day, after the app opens or comes back to the foreground and a sync has
// reached the server (prewarmYesterdayAnalysis, called from the runtime's
// onSynced), so the Yesterday page finds it ready. The page's own query is
// the fallback: it shares the same key, so it reuses the prewarmed answer or
// the request still in flight instead of asking again. The server keeps the
// answer for the day, so even a second ask costs no model call.

import {
  missesFrom,
  type ServerMiss,
  statKey,
  statsCache,
} from "@domain/dash/server-stats"
import { dayOffset } from "@domain/lib/day"
import { type QueryClient, useQuery } from "@tanstack/react-query"

export interface YesterdayAnalysis {
  day: string
  /** ``celebrate`` when nothing slipped (``points`` is empty). */
  state: "celebrate" | "analysis"
  /** ``fern`` the model; ``rules`` AI off or no model (a read of the data). */
  source: "fern" | "rules" | "none"
  points: string[]
  misses: number
  due: number
  done: number
  on_target: boolean
}

/** One model call: longer than an ordinary request. */
const ANALYSIS_TIMEOUT_MS = 45_000
/** Kept for the whole day, page shown or not: a prewarmed answer must
 * outlive the hours before the person opens the page. */
const ANALYSIS_GC_MS = 26 * 60 * 60_000

export async function fetchYesterdayAnalysis(): Promise<YesterdayAnalysis> {
  // Loaded on use, so prototype mode never builds auth.
  const auth = require("./auth") as typeof import("./auth")
  return auth.http.request(
    "POST",
    "/dashboard/misses/yesterday/analysis",
    undefined,
    { timeoutMs: ANALYSIS_TIMEOUT_MS },
  )
}

const ROOT = ["dashboard", "yesterday-analysis"] as const

export const yesterdayAnalysisKey = (day: string) => [...ROOT, day]

/** Off (never pending) when ``enabled`` is false. No automatic retry: a
 * failure settles as the page's error state at once, and its Try again
 * asks again. */
export function useYesterdayAnalysis(day: string, enabled: boolean) {
  return useQuery({
    queryKey: yesterdayAnalysisKey(day),
    queryFn: fetchYesterdayAnalysis,
    enabled,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: ANALYSIS_GC_MS,
  })
}

// ------------------------------------------------------------ prewarm

let client: QueryClient | null = null
/** The account and day already prewarmed (or being prewarmed). */
let warmed: { owner: string; day: string } | null = null

/** Live mode: the app's query client, the one the page reads. */
export function installYesterdayPrewarm(c: QueryClient | null) {
  client = c
}

/** Sync stopped (sign out, session lost): forget the account's read so the
 * next account never sees it. */
export function resetYesterdayPrewarm() {
  warmed = null
  client?.removeQueries({ queryKey: [...ROOT] })
}

export interface PrewarmDeps {
  /** The signed-in account. */
  owner: string
  online: () => boolean
  /** Fetches a server statistic into ``statsCache`` (the runtime's
   * ``stats.load``). */
  loadMisses: (key: string) => Promise<void>
  now?: Date
}

export type PrewarmResult = "warmed" | "nothing" | "skipped"

/**
 * Asks for yesterday's read in the background, at most once per account per
 * day (yesterday as the app counts it: days roll over at 04:00). First loads
 * the misses window the Yesterday page lists (so the list is warm too); when
 * nothing slipped yesterday there is nothing to read and no request is made.
 * Offline, or with no query client, it waits for the next sync.
 *
 * AI off or the spend cap reached is the server's call: it answers with a
 * rules-based read and no model call, so the client does not gate on it.
 */
export async function prewarmYesterdayAnalysis(
  deps: PrewarmDeps,
): Promise<PrewarmResult> {
  const c = client
  if (!c || !deps.online()) return "skipped"
  const now = deps.now ?? new Date()
  const day = dayOffset(-1, now)
  if (warmed?.owner === deps.owner && warmed.day === day) return "skipped"
  if (warmed && warmed.owner !== deps.owner)
    c.removeQueries({ queryKey: [...ROOT] })
  // Claimed before the first await: a second sync landing meanwhile is a
  // no-op instead of a second request.
  const claim = { owner: deps.owner, day }
  warmed = claim
  // Yesterday's read only: earlier days are never shown again.
  c.removeQueries({
    queryKey: [...ROOT],
    predicate: (q) => q.queryKey[2] !== day,
  })
  const key = statKey.misses(dayOffset(-7, now), day)
  await deps.loadMisses(key)
  const rows = statsCache.get().entries[key]?.data as ServerMiss[] | undefined
  if (!Array.isArray(rows)) {
    // The list did not load: try again on the next sync.
    if (warmed === claim) warmed = null
    return "skipped"
  }
  if (!missesFrom(rows).some((m) => m.day === day)) return "nothing"
  if (warmed !== claim) return "skipped"
  // Shares the page's key: a page opened meanwhile joins this request, and
  // one opened later reads the answer. A failure is left as the query's
  // error, which the page retries when it mounts.
  await c.prefetchQuery({
    queryKey: yesterdayAnalysisKey(day),
    queryFn: fetchYesterdayAnalysis,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: ANALYSIS_GC_MS,
  })
  return "warmed"
}
