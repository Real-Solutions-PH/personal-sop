// Server lists read through React Query (not synced rows) go stale when the
// server writes them on its own: Fern saves a library food, another device
// edits one. This is the one map of what to refetch after which event, so a
// new server-read list registers here instead of wiring its own listener.
import type { QueryClient, QueryKey } from "@tanstack/react-query"
import { onServerEvent } from "./runtime"

const FOODS: QueryKey = ["nutrition", "foods"]

/** A server event (or ``capture.done``, raised here when a capture's reply
 * stream ends) → the query lists it makes stale. */
export const STALE_AFTER: Record<string, QueryKey[]> = {
  "companion.reply": [FOODS],
  "sync.changed": [FOODS],
  "capture.done": [FOODS],
}

let client: QueryClient | null = null

/** Refetches every list ``type`` makes stale. */
export function refreshQueries(type: string) {
  for (const queryKey of STALE_AFTER[type] ?? [])
    void client?.invalidateQueries({ queryKey })
}

/** Live mode: refresh on the server's events. Returns the unsubscribe. */
export function installQueryRefresh(c: QueryClient) {
  client = c
  return onServerEvent((e) => refreshQueries(e.type))
}
