// Fern's read of yesterday is asked for once a day in the background after
// the app opens (a sync reached the server), and the Yesterday page reuses
// that answer or the request still in flight instead of asking again.

import { statKey, statsCache } from "@domain/dash/server-stats"
import { dayOffset } from "@domain/lib/day"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react-native"
import type { ReactNode } from "react"

const mockRequest = jest.fn()
jest.mock("@/live/auth", () => ({ http: { request: mockRequest } }))

const {
  installYesterdayPrewarm,
  prewarmYesterdayAnalysis,
  resetYesterdayPrewarm,
  useYesterdayAnalysis,
} = require("../yesterday-analysis") as typeof import("../yesterday-analysis")

const ANALYSIS = "/dashboard/misses/yesterday/analysis"
// 10:00 on the 15th: yesterday is the 14th.
const MORNING = new Date(2026, 10, 15, 10, 0)

const read = (day: string) => ({
  day,
  state: "analysis",
  source: "fern",
  points: ["Read slipped.", "Likely a late night.", "Read first today."],
  misses: 1,
  due: 3,
  done: 2,
  on_target: false,
})

const miss = (day: string) => ({
  id: `habit:read:${day}`,
  day,
  title: "Missed: Read",
  module: "habits",
  href: "/habits",
  kind: "habit",
  note: null,
})

/** The misses window as the server would return it into statsCache. */
function loader(rows: (now: Date) => unknown[] | null) {
  return jest.fn(async (key: string) => {
    const now = current
    const data = rows(now)
    statsCache.set((s) => ({
      ...s,
      entries: {
        ...s.entries,
        [key]: data === null ? { error: "failed" } : { data, at: 1 },
      },
    }))
  })
}
let current = MORNING

let client: QueryClient
const analysisCalls = () =>
  mockRequest.mock.calls.filter((c) => c[1] === ANALYSIS).length

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  current = MORNING
  mockRequest.mockReset()
  mockRequest.mockImplementation(async () => read(dayOffset(-1, current)))
  statsCache.set({ owner: "u1", editedAt: 0, entries: {} })
  client = new QueryClient()
  installYesterdayPrewarm(client)
  resetYesterdayPrewarm()
})
afterEach(() => client.clear())

const deps = (
  over: Partial<Parameters<typeof prewarmYesterdayAnalysis>[0]> = {},
) => ({
  owner: "u1",
  online: () => true,
  loadMisses: loader((now) => [miss(dayOffset(-1, now))]),
  now: current,
  ...over,
})

test("app open asks once; a foreground sync later the same day does not ask again", async () => {
  const loadMisses = loader((now) => [miss(dayOffset(-1, now))])
  expect(await prewarmYesterdayAnalysis(deps({ loadMisses }))).toBe("warmed")
  expect(analysisCalls()).toBe(1)
  expect(loadMisses).toHaveBeenCalledWith(
    statKey.misses(dayOffset(-7, MORNING), dayOffset(-1, MORNING)),
  )
  // Back in the foreground at 23:00: same day, nothing new.
  expect(
    await prewarmYesterdayAnalysis(
      deps({ loadMisses, now: new Date(2026, 10, 15, 23, 0) }),
    ),
  ).toBe("skipped")
  expect(analysisCalls()).toBe(1)
})

test("two syncs landing together make one request", async () => {
  await Promise.all([
    prewarmYesterdayAnalysis(deps()),
    prewarmYesterdayAnalysis(deps()),
  ])
  expect(analysisCalls()).toBe(1)
})

test("the page reads the prewarmed answer without a new request", async () => {
  await prewarmYesterdayAnalysis(deps())
  expect(analysisCalls()).toBe(1)
  const day = dayOffset(-1, MORNING)
  const { result } = renderHook(() => useYesterdayAnalysis(day, true), {
    wrapper,
  })
  // Ready on the first render: no loading state.
  expect(result.current.data?.day).toBe(day)
  expect(result.current.isPending).toBe(false)
  await act(async () => {})
  expect(analysisCalls()).toBe(1)
})

