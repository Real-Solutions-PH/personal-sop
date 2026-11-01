// What Shortcuts, Siri and Back Tap ask for lands in the same store actions
// the in-app controls call, and the reply says what happened or why not.
import { dashStore } from "@domain/dash/store"
import * as N from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import * as FO from "@domain/focus/actions"
import { focusStore } from "@domain/focus/store"
import { money } from "@domain/lib/money"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  addMessage,
  answering,
  companionStore,
  replying,
} from "@/prototype/companion/store"
import type { ShortcutRequest } from "../native"

const mockQueue: ShortcutRequest[] = []
const mockReply = jest.fn()
jest.mock("../native", () => ({
  drainRequests: () => mockQueue.splice(0),
  replyRequest: (...a: unknown[]) => mockReply(...a),
}))
// Fern answers at once here; the live path streams the same messages.
const mockAsk = jest.fn((text: string) => {
  addMessage({ role: "me", text })
  addMessage({ role: "sol", text: `You asked: ${text}` })
})
jest.mock("@/prototype/companion/brain", () => ({
  ask: (text: string) => mockAsk(text),
}))

const R = require("../requests") as typeof import("../requests")

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  replying.setState({ id: null })
  answering.setState({ id: null })
  mockQueue.length = 0
  mockReply.mockClear()
  mockAsk.mockClear()
})

const enable = (k: string, on: boolean) =>
  dashStore.set((s) => ({ ...s, enabled: { ...s.enabled, [k]: on } }))

describe("quick expense", () => {
  it("logs “₱250 lunch” as a quick-add expense and reports today's spend", () => {
    enable("finance", true)
    const day = N.today()
    const before = N.spendIn(finStore.get(), day, day, null)
    const count = finStore.get().records.length
    const r = R.quickExpense("₱250 lunch")
    const recs = finStore.get().records
    expect(recs).toHaveLength(count + 1)
    const added = recs.find(
      (x) => x.note === "₱250 lunch" && x.source === "quick-add",
    )
    expect(added).toMatchObject({ type: "expense", amount: 250 })
    expect(r.error).toBeUndefined()
    expect(r.amount).toBe(money(250))
    expect(r.spentToday).toBe(money(before + 250))
  })

  it("reads amounts without a peso sign and with k", () => {
    enable("finance", true)
    R.quickExpense("1.2k groceries")
    expect(
      finStore.get().records.find((x) => x.note === "1.2k groceries")?.amount,
    ).toBe(1200)
  })

  it("refuses text with no amount and logs nothing", () => {
    enable("finance", true)
    const count = finStore.get().records.length
    const r = R.quickExpense("lunch with Mia")
    expect(r.error).toMatch(/couldn't find an amount/)
    expect(finStore.get().records).toHaveLength(count)
  })

  it("says to turn Finance on when it is off", () => {
    enable("finance", false)
    const count = finStore.get().records.length
    expect(R.quickExpense("250 lunch").error).toMatch(/Turn on Finance/)
    expect(finStore.get().records).toHaveLength(count)
  })
})

describe("focus", () => {
  it("starts once, says so when already running, and stops", () => {
    enable("focus", true)
    FO.stopFocus()
    const started = R.focusStart("pomodoro")
    expect(started.text).toMatch(/^Focus started: \d+ minutes/)
    expect(FO.current(focusStore.get())).toBeTruthy()
    expect(R.focusStart().text).toMatch(/already running/)
    expect(R.focusStop().text).toMatch(/Focus stopped/)
    expect(FO.current(focusStore.get())).toBeFalsy()
    expect(R.focusStop().text).toMatch(/No focus session/)
  })

  it("a stopwatch says it counts up", () => {
    enable("focus", true)
    FO.stopFocus()
    expect(R.focusStart("stopwatch").text).toMatch(/counts up/)
    R.focusStop()
  })
})

describe("Fern's reply", () => {
  const ids = () => new Set(companionStore.get().messages.map((m) => m.id))

  it("waits while the reply is still being written", () => {
    const before = ids()
    addMessage({ role: "me", text: "how much did I spend" })
    expect(R.fernReply(before)).toBeNull()
    addMessage({ role: "sol", text: "₱1,240 today." })
    replying.setState({ id: "x" })
    expect(R.fernReply(before)).toBeNull()
    replying.setState({ id: null })
    expect(R.fernReply(before)).toEqual({
      text: "₱1,240 today.",
      needsApp: false,
    })
  })

  it("flags a card that waits for Confirm", () => {
    const before = ids()
    addMessage({ role: "me", text: "log 3 eggs" })
    addMessage({
      role: "sol",
      text: "Here's the meal.",
      blocks: [
        {
          t: "steps",
          items: [
            {
              id: "s1",
              tool: "log_meal",
              label: "Logged",
              card_id: "c1",
              state: "proposed",
            },
          ],
        },
      ],
    })
    expect(R.fernReply(before)?.needsApp).toBe(true)
  })

  it("reports a question that failed or is waiting for a connection", () => {
    let before = ids()
    companionStore.set((s) => ({
      ...s,
      messages: [
        ...s.messages,
        { id: "q1", role: "me", at: Date.now(), text: "hi", status: "failed" },
      ],
    }))
    expect(R.fernReply(before)?.error).toMatch(/couldn't answer/)
    before = ids()
    companionStore.set((s) => ({
      ...s,
      messages: [
        ...s.messages,
        { id: "q2", role: "me", at: Date.now(), text: "hi", status: "queued" },
      ],
    }))
    expect(R.fernReply(before)?.error).toMatch(/offline/)
  })

  it("askFern sends the question and returns the answer", async () => {
    const r = await R.askFern("what's left", { pollMs: 1 })
    expect(mockAsk).toHaveBeenCalledWith("what's left")
    expect(r).toEqual({ text: "You asked: what's left", needsApp: false })
  })

  it("gives up with pending when no reply comes in time", async () => {
    mockAsk.mockImplementationOnce(() => {})
    const r = await R.askFern("hello", { pollMs: 1, fernTimeoutMs: 20 })
    expect(r).toEqual({ pending: true })
  })
})

describe("dispatch", () => {
  it("opens a link through the widget routes, with no reply", async () => {
    const navigate = jest.fn()
    mockQueue.push({ id: "o1", type: "open", at: 1, path: "/fern?mode=talk" })
    await R.runShortcutRequests({ navigate })
    expect(navigate).toHaveBeenCalledWith(
      expect.stringMatching(/^\/capture\?launch=talk&at=\d+$/),
    )
    expect(mockReply).not.toHaveBeenCalled()
  })

  it("answers each request under its own id", async () => {
    enable("finance", true)
    mockQueue.push(
      { id: "e1", type: "expense", at: 2, text: "250 lunch" },
      { id: "x1", type: "teleport", at: 1 },
    )
    await R.runShortcutRequests({ navigate: jest.fn() })
    expect(mockReply).toHaveBeenCalledWith(
      "e1",
      expect.objectContaining({ amount: money(250) }),
    )
    expect(mockReply).toHaveBeenCalledWith("x1", {
      error: "Update Unfurl to use this shortcut.",
    })
  })
})
