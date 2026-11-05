// Live mode where the auth module resolves to nothing (a send whose timer
// fires after its test's environment is torn down, as happened in CI): the
// timed send must not throw into whatever suite runs next.
import { configureStorage } from "@domain/lib/store"

jest.mock("@/live/config", () => ({
  liveMode: true,
  API_URL: "http://api.test",
  API_PREFIX: "/api/v1",
}))
jest.mock("@/live/auth", () => undefined)

const F = require("../funnel") as typeof import("../funnel")

test("a queued event with no API client neither throws nor is lost", async () => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  jest.useFakeTimers()
  F.funnelStore.set({ installId: "", queue: [] })
  F.logFunnel({ event: "step_view", step: "modules" })
  await expect(jest.runOnlyPendingTimersAsync()).resolves.toBeUndefined()
  await expect(F.flushFunnel()).resolves.toBe(0)
  expect(F.funnelStore.get().queue).toHaveLength(1)
  jest.useRealTimers()
})
