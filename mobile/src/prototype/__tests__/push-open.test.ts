// A tapped notification is recorded as a ``push_open`` usage event: a push
// the server sent carries its notification id (how a nudge learns it was
// opened), a reminder the phone scheduled carries its category only.
import { configureStorage } from "@domain/lib/store"
import { notePushOpen, pushOpenDetail } from "../notifications"
import { sessionStore } from "../session"
import { setUsageSender, usageStore } from "../usage"

jest.mock("../navigation", () => ({ go: jest.fn() }))

const NID = "1B4E28BA-2FA1-11D2-883F-0016D3CCA427"

describe("pushOpenDetail", () => {
  it("is the server notification's id, lowercased", () => {
    expect(pushOpenDetail("x", { notification_id: NID, href: "/" })).toBe(
      NID.toLowerCase(),
    )
  })
  it("is a server push's kind when it has no notification row", () => {
    expect(pushOpenDetail("x", { kind: "companion.reply" })).toBe(
      "companion.reply",
    )
  })
  it("is a local reminder's category, never its content", () => {
    expect(pushOpenDetail("habit-hj-1-21:00", { href: "/habits/hj" })).toBe(
      "habit",
    )
    expect(pushOpenDetail("task-abc", {})).toBe("task")
    expect(pushOpenDetail("weigh-in-mon", null)).toBe("weigh-in")
    expect(pushOpenDetail("eat-back", undefined)).toBe("eat-back")
    expect(pushOpenDetail("something-new", {})).toBe("other")
  })
  it("ignores an id that is not a uuid", () => {
    expect(pushOpenDetail("bill-1", { notification_id: "nope" })).toBe("bill")
  })
})

describe("notePushOpen", () => {
  const sent: { events: Record<string, unknown>[] }[] = []
  beforeEach(() => {
    configureStorage({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
    sent.length = 0
    usageStore.set({ queue: [] })
    sessionStore.set((s) => ({
      ...s,
      signedIn: true,
      user: { name: "A", username: "a", email: "a@example.com" },
    }))
    setUsageSender(async (_path, body) => {
      sent.push(body as never)
    })
  })
  afterEach(() => setUsageSender(null))

  it("sends a push_open event at once with the cleaned detail", async () => {
    notePushOpen({
      identifier: "srv",
      content: { data: { notification_id: NID, href: "/habits/h" } },
    })
    await Promise.resolve()
    await Promise.resolve()
    const events = sent.flatMap((b) => b.events)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: "push_open",
      detail: NID.toLowerCase(),
    })
  })
})
