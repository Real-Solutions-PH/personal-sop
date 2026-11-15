import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as G from "@domain/finance/groups"
import * as L from "@domain/finance/loans"
import { derivedId } from "@domain/lib/ids"
import type { StorageAdapter } from "@domain/lib/store"
import { SyncEngine } from "../engine"
import type { Http } from "../http"
import { categoryIds } from "../mappers/finance"
import { budgetFromRow, goalFromRow, sharedMappers } from "../mappers/shared"
import { createOutbox, type SyncOp } from "../outbox"

const KAI = "11111111-1111-4111-8111-111111111111"
const MIA = "22222222-2222-4222-8222-222222222222"
const ACCT = "33333333-3333-4333-8333-333333333333"
const OBJ = "44444444-4444-4444-8444-444444444444"

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}
const noHttp: Http = {
  request: async () => {
    throw new Error("unused")
  },
  raw: async () => {
    throw new Error("unused")
  },
}
const engine = (me = KAI) => {
  const storage = memoryStorage()
  return new SyncEngine({
    http: noHttp,
    storage,
    outbox: createOutbox(storage),
    mappers: sharedMappers(me),
    online: () => false,
  })
}

// Every op, for the backend's wire-format check (tests/modules/shared_finance).
const wire: Omit<SyncOp, "op_id" | "at">[] = []
const strip = (op: SyncOp) => {
  const { op_id: _o, at: _a, ...rest } = op
  const data = { ...op.data } as Record<string, unknown>
  for (const k of ["id", "goal_id", "entry_id", "budget_id", "object_id"])
    if (typeof data[k] === "string") data[k] = OBJ
  return { ...rest, data }
}

beforeEach(() => L.sharedStore.reset())
afterAll(() => {
  const dir = join(__dirname, "fixtures")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "shared-groups-wire.json"),
    `${JSON.stringify(wire, null, 2)}\n`,
  )
})

const person = (id: string, name: string) => ({
  id,
  name,
  handle: null,
  photo_media_id: null,
})

function goalRow(me: string, role: "owner" | "member", extra = {}) {
  return {
    id: L.memberId(me, OBJ, "goal"),
    version: 3,
    kind: "goal",
    object_id: OBJ,
    role,
    status: "active",
    data: {
      id: OBJ,
      role,
      my_status: "active",
      status: "active",
      name: "Japan trip",
      currency: "PHP",
      target_minor: 1_000_000,
      deadline: null,
      balance_minor: 0,
      pending_minor: 0,
      members: [
        {
          person: person(KAI, "Kai"),
          role: "owner",
          status: "active",
          amount_minor: 0,
        },
        {
          person: person(MIA, "Mia"),
          role: "member",
          status: "active",
          amount_minor: 0,
        },
      ],
      entries: [],
      events: [],
      created_at: "2026-11-15T03:00:00Z",
      ...extra,
    },
  }
}

it("a new goal and a deposit are two actions; the balance adds up", () => {
  const e = engine()
  e.capture()
  const g = G.createGoal({
    me: { id: KAI, name: "Kai" },
    members: [{ id: MIA, name: "Mia" }],
    name: " Japan trip ",
    currency: "PHP",
    target: 1_000_000,
    deadline: "2027-04-01",
  })
  expect(g.id).toBe(derivedId("shared-member", KAI, `goal:${g.goalId}`))
  const [create] = e.capture()
  expect(create).toMatchObject({
    name: "finance.goal.create",
    data: {
      id: g.goalId,
      name: "Japan trip",
      target_minor: 1_000_000,
      deadline: "2027-04-01",
      member_ids: [MIA],
    },
  })
  wire.push(strip(create))
  G.addEntry(g.goalId, {
    kind: "deposit",
    amount: 250_000,
    onDate: "2026-11-15",
    accountId: ACCT,
    me: KAI,
  })
  const [dep] = e.capture()
  expect(dep).toMatchObject({
    name: "finance.goal.entry",
    data: {
      goal_id: g.goalId,
      kind: "deposit",
      amount_minor: 250_000,
      account_id: ACCT,
    },
  })
  wire.push(strip(dep))
  const goal = L.sharedStore.get().goals[0]
  expect(G.goalSummary(goal)).toMatchObject({
    balance: 250_000,
    pending: 0,
    byMember: { [KAI]: 250_000 },
    progress: 0.25,
  })
  expect(G.goalRoom(goal)).toBe(250_000)
})

