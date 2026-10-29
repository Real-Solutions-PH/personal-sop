// Screen time's pure rules (spec "Rules"): the rung ladder, the app-day
// window, the too-early guard, what a day's native events add up to, an auto
// habit's ring, the reconciler that turns closed days into rows and logs, and
// the Screen time area's score. Times are built with local Date constructors
// so the expectations hold in any time zone.
import type { Habit, HabitLog } from "@domain/habits/data"
import { derivedId } from "@domain/lib/ids"
import type { NativeEvent, ScreenDay, ScreenGroup } from "@domain/screen/data"
import {
  areaRate,
  dayOf,
  dayScore,
  observe,
  plausible,
  reconcile,
  ruleState,
  rungsFor,
  STANDARD_RUNGS,
  windowFor,
} from "@domain/screen/logic"

const H = 4
const MIN = 60_000
const G = "00000000-0000-4000-8000-0000000000a1"
const G2 = "00000000-0000-4000-8000-0000000000a2"
// Local wall-clock instant on October `d`, 2026.
const t = (d: number, hh: number, mm = 0) =>
  new Date(2026, 9, d, hh, mm, 0, 0).getTime()

const habit = (id: string, maxMin: number, groupId = G): Habit =>
  ({
    id,
    name: "No social",
    icon: "📵",
    type: "check",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
    reminder: false,
    status: "active",
    pauses: [],
    linkWorkout: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    sortOrder: 0,
    rule: { kind: "screen_limit", groupId, maxMin },
  }) as Habit

// A fully observed, closed app-day for G on October `d` with the given rungs
// (minutes, each crossed late enough to be plausible).
const closedDay = (d: number, rungs: number[], groupId = G): NativeEvent[] => [
  { kind: "start", groupId, at: t(d, H), hasSelection: true },
  ...rungs.map(
    (r): NativeEvent => ({ kind: "rung", groupId, at: t(d, 20), rungMin: r }),
  ),
  { kind: "end", groupId, at: t(d + 1, H) - MIN },
]

