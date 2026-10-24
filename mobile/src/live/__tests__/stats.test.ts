import { useFacets } from "@domain/dash/facets"
import {
  lifeScoreOf,
  useAchievements,
  useAllCalendar,
  useAllMetrics,
  useAllMisses,
  useAreaRates,
  useLifeScore,
  useMetricDetail,
  useOnTarget,
  useTodayRing,
  useTrophies,
} from "@domain/dash/hooks"
import {
  connectStatsSource,
  resolveStat,
  type ServerAchievements,
  type ServerOverview,
  type StatsSource,
  statKey,
  statsCache,
} from "@domain/dash/server-stats"
import { dayKey } from "@domain/lib/day"
import { setConnectivity } from "@domain/lib/platform"
import { act, renderHook } from "@testing-library/react-native"
import { ApiError, type Http, NetworkError } from "../http"
import { createStats, specFor } from "../stats"

// ------------------------------------------------------------ fixtures
// Hand-written server answers (the shapes of stats/schema.py), so every
// expected value below is read off this payload, never computed by the code
// under test.

const OVERVIEW_7D: ServerOverview = {
  range: "7d",
  days: 7,
  life_score: 61,
  prev_score: 55,
  delta: 6,
  areas: [
    { module: "habits", enabled: true, weight: 3, rate: 0.8, prev: 0.7 },
    { module: "tasks", enabled: true, weight: 2, rate: 0.5, prev: 0.4 },
    { module: "fitness", enabled: true, weight: 3, rate: null, prev: null },
    { module: "finance", enabled: true, weight: 2, rate: 0.25, prev: 0.3 },
  ],
  on_target: {
    threshold: 0.8,
    rate: 0.5,
    prev_rate: 0.25,
    on_target: 3,
    scored: 6,
    current: 2,
    best: 4,
    logged: 6,
  },
  days_series: [{ day: dayKey(), due: 4, done: 4, on_target: true }],
  today: { due: 4, done: 4, per: {} },
  facets: [
    {
      key: "routines",
      label: "Routines",
      module: "habits",
      value: 0.9,
      prev: 0.6,
      off: false,
      href: "/habits/routines",
      metric_keys: [],
      extra: [
        {
          module: "habits",
          key: "routines.rate",
          ref: "habits:routines.rate",
          label: "Routines completed",
          value: "90%",
          number: 90,
          delta: 30,
          good_when: "up",
          shareable: true,
        },
      ],
    },
  ],
  metrics: [
    {
      module: "tasks",
      key: "tasks.onTime",
      ref: "tasks:tasks.onTime",
      label: "On time",
      value: "77%",
      number: 77,
      delta: null,
      good_when: null,
      shareable: true,
    },
  ],
}

const ACHIEVEMENTS: ServerAchievements = {
  data: [
    {
      id: "streak-7",
      type: "streak",
      title: "7-day on-target streak",
      requirement: "Hit your daily target 7 days in a row",
      pct: 0.29,
      text: "2 / 7 days",
      trophy: null,
    },
  ],
  trophies: [
    {
      id: "first-wrap-2026-10-01",
      type: "first",
      title: "First day wrapped up",
      value: "1st",
      detail: "Sealed a day",
      day: "2026-10-01",
      href: "/today/wrap-up",
      share_ref: null,
      seen: false,
    },
  ],
  unseen: 1,
}

// ---------------------------------------------------------- the source

function fakeHttp(answer: (path: string) => unknown) {
  const calls: string[] = []
  const http: Http = {
    request: async <T>(_m: string, path: string): Promise<T> => {
      calls.push(path)
      const a = answer(path)
      if (a instanceof Error) throw a
      return a as T
    },
    raw: async () => {
      throw new Error("unused")
    },
  }
  return { http, calls }
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  statsCache.set({ owner: "", editedAt: 0, entries: {} })
  connectStatsSource(null)
  setConnectivity(true)
})

test("every cache key maps to its endpoint", () => {
  expect(specFor("overview:30d")).toEqual({
    path: "/stats/overview?range=30d",
  })
  expect(specFor("today")).toEqual({ path: "/dashboard/today" })
  expect(specFor("achievements")).toEqual({ path: "/stats/achievements" })
  expect(specFor("calendar:2026-10-01:2026-10-07")).toEqual({
    path: "/stats/calendar?from=2026-10-01&to=2026-10-07",
    paged: true,
  })
  expect(specFor("misses:2026-10-01:2026-10-07")?.path).toBe(
    "/stats/misses?from=2026-10-01&to=2026-10-07",
  )
  expect(specFor("metric:habits:habits.rate")).toEqual({
    path: "/stats/metrics/habits%3Ahabits.rate",
  })
  expect(specFor("series:life:14")).toEqual({
    path: "/stats/series?metric=life&days=14",
  })
  expect(specFor("nope")).toBeNull()
})

