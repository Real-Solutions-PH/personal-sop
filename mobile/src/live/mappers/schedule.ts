// Schedule overrides (a habit, routine or recurring task's occurrence moved
// to another time on one day) against the server's schedule_override rows.
// Plain rows: a move is an upsert, a reset a delete. Ids are derived from
// kind + item + day on every device, and the server also matches on that
// key, so two devices moving the same item land on one row.

import type { OverrideKind, ScheduleOverride } from "@domain/schedule/data"
import { scheduleStore } from "@domain/schedule/store"
import type { Mapper } from "../mapper"

type S = ReturnType<typeof scheduleStore.get>

const KINDS: readonly OverrideKind[] = ["habit", "routine", "task"]
const sameItem = (a: ScheduleOverride, b: ScheduleOverride) =>
  a.kind === b.kind && a.refId === b.refId && a.day === b.day

export function scheduleOverrideMapper(): Mapper<S, ScheduleOverride> {
  return {
    entity: "schedule_override",
    pureRows: true,
    store: scheduleStore,
    list: (s) => s.overrides,
    id: (o) => o.id,
    toServer: (o) => ({
      kind: o.kind,
      ref_id: o.refId,
      day: o.day,
      time: o.time,
    }),
    fromServer: (row) => {
      const kind = String(row.kind) as OverrideKind
      // A kind this build does not know cannot be shown or reset here.
      if (!KINDS.includes(kind)) return null
      return {
        id: String(row.id),
        kind,
        refId: String(row.ref_id),
        day: String(row.day),
        time: String(row.time),
      }
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const gone = new Set(dels)
      const kept = s.overrides.filter(
        (o) =>
          !gone.has(o.id) && !ups.some((u) => u.id === o.id || sameItem(u, o)),
      )
      return { ...s, overrides: [...kept, ...ups] }
    },
  }
}

export const scheduleMappers = () => [scheduleOverrideMapper()]
