// The plan row (server entity "entitlement", ADR-0037): pulled into the plan
// store, never pushed. The server writes it from RevenueCat alone.
import {
  FREE,
  type PlanState,
  planFromServer,
  planStore,
} from "@/prototype/plan"
import type { Mapper } from "../mapper"

type Row = PlanState & { id: string }

function entitlementMapper(): Mapper<PlanState, Row> {
  return {
    entity: "entitlement",
    store: planStore,
    readOnly: true,
    list: (s) => (s.id ? [s as Row] : []),
    id: (r) => r.id,
    toServer: (r) => ({
      plan: r.plan,
      plus_until: r.plusUntil,
      will_renew: r.willRenew,
      product_id: r.productId,
    }),
    fromServer: (row) => ({ id: String(row.id), ...planFromServer(row) }),
    merge: (s, ups, dels) => {
      const up = ups[ups.length - 1]
      if (up) return { ...up }
      if (s.id && dels.includes(s.id)) return { ...FREE }
      return s
    },
  }
}

export function billingMappers(_userId: string): Mapper<PlanState, Row>[] {
  return [entitlementMapper()]
}
