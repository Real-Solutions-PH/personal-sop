import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as J from "@domain/finance/joint"
import * as L from "@domain/finance/loans"
import type { StorageAdapter } from "@domain/lib/store"
import { SyncEngine } from "../engine"
import type { Http } from "../http"
import { accountFromRow, sharedMappers } from "../mappers/shared"
import { createOutbox, type SyncOp } from "../outbox"

const KAI = "11111111-1111-4111-8111-111111111111"
const MIA = "22222222-2222-4222-8222-222222222222"
const OBJ = "44444444-4444-4444-8444-444444444444"
const FOOD = "55555555-5555-4555-8555-555555555555"

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
const engine = (me = MIA) => {
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
  for (const k of ["id", "account_id", "object_id", "category_id"])
    if (typeof data[k] === "string") data[k] = OBJ
  return { ...rest, data }
}

beforeEach(() => L.sharedStore.reset())
afterAll(() => {
  const dir = join(__dirname, "fixtures")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "shared-joint-wire.json"),
    `${JSON.stringify(wire, null, 2)}\n`,
  )
})

const person = (id: string, name: string) => ({
  id,
  name,
  handle: null,
  photo_media_id: null,
})

function accountRow(myStatus = "active", extra = {}) {
  return {
    id: L.memberId(MIA, OBJ, "account"),
    version: 4,
    kind: "account",
    object_id: OBJ,
    role: "member",
    status: myStatus,
    data: {
      id: OBJ,
      role: "member",
      my_status: myStatus,
      name: "House money",
      type: "bank",
      color: "fin",
      currency: "PHP",
      archived: false,
      in_net_worth: true,
      balance_minor: 4_250_000,
      owner: person(KAI, "Kai"),
      members: [
        { person: person(KAI, "Kai"), role: "owner", status: "active" },
        { person: person(MIA, "Mia"), role: "member", status: myStatus },
      ],
      records: [
        {
          id: "r1",
          kind: "expense",
          amount_minor: 125_000,
          signed_minor: -125_000,
          at: "2026-11-28T03:00:00Z",
          day: "2026-11-28",
          payee: "Groceries",
          note: null,
          category_id: FOOD,
          category_name: "Food",
          category_icon: "utensils",
          by_id: KAI,
          is_adjustment: false,
          pending: false,
        },
      ],
      records_total: 1,
      categories: [
        { id: FOOD, name: "Food", icon: "utensils", kind: "expense" },
      ],
      events: [],
      shared_at: "2026-11-28T02:00:00Z",
      ...extra,
    },
  }
}

it("reads a member's synced view of a joint account", () => {
  const a = accountFromRow(accountRow())!
  expect(a).toMatchObject({
    accountId: OBJ,
    role: "member",
    myStatus: "active",
    name: "House money",
    balance: 4_250_000,
    owner: { id: KAI, name: "Kai" },
    recordsTotal: 1,
  })
  expect(a.records[0]).toMatchObject({
    kind: "expense",
    signed: -125_000,
    byId: KAI,
    categoryName: "Food",
  })
  expect(a.id).toBe(L.memberId(MIA, OBJ, "account"))
  // Another kind is not an account.
  expect(accountFromRow({ ...accountRow(), kind: "goal" })).toBeNull()
})

it("accepting an invite is one respond action", () => {
  const e = engine()
  L.sharedStore.set({
    ...L.EMPTY_SHARED,
    accounts: [accountFromRow(accountRow("invited"))!],
  })
  e.capture()
  J.respondAccount(OBJ, true)
  const [join] = e.capture()
  expect(join).toMatchObject({
    kind: "action",
    name: "finance.shared.respond",
    data: { kind: "account", object_id: OBJ, accept: true, category_ids: [] },
  })
  wire.push(strip(join))
})

it("a logged transaction moves the balance at once and is one action", () => {
  const e = engine()
  L.sharedStore.set({
    ...L.EMPTY_SHARED,
    accounts: [accountFromRow(accountRow())!],
  })
  e.capture()
  const id = J.addJointRecord(OBJ, {
    type: "expense",
    amount: 50_000,
    day: "2026-11-28",
    categoryId: FOOD,
    payee: " Rice ",
    me: MIA,
  })
  const a = J.jointAccount(OBJ)!
  expect(a.balance).toBe(4_200_000)
  expect(a.records[0]).toMatchObject({ id, byId: MIA, local: true })
  const [rec] = e.capture()
  expect(rec).toMatchObject({
    name: "finance.account.record",
    data: {
      id,
      account_id: OBJ,
      type: "expense",
      amount_minor: 50_000,
      on_date: "2026-11-28",
      category_id: FOOD,
      payee: "Rice",
    },
  })
  wire.push(strip(rec))
})

it("leaving is one action and drops the account from net worth", () => {
  const e = engine()
  L.sharedStore.set({
    ...L.EMPTY_SHARED,
    accounts: [accountFromRow(accountRow())!],
  })
  expect(J.jointWorth(L.sharedStore.get().accounts, "PHP")).toBe(42_500)
  // Another currency is left out, never converted.
  expect(J.jointWorth(L.sharedStore.get().accounts, "USD")).toBe(0)
  e.capture()
  J.leaveAccount(OBJ)
  const [leave] = e.capture()
  expect(leave).toMatchObject({
    name: "finance.account.leave",
    data: { account_id: OBJ },
  })
  wire.push(strip(leave))
  expect(J.jointWorth(L.sharedStore.get().accounts, "PHP")).toBe(0)
})

it("my own joint account adds nothing: it's in my ledger already", () => {
  const own = accountFromRow({
    ...accountRow(),
    role: "owner",
    data: { ...accountRow().data, role: "owner" },
  })!
  expect(J.jointWorth([own], "PHP")).toBe(0)
})
