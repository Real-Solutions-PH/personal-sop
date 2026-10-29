// The Screen time module on the phone (spec 2026-10-29-screen-time-design):
// the module contract and its Life Score inputs, the hexagon facet, the
// store's actions, the sync rows, and the safety net that keeps a habit
// driven by screen time from being ticked by hand. Expected values are
// worked out by hand from the minutes in each test.

import { AREA, seed as dashSeed, MODULE_KEYS } from "@domain/dash/data"
import { useFacets } from "@domain/dash/facets"
import { useAllMetrics, useLifeScore, useTodayRing } from "@domain/dash/hooks"
import { dashStore, upgradeDash } from "@domain/dash/store"
import { palette } from "@domain/design/tokens"
import {
  checkHabit,
  clearLog,
  incrementCount,
  logHabit,
  skipHabit,
  startTimer,
} from "@domain/habits/actions"
import type { Habit, HabitLog } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { dayOffset } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { modules } from "@domain/modules"
import { module as SCR } from "@domain/screen"
import * as A from "@domain/screen/actions"
import type { ScreenDay, ScreenGroup } from "@domain/screen/data"
import { screenStore } from "@domain/screen/store"
import { renderHook } from "@testing-library/react-native"
import { type AnyMapper, diffEntity } from "@/live/mapper"
import { screenMappers } from "@/live/mappers/screen"

// 09:00 local on a Tuesday, well inside one app day.
const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime()
const USER = "00000000-0000-4000-8000-000000000001"

const ALL: ScreenGroup = {
  id: "g-all",
  name: "All apps",
  kind: "all",
  budgetMin: 180,
  sortOrder: 0,
}
const SOCIAL: ScreenGroup = {
  id: "g-social",
  name: "Social",
  kind: "custom",
  budgetMin: 60,
  sortOrder: 1,
}
const GAMES: ScreenGroup = {
  id: "g-games",
  name: "Games",
  kind: "custom",
  budgetMin: 0,
  sortOrder: 2,
}
const row = (
  groupId: string,
  back: number,
  usedMin: number,
  closed = true,
): ScreenDay => ({
  id: `d-${groupId}-${back}`,
  groupId,
  day: dayOffset(-back),
  usedMin,
  closed,
  updatedAt: new Date(T0).toISOString(),
})
const ruleHabit = (over: Partial<Habit> = {}): Habit => ({
  id: "h-social",
  name: "No social media",
  icon: "📵",
  type: "check",
  schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
  reminder: false,
  status: "active",
  pauses: [],
  linkWorkout: false,
  rule: { kind: "screen_limit", groupId: SOCIAL.id, maxMin: 0 },
  createdAt: dayOffset(-30),
  sortOrder: 1,
  ...over,
})

beforeEach(() => {
  jest.useFakeTimers({ now: T0 })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  screenStore.set({ groups: [], days: [] })
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], timer: null }))
  liveStore.set({ live: null })
})
afterEach(() => jest.useRealTimers())

