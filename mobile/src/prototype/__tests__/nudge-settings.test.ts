// Settings' "Nudges from Fern": the picked time stays inside 07:00-21:30,
// the usual time falls back like the server's cold start, and live mode
// asks the server for it.
import { configureStorage } from "@domain/lib/store"
import {
  clampNudgeTime,
  fallbackUsual,
  nudgeStore,
  refreshNudge,
  setNudgeFetcher,
} from "../nudge-settings"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  nudgeStore.set({ usual: null })
})
afterEach(() => setNudgeFetcher(null))

test("a picked time is kept inside the hours a nudge may go out", () => {
  expect(clampNudgeTime("06:15")).toBe("07:00")
  expect(clampNudgeTime("22:45")).toBe("21:30")
  expect(clampNudgeTime("19:20")).toBe("19:20")
  expect(clampNudgeTime("nope")).toBe("07:00")
})

test("before the server knows, the usual time is the evening push less 10 min", () => {
  expect(fallbackUsual("21:00")).toBe("20:50")
  expect(fallbackUsual("23:00")).toBeNull()
  expect(fallbackUsual("")).toBeNull()
})

test("the usual time comes from the server; a failed ask keeps the last", async () => {
  setNudgeFetcher(async () => ({ mode: "daily", pinned: null, usual: "19:20" }))
  await refreshNudge()
  expect(nudgeStore.get().usual).toBe("19:20")
  setNudgeFetcher(async () => {
    throw new Error("offline")
  })
  await refreshNudge()
  expect(nudgeStore.get().usual).toBe("19:20")
  setNudgeFetcher(async () => ({ usual: null }))
  await refreshNudge()
  expect(nudgeStore.get().usual).toBeNull()
})
