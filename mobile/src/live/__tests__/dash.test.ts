import { join } from "node:path"
import { type DashState, seed } from "@domain/dash/data"
import {
  archiveGoal,
  dashStore,
  deleteGoal,
  markAllRead,
  markNotifRead,
  noteMiss,
  saveGoal,
  saveReview,
  saveShareDefaults,
  sealDay,
  setEveningStart,
  setIdentities,
  setOnboarded,
  setPush,
  skipSetup,
  unsealDay,
  updateProfile,
} from "@domain/dash/store"
import { derivedId } from "@domain/lib/ids"
import { privacyStore, togglePrivacy } from "@domain/lib/privacy"
import type { StorageAdapter } from "@domain/lib/store"
import { appearanceStore } from "@/prototype/theme"
import { SyncEngine } from "../engine"
import type { Http } from "../http"
import type { Payload } from "../mapper"
import {
  dashIdStore,
  dashMappers,
  goalMapper,
  identityMapper,
  missNoteMapper,
  notificationMapper,
  profileFromServer,
  profileToServer,
  reviewMapper,
  setupSkipMapper,
  shareDefaultMapper,
  wrapUpMapper,
} from "../mappers/dash"
import { createOutbox, type SyncOp } from "../outbox"
import { writeStableFixture } from "./stable-fixture"

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"
// Fixed business days keep the wire fixture byte-stable across runs.
const MONDAY = "2026-10-12"
const DAY = "2026-10-14"
const G1 = "11111111-1111-4111-8111-111111111111"
const I1 = "22222222-2222-4222-8222-222222222222"
const N1 = "33333333-3333-4333-8333-333333333333"

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

const quietHttp: Http = {
  request: async <T>(): Promise<T> => ({ results: [] }) as T,
  raw: async () => {
    throw new Error("unused")
  },
}

function engine() {
  const storage = memoryStorage()
  return new SyncEngine({
    http: quietHttp,
    storage,
    outbox: createOutbox(storage),
    mappers: dashMappers(USER),
    online: () => false,
  })
}

/** The live blank: settings kept, every record emptied (as blank.ts). */
const blank = (): DashState => ({
  ...seed(),
  goals: [],
  reviews: {},
  notifs: [],
  missNotes: {},
  wrapups: {},
  setupSkipped: [],
  profile: {
    name: "Kai Tecson",
    handle: "@kai.sop",
    since: DAY,
    identities: [],
  },
})

const wire: SyncOp[] = []
const record = (ops: SyncOp[]) => {
  wire.push(...ops)
  return ops
}
const upserts = (ops: SyncOp[], name: string) =>
  ops.filter((o) => o.kind === "upsert" && o.name === name)

beforeEach(() => {
  dashIdStore.set({ owner: "", ids: {} })
  dashStore.set(blank())
  appearanceStore.set({ mode: "system" })
  privacyStore.set({ hidden: false })
})

afterAll(() => {
  writeStableFixture(join(__dirname, "fixtures", "dash-wire.json"), wire)
})

// ------------------------------------------------------------ round trips

const roundTrip = <L>(
  m: {
    list(s: DashState): L[]
    id(l: L): string
    toServer(l: L, s: DashState): Payload
    fromServer(r: Payload, s: DashState): L | null
  },
  extra: Payload = {},
) => {
  const s = dashStore.get()
  for (const l of m.list(s)) {
    const row = { id: m.id(l), ...m.toServer(l, s), ...extra }
    expect(m.fromServer(row, s)).toEqual(l)
  }
  return m.list(s).length
}

test("goal round trip keeps every field the screens read", () => {
  dashStore.set((s) => ({
    ...s,
    goals: seed().goals.map((g, i) => ({
      ...g,
      id: derivedId("test", USER, String(i)),
      createdAt: DAY,
    })),
  }))
  // created_at is server-set: noon on DAY is still DAY on the device.
  expect(
    roundTrip(goalMapper(), {
      created_at: new Date(`${DAY}T12:00:00`).toISOString(),
    }),
  ).toBe(5)
})