let n = 0
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`

describe("rungs", () => {
  test("the standard ladder", () => {
    expect(STANDARD_RUNGS).toEqual([
      1, 5, 10, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210,
      225, 240, 300, 360, 480,
    ])
  })
  test("rungsFor adds limit+1 once each, sorted", () => {
    const r = rungsFor([0, 30])
    expect(r.filter((x) => x === 1)).toHaveLength(1)
    expect(r.filter((x) => x === 31)).toHaveLength(1)
    expect(r).toEqual([...r].sort((a, b) => a - b))
    expect(r).toHaveLength(STANDARD_RUNGS.length + 1)
    expect(rungsFor([30, 30])).toHaveLength(STANDARD_RUNGS.length + 1)
  })
})

describe("window and day", () => {
  test("the window runs from the day start to one minute before the next", () => {
    expect(windowFor("2026-10-20", H)).toEqual({
      startMs: t(20, 4),
      endMs: t(21, 3, 59),
    })
    expect(windowFor("2026-10-20", 0)).toEqual({
      startMs: t(20, 0),
      endMs: t(20, 23, 59),
    })
  })
  test("dayOf keys an instant to the app day that contains it", () => {
    expect(dayOf(t(20, 4), H)).toBe("2026-10-20")
    expect(dayOf(t(21, 3, 59), H)).toBe("2026-10-20")
    expect(dayOf(t(20, 3, 59), H)).toBe("2026-10-19")
    expect(dayOf(t(20, 3, 59), 0)).toBe("2026-10-20")
  })
  test("a rung of N minutes needs N minutes since the window began", () => {
    const start = t(20, 4)
    expect(plausible(60, start + 59 * MIN, start)).toBe(false)
    expect(plausible(60, start + 60 * MIN, start)).toBe(true)
  })
})

describe("observe", () => {
  test("no start for the day: listed, not observed (Review Focus 1)", () => {
    const obs = observe(
      [{ kind: "rung", groupId: G, at: t(20, 12), rungMin: 30 }],
      H,
    )
    expect(obs).toEqual([
      {
        day: "2026-10-20",
        groupId: G,
        observed: false,
        usedMin: 30,
        closed: false,
      },
    ])
  })
  test("a start without a selection is not observed (Review Focus 1)", () => {
    const obs = observe(
      [
        { kind: "start", groupId: G, at: t(20, 4), hasSelection: false },
        { kind: "end", groupId: G, at: t(21, 3, 59) },
      ],
      H,
    )
    expect(obs).toEqual([
      {
        day: "2026-10-20",
        groupId: G,
        observed: false,
        usedMin: 0,
        closed: true,
      },
    ])
  })
  test("duplicate, out-of-order and implausible rungs keep the max plausible (Review Focus 2)", () => {
    const obs = observe(
      [
        { kind: "rung", groupId: G, at: t(20, 9), rungMin: 30 },
        { kind: "end", groupId: G, at: t(21, 3, 59) },
        { kind: "rung", groupId: G, at: t(20, 4, 10), rungMin: 60 },
        { kind: "rung", groupId: G, at: t(20, 8), rungMin: 15 },
        { kind: "start", groupId: G, at: t(20, 4), hasSelection: true },
        { kind: "rung", groupId: G, at: t(20, 9, 5), rungMin: 30 },
      ],
      H,
    )
    expect(obs).toEqual([
      {
        day: "2026-10-20",
        groupId: G,
        observed: true,
        usedMin: 30,
        closed: true,
      },
    ])
  })
  test("days and groups are kept apart", () => {
    const obs = observe(
      [
        ...closedDay(20, [5]),
        ...closedDay(21, [10]),
        ...closedDay(20, [45], G2),
      ],
      H,
    )
    expect(obs.map((o) => [o.day, o.groupId, o.usedMin])).toEqual([
      ["2026-10-20", G, 5],
      ["2026-10-20", G2, 45],
      ["2026-10-21", G, 10],
    ])
  })
})

describe("ruleState", () => {
  const rule = { kind: "screen_limit" as const, groupId: G, maxMin: 30 }
  const obs = (usedMin: number, observed = true) => ({
    day: "2026-10-20",
    groupId: G,
    observed,
    usedMin,
    closed: false,
  })
  test("untracked without an observed day", () => {
    expect(ruleState(rule, undefined, t(20, 12), H)).toEqual({
      kind: "untracked",
    })
    expect(ruleState(rule, obs(0, false), t(20, 12), H)).toEqual({
      kind: "untracked",
    })
  })
  test("broken past the limit", () => {
    expect(ruleState(rule, obs(45), t(20, 12), H)).toEqual({
      kind: "broken",
      usedMin: 45,
      overMin: 15,
    })
  })
  test("tracking fills with the elapsed window", () => {
    const { startMs, endMs } = windowFor("2026-10-20", H)
    const mid = startMs + (endMs - startMs) / 2
    expect(ruleState(rule, obs(30), mid, H)).toEqual({
      kind: "tracking",
      usedMin: 30,
      progress: 0.5,
    })
    expect(ruleState(rule, obs(0), t(22, 12), H)).toMatchObject({ progress: 1 })
    expect(ruleState(rule, obs(0), t(19, 12), H)).toMatchObject({ progress: 0 })
  })
})

describe("reconcile", () => {
  const now = t(22, 12)
  test("a closed day within the limit writes a row and a derived screen log", () => {
    n = 0
    const h = habit("h1", 30)
    const out = reconcile({
      events: closedDay(20, [5, 30]),
      habits: [h],
      logs: [],
      existingDays: [],
      nowMs: now,
      dayStartHour: H,
      newId,
    })
    expect(out.days).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000001",
        groupId: G,
        day: "2026-10-20",
        usedMin: 30,
        closed: true,
        updatedAt: new Date(now).toISOString(),
      },
    ])
    expect(out.logs).toEqual([
      {
        id: derivedId("screen-habit", "h1", "2026-10-20"),
        habitId: "h1",
        day: "2026-10-20",
        status: "done",
        loggedAt: new Date(t(21, 3, 59)).toISOString(),
        source: "screen",
      },
    ])
  })
  test("an end delivered after the next window opened still closes its own day", () => {
    n = 0
    const events = closedDay(20, [5]).map((e) =>
      e.kind === "end" ? { ...e, at: t(21, 6, 30) } : e,
    )
    const out = reconcile({
      events,
      habits: [habit("h1", 30)],
      logs: [],
      existingDays: [],
      nowMs: now,
      dayStartHour: H,
      newId,
    })
    expect(out.days.map((d) => [d.day, d.closed])).toEqual([
      ["2026-10-20", true],
    ])
    expect(out.logs.map((l) => l.day)).toEqual(["2026-10-20"])
  })
  test("archived, paused and unscheduled habits get no log", () => {
    const archived = { ...habit("h1", 30), status: "archived" as const }
    const paused = { ...habit("h2", 30), pauses: [{ from: "2026-10-19" }] }
    const offDay = { ...habit("h3", 30), schedule: [{ days: [] }] }
    const out = reconcile({
      events: closedDay(20, [5]),
      habits: [archived, paused, offDay],
      logs: [],
      existingDays: [],
      nowMs: now,
      dayStartHour: H,
      newId,
    })
    expect(out.logs).toEqual([])
  })
  test("a broken day writes the row but no log", () => {
    const out = reconcile({
      events: closedDay(20, [31]),
      habits: [habit("h1", 30)],
      logs: [],
      existingDays: [],
      nowMs: now,
      dayStartHour: H,
      newId,
    })
    expect(out.days).toHaveLength(1)
    expect(out.logs).toEqual([])
  })
  test("an existing log of any source is never overwritten (Review Focus 3)", () => {
    for (const source of ["tap", "screen"] as const) {
      const existing: HabitLog = {
        id: "l1",
        habitId: "h1",
        day: "2026-10-20",
        status: "skipped",
        loggedAt: "2026-10-20T10:00:00.000Z",
        source,
      }
      const out = reconcile({
        events: closedDay(20, [5]),
        habits: [habit("h1", 30)],
        logs: [existing],
        existingDays: [],
        nowMs: now,
        dayStartHour: H,
        newId,
      })
      expect(out.logs).toEqual([])
    }
  })
  test("an unobserved day writes nothing (Review Focus 1)", () => {
    const out = reconcile({
      events: [
        { kind: "rung", groupId: G, at: t(20, 12), rungMin: 5 },
        { kind: "end", groupId: G, at: t(21, 3, 59) },
      ],
      habits: [habit("h1", 30)],
      logs: [],
      existingDays: [],
      nowMs: now,
      dayStartHour: H,
      newId,
    })
    expect(out).toEqual({ days: [], logs: [] })
  })
  test("reuses an existing row's id and never lowers usedMin", () => {
    const old: ScreenDay = {
      id: "d-old",
      groupId: G,
      day: "2026-10-20",
      usedMin: 45,
      closed: false,
      updatedAt: "2026-10-20T10:00:00.000Z",
    }
    const out = reconcile({
      events: closedDay(20, [10]),
      habits: [habit("h1", 30)],
      logs: [],
      existingDays: [old],
      nowMs: now,
      dayStartHour: H,
      newId,
    })
    expect(out.days).toEqual([
      {
        ...old,
        usedMin: 45,
        closed: true,
        updatedAt: new Date(now).toISOString(),
      },
    ])
    // The kept 45 breaks a 30-minute limit: no log.
    expect(out.logs).toEqual([])
  })
  test("raises an existing row with a higher rung", () => {
    const old: ScreenDay = {
      id: "d-old",
      groupId: G,
      day: "2026-10-20",
      usedMin: 5,
      closed: true,
      updatedAt: "2026-10-20T10:00:00.000Z",
    }
    const out = reconcile({
      events: closedDay(20, [10]),
      habits: [],
      logs: [],
      existingDays: [old],
      nowMs: now,
      dayStartHour: H,
      newId,
    })
    expect(out.days).toEqual([
      { ...old, usedMin: 10, updatedAt: new Date(now).toISOString() },
    ])
  })
  test("today's open observed day writes a row with closed false, no log", () => {
    n = 0
    const out = reconcile({
      events: [
        { kind: "start", groupId: G, at: t(22, 4), hasSelection: true },
        { kind: "rung", groupId: G, at: t(22, 9), rungMin: 15 },
      ],
      habits: [habit("h1", 30)],
      logs: [],
      existingDays: [],
      nowMs: now,
      dayStartHour: H,
      newId,
    })
    expect(out.days).toEqual([
      expect.objectContaining({
        day: "2026-10-22",
        usedMin: 15,
        closed: false,
      }),
    ])
    expect(out.logs).toEqual([])
  })
  test("days older than seven app-days are left alone", () => {
    const out = reconcile({
      events: [...closedDay(14, [5]), ...closedDay(15, [5])],
      habits: [habit("h1", 30)],
      logs: [],
      existingDays: [],
      nowMs: now,
      dayStartHour: H,
      newId,
    })
    expect(out.days.map((d) => d.day)).toEqual(["2026-10-15"])
    expect(out.logs.map((l) => l.day)).toEqual(["2026-10-15"])
  })
  test("only habits ruled on the day's group are logged", () => {
    const out = reconcile({
      events: closedDay(20, [5]),
      habits: [
        habit("h1", 30),
        habit("h2", 30, G2),
        { ...habit("h3", 0), rule: undefined },
      ],
      logs: [],
      existingDays: [],
      nowMs: now,
      dayStartHour: H,
      newId,
    })
    expect(out.logs.map((l) => l.habitId)).toEqual(["h1"])
  })
})

describe("scores", () => {
  test("dayScore", () => {
    expect(dayScore(30, 60)).toBe(1)
    expect(dayScore(60, 60)).toBe(1)
    expect(dayScore(90, 60)).toBe(0.5)
    expect(dayScore(120, 60)).toBe(0)
    expect(dayScore(500, 60)).toBe(0)
  })
  const group = (id: string, budgetMin: number): ScreenGroup => ({
    id,
    name: id,
    kind: "custom",
    budgetMin,
    sortOrder: 0,
  })
  const row = (
    groupId: string,
    day: string,
    usedMin: number,
    closed = true,
  ): ScreenDay => ({
    id: `${groupId}-${day}`,
    groupId,
    day,
    usedMin,
    closed,
    updatedAt: "2026-10-22T00:00:00.000Z",
  })
  test("areaRate averages groups per closed day, then days; budget 0 skipped", () => {
    const groups = [group(G, 60), group(G2, 0)]
    expect(
      areaRate(
        [
          row(G, "2026-10-20", 90),
          row(G2, "2026-10-20", 500),
          row(G, "2026-10-21", 30),
          row(G, "2026-10-22", 500, false),
        ],
        groups,
      ),
    ).toBe(0.75)
    expect(areaRate([row(G2, "2026-10-20", 0)], groups)).toBeNull()
  })
  test("areaRate is null without closed days", () => {
    expect(areaRate([], [group(G, 60)])).toBeNull()
    expect(
      areaRate([row(G, "2026-10-22", 10, false)], [group(G, 60)]),
    ).toBeNull()
  })
})