test("watch fetches once, stamps the start time, and dedupes in flight", async () => {
  let t = 1_000
  const { http, calls } = fakeHttp(() => OVERVIEW_7D)
  const s = createStats({ http, online: () => true, now: () => t })
  const k = statKey.overview("7d")
  s.source.watch(k)
  s.source.watch(k) // in flight: no second request
  t = 5_000
  await settle()
  expect(calls).toEqual(["/stats/overview?range=7d"])
  expect(statsCache.get().entries[k]).toMatchObject({
    data: OVERVIEW_7D,
    at: 1_000,
    pending: false,
  })
  s.source.touch(k) // fresh: nothing
  await settle()
  expect(calls).toHaveLength(1)
  s.markEdited() // a local edit makes it stale
  s.source.touch(k)
  await settle()
  expect(calls).toHaveLength(2)
  t = 100_000 // older than STALE_MS
  s.source.touch(k)
  await settle()
  expect(calls).toHaveLength(3)
})

test("paged lists walk at most five pages and flag the rest", async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }))
  const { http, calls } = fakeHttp(() => ({ data: page, count: 750 }))
  const s = createStats({ http, online: () => true })
  await s.load(statKey.calendar("2026-01-01", "2026-12-31"))
  expect(calls).toHaveLength(5)
  expect(calls[4]).toContain("skip=400&limit=100")
  const e = statsCache.get().entries["calendar:2026-01-01:2026-12-31"]
  expect((e.data as unknown[]).length).toBe(500)
  expect(e.truncated).toBe(true)

  const short = fakeHttp(() => ({ data: page.slice(0, 3), count: 3 }))
  const s2 = createStats({ http: short.http, online: () => true })
  await s2.load(statKey.misses("2026-10-01", "2026-10-07"))
  expect(short.calls).toHaveLength(1)
  expect(
    statsCache.get().entries["misses:2026-10-01:2026-10-07"].truncated,
  ).toBe(false)
})

test("offline sends nothing; failures keep the last good data", async () => {
  const off = fakeHttp(() => OVERVIEW_7D)
  const s = createStats({ http: off.http, online: () => false })
  await s.load("today")
  expect(off.calls).toEqual([])
  expect(statsCache.get().entries.today).toMatchObject({ error: "offline" })

  let fail: Error | null = null
  const flaky = fakeHttp(() => fail ?? { ring: { due: 1, done: 0, per: {} } })
  const s2 = createStats({ http: flaky.http, online: () => true })
  await s2.load("today")
  fail = new ApiError(500, "boom", "boom")
  await s2.load("today")
  expect(statsCache.get().entries.today).toMatchObject({
    error: "failed",
    data: { ring: { due: 1, done: 0, per: {} } },
  })
  fail = new NetworkError("down")
  await s2.load("today")
  expect(statsCache.get().entries.today.error).toBe("offline")
})

test("refreshAll refetches watched keys only; start drops another account", async () => {
  const { http, calls } = fakeHttp(() => ({}))
  const s = createStats({ http, online: () => true })
  statsCache.set({
    owner: "other",
    editedAt: 9,
    entries: { today: { data: 1 } },
  })
  s.start("me")
  expect(statsCache.get()).toEqual({ owner: "me", editedAt: 0, entries: {} })
  const stop = s.source.watch("achievements")
  await settle()
  await s.refreshAll()
  expect(calls).toEqual(["/stats/achievements", "/stats/achievements"])
  stop()
  await s.refreshAll()
  expect(calls).toHaveLength(2)
  s.stop()
})

test("resolveStat keeps loading, empty and error apart", () => {
  expect(resolveStat(false, { data: [1] }, 0, true)).toEqual({
    data: undefined,
    status: "off",
    source: "local",
  })
  expect(resolveStat(true, undefined, 0, true).status).toBe("loading")
  expect(resolveStat(true, { pending: true }, 0, true)).toMatchObject({
    status: "loading",
    source: "local",
  })
  expect(resolveStat(true, { error: "failed" }, 0, true)).toMatchObject({
    status: "error",
    source: "local",
  })
  expect(resolveStat(true, { data: [], at: 5 }, 0, true)).toEqual({
    data: [],
    status: "empty",
    source: "server",
  })
  expect(resolveStat(true, { data: [1], at: 5 }, 0, true)).toMatchObject({
    status: "ready",
    source: "server",
  })
  // An edit newer than the fetch, or offline: the local value shows.
  expect(resolveStat(true, { data: [1], at: 5 }, 6, true).source).toBe("local")
  expect(resolveStat(true, { data: [1], at: 5 }, 0, false).source).toBe("local")
})

