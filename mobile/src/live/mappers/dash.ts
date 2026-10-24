// Dashboard and profile mappers: the profile singleton (with the appearance
// and privacy stores folded in), identities, setup skips, goals, reviews,
// wrap-ups, miss notes, notifications and share defaults.
//
// Rulings (each one is the narrowest mapping that keeps the UI unchanged):
// - Reviews, wrap-ups, miss notes, share defaults and setup skips are keyed
//   locally by their natural key (period key, day, miss key, template,
//   module). The device id is derivedId(<kind>, userId, <key>), so two
//   devices agree. A pulled row with a different id (created through REST)
//   is remembered in ``dashIdStore`` and used from then on.
// - Sealing a day is a plain wrap_up upsert, not ``dashboard.seal_day``: the
//   wrap-up screen already writes the reflection to the journal itself, and
//   the action would write it a second time. Unsealing is the delete.
// - Notifications are created by the server. Only rows this device pulled
//   are listed, so a local-only notice never becomes a create the server
//   refuses; mark-read is the ``read`` field, dismiss is the delete. The
//   server's ``social`` kind shows as ``system`` (the inbox has no icon for
//   it).
// - The onboarding finish is not ``dashboard.onboarding``: the onboarding
//   screen already saves its goals locally, which sync as goal creates.
// - The profile photo is NOT mapped: the device holds a file URI and the
//   server holds a media id; mapping it needs the media upload first.
// - ``push.review`` is a schedule label on the device ("Sun 19:00") and a
//   switch on the server: any label sends true, an empty one false.

import type {
  DashState,
  Goal,
  Identity,
  Notif,
  ReviewState,
  ShareTemplate,
  WrapUp,
} from "@domain/dash/data"
import { dashStore } from "@domain/dash/store"
import { dayKey } from "@domain/lib/day"
import { derivedId, isUuid } from "@domain/lib/ids"
import { currencyStore, isCurrency } from "@domain/lib/money"
import { privacyStore } from "@domain/lib/privacy"
import { createStore, type Store } from "@domain/lib/store"
import { appearanceStore } from "@/prototype/theme"
import type { Mapper, Payload } from "../mapper"
import { singleton } from "./helpers"

type ModuleKey = DashState["setupSkipped"][number]
const MODULES: ModuleKey[] = [
  "habits",
  "tasks",
  "fitness",
  "nutrition",
  "finance",
]

// ------------------------------------------------------------ server ids

/** Server ids for natural-keyed rows, and the notification ids pulled. */
export const dashIdStore = createStore<{
  owner: string
  ids: Record<string, string>
}>("live-dash-ids", () => ({ owner: "", ids: {} }))

function idsFor(userId: string) {
  if (dashIdStore.get().owner !== userId)
    dashIdStore.set({ owner: userId, ids: {} })
  const get = (entity: string, key: string, kind: string) =>
    dashIdStore.get().ids[`${entity}:${key}`] ?? derivedId(kind, userId, key)
  const remember = (pairs: [string, string][]) => {
    const cur = dashIdStore.get().ids
    if (pairs.every(([k, v]) => cur[k] === v)) return
    dashIdStore.set((s) => ({
      ...s,
      ids: { ...s.ids, ...Object.fromEntries(pairs) },
    }))
  }
  return { get, remember }
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined)

/**
 * A ``Record<key, V>`` slice of the dash store, one server row per key.
 * ``keyOf`` reads the natural key back from a pulled row.
 */
function keyedRecord<V>(opts: {
  entity: string
  kind: string
  userId: string
  read(s: DashState): Record<string, V>
  write(s: DashState, next: Record<string, V>): DashState
  toServer(key: string, value: V): Payload
  fromServer(row: Payload): { key: string; value: V } | null
}): Mapper<DashState, { id: string; key: string; value: V }> {
  const ids = idsFor(opts.userId)
  const idOf = (key: string) => ids.get(opts.entity, key, opts.kind)
  return {
    entity: opts.entity,
    store: dashStore,
    list: (s) =>
      Object.entries(opts.read(s)).map(([key, value]) => ({
        id: idOf(key),
        key,
        value,
      })),
    id: (l) => l.id,
    toServer: (l) => opts.toServer(l.key, l.value),
    fromServer: (row) => {
      const r = opts.fromServer(row)
      return r ? { id: String(row.id), ...r } : null
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      ids.remember(ups.map((u) => [`${opts.entity}:${u.key}`, u.id]))
      const next = { ...opts.read(s) }
      const gone = new Set(dels)
      for (const key of Object.keys(next))
        if (gone.has(idOf(key))) delete next[key]
      for (const u of ups) next[u.key] = u.value
      return opts.write(s, next)
    },
  }
}

