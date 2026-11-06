// Fern's short read of yesterday's misses (POST
// /dashboard/misses/yesterday/analysis). Asked for when the Yesterday page
// opens, never on a schedule. The server keeps the answer for the day, so a
// reopen costs no model call; this keyed query also keeps it for the session.

import { useQuery } from "@tanstack/react-query"

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

export const yesterdayAnalysisKey = (day: string) => [
  "dashboard",
  "yesterday-analysis",
  day,
]

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
    gcTime: 30 * 60_000,
  })
}
