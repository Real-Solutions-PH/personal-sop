// App usage queue: signed-in only, card keys cleaned, batches of 50, a
// failed send stays queued, and another account's queue is never sent.
import { configureStorage } from "@domain/lib/store"
import { sessionStore } from "../session"
import {
  cardKey,
  flushUsage,
  logUsage,
  setUsageSender,
  usageStore,
} from "../usage"

const sent: { path: string; body: { events: Record<string, unknown>[] } }[] = []
let fail = false

const signIn = (email: string) =>
  sessionStore.set((s) => ({
    ...s,
    signedIn: true,
    user: { name: "A", username: "a", email },
  }))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  jest.useFakeTimers()
  sent.length = 0
  fail = false
  usageStore.set({ queue: [] })
  sessionStore.set((s) => ({ ...s, signedIn: false, user: null }))
  setUsageSender(async (path, body) => {
    if (fail) throw new Error("offline")
    sent.push({ path, body: body as never })
  })
})
afterEach(() => {
  jest.useRealTimers()
  setUsageSender(null)
})

test("nothing is recorded while signed out", () => {
  logUsage({ kind: "app_open" })
  expect(usageStore.get().queue).toEqual([])
})

test("events are sent without the account tag", async () => {
  signIn("a@example.com")
  logUsage({ kind: "app_open" })
  logUsage({ kind: "share_card", detail: "Week Wrap!" })
  await flushUsage()
  expect(sent).toHaveLength(1)
  expect(sent[0].path).toBe("/usage/events")
  const events = sent[0].body.events
  expect(events.map((e) => [e.kind, e.detail])).toEqual([
    ["app_open", undefined],
    ["share_card", "week-wrap-"],
  ])
  expect(events.every((e) => !("account" in e))).toBe(true)
  expect(usageStore.get().queue).toEqual([])
})

test("a failed send stays queued", async () => {
  signIn("a@example.com")
  fail = true
  logUsage({ kind: "app_open" })
  await flushUsage()
  expect(usageStore.get().queue).toHaveLength(1)
  fail = false
  expect(await flushUsage()).toBe(1)
})

test("another account's queue is dropped, not sent", async () => {
  signIn("a@example.com")
  fail = true
  logUsage({ kind: "app_open" })
  await flushUsage()
  fail = false
  signIn("b@example.com")
  expect(await flushUsage()).toBe(0)
  expect(sent).toEqual([])
  expect(usageStore.get().queue).toEqual([])
})

test("a close is sent at once", async () => {
  signIn("a@example.com")
  logUsage({ kind: "app_close" }, { now: true })
  await Promise.resolve()
  await Promise.resolve()
  expect(sent).toHaveLength(1)
})

test("batches of 50", async () => {
  signIn("a@example.com")
  fail = true
  for (let i = 0; i < 120; i++) logUsage({ kind: "app_open" })
  fail = false
  await flushUsage()
  expect(sent.map((s) => s.body.events.length)).toEqual([50, 50, 20])
})

test("card keys fit the server's pattern", () => {
  expect(cardKey("streak")).toBe("streak")
  expect(cardKey("Run & Walk")).toBe("run-walk")
  expect(cardKey("x".repeat(60))).toHaveLength(40)
  expect(cardKey("!!!")).toBe("-")
  expect(cardKey("")).toBe("card")
})