it("a member joins, okays one withdrawal and turns another down", () => {
  const e = engine(MIA)
  const sent = (id: string) => ({
    id,
    kind: "withdrawal",
    status: "sent",
    amount_minor: 10_000,
    on_date: "2026-11-15",
    note: null,
    by_id: KAI,
    account_id: null,
    record_id: null,
    decided_at: null,
    decided_by: null,
    reason: null,
    created_at: "2026-11-15T04:00:00Z",
  })
  const invited = goalFromRow(goalRow(MIA, "member", { my_status: "invited" }))!
  L.sharedStore.set({ ...L.EMPTY_SHARED, goals: [invited] })
  e.capture()
  G.respondGoal(OBJ, true)
  const [join] = e.capture()
  expect(join).toMatchObject({
    name: "finance.shared.respond",
    data: { kind: "goal", object_id: OBJ, accept: true, category_ids: [] },
  })
  wire.push(strip(join))

  const g = goalFromRow(
    goalRow(MIA, "member", { entries: [sent("w1"), sent("w2")] }),
  )!
  L.sharedStore.set({ ...L.EMPTY_SHARED, goals: [g] })
  e.capture()
  G.decideEntry(OBJ, "w1", true, MIA)
  const [ok] = e.capture()
  expect(ok).toMatchObject({
    name: "finance.goal.decide",
    data: { goal_id: OBJ, entry_id: "w1", accept: true, reason: null },
  })
  wire.push(strip(ok))
  G.decideEntry(OBJ, "w2", false, MIA, " Not yet ")
  const [no] = e.capture()
  expect(no).toMatchObject({
    name: "finance.goal.decide",
    data: { entry_id: "w2", accept: false, reason: "Not yet" },
  })
  wire.push(strip(no))
})

it("the asker takes back their own withdrawal", () => {
  const e = engine(KAI)
  const g = goalFromRow(goalRow(KAI, "owner"))!
  L.sharedStore.set({ ...L.EMPTY_SHARED, goals: [g] })
  e.capture()
  const id = G.addEntry(OBJ, {
    kind: "withdrawal",
    amount: 5_000,
    onDate: "2026-11-15",
    accountId: ACCT,
    me: KAI,
  })
  const [ask] = e.capture()
  expect(ask).toMatchObject({
    name: "finance.goal.entry",
    data: { kind: "withdrawal" },
  })
  wire.push(strip(ask))
  expect(G.goalSummary(L.sharedStore.get().goals[0]).pending).toBe(5_000)
  G.withdrawEntry(OBJ, id, KAI)
  const [back] = e.capture()
  expect(back).toMatchObject({
    name: "finance.goal.withdraw",
    data: { goal_id: OBJ, entry_id: id },
  })
  wire.push(strip(back))
})

it("a budget is created, joined with categories, and its categories change", () => {
  const cats = categoryIds(KAI)
  const e = engine(KAI)
  e.capture()
  const b = G.createBudget({
    me: { id: KAI, name: "Kai" },
    members: [{ id: MIA, name: "Mia" }],
    name: "Groceries",
    currency: "PHP",
    limit: 1_500_000,
    categoryIds: ["groceries"],
    month: "2026-11",
  })
  const [create] = e.capture()
  expect(create).toMatchObject({
    name: "finance.budget.create",
    data: {
      id: b.budgetId,
      limit_minor: 1_500_000,
      member_ids: [MIA],
      // The seeded slug leaves as the server's category id.
      category_ids: [cats.out("groceries")],
    },
  })
  wire.push(strip({ ...create, data: { ...create.data, category_ids: [OBJ] } }))
  G.setBudgetCategories(b.budgetId, ["groceries", "dining"])
  const [set] = e.capture()
  expect(set).toMatchObject({
    name: "finance.budget.categories",
    data: { category_ids: [cats.out("groceries"), cats.out("dining")] },
  })
  wire.push(strip({ ...set, data: { ...set.data, category_ids: [OBJ] } }))

  const m = sharedMappers(MIA)[0]
  const row = {
    id: L.memberId(MIA, OBJ, "budget"),
    version: 4,
    kind: "budget",
    object_id: OBJ,
    role: "member",
    status: "invited",
    data: {
      id: OBJ,
      role: "member",
      my_status: "invited",
      status: "active",
      name: "Groceries",
      currency: "PHP",
      limit_minor: 1_500_000,
      month: "2026-11",
      spent_minor: 1_250_000,
      my_category_ids: [],
      members: [],
      events: [],
      created_at: "2026-11-15T03:00:00Z",
    },
  }
  const pulled = m.fromServer(row, L.sharedStore.get()) as G.SharedBudget
  expect(G.budgetPct(pulled)).toBeCloseTo(0.833, 2)
  const e2 = engine(MIA)
  L.sharedStore.set({ ...L.EMPTY_SHARED, budgets: [pulled] })
  e2.capture()
  G.respondBudget(OBJ, true, ["groceries"])
  const [join] = e2.capture()
  expect(join).toMatchObject({
    name: "finance.shared.respond",
    data: {
      kind: "budget",
      accept: true,
      category_ids: [categoryIds(MIA).out("groceries")],
    },
  })
  wire.push(strip({ ...join, data: { ...join.data, category_ids: [OBJ] } }))
  expect(budgetFromRow({ ...row, kind: "goal" }, categoryIds(MIA))).toBeNull()
})
