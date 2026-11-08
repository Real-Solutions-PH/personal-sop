import type { ModuleKey } from "@domain/contract"
import { AREA, MODULE_KEYS, orderModules } from "@domain/dash/data"
import { dashStore } from "@domain/dash/store"
import { createStore } from "@domain/lib/store"
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  CloudSun,
  Dumbbell,
  Flag,
  History,
  LayoutGrid,
  Leaf,
  ListChecks,
  type LucideIcon,
  Moon,
  Smartphone,
  Smile,
  Sparkles,
  Sprout,
  Target,
  Timer,
  Trophy,
  Users,
  Utensils,
  Wallet,
} from "lucide-react-native"
import type { Extra } from "./extras"
import type { Accent } from "./theme"

// Home's sections in the person's order, and the ones they hid there. This
// layer only places and hides whole sections; what each card shows and opens
// stays with the card. Held on the account (the profile's ``home_layout``,
// synced by src/live/mappers/dash.ts).
//
// Two switches sit above it and always win: a module turned off (Settings →
// Sections) and an extra turned off (Journal, Community, Weather, Calendar)
// stay hidden whatever the layout says.

export interface HomeSection {
  id: string
  label: string
  icon: LucideIcon
  accent: Accent
  /** When the section shows at all, for the edit list. */
  hint?: string
  /** A scored module's card: its slot follows the module order. */
  module?: ModuleKey
  /** An extra the person can switch off for the whole app. */
  extra?: Extra
  /** Only on the web build. */
  web?: boolean
}

const MODULE_ICON: Partial<Record<ModuleKey, LucideIcon>> = {
  habits: Target,
  tasks: CheckSquare,
  fitness: Dumbbell,
  nutrition: Utensils,
  focus: Timer,
  finance: Wallet,
}
// Screen time has no Home card.
const HOME_MODULES = MODULE_KEYS.filter((k) => MODULE_ICON[k])
const moduleSection = (k: ModuleKey): HomeSection => ({
  id: k,
  label: AREA[k].label,
  icon: MODULE_ICON[k] ?? Target,
  accent: AREA[k].accent,
  module: k,
})

/** Every Home section, in the default order. A section added in a later
 * release goes here at its place; accounts with a saved layout get it there
 * too (see ``resolveOrder``). Ids are stored on the account: never rename. */
export const HOME_SECTIONS: readonly HomeSection[] = [
  {
    id: "weekly_review",
    label: "Weekly review",
    icon: CalendarCheck,
    accent: "primary",
    hint: "Once a week, until you open it",
  },
  {
    id: "yesterday",
    label: "Yesterday's recap",
    icon: History,
    accent: "life",
    hint: "The morning after a miss",
  },
  {
    id: "first_week",
    label: "Your first week",
    icon: Sprout,
    accent: "primary",
    hint: "Your first seven days",
  },
  { id: "plan", label: "Today's plan", icon: ListChecks, accent: "primary" },
  {
    id: "weather",
    label: "Weather",
    icon: CloudSun,
    accent: "life",
    extra: "weather",
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: CalendarDays,
    accent: "life",
    extra: "calendar",
  },
  {
    id: "setup",
    label: "Finish setting up",
    icon: Sparkles,
    accent: "primary",
    hint: "Until every module is set up",
  },
  { id: "launcher", label: "Your apps", icon: LayoutGrid, accent: "primary" },
  {
    id: "wrap_up",
    label: "Evening wrap-up",
    icon: Moon,
    accent: "life",
    hint: "Evenings",
  },
  {
    id: "install",
    label: "Install the app",
    icon: Smartphone,
    accent: "primary",
    web: true,
  },
  {
    id: "mood",
    label: "Mood check-in",
    icon: Smile,
    accent: "life",
    extra: "journal",
  },
  ...HOME_MODULES.map(moduleSection),
  {
    id: "intro",
    label: "Something to try",
    icon: Leaf,
    accent: "primary",
    hint: "Now and then, for a part you hid",
  },
  {
    id: "community",
    label: "Community",
    icon: Users,
    accent: "life",
    extra: "social",
  },
  { id: "goals", label: "Goals in play", icon: Flag, accent: "primary" },
  {
    id: "recap",
    label: "New trophy or yesterday's misses",
    icon: Trophy,
    accent: "primary",
    hint: "Mornings, when there's one",
  },
  {
    id: "tomorrow",
    label: "Tomorrow",
    icon: CalendarClock,
    accent: "primary",
    hint: "Evenings",
  },
]
export const DEFAULT_ORDER = HOME_SECTIONS.map((s) => s.id)
const BY_ID = new Map(HOME_SECTIONS.map((s) => [s.id, s]))
export const homeSection = (id: string) => BY_ID.get(id)
const MODULE_IDS = new Set<string>(HOME_MODULES)

