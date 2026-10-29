// Screen time mappers (spec 2026-10-29-screen-time-design): the user's app
// groups and the per-group day rows. Both are plain field writes. A day row
// has a natural key, (group, day): the server lands an upsert on the row it
// already holds for that pair and keeps the higher minutes, so a pulled row
// replaces any local row for the same pair under another id. Groups come
// before days, and before habits (a habit's rule names a group).

import type { ScreenDay, ScreenGroup, ScreenState } from "@domain/screen/data"
import { screenStore } from "@domain/screen/store"
import type { Mapper } from "../mapper"

const instant = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : new Date(String(v)).toISOString()

/** Upsert-by-id into a list, keeping order; new rows go last. */
function mergeById<T extends { id: string }>(
  rows: T[],
  ups: T[],
  dels: string[],
): T[] {
  const gone = new Set(dels)
  const map = new Map<string, T>()
  for (const r of rows) if (!gone.has(r.id)) map.set(r.id, r)
  for (const u of ups) map.set(u.id, u)
  return [...map.values()]
}

export function groupMapper(): Mapper<ScreenState, ScreenGroup> {
  return {
    entity: "screen_group",
    store: screenStore,
    list: (s) => s.groups,
    id: (g) => g.id,
    toServer: (g) => ({
      name: g.name,
      kind: g.kind,
      budget_min: g.budgetMin,
      sort_order: g.sortOrder,
      archived_at: g.archivedAt ?? null,
    }),
    fromServer: (row) => {
      if (row.kind !== "all" && row.kind !== "custom") return null
      const out: ScreenGroup = {
        id: String(row.id),
        name: String(row.name ?? ""),
        kind: row.kind,
        budgetMin: Number(row.budget_min ?? 60),
        sortOrder: Number(row.sort_order ?? 0),
      }
      const archived = instant(row.archived_at)
      if (archived) out.archivedAt = archived
      return out
    },
    merge: (s, ups, dels) =>
      ups.length || dels.length
        ? {
            ...s,
            groups: mergeById(s.groups, ups, dels),
            // A group deleted elsewhere takes its days with it (the FK
            // cascades on the server).
            days: dels.length
              ? s.days.filter((d) => !dels.includes(d.groupId))
              : s.days,
          }
        : s,
  }
}

export function dayMapper(): Mapper<ScreenState, ScreenDay> {
  return {
    entity: "screen_day",
    store: screenStore,
    list: (s) => s.days,
    id: (d) => d.id,
    toServer: (d) => ({
      group_id: d.groupId,
      day: d.day,
      used_min: d.usedMin,
      closed: d.closed,
      updated_at: d.updatedAt,
    }),
    fromServer: (row) => ({
      id: String(row.id),
      groupId: String(row.group_id),
      day: String(row.day),
      usedMin: Number(row.used_min ?? 0),
      closed: Boolean(row.closed),
      updatedAt: instant(row.updated_at) ?? new Date().toISOString(),
    }),
    // One row per group and day: a pulled row replaces a local row holding
    // the same pair under another id (the server's id wins).
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const key = (d: ScreenDay) => `${d.groupId}|${d.day}`
      const pulled = new Map(ups.map((u) => [key(u), u.id]))
      const kept = s.days.filter((d) => {
        const winner = pulled.get(key(d))
        return winner === undefined || winner === d.id
      })
      return { ...s, days: mergeById(kept, ups, dels) }
    },
  }
}

export const screenMappers = (_userId: string) => [groupMapper(), dayMapper()]
