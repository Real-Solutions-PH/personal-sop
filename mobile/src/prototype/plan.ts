// The account's plan: free or Unfurl Plus. The server decides it (from
// RevenueCat's webhooks and its own refresh, ADR-0037) and the phone shows
// what the server last said: through sync (the read-only "entitlement" row)
// and the refresh asked for on start and after a purchase or a restore.
// The phone's one check of its own can only take Plus away: an end date
// already past reads as free.
import { createStore } from "@domain/lib/store"
import { liveMode } from "@/live/config"

export type PlanName = "free" | "plus"

export interface PlanState {
  /** The server's row id, once a pull has brought one. */
  id?: string
  plan: PlanName
  /** ISO instant the paid period ends; null with Plus: no end. */
  plusUntil: string | null
  willRenew: boolean
  productId: string | null
}

export const FREE: PlanState = {
  plan: "free",
  plusUntil: null,
  willRenew: false,
  productId: null,
}

export const planStore = createStore<PlanState>("plan", () => ({ ...FREE }))

export function plusInForce(s: PlanState, now = Date.now()): boolean {
  if (s.plan !== "plus") return false
  if (s.plusUntil === null) return true
  const end = Date.parse(s.plusUntil)
  return Number.isFinite(end) && end > now
}

export function usePlus(): boolean {
  return planStore.use((s) => plusInForce(s))
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null)

/** A server answer (the plan route or the synced row) as the phone keeps
 * it. Anything it does not recognise is free. */
export function planFromServer(row: Record<string, unknown>): PlanState {
  return {
    plan: row.plan === "plus" ? "plus" : "free",
    plusUntil: str(row.plus_until),
    willRenew: row.will_renew === true,
    productId: str(row.product_id),
  }
}

type Refresher = () => Promise<Record<string, unknown>>
let refresher: Refresher | null = null
/** Tests set how the server is asked; live mode posts /billing/refresh. */
export function setPlanRefresher(r: Refresher | null) {
  refresher = r
}
function ask(): Refresher | null {
  if (refresher) return refresher
  if (!liveMode) return null
  try {
    const http = (
      require("@/live/auth") as Partial<typeof import("@/live/auth")>
    ).http
    return http
      ? async () =>
          (await http.request("POST", "/billing/refresh")) as Record<
            string,
            unknown
          >
      : null
  } catch {
    return null
  }
}

/** Asks the server for the plan in force now and stores it; null when the
 * server could not be reached (the plan held stays). */
export async function refreshPlan(): Promise<PlanState | null> {
  const go = ask()
  if (!go) return null
  try {
    const next = planFromServer(await go())
    planStore.set((s) => ({
      ...s,
      ...next,
      productId: next.productId ?? s.productId,
    }))
    return planStore.get()
  } catch {
    return null
  }
}