// --------------------------------------------------------------- profile

/** The four stores the profile row spans, read and written as one. */
interface ProfileState {
  dash: DashState
  appearance: ReturnType<typeof appearanceStore.get>
  privacy: ReturnType<typeof privacyStore.get>
  currency: ReturnType<typeof currencyStore.get>
}

function combined(): Store<ProfileState> {
  let last: ProfileState | null = null
  const get = (): ProfileState => {
    const dash = dashStore.get()
    const appearance = appearanceStore.get()
    const privacy = privacyStore.get()
    const currency = currencyStore.get()
    if (
      !last ||
      last.dash !== dash ||
      last.appearance !== appearance ||
      last.privacy !== privacy ||
      last.currency !== currency
    )
      last = { dash, appearance, privacy, currency }
    return last
  }
  const set: Store<ProfileState>["set"] = (next) => {
    const cur = get()
    const v = typeof next === "function" ? next(cur) : next
    if (v.dash !== cur.dash) dashStore.set(v.dash)
    if (v.appearance !== cur.appearance) appearanceStore.set(v.appearance)
    if (v.privacy !== cur.privacy) privacyStore.set(v.privacy)
    if (v.currency !== cur.currency) currencyStore.set(v.currency)
  }
  return {
    get,
    set,
    use: (select) => select(get()),
    reset: () => {},
    flush: () => true,
    subscribe: (l) => {
      const offs = [
        dashStore.subscribe(l),
        appearanceStore.subscribe(l),
        privacyStore.subscribe(l),
        currencyStore.subscribe(l),
      ]
      return () => {
        for (const off of offs) off()
      }
    },
  }
}

const HANDLE = /^[a-z0-9._]{3,20}$/
const HM = /^([01]\d|2[0-3]):[0-5]\d$/
const DEFAULT_REVIEW = "Sun 19:00"
const APPEARANCES = ["system", "light", "dark"] as const
const PERMISSIONS = ["default", "granted", "denied"] as const

const pick = <T extends string>(all: readonly T[], v: unknown, cur: T): T =>
  all.includes(v as T) ? (v as T) : cur

/** Profile payload; a value the server would refuse is left out. */
export function profileToServer(v: ProfileState): Payload {
  const d = v.dash
  const out: Payload = {
    evening_start: d.eveningStart,
    target_threshold: d.targetThreshold,
    appearance: v.appearance.mode,
    privacy_hidden: v.privacy.hidden,
    currency: v.currency.code,
    onboarded: d.onboarded,
    setup_hidden: d.setupHidden,
    install_dismissed: d.installDismissed,
    push_permission: d.push.permission,
    push_morning: HM.test(d.push.morning) ? d.push.morning : null,
    push_evening: HM.test(d.push.evening) ? d.push.evening : null,
    push_review: Boolean(d.push.review),
    seen_trophies: d.seenTrophies.slice(-500),
  }
  const name = d.profile.name.trim()
  if (name.length >= 2 && name.length <= 80) out.name = name
  const handle = d.profile.handle.replace(/^@/, "")
  if (HANDLE.test(handle)) out.handle = handle
  if (!HM.test(d.eveningStart)) delete out.evening_start
  if (!(d.targetThreshold > 0 && d.targetThreshold <= 1))
    delete out.target_threshold
  return out
}

export function profileFromServer(
  row: Payload,
  cur: ProfileState,
): ProfileState {
  const d = cur.dash
  const handle = str(row.handle)
  const since = str(row.since)
  return {
    dash: {
      ...d,
      profile: {
        ...d.profile,
        name: str(row.name) ?? d.profile.name,
        handle: handle ? `@${handle}` : "",
        since: since ?? d.profile.since,
      },
      eveningStart: str(row.evening_start) ?? d.eveningStart,
      targetThreshold:
        typeof row.target_threshold === "number"
          ? row.target_threshold
          : d.targetThreshold,
      onboarded: Boolean(row.onboarded),
      setupHidden: Boolean(row.setup_hidden),
      installDismissed: Boolean(row.install_dismissed),
      push: {
        ...d.push,
        permission: pick(PERMISSIONS, row.push_permission, d.push.permission),
        morning: str(row.push_morning) ?? "",
        evening: str(row.push_evening) ?? "",
        review: row.push_review ? d.push.review || DEFAULT_REVIEW : "",
      },
      seenTrophies: Array.isArray(row.seen_trophies)
        ? row.seen_trophies.map(String)
        : d.seenTrophies,
    },
    appearance: {
      ...cur.appearance,
      mode: pick(APPEARANCES, row.appearance, cur.appearance.mode),
    },
    privacy: { ...cur.privacy, hidden: Boolean(row.privacy_hidden) },
    // An unknown code keeps the device's (fail closed: never a blank symbol).
    currency: isCurrency(row.currency) ? { code: row.currency } : cur.currency,
  }
}

