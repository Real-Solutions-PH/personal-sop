// The widget snapshot reads the same stores and rules Today does, masks
// money when privacy is on, and only changes when something a widget shows
// changed. The lock-screen state stays put between renders so the app does
// not spend the Live Activity update budget on a clock tick.

import { dashStore } from "@domain/dash/store"
import { finStore } from "@domain/finance/store"
import * as FA from "@domain/fitness/actions"
import { fitStore } from "@domain/fitness/store"
import * as HA from "@domain/habits/actions"
import * as H from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { tasksStore } from "@domain/tasks/store"
import { buildLiveState, liveKey } from "../live-state"
import {
  buildSnapshot,
  dayEndsAfter,
  dayHeadline,
  launcherApps,
  type SnapshotInput,
  snapshotKey,
} from "../snapshot"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  liveStore.set({ live: null })
  habitsStore.set((s) => ({
    ...s,
    runs: s.runs.filter((r) => r.day !== dayKey()),
    timer: null,
  }))
})

const input = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  habits: habitsStore.get(),
  tasks: tasksStore.get(),
  fit: fitStore.get(),
  fin: finStore.get(),
  dash: dashStore.get(),
  live: liveStore.get().live,
  privacy: false,
  ring: { done: 3, due: 8 },
  lifeScore: 72,
  streak: 4,
  journal: true,
  screenTime: false,
  ...over,
})

it("the day headline matches Today's hero", () => {
  expect(dayHeadline(0, 0, 0.7)).toBe("Free day")
  expect(dayHeadline(8, 8, 0.7)).toBe("Day complete")
  expect(dayHeadline(6, 8, 0.7)).toBe("Target hit")
  expect(dayHeadline(3, 8, 0.7)).toBe("3 to target")
})

it("the snapshot's day ends at the next 4:00", () => {
  const late = new Date(2026, 9, 23, 23, 30)
  expect(dayEndsAfter(late)).toEqual(new Date(2026, 9, 24, 4, 0))
  const small = new Date(2026, 9, 24, 2, 15)
  expect(dayEndsAfter(small)).toEqual(new Date(2026, 9, 24, 4, 0))
  expect(buildSnapshot(input({ now: small })).day).toBe("2026-10-23")
})

it("today carries the ring, Life Score and streak", () => {
  const s = buildSnapshot(input())
  expect(s.v).toBe(1)
  expect(s.day).toBe(dayKey())
  expect(s.today).toMatchObject({
    done: 3,
    due: 8,
    pct: 3 / 8,
    lifeScore: 72,
    streak: 4,
  })
  expect(buildSnapshot(input({ ring: { done: 0, due: 0 } })).today.pct).toBe(1)
})

it("habits are today's due ones, open first, with their streaks", () => {
  const s = buildSnapshot(input())
  const today = dayKey()
  const st = habitsStore.get()
  const idx = H.logIndex(st.logs)
  const due = st.habits.filter(
    (h) =>
      h.status !== "archived" &&
      H.isDue(h, today) &&
      idx.get(H.lk(h.id, today))?.status !== "skipped",
  )
  expect(s.habits.total).toBe(due.length)
  expect(s.habits.items.length).toBe(Math.min(6, due.length))
  const firstDone = s.habits.items.findIndex((h) => h.done)
  if (firstDone >= 0)
    expect(s.habits.items.slice(firstDone).every((h) => h.done)).toBe(true)
  for (const item of s.habits.items) {
    const h = st.habits.find((x) => x.id === item.id)
    if (!h) throw new Error("unknown habit in snapshot")
    expect(item.streak).toBe(H.streaks(h, idx, today).current)
    expect(item.checkable).toBe(h.type === "check" && !h.rule)
  }
})

