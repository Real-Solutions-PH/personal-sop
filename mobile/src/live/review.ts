// Fern's review of a range (POST /companion/review): the way back after
// missed days, or a week on demand. The server keeps the answer per range
// until its facts change, so a reopen costs no model call; this keyed query
// also keeps it for the session.

import type { ReviewKind, ReviewOut } from "@domain/companion/review-rules"
import { useQuery } from "@tanstack/react-query"

/** One model call: longer than an ordinary request. */
const REVIEW_TIMEOUT_MS = 45_000

export interface ReviewInput {
  kind: ReviewKind
  fromDay: string
  toDay: string
  dismissed: string[]
}

export async function fetchReview(i: ReviewInput): Promise<ReviewOut> {
  // Loaded on use, so prototype mode never builds auth.
  const auth = require("./auth") as typeof import("./auth")
  return auth.http.request(
    "POST",
    "/companion/review",
    {
      kind: i.kind,
      from_day: i.fromDay,
      to_day: i.toDay,
      dismissed: i.dismissed.slice(-50),
    },
    { timeoutMs: REVIEW_TIMEOUT_MS },
  )
}

export const reviewKey = (kind: ReviewKind, from: string, to: string) => [
  "companion",
  "review",
  kind,
  from,
  to,
]

/** Off (never pending) when ``enabled`` is false. No automatic retry: a
 * failure settles as the card's error state, and its Try again asks again. */
export function useFernReview(i: ReviewInput, enabled: boolean) {
  return useQuery({
    queryKey: reviewKey(i.kind, i.fromDay, i.toDay),
    queryFn: () => fetchReview(i),
    enabled,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
  })
}