test("review, wrap-up, miss note and share default round trips", () => {
  const s = seed()
  dashStore.set((st) => ({
    ...st,
    reviews: {
      [`w-${MONDAY}`]: {
        done: true,
        doneAt: "2026-10-18T11:20:00.000Z",
        reflection: "Gym solid",
        focus: "tasks:tasks.onTime",
      },
      "m-2026-10-01": { done: false },
    },
    wrapups: {
      [DAY]: {
        at: "2026-10-14T13:00:00.000Z",
        onTarget: true,
        done: 5,
        due: 6,
        reflection: "Good day",
      },
    },
    missNotes: { [`habit-x:${DAY}`]: "Travelled" },
    share: { weekly: { hexagon: true, savings: false } },
    notifs: s.notifs,
  }))
  expect(roundTrip(reviewMapper(USER))).toBe(2)
  expect(roundTrip(wrapUpMapper(USER))).toBe(1)
  expect(roundTrip(missNoteMapper(USER))).toBe(1)
  expect(roundTrip(shareDefaultMapper(USER))).toBe(1)
})

test("identity round trip keeps order and the goal link", () => {
  setIdentities([
    { id: I1, text: "I train 4× a week", goalId: G1 },
    { id: derivedId("test", USER, "i2"), text: "I finish what I start" },
  ])
  expect(roundTrip(identityMapper())).toBe(2)
})

test("profile round trip covers the dash, appearance and privacy fields", () => {
  appearanceStore.set({ mode: "dark" })
  privacyStore.set({ hidden: true })
  setPush({ permission: "granted", morning: "06:30", evening: "21:15" })
  const cur = {
    dash: dashStore.get(),
    appearance: appearanceStore.get(),
    privacy: privacyStore.get(),
  }
  const row = { ...profileToServer(cur), since: DAY }
  expect(row).toMatchObject({
    name: "Kai Tecson",
    handle: "kai.sop",
    appearance: "dark",
    privacy_hidden: true,
    push_review: true,
  })
  expect(profileFromServer(row, cur)).toEqual(cur)
})

test("profile leaves out a value the server would refuse", () => {
  updateProfile({ name: "K", handle: "" })
  setEveningStart("late")
  const out = profileToServer({
    dash: dashStore.get(),
    appearance: appearanceStore.get(),
    privacy: privacyStore.get(),
  })
  expect(out).not.toHaveProperty("name")
  expect(out).not.toHaveProperty("handle")
  expect(out).not.toHaveProperty("evening_start")
})

// ------------------------------------------------------------- diffs

test("profile: one edit per store sends only that field", () => {
  const e = engine()
  const first = record(e.capture())
  expect(upserts(first, "profile")).toHaveLength(1)
  appearanceStore.set({ mode: "light" })
  expect(upserts(record(e.capture()), "profile")[0].data).toEqual({
    appearance: "light",
  })
  togglePrivacy()
  expect(upserts(record(e.capture()), "profile")[0].data).toEqual({
    privacy_hidden: true,
  })
  setOnboarded(false)
  expect(upserts(record(e.capture()), "profile")[0].data).toEqual({
    onboarded: false,
  })
})

test("goals: create, single-field edit, archive, delete unlinks identities", () => {
  const e = engine()
  e.capture()
  const g = saveGoal({
    metric: "life",
    label: "Life Score",
    target: 75,
    unit: "",
    comparator: "gte",
    period: "month",
  })
  const created = upserts(record(e.capture()), "goal")
  expect(created).toHaveLength(1)
  expect(created[0].data).toMatchObject({ metric: "life", target: 75 })
  saveGoal({ ...g, target: 80 })
  expect(upserts(record(e.capture()), "goal")[0].data).toEqual({ target: 80 })
  archiveGoal(g.id)
  expect(upserts(record(e.capture()), "goal")[0].data).toEqual({
    status: "archived",
  })
  setIdentities([{ id: I1, text: "I keep score", goalId: g.id }])
  expect(upserts(record(e.capture()), "identity")[0].data).toEqual({
    text: "I keep score",
    goal_id: g.id,
    sort_order: 0,
  })
  deleteGoal(g.id)
  const ops = record(e.capture())
  expect(ops.find((o) => o.kind === "delete")).toMatchObject({
    name: "goal",
    id: g.id,
  })
  expect(upserts(ops, "identity")[0].data).toEqual({ goal_id: null })
})