test("a page opened while the read is in flight joins that request", async () => {
  let answer: (v: unknown) => void = () => {}
  mockRequest.mockImplementation(
    () => new Promise((resolve) => (answer = resolve)),
  )
  const day = dayOffset(-1, MORNING)
  const warming = prewarmYesterdayAnalysis(deps())
  await waitFor(() => expect(analysisCalls()).toBe(1))
  const { result } = renderHook(() => useYesterdayAnalysis(day, true), {
    wrapper,
  })
  expect(result.current.isPending).toBe(true)
  await act(async () => {
    answer(read(day))
    await warming
  })
  await waitFor(() => expect(result.current.data?.day).toBe(day))
  expect(analysisCalls()).toBe(1)
})

test("a new day (past 04:00) asks again; before 04:00 it is still yesterday's day", async () => {
  await prewarmYesterdayAnalysis(deps())
  expect(analysisCalls()).toBe(1)
  // 02:00 on the 16th is still the 15th's business day.
  current = new Date(2026, 10, 16, 2, 0)
  expect(await prewarmYesterdayAnalysis(deps({ now: current }))).toBe("skipped")
  expect(analysisCalls()).toBe(1)
  // 04:30 on the 16th: a new day, yesterday is now the 15th.
  current = new Date(2026, 10, 16, 4, 30)
  expect(await prewarmYesterdayAnalysis(deps({ now: current }))).toBe("warmed")
  expect(analysisCalls()).toBe(2)
  const next = dayOffset(-1, current)
  expect(next).toBe("2026-11-15")
  expect(
    client.getQueryData(["dashboard", "yesterday-analysis", next]),
  ).toEqual(read(next))
  // The old day's read is dropped.
  expect(
    client.getQueryData(["dashboard", "yesterday-analysis", "2026-11-14"]),
  ).toBeUndefined()
})

test("nothing slipped yesterday: no request (only earlier days missed)", async () => {
  const loadMisses = loader((now) => [miss(dayOffset(-3, now))])
  expect(await prewarmYesterdayAnalysis(deps({ loadMisses }))).toBe("nothing")
  expect(analysisCalls()).toBe(0)
})

test("offline: nothing is asked, and the next sync online does", async () => {
  expect(await prewarmYesterdayAnalysis(deps({ online: () => false }))).toBe(
    "skipped",
  )
  expect(mockRequest).not.toHaveBeenCalled()
  expect(await prewarmYesterdayAnalysis(deps())).toBe("warmed")
  expect(analysisCalls()).toBe(1)
})

test("the misses list failed to load: no request, retried on the next sync", async () => {
  const failing = loader(() => null)
  expect(await prewarmYesterdayAnalysis(deps({ loadMisses: failing }))).toBe(
    "skipped",
  )
  expect(analysisCalls()).toBe(0)
  expect(await prewarmYesterdayAnalysis(deps())).toBe("warmed")
  expect(analysisCalls()).toBe(1)
})

test("a failed read is left for the page, which asks again when it opens", async () => {
  mockRequest.mockRejectedValueOnce(new Error("analysis_failed"))
  expect(await prewarmYesterdayAnalysis(deps())).toBe("warmed")
  expect(analysisCalls()).toBe(1)
  const day = dayOffset(-1, MORNING)
  const { result } = renderHook(() => useYesterdayAnalysis(day, true), {
    wrapper,
  })
  await waitFor(() => expect(result.current.data?.day).toBe(day))
  expect(analysisCalls()).toBe(2)
})

test("another account signs in: its own read, the last one's dropped", async () => {
  await prewarmYesterdayAnalysis(deps())
  expect(analysisCalls()).toBe(1)
  expect(await prewarmYesterdayAnalysis(deps({ owner: "u2" }))).toBe("warmed")
  expect(analysisCalls()).toBe(2)
})

test("signing out forgets the read", async () => {
  await prewarmYesterdayAnalysis(deps())
  resetYesterdayPrewarm()
  expect(
    client.getQueryData([
      "dashboard",
      "yesterday-analysis",
      dayOffset(-1, MORNING),
    ]),
  ).toBeUndefined()
})