export interface HomeLayout {
  order: string[]
  hidden: string[]
}
/** ``null``: never edited, so the default arrangement. */
export const homeLayoutStore = createStore<HomeLayout | null>(
  "native-home-layout",
  () => null,
  { upgrade: (saved) => (saved ? homeLayoutFromServer(saved, null) : null) },
)

const dedupe = (ids: readonly string[]) => [...new Set(ids)]

/** The saved order completed with ``defaults``: every saved id keeps its
 * place (ids this release does not know included, so a newer phone's
 * sections survive), and a default id the saved order lacks goes in after
 * the nearest section that comes before it by default. */
export function resolveOrder(
  saved: readonly string[] | undefined | null,
  defaults: readonly string[] = DEFAULT_ORDER,
): string[] {
  if (!saved) return [...defaults]
  const out = dedupe(saved)
  defaults.forEach((id, i) => {
    if (out.includes(id)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const p = out.indexOf(defaults[j])
      if (p >= 0) {
        at = p + 1
        break
      }
    }
    out.splice(at, 0, id)
  })
  return out
}

/** Module cards keep their slots, filled in the module order (Settings →
 * Sections), so the two orders never disagree. */
export function withModuleOrder(
  ids: readonly string[],
  moduleOrder: readonly ModuleKey[],
): string[] {
  const queue = moduleOrder.filter((k) => MODULE_IDS.has(k) && ids.includes(k))
  return ids.map((id) => (MODULE_IDS.has(id) ? (queue.shift() ?? id) : id))
}

/** Moves ``id`` to place ``to`` among ``visible`` (the rows the person sees),
 * leaving every other id, listed or not, in its slot. */
export function moveAmong(
  ids: readonly string[],
  visible: readonly string[],
  id: string,
  to: number,
): string[] {
  const next = visible.filter((x) => x !== id)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, id)
  const shown = new Set(visible)
  return ids.map((x) => (shown.has(x) ? (next.shift() ?? x) : x))
}

/** The module order with the Home modules in their Home order; modules
 * without a Home card (Screen time) keep their place. */
export function moduleOrderFrom(
  ids: readonly string[],
  current: readonly ModuleKey[],
): ModuleKey[] {
  const home = ids.filter((id): id is ModuleKey => MODULE_IDS.has(id))
  return current.map((k) => (MODULE_IDS.has(k) ? (home.shift() ?? k) : k))
}

/** Home's order as it renders, unknown ids included. */
export function homeOrder(
  layout: HomeLayout | null,
  moduleOrder: readonly ModuleKey[],
): string[] {
  return withModuleOrder(resolveOrder(layout?.order), moduleOrder)
}

export function useHomeLayout() {
  const layout = homeLayoutStore.use((s) => s)
  const order = dashStore.use((s) => s.order)
  const ids = homeOrder(layout, orderModules(order))
  const hidden = new Set(layout?.hidden ?? [])
  return { ids, hidden }
}

/** Moves a section within the rows the edit list shows. */
export function moveSection(id: string, to: number, visible: string[]) {
  const s = dashStore.get()
  const modules = orderModules(s.order)
  const ids = moveAmong(
    homeOrder(homeLayoutStore.get(), modules),
    visible,
    id,
    to,
  )
  homeLayoutStore.set((cur) => ({ order: ids, hidden: cur?.hidden ?? [] }))
  if (MODULE_IDS.has(id)) {
    const order = moduleOrderFrom(ids, modules)
    if (order.some((k, i) => k !== modules[i]))
      dashStore.set((d) => ({ ...d, order }))
  }
}

/** Shows or hides a section on Home (the module or extra stays on). */
export function setSectionShown(id: string, on: boolean) {
  homeLayoutStore.set((cur) => {
    const hidden = (cur?.hidden ?? []).filter((x) => x !== id)
    return {
      order: cur?.order ?? resolveOrder(null),
      hidden: on ? hidden : [...hidden, id],
    }
  })
}

/** Home as shipped: the default order, every section shown, and the modules
 * back in their default order. */
export function resetHomeLayout() {
  homeLayoutStore.set({ order: [...DEFAULT_ORDER], hidden: [] })
  dashStore.set((d) => ({ ...d, order: [...MODULE_KEYS] }))
}

/** The server's ``home_layout`` over the device's; anything that is not a
 * layout keeps the device's (an account that never edited Home). */
export function homeLayoutFromServer(
  v: unknown,
  cur: HomeLayout | null,
): HomeLayout | null {
  if (!v || typeof v !== "object") return cur
  const raw = v as { order?: unknown; hidden?: unknown }
  const list = (x: unknown) =>
    Array.isArray(x) ? dedupe(x.filter((i) => typeof i === "string")) : []
  const next = { order: list(raw.order), hidden: list(raw.hidden) }
  const same =
    cur &&
    cur.order.length === next.order.length &&
    cur.order.every((x, i) => x === next.order[i]) &&
    cur.hidden.length === next.hidden.length &&
    cur.hidden.every((x, i) => x === next.hidden[i])
  return same ? cur : next
}
