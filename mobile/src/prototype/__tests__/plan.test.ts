// The plan as the phone holds it: whatever the server last said, with Plus
// shown only while its end date is still ahead. A refresh asks the server
// (which asks RevenueCat); the phone never decides Plus on its own.
import { configureStorage } from "@domain/lib/store"
import {
  planFromServer,
  planStore,
  plusInForce,
  refreshPlan,
  setPlanRefresher,
} from "../plan"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  planStore.set({
    plan: "free",
    plusUntil: null,
    willRenew: false,
    productId: null,
  })
  setPlanRefresher(null)
})

const NOW = Date.parse("2026-11-09T00:00:00Z")

test("Plus counts only while the server says plus and its end is ahead", () => {
  const plus = {
    plan: "plus" as const,
    plusUntil: "2027-11-09T00:00:00Z",
    willRenew: true,
    productId: "plus_yearly",
  }
  expect(plusInForce(plus, NOW)).toBe(true)
  expect(plusInForce({ ...plus, plusUntil: null }, NOW)).toBe(true)
  // A cancelled subscription that ran out reads as free with no new pull.
  expect(plusInForce({ ...plus, plusUntil: "2026-11-08T23:59:59Z" }, NOW)).toBe(
    false,
  )
  expect(plusInForce({ ...plus, plan: "free" }, NOW)).toBe(false)
})

test("a server row maps onto the plan", () => {
  expect(
    planFromServer({
      plan: "plus",
      plus_until: "2027-11-09T00:00:00Z",
      will_renew: true,
      product_id: "plus_yearly",
    }),
  ).toEqual({
    plan: "plus",
    plusUntil: "2027-11-09T00:00:00Z",
    willRenew: true,
    productId: "plus_yearly",
  })
  // Anything the phone does not recognise is free, never Plus.
  expect(planFromServer({ plan: "gold" }).plan).toBe("free")
  expect(planFromServer({}).plan).toBe("free")
})

test("a refresh stores what the server answers", async () => {
  setPlanRefresher(async () => ({
    plan: "plus",
    plus_until: "2027-11-09T00:00:00Z",
    will_renew: true,
  }))
  const got = await refreshPlan()
  expect(got?.plan).toBe("plus")
  expect(planStore.get().plan).toBe("plus")
  expect(planStore.get().plusUntil).toBe("2027-11-09T00:00:00Z")
})

test("a failed refresh keeps the plan it had", async () => {
  planStore.set((s) => ({ ...s, plan: "plus", plusUntil: null }))
  setPlanRefresher(async () => {
    throw new Error("offline")
  })
  expect(await refreshPlan()).toBeNull()
  expect(planStore.get().plan).toBe("plus")
})
