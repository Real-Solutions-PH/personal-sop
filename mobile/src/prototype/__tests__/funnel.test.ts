// The onboarding funnel queue: random install id, nothing typed, batches of
// 50, and a failed send stays queued.
import { configureStorage } from "@domain/lib/store"
import {
  flushFunnel,
  funnelStore,
  installId,
  logFunnel,
  setFunnelSender,
} from "../funnel"

const sent: {
  path: string
  body: { install_id: string; events: unknown[] }
}[] = []
let fail = false

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  jest.useFakeTimers()
  sent.length = 0
  fail = false
  funnelStore.set({ installId: "", queue: [] })
  setFunnelSender(async (path, body) => {
    if (fail) throw new Error("offline")
    sent.push({ path, body: body as never })
  })
})
afterEach(() => {
  jest.useRealTimers()
  setFunnelSender(null)
})

test("the install id is a random UUID, made once", () => {
  const id = installId()
  expect(id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(installId()).toBe(id)
})

test("events are sent together shortly after, with when they happened", async () => {
  const at = new Date("2026-11-05T01:00:00Z")
  logFunnel({ event: "step_view", step: "modules" }, at)
  logFunnel(
    {
      event: "module_toggle",
      step: "modules",
      module: "journal",
      turned_on: true,
    },
    at,
  )
  expect(sent).toHaveLength(0)
  await jest.runOnlyPendingTimersAsync()
  expect(sent).toEqual([
    {
      path: "/funnel/events",
      body: {
        install_id: installId(),
        events: [
          { event: "step_view", step: "modules", at: at.toISOString() },
          {
            event: "module_toggle",
            step: "modules",
            module: "journal",
            turned_on: true,
            at: at.toISOString(),
          },
        ],
      },
    },
  ])
  expect(funnelStore.get().queue).toEqual([])
})

test("a failed send keeps the queue; the next one sends it in batches of 50", async () => {
  fail = true
  for (let i = 0; i < 120; i++)
    logFunnel({ event: "step_view", step: "identity" })
  await jest.runOnlyPendingTimersAsync()
  expect(funnelStore.get().queue).toHaveLength(120)
  fail = false
  expect(await flushFunnel()).toBe(120)
  expect(sent.map((s) => s.body.events.length)).toEqual([50, 50, 20])
})

test("with no API client the timed send does nothing and keeps the queue", async () => {
  setFunnelSender(null)
  // liveMode is false here, so there is no sender: nothing may throw.
  logFunnel({ event: "step_view", step: "identity" })
  await expect(flushFunnel()).resolves.toBe(0)
  await jest.runOnlyPendingTimersAsync()
})
