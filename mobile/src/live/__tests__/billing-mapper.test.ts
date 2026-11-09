// The plan row syncs down only: the mapper reads the server's entitlement
// row into the plan store and never produces an op for it.
import { configureStorage } from "@domain/lib/store"
import { planStore } from "@/prototype/plan"
import { diffEntity } from "../mapper"
import { billingMappers } from "../mappers/billing"

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
})

const [mapper] = billingMappers("u1")

test("it is a read-only entity named entitlement", () => {
  expect(mapper.entity).toBe("entitlement")
  expect(mapper.readOnly).toBe(true)
})

test("a pulled row becomes the plan, and a delete makes it free", () => {
  const row = mapper.fromServer(
    {
      id: "e1",
      plan: "plus",
      plus_until: "2027-11-09T00:00:00Z",
      will_renew: true,
      product_id: "plus_yearly",
      version: 3,
    },
    planStore.get(),
  )
  if (!row) throw new Error("row dropped")
  planStore.set((s) => mapper.merge(s, [row], []))
  expect(planStore.get()).toEqual({
    id: "e1",
    plan: "plus",
    plusUntil: "2027-11-09T00:00:00Z",
    willRenew: true,
    productId: "plus_yearly",
  })
  planStore.set((s) => mapper.merge(s, [], ["e1"]))
  expect(planStore.get().plan).toBe("free")
})

test("a local change to the plan produces no op", () => {
  planStore.set((s) => ({ ...s, id: "e1", plan: "plus" }))
  const diff = diffEntity(mapper, planStore.get(), {}, {})
  expect(diff).toEqual({ upserts: [], deletes: [], actions: [] })
})
