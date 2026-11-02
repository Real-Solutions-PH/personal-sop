// Reference mappers: the per-user weather preferences and the Life Score
// module switches/weights. Module sessions follow this shape for theirs.
// Weather: the city and unit follow the user; `source` and `asked` are per
// device (location permission is), so a pull never overwrites them.

import { type DashState, orderModules } from "@domain/dash/data"
import { dashStore } from "@domain/dash/store"
import { derivedId } from "@domain/lib/ids"
import { weatherStore } from "@/prototype/weather"
import type { Mapper } from "../mapper"
import { singleton } from "./helpers"

const MODULES = [
  "habits",
  "tasks",
  "fitness",
  "nutrition",
  "focus",
  "finance",
  "screen",
] as const
type ModuleKey = (typeof MODULES)[number]

type WeatherState = ReturnType<typeof weatherStore.get>

export function weatherPrefMapper(userId: string) {
  return singleton<WeatherState, WeatherState>({
    entity: "weather_pref",
    userId,
    store: weatherStore,
    read: (s) => s,
    write: (_s, v) => v,
    toServer: (v) => ({
      source: v.source,
      city_name: v.city.name,
      city_detail: v.city.detail ?? null,
      city_lat: v.city.lat,
      city_lon: v.city.lon,
      unit: v.unit,
      asked: v.asked,
    }),
    fromServer: (row, cur) => ({
      ...cur,
      city: {
        name: String(row.city_name),
        detail: (row.city_detail as string | null) ?? undefined,
        lat: Number(row.city_lat),
        lon: Number(row.city_lon),
      },
      unit: row.unit === "f" ? "f" : "c",
    }),
  })
}

interface ModuleRow {
  id: string
  module: ModuleKey
  enabled: boolean
  weight: number
  /** Place in the person's module order (Settings → Sections). */
  sortOrder: number
}

export function modulePrefMapper(userId: string): Mapper<DashState, ModuleRow> {
  const idOf = (m: ModuleKey) => derivedId("module-pref", userId, m)
  return {
    entity: "module_pref",
    store: dashStore,
    list: (s) => {
      const order = orderModules(s.order)
      return MODULES.map((m) => ({
        id: idOf(m),
        module: m,
        enabled: s.enabled[m],
        weight: s.weights[m],
        sortOrder: order.indexOf(m),
      }))
    },
    id: (l) => l.id,
    toServer: (l) => ({
      module: l.module,
      enabled: l.enabled,
      weight: l.weight,
      sort_order: l.sortOrder,
    }),
    fromServer: (row) => {
      const m = row.module as ModuleKey
      if (!MODULES.includes(m)) return null
      return {
        id: idOf(m),
        module: m,
        enabled: Boolean(row.enabled),
        weight: Number(row.weight),
        sortOrder: Number(row.sort_order ?? 0),
      }
    },
    merge: (s, ups) => {
      if (!ups.length) return s
      const enabled = { ...s.enabled }
      const weights = { ...s.weights }
      // Pulled places win over this device's; ties (rows nobody ever
      // reordered all hold 0) keep the default module order.
      const cur = orderModules(s.order)
      const place = new Map(cur.map((m, i) => [m, i]))
      for (const u of ups) {
        enabled[u.module] = u.enabled
        weights[u.module] = u.weight
        place.set(u.module, u.sortOrder)
      }
      const order = [...MODULES].sort(
        (a, b) =>
          (place.get(a) ?? 0) - (place.get(b) ?? 0) ||
          MODULES.indexOf(a) - MODULES.indexOf(b),
      )
      const same = order.every((m, i) => m === cur[i])
      return { ...s, enabled, weights, order: same ? s.order : order }
    },
  }
}
