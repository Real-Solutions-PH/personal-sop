// "Describe your meal" estimated on the server (POST /fitness/meals/estimate):
// the user's AI model itemises the words, checked like Fern's estimates,
// with the built-in food table as the server's own fallback. The device's
// table knows 26 dishes and drops every other food without a word, so it
// runs only when the server cannot be reached.
//
// The meal and its items come back as server rows and go into the store
// the way a pull would (engine.apply), so they are never pushed back.

import { ApiError, NetworkError } from "./http"

/** A model call plus a repair round: longer than an ordinary request. */
const ESTIMATE_TIMEOUT_MS = 45_000

interface Row {
  id: string
  version: number
  [key: string]: unknown
}

interface MealOut extends Row {
  items: Row[]
  totals?: unknown
}

export type LiveEstimate =
  | { ok: true; id: string }
  /** The server could read no food in the words. */
  | { ok: false; reason: "unrecognised" }
  /** Not signed in live, offline, or the server failed: estimate here. */
  | { ok: false; reason: "unavailable" }

export async function estimateMealLive(input: {
  id: string
  text: string
  eatenAt: string
  label: string
}): Promise<LiveEstimate> {
  // Loaded on use, so prototype mode never builds live sync or auth.
  const runtime = require("./runtime") as typeof import("./runtime")
  const sync = runtime.engine()
  if (!sync) return { ok: false, reason: "unavailable" }
  const auth = require("./auth") as typeof import("./auth")
  let meal: MealOut
  try {
    meal = await auth.http.request(
      "POST",
      "/fitness/meals/estimate",
      {
        id: input.id,
        text: input.text,
        eaten_at: input.eatenAt,
        label: input.label,
        source: "text",
      },
      { timeoutMs: ESTIMATE_TIMEOUT_MS },
    )
  } catch (error) {
    if (error instanceof ApiError && error.code === "meal_not_recognised")
      return { ok: false, reason: "unrecognised" }
    if (error instanceof ApiError || error instanceof NetworkError)
      return { ok: false, reason: "unavailable" }
    throw error
  }
  const { items, totals: _, ...row } = meal
  sync.apply([
    { entity: "meal", id: row.id, version: row.version, deleted: false, row },
    ...items.map((it) => ({
      entity: "meal_item",
      id: it.id,
      version: it.version,
      deleted: false,
      row: it,
    })),
  ])
  return { ok: true, id: row.id }
}