// ----------------------------------------------------- the live switch

/** A connected source that serves whatever the cache holds. */
function connect(entries: Record<string, unknown>) {
  const watched: string[] = []
  const src: StatsSource = {
    watch: (k) => {
      watched.push(k)
      return () => {}
    },
    touch: () => {},
  }
  act(() => {
    statsCache.set({
      owner: "me",
      editedAt: 0,
      entries: Object.fromEntries(
        Object.entries(entries).map(([k, data]) => [k, { data, at: 1 }]),
      ),
    })
    connectStatsSource(src)
  })
  return watched
}

test("an area with nothing to rate is left out of the Life Score, as on the server", () => {
  // The account seen on 2026-10-21: no habits, no accounts. By hand:
  // (3 x 0.25 + 2 x 0.5) / (3 + 2) = 0.35. Counting habits and finance as 0
  // instead gives 1.75 / 10 = 0.175, the 18 the device showed before the
  // server's 35 arrived.
  // Nutrition (ADR-0024) with nothing logged is unrated too.
  const rates = {
    habits: 0,
    tasks: 0.5,
    fitness: 0.25,
    nutrition: 0,
    focus: 0,
    finance: 0,
  }
  // Focus (ADR-0025) switched off, so the sums above stay as they were.
  const weights = {
    habits: 3,
    tasks: 2,
    fitness: 3,
    nutrition: 2,
    focus: 2,
    finance: 2,
  }
  const enabled = {
    habits: true,
    tasks: true,
    fitness: true,
    nutrition: true,
    focus: false,
    finance: true,
  }
  const rated = {
    habits: false,
    tasks: true,
    fitness: true,
    nutrition: false,
    focus: false,
    finance: false,
  }
  expect(lifeScoreOf(rates, weights, enabled, rated)).toBe(35)
  // Counting the unrated areas as 0: 1.75 / 12 = 0.146.
  expect(lifeScoreOf(rates, weights, enabled)).toBe(15)
  const none = {
    habits: false,
    tasks: false,
    fitness: false,
    nutrition: false,
    focus: false,
    finance: false,
  }
  expect(lifeScoreOf(rates, weights, enabled, none)).toBeNull()
})

test("prototype and web: no source, the hooks compute locally", () => {
  const { result } = renderHook(() => useLifeScore(7))
  expect(result.current.source).toBe("local")
  expect(result.current.status).toBe("off")
})

test("live: Life Score, area rates, on-target and metrics read the overview", () => {
  const watched = connect({ [statKey.overview("7d")]: OVERVIEW_7D })
  const ls = renderHook(() => useLifeScore(7)).result.current
  expect(ls).toMatchObject({
    score: 61,
    prev: 55,
    delta: 6,
    source: "server",
    rates: { habits: 0.8, tasks: 0.5, fitness: 0, finance: 0.25 },
    prevRates: { habits: 0.7, tasks: 0.4, fitness: 0, finance: 0.3 },
  })
  expect(renderHook(() => useAreaRates(7, 7)).result.current.finance).toBe(0.3)
  const t = renderHook(() => useOnTarget(7)).result.current
  expect(t).toMatchObject({
    rate: 0.5,
    prevRate: 0.25,
    onTarget: 3,
    scored: 6,
    current: 2,
    best: 4,
    logged: 6,
    source: "server",
  })
  expect(t.range).toEqual([{ day: dayKey(), due: 4, done: 4, onTarget: true }])
  // The long series keeps its length; today comes from the server.
  expect(t.series.length).toBe(365)
  expect(t.series.at(-1)).toEqual(t.range[0])
  const m = renderHook(() => useAllMetrics(7)).result.current
  expect(m.tasks).toEqual([
    { key: "tasks.onTime", label: "On time", value: "77%", shareable: true },
  ])
  expect(m.habits).toEqual([])
  const f = renderHook(() => useFacets(7)).result.current
  expect(f).toEqual([
    expect.objectContaining({
      key: "routines",
      value: 0.9,
      metricKeys: [],
      extra: [expect.objectContaining({ key: "routines.rate", delta: 30 })],
    }),
  ])
  expect(watched).toContain("overview:7d")
})

test("live: a range the server has no form for stays local", () => {
  connect({ [statKey.overview("7d")]: OVERVIEW_7D })
  const ls = renderHook(() => useLifeScore(14)).result.current
  expect(ls.source).toBe("local")
  expect(ls.status).toBe("off")
})

test("live, first load in flight: the local value shows, status loading", () => {
  connect({})
  const ls = renderHook(() => useLifeScore(7)).result.current
  expect(ls.source).toBe("local")
  expect(ls.status).toBe("loading")
  // The prototype seed is local data, so nothing renders empty.
  expect(
    renderHook(() => useAllCalendar(dayKey(), dayKey())).result.current.length,
  ).toBeGreaterThan(0)
})