describe("the module", () => {
  test("joins every module list as the seventh area, with its own colour", () => {
    expect(modules.map((m) => m.key)).toContain("screen")
    expect(SCR.key).toBe("screen")
    expect(SCR.label).toBe("Screen time")
    expect(SCR.href).toBe("/screen")
    expect(MODULE_KEYS[MODULE_KEYS.length - 1]).toBe("screen")
    expect(AREA.screen).toEqual({ label: "Screen time", accent: "scr" })
    expect(palette.light.scr).toMatch(/^#[0-9a-f]{6}$/)
    expect(palette.dark.scr).toMatch(/^#[0-9a-f]{6}$/)
    const used = Object.entries(palette.light)
      .filter(([k]) =>
        ["hab", "tsk", "fit", "nut", "foc", "fin", "life"].includes(k),
      )
      .map(([, v]) => v)
    expect(used).not.toContain(palette.light.scr)
  })

  test("is on by default with weight 2; a state saved before it gets both", () => {
    expect(dashSeed().weights.screen).toBe(2)
    expect(dashSeed().enabled.screen).toBe(true)
    const old = dashSeed()
    const { screen: _w, ...weights } = old.weights
    const { screen: _e, ...enabled } = old.enabled
    const up = upgradeDash({
      ...old,
      weights: weights as typeof old.weights,
      enabled: enabled as typeof old.enabled,
    })
    expect(up.weights.screen).toBe(2)
    expect(up.enabled.screen).toBe(true)
  })

  test("with no data the rate is null and the Life Score leaves the area out", () => {
    expect(renderHook(() => SCR.useAreaRate(7)).result.current).toBeNull()
    expect(renderHook(() => SCR.useTodayProgress()).result.current).toEqual({
      due: 0,
      done: 0,
    })
    const on = renderHook(() => useLifeScore(7)).result.current.score
    dashStore.set((s) => ({ ...s, enabled: { ...s.enabled, screen: false } }))
    const off = renderHook(() => useLifeScore(7)).result.current.score
    expect(on).not.toBeNull()
    expect(on).toBe(off)
  })

  test("the rate is the mean day score over closed days in the window", () => {
    screenStore.set({
      groups: [ALL, SOCIAL, GAMES],
      days: [
        // Yesterday: All within budget (1), Social 90 of 60 (0.5) → 0.75.
        row(ALL.id, 1, 120),
        row(SOCIAL.id, 1, 90),
        // A zero budget is not scored.
        row(GAMES.id, 1, 45),
        // Two days ago: All 200 of 180 (1 - 20/180), Social 30 (1).
        row(ALL.id, 2, 200),
        row(SOCIAL.id, 2, 30),
        // Today is still open; ten days ago is outside the week.
        row(SOCIAL.id, 0, 500, false),
        row(SOCIAL.id, 10, 500),
      ],
    })
    const want = (0.75 + (1 - 20 / 180 + 1) / 2) / 2
    expect(renderHook(() => SCR.useAreaRate(7)).result.current).toBeCloseTo(
      want,
      10,
    )
    // The previous week holds only the day ten days back: 500 of 60 → 0.
    expect(renderHook(() => SCR.useAreaRate(7, 7)).result.current).toBe(0)
  })

  test("today's progress counts today's closed rows of budgeted groups", () => {
    screenStore.set({
      groups: [ALL, SOCIAL, GAMES],
      days: [row(ALL.id, 0, 100), row(SOCIAL.id, 0, 90), row(GAMES.id, 0, 0)],
    })
    expect(renderHook(() => SCR.useTodayProgress()).result.current).toEqual({
      due: 2,
      done: 1,
    })
    expect(renderHook(() => useTodayRing()).result.current.per.screen).toEqual({
      due: 2,
      done: 1,
    })
  })

  test("screen.used is the main group's lower bound, a day on average", () => {
    screenStore.set({
      groups: [ALL, SOCIAL],
      days: [
        row(ALL.id, 1, 120),
        row(ALL.id, 2, 200),
        row(SOCIAL.id, 1, 300),
        row(ALL.id, 8, 100),
      ],
    })
    const [m] = renderHook(() => SCR.useMetrics(7)).result.current
    expect(m).toEqual({
      key: "screen.used",
      label: "Screen time (at least)",
      value: "≥ 160 min",
      delta: 60,
      goodWhen: "down",
      shareable: true,
    })
    expect(renderHook(() => useAllMetrics(7)).result.current.screen).toEqual([
      m,
    ])
  })

  test("without an All apps group the busiest custom group stands in", () => {
    screenStore.set({
      groups: [SOCIAL, GAMES],
      days: [row(SOCIAL.id, 1, 45), row(GAMES.id, 1, 90)],
    })
    const [m] = renderHook(() => SCR.useMetrics(7)).result.current
    expect(m.value).toBe("≥ 90 min")
    expect(m.delta).toBeUndefined()
    screenStore.set({ groups: [], days: [] })
    expect(renderHook(() => SCR.useMetrics(7)).result.current[0].value).toBe(
      "—",
    )
  })

  test("the Screen time facet comes last, after Finance, valued at the area rate", () => {
    screenStore.set({
      groups: [ALL, SOCIAL],
      days: [row(ALL.id, 1, 120), row(SOCIAL.id, 1, 90)],
    })
    const facets = renderHook(() => useFacets(7)).result.current
    const keys = facets.map((f) => f.key)
    expect(keys.slice(-2)).toEqual(["finance", "screen"])
    const f = facets[facets.length - 1]
    expect(f).toMatchObject({
      key: "screen",
      label: "Screen time",
      module: "screen",
      href: "/screen",
      off: false,
    })
    expect(f.value).toBeCloseTo(0.75, 10)
    dashStore.set((s) => ({ ...s, enabled: { ...s.enabled, screen: false } }))
    const off = renderHook(() => useFacets(7)).result.current
    expect(off[off.length - 1].off).toBe(true)
  })
})

describe("the store", () => {
  test("adds, edits and orders groups", () => {
    const a = A.addGroup("Social", 60)
    const b = A.addGroup("Games", 30)
    const [ga, gb] = screenStore.get().groups
    expect(ga).toMatchObject({
      id: a,
      name: "Social",
      kind: "custom",
      budgetMin: 60,
    })
    expect(gb.id).toBe(b)
    expect(gb.sortOrder).toBeGreaterThan(ga.sortOrder)
    A.updateGroup(a, { name: "Socials", budgetMin: 45 })
    expect(screenStore.get().groups[0]).toMatchObject({
      name: "Socials",
      budgetMin: 45,
    })
  })

  test("there is one All apps group, made when missing", () => {
    const id = A.ensureAllGroup()
    expect(A.ensureAllGroup()).toBe(id)
    const all = screenStore.get().groups.filter((g) => g.kind === "all")
    expect(all).toEqual([
      expect.objectContaining({
        id,
        name: "All apps",
        kind: "all",
        budgetMin: 180,
      }),
    ])
  })

  test("a group a live rule habit points at cannot be archived", () => {
    const id = A.addGroup("Social", 60)
    habitsStore.set((s) => ({
      ...s,
      habits: [
        ruleHabit({ rule: { kind: "screen_limit", groupId: id, maxMin: 30 } }),
      ],
    }))
    expect(() => A.archiveGroup(id)).toThrow("screen_group_in_use")
    expect(screenStore.get().groups[0].archivedAt).toBeUndefined()
    habitsStore.set((s) => ({
      ...s,
      habits: s.habits.map((h) => ({
        ...h,
        status: "archived" as const,
        archivedAt: dayOffset(0),
      })),
    }))
    A.archiveGroup(id)
    expect(screenStore.get().groups[0].archivedAt).toBe(
      new Date(T0).toISOString(),
    )
  })

  test("applyReconcile raises day rows and adds the habit logs, never over one", () => {
    const h = ruleHabit()
    const kept: HabitLog = {
      id: "manual",
      habitId: h.id,
      day: dayOffset(-2),
      status: "skipped",
      loggedAt: new Date(T0).toISOString(),
      source: "tap",
    }
    habitsStore.set((s) => ({ ...s, habits: [h], logs: [kept] }))
    screenStore.set({ groups: [SOCIAL], days: [row(SOCIAL.id, 1, 15, false)] })
    const done = (back: number, id: string): HabitLog => ({
      id,
      habitId: h.id,
      day: dayOffset(-back),
      status: "done",
      loggedAt: new Date(T0).toISOString(),
      source: "screen",
    })
    A.applyReconcile({
      days: [
        // Same group and day under another id: lands on the existing row.
        { ...row(SOCIAL.id, 1, 10, true), id: "other" },
        row(SOCIAL.id, 3, 0),
      ],
      logs: [done(1, "l1"), done(2, "l2")],
    })
    const days = screenStore.get().days
    expect(days).toHaveLength(2)
    expect(days.find((d) => d.day === dayOffset(-1))).toMatchObject({
      id: `d-${SOCIAL.id}-1`,
      usedMin: 15,
      closed: true,
    })
    const logs = habitsStore.get().logs
    expect(logs.map((l) => l.id).sort()).toEqual(["l1", "manual"])
    expect(logs.find((l) => l.id === "manual")).toEqual(kept)
  })
})

describe("a habit driven by screen time", () => {
  test("refuses every manual action", () => {
    const h = ruleHabit()
    const kept: HabitLog = {
      id: "l0",
      habitId: h.id,
      day: dayOffset(-1),
      status: "done",
      loggedAt: new Date(T0).toISOString(),
      source: "screen",
    }
    habitsStore.set((s) => ({ ...s, habits: [h], logs: [kept] }))
    const before = habitsStore.get()
    expect(checkHabit(h.id)).toBeNull()
    expect(logHabit({ habitId: h.id, status: "done" })).toBeNull()
    expect(incrementCount(h.id)).toBeNull()
    expect(skipHabit(h.id)).toBeNull()
    expect(clearLog(h.id, dayOffset(-1))).toBeNull()
    expect(startTimer(h.id)).toBe(false)
    expect(habitsStore.get()).toBe(before)
    expect(liveStore.get().live).toBeNull()
  })
})

describe("sync rows", () => {
  const byName = (name: string) => {
    const m = screenMappers(USER).find((x) => x.entity === name)
    if (!m) throw new Error(name)
    return m as AnyMapper
  }
  const state = () => screenStore.get()

  test("screen_group round-trips and sends snake_case", () => {
    const m = byName("screen_group")
    const archived = { ...SOCIAL, archivedAt: "2026-10-19T01:00:00.000Z" }
    screenStore.set({ groups: [ALL, archived], days: [] })
    expect(m.toServer(ALL, state())).toEqual({
      name: "All apps",
      kind: "all",
      budget_min: 180,
      sort_order: 0,
      archived_at: null,
    })
    for (const g of [ALL, archived])
      expect(
        m.fromServer(
          { id: g.id, ...m.toServer(g, state()), version: 1 },
          state(),
        ),
      ).toEqual(g)
    expect(
      m.fromServer({ id: "x", name: "?", kind: "weird" }, state()),
    ).toBeNull()
    const diff = diffEntity(m, state(), {}, {})
    expect(diff.upserts.map((u) => [u.id, u.create])).toEqual([
      [ALL.id, true],
      [SOCIAL.id, true],
    ])
  })

  test("screen_day round-trips; a pulled row takes the place of the same group and day", () => {
    const m = byName("screen_day")
    const d = row(SOCIAL.id, 1, 45)
    screenStore.set({ groups: [SOCIAL], days: [d] })
    expect(m.toServer(d, state())).toEqual({
      group_id: SOCIAL.id,
      day: d.day,
      used_min: 45,
      closed: true,
      updated_at: d.updatedAt,
    })
    const back = m.fromServer({ id: d.id, ...m.toServer(d, state()) }, state())
    expect(back).toEqual(d)
    const server = { ...d, id: "server-id", usedMin: 60 }
    const merged = m.merge(state(), [server], [])
    expect(merged.days).toEqual([server])
  })

  test("groups go before days", () => {
    expect(screenMappers(USER).map((m) => m.entity)).toEqual([
      "screen_group",
      "screen_day",
    ])
  })
})