it("a habit that completes from screen time is never checkable on a widget", () => {
  const st = habitsStore.get()
  const target = st.habits.find(
    (h) =>
      h.type === "check" && h.status !== "archived" && H.isDue(h, dayKey()),
  )
  if (!target) throw new Error("seed has no due check habit")
  habitsStore.set((s) => ({
    ...s,
    habits: s.habits.map((h) =>
      h.id === target.id
        ? { ...h, rule: { kind: "screen_limit", groupId: "g", maxMin: 0 } }
        : h,
    ),
  }))
  const item = buildSnapshot(input()).habits.items.find(
    (i) => i.id === target.id,
  )
  expect(item?.checkable).toBe(false)
})

it("checking a habit changes the snapshot; the write time alone does not", () => {
  const a = buildSnapshot(input({ now: new Date() }))
  const b = buildSnapshot(input({ now: new Date(Date.now() + 1000) }))
  expect(snapshotKey(a)).toBe(snapshotKey(b))
  const open = a.habits.items.find((h) => !h.done && h.checkable)
  if (!open) return
  HA.checkHabit(open.id)
  const c = buildSnapshot(input())
  expect(snapshotKey(c)).not.toBe(snapshotKey(a))
  expect(c.habits.done).toBe(a.habits.done + 1)
  // Done habits sort after open ones, so with more than six due it may
  // leave the list; when it stays it reads as done.
  const after = c.habits.items.find((h) => h.id === open.id)
  if (after) expect(after.done).toBe(true)
})

it("macros are what was eaten against today's target", () => {
  fitStore.set((s) => ({
    ...s,
    meals: [],
    targets: [
      {
        id: "t",
        effectiveFrom: "2000-01-01",
        kcal: 2200,
        protein: 150,
        carbs: 220,
        fat: 70,
      },
    ],
  }))
  FA.logMeal({
    label: "lunch",
    source: "manual",
    items: [
      {
        name: "Chicken",
        qty: 1,
        unit: "plate",
        kcal: 600,
        protein: 45,
        carbs: 50,
        fat: 20,
      },
    ],
  } as Parameters<typeof FA.logMeal>[0])
  const m = buildSnapshot(input()).macros
  expect(m?.kcal).toEqual({ eaten: 600, target: 2200 })
  expect(m?.protein).toEqual({ eaten: 45, target: 150 })
  expect(m?.meals).toBe(1)
  fitStore.set((s) => ({ ...s, targets: [] }))
  expect(buildSnapshot(input()).macros).toBeNull()
})

it("money follows the overall budget and the privacy toggle", () => {
  const shown = buildSnapshot(input()).money
  const hidden = buildSnapshot(input({ privacy: true })).money
  if (!shown) {
    expect(hidden).toBeNull()
    return
  }
  expect(shown.hidden).toBe(false)
  expect(shown.safeToday).not.toContain("•")
  expect(hidden).toMatchObject({
    hidden: true,
    safeToday: "••••",
    left: "••••",
    spent: "••••",
    limit: "••••",
  })
  expect(shown.pct).toBeGreaterThanOrEqual(0)
  expect(shown.pct).toBeLessThanOrEqual(1)
})

it("tasks put overdue first and skip shopping lists", () => {
  const s = buildSnapshot(input())
  expect(s.tasks.items.length).toBeLessThanOrEqual(5)
  const firstOnTime = s.tasks.items.findIndex((t) => !t.overdue)
  if (firstOnTime >= 0)
    expect(s.tasks.items.slice(firstOnTime).some((t) => t.overdue)).toBe(false)
  const st = tasksStore.get()
  const shopping = new Set(
    st.lists.filter((l) => l.kind === "shopping").map((l) => l.id),
  )
  for (const item of s.tasks.items) {
    const t = st.tasks.find((x) => x.id === item.id)
    expect(t?.status).toBe("open")
    expect(t?.listId && shopping.has(t.listId)).toBeFalsy()
  }
})