test("live, offline: the local calculation shows even with a cache", () => {
  connect({ [statKey.overview("7d")]: OVERVIEW_7D })
  act(() => setConnectivity(false))
  expect(renderHook(() => useLifeScore(7)).result.current.source).toBe("local")
})

test("live: an empty server list renders empty, not the local list", () => {
  const today = dayKey()
  connect({
    [statKey.calendar(today, today)]: [],
    [statKey.misses(today, today)]: [],
  })
  expect(renderHook(() => useAllCalendar(today, today)).result.current).toEqual(
    [],
  )
  expect(renderHook(() => useAllMisses(today, today)).result.current).toEqual(
    [],
  )
})

test("live: calendar, misses, ring, achievements, trophies, metric detail", () => {
  const today = dayKey()
  connect({
    [statKey.calendar(today, today)]: [
      {
        id: "t1",
        day: today,
        time: null,
        title: "Ship",
        module: "tasks",
        done: null,
        href: "/tasks",
      },
      {
        id: "x",
        day: today,
        time: "09:00",
        title: "Unknown module",
        module: "social",
        done: true,
        href: "/",
      },
    ],
    [statKey.misses(today, today)]: [
      {
        id: "m1",
        day: today,
        title: "Run",
        module: "habits",
        href: "/habits",
        kind: "habit",
        note: null,
      },
    ],
    [statKey.today()]: {
      ring: { due: 9, done: 3, per: { habits: { due: 5, done: 2 } } },
      life_score: 61,
      streak: 2,
    },
    [statKey.achievements()]: ACHIEVEMENTS,
    [statKey.metric("life")]: {
      ref: "life",
      week: {
        ref: "life",
        label: "Life Score",
        module: "life",
        value: "61",
        n: 61,
        unit: "",
        good_when: "up",
        shareable: true,
        delta: null,
      },
      month: null,
    },
  })
  expect(renderHook(() => useAllCalendar(today, today)).result.current).toEqual(
    [
      {
        id: "t1",
        day: today,
        title: "Ship",
        module: "tasks",
        href: "/tasks",
      },
    ],
  )
  expect(renderHook(() => useAllMisses(today, today)).result.current).toEqual([
    { id: "m1", day: today, title: "Run", module: "habits", href: "/habits" },
  ])
  expect(renderHook(() => useTodayRing()).result.current).toEqual({
    due: 9,
    done: 3,
    per: {
      habits: { due: 5, done: 2 },
      tasks: { due: 0, done: 0 },
      fitness: { due: 0, done: 0 },
      nutrition: { due: 0, done: 0 },
      focus: { due: 0, done: 0 },
      finance: { due: 0, done: 0 },
    },
  })
  expect(renderHook(() => useAchievements()).result.current).toEqual([
    {
      id: "streak-7",
      type: "streak",
      title: "7-day on-target streak",
      requirement: "Hit your daily target 7 days in a row",
      progress: { pct: 0.29, text: "2 / 7 days" },
      trophy: null,
    },
  ])
  expect(renderHook(() => useTrophies()).result.current).toEqual([
    {
      id: "first-wrap-2026-10-01",
      type: "first",
      title: "First day wrapped up",
      value: "1st",
      detail: "Sealed a day",
      day: "2026-10-01",
      href: "/today/wrap-up",
    },
  ])
  const d = renderHook(() => useMetricDetail("life")).result.current
  expect(d.week).toEqual({
    ref: "life",
    label: "Life Score",
    module: "life",
    value: "61",
    n: 61,
    unit: "",
    goodWhen: "up",
    shareable: true,
  })
  expect(d.month).toBeUndefined()
})

test("a stat fetched while an edit is still on its way stays stale until the refetch", async () => {
  const t = 1_000
  let settled = false
  const { http } = fakeHttp(() => OVERVIEW_7D)
  const s = createStats({
    http,
    online: () => true,
    now: () => t,
    settled: () => settled,
  })
  const k = statKey.overview("7d")
  s.markEdited() // a habit checked off at t
  s.source.watch(k) // a sync already in flight refetches before the push
  await settle()
  const before = statsCache.get()
  expect(before.entries[k]?.at).toBe(0)
  // Not fresh: the screen keeps the local numbers.
  expect(
    resolveStat(true, before.entries[k], before.editedAt, true).source,
  ).toBe("local")
  settled = true // the push landed; the sync's refresh runs
  await s.refreshAll()
  const after = statsCache.get()
  expect(resolveStat(true, after.entries[k], after.editedAt, true).source).toBe(
    "server",
  )
})