export function profileMapper(userId: string) {
  return singleton<ProfileState, ProfileState>({
    entity: "profile",
    userId,
    store: combined(),
    read: (s) => s,
    write: (_s, v) => v,
    toServer: profileToServer,
    fromServer: profileFromServer,
  })
}

// ------------------------------------------------------------ identities

interface IdentityRow extends Identity {
  order: number
}

export function identityMapper(): Mapper<DashState, IdentityRow> {
  return {
    entity: "identity",
    store: dashStore,
    list: (s) =>
      s.profile.identities
        .map((i, order) => ({ ...i, order }))
        .filter((i) => isUuid(i.id)),
    id: (l) => l.id,
    toServer: (l) => ({
      text: l.text,
      goal_id: l.goalId && isUuid(l.goalId) ? l.goalId : null,
      sort_order: l.order,
    }),
    fromServer: (row) => ({
      id: String(row.id),
      text: String(row.text ?? ""),
      goalId: str(row.goal_id),
      order: Number(row.sort_order ?? 0),
    }),
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const map = new Map<string, IdentityRow>(
        s.profile.identities.map((i, order) => [i.id, { ...i, order }]),
      )
      for (const d of dels) map.delete(d)
      for (const u of ups) map.set(u.id, u)
      const identities = [...map.values()]
        .sort((a, b) => a.order - b.order)
        .slice(0, 3)
        .map(({ order: _order, ...i }) => i)
      return { ...s, profile: { ...s.profile, identities } }
    },
  }
}

// ----------------------------------------------------------- setup skips

export function setupSkipMapper(
  userId: string,
): Mapper<DashState, { id: string; module: ModuleKey }> {
  const ids = idsFor(userId)
  const idOf = (m: ModuleKey) => ids.get("setup_skip", m, "setup-skip")
  return {
    entity: "setup_skip",
    store: dashStore,
    list: (s) => s.setupSkipped.map((module) => ({ id: idOf(module), module })),
    id: (l) => l.id,
    toServer: (l) => ({ module: l.module }),
    fromServer: (row) => {
      const m = row.module as ModuleKey
      return MODULES.includes(m) ? { id: String(row.id), module: m } : null
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      ids.remember(ups.map((u) => [`setup_skip:${u.module}`, u.id]))
      const gone = new Set(dels)
      const kept = s.setupSkipped.filter((m) => !gone.has(idOf(m)))
      const setupSkipped = MODULES.filter(
        (m) => kept.includes(m) || ups.some((u) => u.module === m),
      )
      return { ...s, setupSkipped }
    },
  }
}

// ----------------------------------------------------------------- goals

const COMPARATORS = ["gte", "lte"] as const
const PERIODS = ["week", "month"] as const
const STATUSES = ["active", "archived"] as const
const VIAS = ["manual", "onboarding", "review"] as const

/** The business day an instant falls on, on this device. */
const localDay = (iso: string) => dayKey(new Date(iso))

export function goalMapper(): Mapper<DashState, Goal> {
  return {
    entity: "goal",
    store: dashStore,
    list: (s) => s.goals.filter((g) => isUuid(g.id)),
    id: (g) => g.id,
    toServer: (g) => ({
      metric: g.metric,
      label: g.label,
      target: g.target,
      unit: g.unit,
      comparator: g.comparator,
      period: g.period,
      status: g.status,
      via: g.via ?? "manual",
    }),
    fromServer: (row) => ({
      id: String(row.id),
      metric: String(row.metric),
      label: String(row.label),
      target: Number(row.target),
      unit: String(row.unit ?? ""),
      comparator: pick(COMPARATORS, row.comparator, "gte"),
      period: pick(PERIODS, row.period, "week"),
      createdAt: str(row.created_at)
        ? localDay(String(row.created_at))
        : dayKey(),
      status: pick(STATUSES, row.status, "active"),
      via: pick(VIAS, row.via, "manual"),
    }),
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const gone = new Set(dels)
      const byId = new Map(ups.map((g) => [g.id, g]))
      const kept = s.goals
        .filter((g) => !gone.has(g.id))
        .map((g) => byId.get(g.id) ?? g)
      const known = new Set(kept.map((g) => g.id))
      const added = ups.filter((g) => !known.has(g.id))
      return { ...s, goals: [...added, ...kept] }
    },
  }
}

// --------------------------------------------------------------- reviews