it("a module switched off leaves its widget empty", () => {
  const off = buildSnapshot(
    input({
      dash: {
        ...dashStore.get(),
        enabled: {
          habits: false,
          tasks: false,
          fitness: false,
          nutrition: false,
          focus: false,
          finance: false,
          screen: false,
        },
      },
    }),
  )
  expect(off.habits.items).toEqual([])
  expect(off.tasks.items).toEqual([])
  expect(off.macros).toBeNull()
  expect(off.money).toBeNull()
})

it("the running activity shows on the Today widget", () => {
  const t = fitStore.get().templates[0]
  FA.startWorkout({ from: "template", templateId: t.id })
  expect(buildSnapshot(input()).live).toMatchObject({
    kind: "workout",
    href: FA.WORKOUT_HREF,
  })
})

describe("lock-screen state", () => {
  const live = (now: number) =>
    buildLiveState({
      live: liveStore.get().live,
      habits: habitsStore.get(),
      fit: fitStore.get(),
      now,
    })
  it("is null when nothing runs", () => {
    expect(live(Date.now())).toBeNull()
  })
  it("a running routine counts down on its own: no update per second", () => {
    const r = habitsStore
      .get()
      .routines.find((x) => x.status === "active" && x.steps.length >= 2)
    if (!r) throw new Error("no routine")
    const run = HA.startRoutine(r.id)
    if (!run) throw new Error("not started")
    const a = live(Date.now())
    const b = live(Date.now() + 7000)
    expect(liveKey(a)).toBe(liveKey(b))
    expect(a?.stepEndsAt).toBe(
      new Date(run.stepStartedAt).getTime() + run.steps[0].minutes * 60_000,
    )
    expect(a?.next[0]?.key).toBe("1")
    expect(a?.count).toBe(run.steps.length)
    HA.toggleRunPause(run)
    const p = live(Date.now())
    expect(p?.paused).toBe(true)
    expect(p?.stepEndsAt).toBeUndefined()
    expect(p?.remainingSec).toBeGreaterThan(0)
  })
  it("a habit timer is stable while running", () => {
    const h = habitsStore.get().habits.find((x) => x.status === "active")
    if (!h) throw new Error("no habit")
    HA.startTimer(h.id)
    expect(liveKey(live(Date.now()))).toBe(liveKey(live(Date.now() + 5000)))
    expect(live(Date.now())?.controls).toEqual(["pause", "finish"])
  })
  it("a workout shows the next set and the upcoming ones", () => {
    const t = fitStore.get().templates[0]
    const res = FA.startWorkout({ from: "template", templateId: t.id })
    if (!res.ok) throw new Error(res.reason)
    const s = live(Date.now())
    const first = res.workout.exercises[0]
    expect(s?.key).toBe(`${first.id}/${first.sets[0].id}`)
    expect(s?.detail).toMatch(/Set 1 of|Warm-up/)
    expect(s?.next.length).toBeGreaterThan(0)
    expect(s?.controls).toEqual(["finishSet", "finish"])
    expect(liveKey(s)).toBe(liveKey(live(Date.now() + 9000)))
  })
})

it("the Apps widget lists what the in-app launcher shows, in its order", () => {
  const all = {
    habits: true,
    tasks: true,
    fitness: true,
    nutrition: true,
    focus: true,
    finance: true,
    screen: true,
  }
  expect(launcherApps(all, true, true)).toEqual([
    "habits",
    "tasks",
    "fitness",
    "nutrition",
    "focus",
    "finance",
    "screen",
    "journal",
  ])
  // Screen Time needs a build that can read it; Journal can be hidden.
  expect(launcherApps(all, false, false)).not.toContain("screen")
  expect(launcherApps(all, false, false)).not.toContain("journal")
  expect(launcherApps({ ...all, finance: false }, true, false)).not.toContain(
    "finance",
  )
  expect(
    buildSnapshot(input({ journal: false, screenTime: false })).apps,
  ).not.toContain("journal")
})