test("reviews, wrap-ups, miss notes, share defaults, setup skips", () => {
  const e = engine()
  e.capture()
  saveReview(`w-${MONDAY}`, { done: true, doneAt: "2026-10-18T11:00:00Z" })
  sealDay(DAY, { onTarget: true, done: 4, due: 5, reflection: "ok" })
  noteMiss(`task-a:${DAY}`, "sick")
  saveShareDefaults("streak", { grid: true, best: false })
  skipSetup("finance")
  const ops = record(e.capture())
  expect(upserts(ops, "review")[0]).toMatchObject({
    id: derivedId("review", USER, `w-${MONDAY}`),
    data: { key: `w-${MONDAY}`, done: true },
  })
  expect(upserts(ops, "wrap_up")[0].data).toMatchObject({
    day: DAY,
    on_target: true,
    done: 4,
    due: 5,
  })
  expect(upserts(ops, "miss_note")[0].data).toEqual({
    miss_key: `task-a:${DAY}`,
    note: "sick",
  })
  expect(upserts(ops, "share_default")[0].data).toEqual({
    template: "streak",
    fields: { grid: true, best: false },
  })
  expect(upserts(ops, "setup_skip")[0].data).toEqual({ module: "finance" })
  // Unseal and clearing a note are deletes; no action ops anywhere.
  unsealDay(DAY)
  noteMiss(`task-a:${DAY}`, "")
  const dels = record(e.capture())
  expect(dels.map((o) => `${o.kind}:${o.name}`).sort()).toEqual([
    "delete:miss_note",
    "delete:wrap_up",
  ])
  expect(wire.some((o) => o.kind === "action")).toBe(false)
})

test("natural key: a pulled review with the server's id replaces the device id", () => {
  const e = engine()
  e.capture()
  const serverId = "44444444-4444-4444-8444-444444444444"
  e.apply([
    {
      entity: "review",
      id: serverId,
      version: 3,
      deleted: false,
      row: { id: serverId, key: `w-${MONDAY}`, done: true, done_at: null },
    },
  ])
  expect(dashStore.get().reviews[`w-${MONDAY}`]).toEqual({ done: true })
  expect(e.capture()).toEqual([]) // no echo
  saveReview(`w-${MONDAY}`, { reflection: "late notes" })
  const ops = e.capture()
  expect(ops).toHaveLength(1)
  expect(ops[0]).toMatchObject({
    kind: "upsert",
    name: "review",
    id: serverId,
    data: { reflection: "late notes" },
  })
  // A pulled delete by that id removes the key.
  e.apply([
    { entity: "review", id: serverId, version: 4, deleted: true, row: null },
  ])
  expect(dashStore.get().reviews).toEqual({})
})

test("setup skips: a pulled delete by derived id removes the module", () => {
  const e = engine()
  skipSetup("habits")
  e.capture()
  e.apply([
    {
      entity: "setup_skip",
      id: derivedId("setup-skip", USER, "habits"),
      version: 2,
      deleted: true,
      row: null,
    },
  ])
  expect(dashStore.get().setupSkipped).toEqual([])
  expect(setupSkipMapper(USER).list(dashStore.get())).toEqual([])
})

test("notifications: only pulled rows sync; read is a field, dismiss a delete", () => {
  const e = engine()
  // A device-made notice never becomes a create the server would refuse.
  dashStore.set((s) => ({ ...s, notifs: seed().notifs }))
  expect(upserts(e.capture(), "notification")).toEqual([])
  e.apply([
    {
      entity: "notification",
      id: N1,
      version: 1,
      deleted: false,
      row: {
        id: N1,
        at: "2026-10-14T07:00:00Z",
        kind: "social",
        title: "Ana cheered",
        body: "Your streak",
        href: "/people",
        read: false,
      },
    },
  ])
  const pulled = dashStore.get().notifs.find((n) => n.id === N1)
  expect(pulled).toMatchObject({ kind: "system", read: false })
  expect(e.capture()).toEqual([])
  markNotifRead(N1)
  expect(record(e.capture())).toEqual([
    expect.objectContaining({
      name: "notification",
      id: N1,
      data: { read: true },
    }),
  ])
  markAllRead()
  expect(e.capture()).toEqual([]) // seed notices are local-only
  dashStore.set((s) => ({ ...s, notifs: s.notifs.filter((n) => n.id !== N1) }))
  expect(e.capture()).toEqual([
    expect.objectContaining({ kind: "delete", name: "notification", id: N1 }),
  ])
  expect(notificationMapper(USER).list(dashStore.get())).toEqual([])
})

test("another account's server ids are dropped", () => {
  dashIdStore.set({ owner: "someone-else", ids: { "review:w-x": "abc" } })
  reviewMapper(USER)
  expect(dashIdStore.get()).toEqual({ owner: USER, ids: {} })
})