export function reviewMapper(userId: string) {
  return keyedRecord<ReviewState>({
    entity: "review",
    kind: "review",
    userId,
    read: (s) => s.reviews,
    write: (s, reviews) => ({ ...s, reviews }),
    toServer: (key, r) => ({
      key,
      done: r.done,
      done_at: r.doneAt ?? null,
      reflection: r.reflection ?? null,
      focus: r.focus ?? null,
    }),
    fromServer: (row) => {
      const key = str(row.key)
      if (!key) return null
      const value: ReviewState = { done: Boolean(row.done) }
      if (str(row.done_at)) value.doneAt = String(row.done_at)
      if (str(row.reflection)) value.reflection = String(row.reflection)
      if (str(row.focus)) value.focus = String(row.focus)
      return { key, value }
    },
  })
}

// -------------------------------------------------------------- wrap-ups

export function wrapUpMapper(userId: string) {
  return keyedRecord<WrapUp>({
    entity: "wrap_up",
    kind: "wrap-up",
    userId,
    read: (s) => s.wrapups,
    write: (s, wrapups) => ({ ...s, wrapups }),
    toServer: (day, w) => ({
      day,
      at: w.at,
      on_target: w.onTarget,
      done: w.done,
      due: w.due,
      reflection: w.reflection ?? null,
    }),
    fromServer: (row) => {
      const day = str(row.day)
      if (!day) return null
      const value: WrapUp = {
        at: String(row.at),
        onTarget: Boolean(row.on_target),
        done: Number(row.done ?? 0),
        due: Number(row.due ?? 0),
      }
      if (str(row.reflection)) value.reflection = String(row.reflection)
      return { key: day, value }
    },
  })
}

// ----------------------------------------------------------- miss notes

export function missNoteMapper(userId: string) {
  return keyedRecord<string>({
    entity: "miss_note",
    kind: "miss-note",
    userId,
    read: (s) => s.missNotes,
    write: (s, missNotes) => ({ ...s, missNotes }),
    toServer: (miss_key, note) => ({ miss_key, note }),
    fromServer: (row) => {
      const key = str(row.miss_key)
      const note = str(row.note)
      return key && note ? { key, value: note } : null
    },
  })
}

// -------------------------------------------------------- share defaults

const TEMPLATES: ShareTemplate[] = [
  "life",
  "weekly",
  "monthly",
  "streak",
  "finance",
  "profile",
  "goal",
]

export function shareDefaultMapper(userId: string) {
  return keyedRecord<Record<string, boolean>>({
    entity: "share_default",
    kind: "share-default",
    userId,
    read: (s) => s.share as Record<string, Record<string, boolean>>,
    write: (s, share) => ({ ...s, share }),
    toServer: (template, fields) => ({ template, fields }),
    fromServer: (row) => {
      const t = row.template as ShareTemplate
      if (
        !TEMPLATES.includes(t) ||
        typeof row.fields !== "object" ||
        !row.fields
      )
        return null
      const fields: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(row.fields)) fields[k] = Boolean(v)
      return { key: t, value: fields }
    },
  })
}

// ---------------------------------------------------------- notifications

const KINDS = ["reminder", "achievement", "review", "system"] as const

export function notificationMapper(userId: string): Mapper<DashState, Notif> {
  idsFor(userId)
  const known = () => dashIdStore.get().ids
  return {
    entity: "notification",
    store: dashStore,
    list: (s) => s.notifs.filter((n) => known()[`notification:${n.id}`]),
    id: (n) => n.id,
    toServer: (n) => ({ read: n.read }),
    fromServer: (row) => ({
      id: String(row.id),
      at: String(row.at),
      kind: pick(KINDS, row.kind, "system"),
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      href: String(row.href ?? "/today"),
      read: Boolean(row.read),
    }),
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const ids = { ...known() }
      for (const u of ups) ids[`notification:${u.id}`] = u.id
      for (const d of dels) delete ids[`notification:${d}`]
      dashIdStore.set((st) => ({ ...st, ids }))
      const gone = new Set(dels)
      const map = new Map(
        s.notifs.filter((n) => !gone.has(n.id)).map((n) => [n.id, n]),
      )
      for (const u of ups) map.set(u.id, u)
      const notifs = [...map.values()].sort((a, b) => b.at.localeCompare(a.at))
      return { ...s, notifs }
    },
  }
}

/**
 * Every dashboard/profile mapper, in push order: goals before identities
 * (an identity names its goal), profile first.
 */
export function dashMappers(userId: string) {
  return [
    profileMapper(userId),
    goalMapper(),
    identityMapper(),
    setupSkipMapper(userId),
    reviewMapper(userId),
    wrapUpMapper(userId),
    missNoteMapper(userId),
    notificationMapper(userId),
    shareDefaultMapper(userId),
  ]
}
