// Battery: requests per minute in a simulated session (fake clock). A sync
// is one pull; refreshing statistics is one request per watched key (7, the
// keys Today + Stats + Yesterday keep watched). Before this schedule the app
// pulled every 60 s in any app state and refetched every watched key after
// each pull: 8 requests a minute, foreground or (JS alive) background.

import {
  createSyncSchedule,
  POLL_STREAM_MS,
  STATS_QUIET_MS,
} from "../sync-schedule"

const WATCHED = 7

function session(opts: { changes?: () => boolean } = {}) {
  let app = "active"
  const log = { pulls: 0, stats: 0 }
  const s = createSyncSchedule({
    appState: () => app,
    // A sync settles at once here: one pull, then onSynced.
    sync: () => {
      log.pulls++
      s.onSynced(opts.changes?.() ?? false)
    },
    refreshStats: () => {
      log.stats += WATCHED
    },
  })
  s.start()
  return {
    s,
    log,
    setApp(next: string) {
      app = next
      s.onAppState(next)
    },
    requests() {
      const n = log.pulls + log.stats
      log.pulls = 0
      log.stats = 0
      return n
    },
  }
}

beforeEach(() => jest.useFakeTimers({ now: new Date("2026-11-15T09:00:00Z") }))
afterEach(() => jest.useRealTimers())

const minutes = (n: number) => jest.advanceTimersByTime(n * 60_000)

test("foreground, stream up, nothing changing: one pull every 5 minutes, no statistics", () => {
  const t = session()
  t.s.onSynced(true) // the launch sync (and its statistics)
  t.requests()
  t.s.onStreamOpen(true)
  minutes(10)
  const n = t.requests()
  expect(n).toBe(2) // was 80 (8 a minute)
  expect(n / 10).toBeLessThanOrEqual(0.2)
})

test("foreground, stream down: the minute pull stays; statistics only every 15 minutes", () => {
  const t = session()
  t.s.onSynced(true)
  t.requests()
  minutes(30)
  // 30 pulls + the statistics twice (at 15 and 30 min): 44, was 240.
  expect(t.requests()).toBe(30 + 2 * WATCHED)
  expect(STATS_QUIET_MS).toBe(15 * 60_000)
})

test("a pull that brings changes, a local edit pushed or a server event refreshes statistics", () => {
  let changed = false
  const t = session({ changes: () => changed })
  t.s.onSynced(true)
  t.requests()
  changed = true
  minutes(1)
  expect(t.log.stats).toBe(WATCHED)
  changed = false
  t.requests()
  t.s.onPullEvent()
  expect(t.log).toEqual({ pulls: 1, stats: WATCHED })
})

test("background (JS alive during a run): no timer, no requests; return catches up once", () => {
  const t = session()
  t.s.onSynced(true)
  t.requests()
  t.setApp("background")
  expect(jest.getTimerCount()).toBe(0)
  minutes(30)
  expect(t.requests()).toBe(0)
  t.setApp("active")
  // One sync and its statistics on return, then the poll again.
  expect(t.log).toEqual({ pulls: 1, stats: WATCHED })
  expect(jest.getTimerCount()).toBe(1)
})

test("inactive (Control Center) keeps polling; the stream dropping restores the minute pull", () => {
  const t = session()
  t.s.onSynced(true)
  t.s.onStreamOpen(true)
  t.setApp("inactive")
  t.requests()
  minutes(POLL_STREAM_MS / 60_000)
  expect(t.log.pulls).toBe(1)
  t.s.onStreamOpen(false)
  t.requests()
  minutes(3)
  expect(t.log.pulls).toBe(3)
})

test("stop clears the poll", () => {
  const t = session()
  t.s.stop()
  expect(jest.getTimerCount()).toBe(0)
})
