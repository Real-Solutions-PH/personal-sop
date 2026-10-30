import { join } from "node:path"
import {
  addAccount,
  addBudget,
  addCategory,
  addPlanned,
  adjustBalance,
  confirmRecord,
  deleteCategoryMoving,
  deleteRecord,
  logExpense,
  logTransfer,
  newThread,
  pushMessage,
  saveLookBack,
  settleOccurrence,
  skipOccurrence,
  snoozeOccurrence,
  unskipOccurrence,
  updateAccount,
  updateBudget,
  updateSettings,
} from "@domain/finance/actions"
import { addDays, today } from "@domain/finance/calc"
import { buildSeed, type FinState } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { derivedId, isUuid } from "@domain/lib/ids"
import type { StorageAdapter } from "@domain/lib/store"
import { SyncEngine } from "../engine"
import type { Http } from "../http"
import type { AnyMapper, Payload } from "../mapper"
import {
  accountMapper,
  budgetCategoryMapper,
  budgetMapper,
  categoryIds,
  categoryMapper,
  colorIn,
  colorOut,
  financeMappers,
  fromMinor,
  lookBackMapper,
  messageMapper,
  plannedMapper,
  plannedSkipMapper,
  plannedSnoozeMapper,
  recordMapper,
  settingsMapper,
  threadMapper,
  toMinor,
} from "../mappers/finance"
import { createOutbox, type SyncOp } from "../outbox"
import { writeStableFixture } from "./stable-fixture"

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"
const cats = categoryIds(USER)

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

// Push answers "applied" with no row; pull has nothing. capture() is where
// the mapping happens.
const quietHttp: Http = {
  request: async <T>(method: string, path: string): Promise<T> => {
    if (method === "POST" && path === "/sync/push") return { results: [] } as T
    return { changes: [], cursor: 0, truncated: false } as T
  },
  raw: async () => {
    throw new Error("unused")
  },
}

function engine() {
  const storage = memoryStorage()
  return new SyncEngine({
    http: quietHttp,
    storage,
    outbox: createOutbox(storage),
    mappers: financeMappers(USER),
    online: () => false,
  })
}

/** A live account's starting point: the default categories (pulled), no
 * ledger. */
function blank(): FinState {
  const s = buildSeed().state
  return {
    ...s,
    accounts: [],
    records: [],
    budgets: [],
    planned: [],
    imports: [],
    lookbacks: [],
    threads: [],
    settings: { ...s.settings, defaultAccountId: "" },
  }
}

/** Engine already in step with the store (everything captured). */
function synced() {
  const e = engine()
  e.capture()
  return e
}

const upserts = (ops: SyncOp[], name: string) =>
  ops.filter((o) => o.kind === "upsert" && o.name === name)
const actionsOf = (ops: SyncOp[]) => ops.filter((o) => o.kind === "action")

// Every payload the tests below produce, for the backend schema check.
const wire: {
  entity?: string
  action?: string
  create?: boolean
  data: unknown
}[] = []
function record(ops: SyncOp[], creates: Set<string>) {
  for (const o of ops) {
    if (o.kind === "action") wire.push({ action: o.name, data: o.data })
    else if (o.kind === "upsert")
      wire.push({
        entity: o.name,
        create: creates.has(`${o.name}:${o.id}`),
        data: o.data,
      })
  }
}
function captureWire(e: SyncEngine, before: Set<string>) {
  const ops = e.capture()
  // A row an action in the same batch writes first (adjust_balance's
  // record) is an update by the time its upsert arrives.
  for (const o of ops)
    if (o.kind === "action" && o.data?.record_id)
      before.add(`fin_record:${o.data.record_id}`)
  const creates = new Set(
    ops
      .filter((o) => o.kind === "upsert" && !before.has(`${o.name}:${o.id}`))
      .map((o) => `${o.name}:${o.id}`),
  )
  for (const o of ops) if (o.kind === "upsert") before.add(`${o.name}:${o.id}`)
  record(ops, creates)
  return ops
}

beforeEach(() => finStore.set(blank()))

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test("pesos to centavos rounds half-up once, through float noise", () => {
  // 1.005 * 100 is 100.49999999999999 and 0.145 * 100 is 14.499999999999998:
  // a bare Math.round gives 100 and 14.
  expect(Math.round(1.005 * 100)).toBe(100)
  expect(toMinor(1.005)).toBe(101)
  expect(Math.round(0.145 * 100)).toBe(14)
  expect(toMinor(0.145)).toBe(15)
  expect(toMinor(2.675)).toBe(268)
  expect(toMinor(0.29)).toBe(29)
  expect(toMinor(-12.5)).toBe(-1250)
  expect(toMinor(1234567.89)).toBe(123456789)
  expect(fromMinor(123456789)).toBe(1234567.89)
})

// ---------------------------------------------------------------------------
// Round trips over the prototype seed
// ---------------------------------------------------------------------------

function roundTrip<L>(
  m: AnyMapper,
  state: FinState,
  extra: (l: L) => Payload = () => ({}),
) {
  for (const l of m.list(state) as L[]) {
    const row = { id: m.id(l), ...m.toServer(l, state), ...extra(l) }
    expect(m.fromServer(row, state)).toEqual(l)
  }
}

test("round trip: accounts, categories, budgets, planned, settings", () => {
  const s = buildSeed().state
  roundTrip(accountMapper(), s)
  roundTrip(categoryMapper(cats), s)
  roundTrip(budgetMapper(), s)
  roundTrip(plannedMapper(cats), s)
  const settings = settingsMapper(USER, cats)
  const [seeded] = settings.list(s)
  // Live account ids are UUIDs; the demo's slugs are not sent (see below).
  const only = {
    ...seeded,
    value: {
      ...seeded.value,
      defaultAccountId: "3b0c5a3e-0d3f-4e7b-9a43-6a0f2a8f1c01",
      lastAccountId: "3b0c5a3e-0d3f-4e7b-9a43-6a0f2a8f1c02",
    },
  }
  expect(settings.fromServer(settings.toServer(only, s), s)).toEqual(only)
})

test("round trip: records, with the fields the server locks on an adjustment", () => {
  const s = buildSeed().state
  // The device's receipt flag needs an uploaded photo id: not mapped.
  const noReceipt = {
    ...s,
    records: s.records.map(({ receipt: _r, ...r }) => r),
  }
  roundTrip(recordMapper(cats), noReceipt, (r: (typeof s.records)[number]) =>
    r.isAdjustment
      ? { type: r.type, account_id: r.accountId, to_account_id: null }
      : {},
  )
  expect(s.records.some((r) => r.isAdjustment)).toBe(true)
})

test("a record kept in dollars carries its dollars and rate both ways", () => {
  const s = buildSeed().state
  const base = s.records.find((r) => r.type === "expense" && !r.isAdjustment)
  if (!base) throw new Error("seed has an expense")
  const usd = {
    ...base,
    receipt: undefined,
    amount: 5792,
    origCurrency: "USD",
    origAmount: 100,
    fxRate: 57.92,
  }
  const m = recordMapper(cats)
  const wire = m.toServer(usd, s)
  expect(wire).toMatchObject({
    amount_minor: 579200,
    orig_currency: "USD",
    orig_amount_minor: 10000,
    fx_rate: "57.92",
  })
  // The server sends the rate back as a decimal string.
  const back = m.fromServer({ ...wire, id: usd.id, fx_rate: "57.92000000" }, s)
  expect([back?.origCurrency, back?.origAmount, back?.fxRate]).toEqual([
    "USD",
    100,
    57.92,
  ])
  // A peso record sends the three as null, which clears them on the server.
  expect(m.toServer({ ...base, receipt: undefined }, s)).toMatchObject({
    orig_currency: null,
    orig_amount_minor: null,
    fx_rate: null,
  })
})

test("round trip: children fold back into their parents", () => {
  const s = buildSeed().state
  s.planned[0].skipped = [s.planned[0].start]
  s.planned[1].snoozed = {
    [s.planned[1].start]: addDays(s.planned[1].start, 2),
  }
  s.lookbacks = [
    {
      id: "lb",
      period: "2026-09",
      note: "ok",
      savedAt: new Date().toISOString(),
      snapshot: { savingsRate: 0.21, income: 52000.5, spend: 41080.25 },
    },
  ]
  s.threads = [
    {
      id: "t",
      title: "Can I afford it?",
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: "m",
          role: "ai",
          text: "Pick a scope",
          at: new Date().toISOString(),
          answer: "needs-scope",
          scope: "aggregates",
        },
      ],
    },
  ]
  roundTrip(lookBackMapper(), s)
  roundTrip(threadMapper(), s)
  for (const m of [
    budgetCategoryMapper(cats),
    plannedSkipMapper(),
    plannedSnoozeMapper(),
    messageMapper(),
  ] as AnyMapper[]) {
    const rows = m.list(s)
    expect(rows.length).toBeGreaterThan(0)
    const pulled = rows.map((l: unknown) =>
      m.fromServer({ id: m.id(l), ...m.toServer(l, s) }, s),
    )
    expect(pulled).toEqual(rows)
    // Folding the rows into a state stripped of them restores the state.
    const stripped: FinState = {
      ...s,
      budgets: s.budgets.map((b) => ({ ...b, categoryIds: null })),
      planned: s.planned.map((p) => ({ ...p, skipped: [], snoozed: {} })),
      threads: s.threads.map((t) => ({ ...t, messages: [] })),
    }
    expect(m.list(m.merge(stripped, pulled, []))).toEqual(rows)
  }
})

test("seeded categories keep their slugs on the device and the server's ids on the wire", () => {
  const m = categoryMapper(cats)
  const s = buildSeed().state
  const dining = s.categories.find((c) => c.id === "dining")
  if (!dining) throw new Error("seed has dining")
  expect(m.id(dining)).toBe(derivedId("category", USER, "dining"))
  expect(m.toServer(dining, s).parent_id).toBe(
    derivedId("category", USER, "food"),
  )
  // A category the user made keeps its own id both ways.
  const mine = { ...dining, id: "5c8b0e1e-6f63-4f0e-9b0b-2a7f8d0c1e11" }
  expect(m.id(mine)).toBe(mine.id)
})

// ---------------------------------------------------------------------------
// Diffs on realistic store edits
// ---------------------------------------------------------------------------

const seen = new Set<string>()

function setup() {
  const acct = addAccount({
    name: "GCash",
    type: "ewallet",
    opening: 1500.5,
    color: "#1e88e5",
    inNetWorth: true,
    inProjection: true,
  })
  const bank = addAccount({
    name: "BPI",
    type: "bank",
    opening: 20000,
    color: "#c62828",
    inNetWorth: true,
    inProjection: true,
  })
  updateSettings({ defaultAccountId: acct.id })
  const e = engine()
  captureWire(e, seen)
  return { e, acct, bank }
}

test("create sends every field; a one-field edit sends only that field", () => {
  const { e, acct } = setup()
  updateAccount(acct.id, { name: "GCash wallet" })
  const ops = captureWire(e, seen)
  expect(ops).toEqual([
    expect.objectContaining({
      kind: "upsert",
      name: "account",
      id: acct.id,
      data: { name: "GCash wallet" },
    }),
  ])
})

test("a new account is a full create with centavos and snake_case", () => {
  const e = synced()
  const a = addAccount({
    name: "Card",
    type: "credit",
    opening: -1234.56,
    limit: 50000,
    color: "#000",
    inNetWorth: true,
    inProjection: false,
  })
  const [op] = upserts(captureWire(e, seen), "account")
  expect(op.id).toBe(a.id)
  expect(isUuid(a.id)).toBe(true)
  expect(op.data).toEqual({
    name: "Card",
    type: "credit",
    opening_minor: -123456,
    opening_date: today(),
    limit_minor: 5000000,
    color: "#000",
    in_net_worth: true,
    in_projection: false,
    archived: false,
    manual: false,
    sort_order: 0,
    last_reconciled: null,
    rate_bp: null,
    matures_on: null,
    goal_minor: null,
    goal_by: null,
  })
})

test("a time deposit's rate, maturity and goal travel as basis points, days and centavos", () => {
  const e = synced()
  addAccount({
    name: "Tonik TD",
    type: "bank",
    opening: 50000,
    color: "#000",
    inNetWorth: true,
    inProjection: false,
    rate: 5.25,
    maturesOn: "2027-04-25",
    goal: 60000.5,
    goalBy: "2027-10-25",
  })
  const [op] = upserts(captureWire(e, seen), "account")
  expect(op.data).toMatchObject({
    rate_bp: 525,
    matures_on: "2027-04-25",
    goal_minor: 6000050,
    goal_by: "2027-10-25",
  })
  const back = accountMapper().fromServer(
    { id: op.id, ...op.data } as never,
    finStore.get(),
  )
  expect(back).toMatchObject({
    rate: 5.25,
    maturesOn: "2027-04-25",
    goal: 60000.5,
    goalBy: "2027-10-25",
  })
})

test("an account colour travels as its bare token; the server column holds 16", () => {
  const e = synced()
  // "var(--acct-emerald)" is 19 characters: sent whole, the server refused
  // the account (validation_error on color) and it never left the device.
  addAccount({
    name: "Cash",
    type: "cash",
    opening: 1234.56,
    color: "var(--acct-emerald)",
    inNetWorth: true,
    inProjection: true,
  })
  const [op] = upserts(captureWire(e, seen), "account")
  expect(op.data?.color).toBe("emerald")
  for (const c of ["green", "emerald", "violet", "orange", "slate"])
    expect(colorOut(`var(--acct-${c})`).length).toBeLessThanOrEqual(16)
  expect(colorIn("emerald")).toBe("var(--acct-emerald)")
  // Rows written before the change, and other shapes, pass through.
  expect(colorIn("var(--acct-blue)")).toBe("var(--acct-blue)")
  expect(colorIn("#000")).toBe("#000")
  expect(colorIn("fin")).toBe("fin")
  expect(colorOut("#000")).toBe("#000")
})

test("an expense translates its seeded category; delete sends a delete", () => {
  const { e, acct } = setup()
  const r = logExpense({
    amount: 189.75,
    accountId: acct.id,
    categoryId: "dining",
  })
  const ops = captureWire(e, seen)
  const [op] = upserts(ops, "fin_record")
  expect(op.data).toMatchObject({
    type: "expense",
    amount_minor: 18975,
    account_id: acct.id,
    category_id: derivedId("category", USER, "dining"),
    source: "chat",
    status: "cleared",
  })
  // Server-owned fields are never written.
  for (const k of ["planned_id", "planned_on", "fee_of", "is_adjustment"])
    expect(op.data).not.toHaveProperty(k)
  deleteRecord(r.id)
  expect(captureWire(e, seen)).toEqual([
    expect.objectContaining({ kind: "delete", name: "fin_record", id: r.id }),
  ])
})

test("settling a planned occurrence: the settle action first, the record with the server's derived id", () => {
  const { e, acct } = setup()
  const p = addPlanned({
    name: "Rent",
    type: "expense",
    amount: 15000,
    estimated: false,
    accountId: acct.id,
    categoryId: "rent",
    schedule: { kind: "monthly", day: 5 },
    end: { kind: "never" },
    autoLog: false,
    isWhatIf: false,
    inProjection: true,
  })
  captureWire(e, seen)
  const day = `${today().slice(0, 8)}05`
  const rec = settleOccurrence(p.id, day, { amount: 15250.5 })?.record
  expect(rec?.id).toBe(derivedId("planned-record", p.id, day))
  const ops = captureWire(e, seen)
  expect(ops[0]).toMatchObject({
    kind: "action",
    name: "finance.settle",
    data: {
      planned_id: p.id,
      day,
      amount_minor: 1525050,
      account_id: acct.id,
      paid_on: today(),
    },
  })
  const [up] = upserts(ops, "fin_record")
  expect(up.id).toBe(rec?.id)
  expect(up.data).not.toHaveProperty("planned_id")
  expect(up.data).not.toHaveProperty("planned_on")
})

test("settling takes the editor's changes, and the exact instant over the day", () => {
  const { acct } = setup()
  const p = addPlanned({
    name: "Rent",
    type: "expense",
    amount: 15000,
    estimated: false,
    accountId: acct.id,
    categoryId: "rent",
    schedule: { kind: "monthly", day: 5 },
    end: { kind: "never" },
    autoLog: false,
    isWhatIf: false,
    inProjection: true,
  })
  const day = `${today().slice(0, 8)}05`
  const at = new Date(2026, 9, 3, 9, 41).toISOString()
  const out = settleOccurrence(p.id, day, {
    amount: 15100,
    categoryId: "bills",
    payee: "Landlord",
    note: "October",
    date: "2026-01-01",
    at,
  })
  expect(out?.updated).toBe(false)
  expect(out?.record).toMatchObject({
    id: derivedId("planned-record", p.id, day),
    amount: 15100,
    categoryId: "bills",
    payee: "Landlord",
    note: "October",
    at,
    plannedId: p.id,
    plannedOn: day,
  })
})

test("settling the same occurrence twice replaces its record, never a second one", () => {
  const { e, acct } = setup()
  const p = addPlanned({
    name: "Rent",
    type: "expense",
    amount: 15000,
    estimated: false,
    accountId: acct.id,
    categoryId: "rent",
    schedule: { kind: "monthly", day: 5 },
    end: { kind: "never" },
    autoLog: false,
    isWhatIf: false,
    inProjection: true,
  })
  captureWire(e, seen)
  const day = `${today().slice(0, 8)}05`
  const id = derivedId("planned-record", p.id, day)
  expect(settleOccurrence(p.id, day, { amount: 15000 })?.updated).toBe(false)
  captureWire(e, seen)
  const again = settleOccurrence(p.id, day, { amount: 15400 })
  expect(again?.updated).toBe(true)
  const same = finStore.get().records.filter((r) => r.id === id)
  expect(same).toHaveLength(1)
  expect(same[0].amount).toBe(15400)
  // The second save is an update of that row, not a second settle.
  const ops = captureWire(e, seen)
  expect(ops.some((o) => o.kind === "action")).toBe(false)
  expect(upserts(ops, "fin_record").map((o) => o.id)).toEqual([id])
  // A plan that is gone records nothing.
  expect(settleOccurrence("no-such-plan", day, { amount: 1 })).toBeUndefined()
})

test("a transfer's fee is its own record, derived from the transfer, sent after it", () => {
  const { e, acct, bank } = setup()
  const { transfer, fee } = logTransfer({
    from: bank.id,
    to: acct.id,
    amount: 5000,
    fee: 15,
    // logTransfer spreads an absent ``at`` as undefined over addRecord's
    // default (a prototype defect outside this write set): pass one.
    at: new Date().toISOString(),
  })
  expect(fee?.id).toBe(derivedId("transfer-fee", transfer.id, "fee"))
  const ops = upserts(captureWire(e, seen), "fin_record")
  expect(ops.map((o) => o.id)).toEqual([transfer.id, fee?.id])
  expect(ops[0].data).toMatchObject({
    type: "transfer",
    amount_minor: 500000,
    to_account_id: acct.id,
    fee_minor: 1500,
  })
  expect(ops[1].data).toMatchObject({
    type: "expense",
    amount_minor: 1500,
    category_id: derivedId("category", USER, "fees"),
  })
  expect(ops[1].data).not.toHaveProperty("fee_of")
})

test("adjusting a balance is the adjust action; the record write leaves the locked fields out", () => {
  const { e, acct } = setup()
  logExpense({ amount: 200, accountId: acct.id, categoryId: "coffee" })
  captureWire(e, seen)
  const adj = adjustBalance(acct.id, 1000, "counted cash")
  if (!adj) throw new Error("adjusted")
  const ops = captureWire(e, seen)
  expect(ops[0]).toMatchObject({
    kind: "action",
    name: "finance.adjust_balance",
    data: {
      account_id: acct.id,
      actual_minor: 100000,
      note: "counted cash",
      record_id: adj.id,
    },
  })
  const [up] = upserts(ops, "fin_record")
  expect(up.id).toBe(adj.id)
  for (const k of ["type", "account_id", "to_account_id", "is_adjustment"])
    expect(up.data).not.toHaveProperty(k)
})

test("confirming a pending record is the confirm action", () => {
  const { e, acct } = setup()
  const r = logExpense({ amount: 99, accountId: acct.id, pending: true })
  captureWire(e, seen)
  confirmRecord(r.id)
  const ops = captureWire(e, seen)
  expect(actionsOf(ops)).toEqual([
    expect.objectContaining({
      name: "finance.confirm_record",
      data: { record_id: r.id },
    }),
  ])
  expect(ops[0].kind).toBe("action")
})

test("skip, un-skip and snooze write the child rows the server derives", () => {
  const { e, acct } = setup()
  const p = addPlanned({
    name: "Internet",
    type: "expense",
    amount: 1699,
    estimated: false,
    accountId: acct.id,
    categoryId: "internet",
    schedule: { kind: "monthly", day: 20 },
    end: { kind: "never" },
    autoLog: false,
    isWhatIf: false,
    inProjection: true,
  })
  captureWire(e, seen)
  const day = `${today().slice(0, 8)}20`
  skipOccurrence(p.id, day)
  let ops = captureWire(e, seen)
  expect(ops).toEqual([
    expect.objectContaining({
      kind: "upsert",
      name: "planned_skip",
      id: derivedId("planned-skip", p.id, day),
      data: { planned_id: p.id, on_day: day },
    }),
  ])
  unskipOccurrence(p.id, day)
  ops = captureWire(e, seen)
  expect(ops.map((o) => [o.kind, o.name])).toEqual([
    ["action", "finance.unskip"],
    ["delete", "planned_skip"],
  ])
  expect(ops[0].data).toEqual({ planned_id: p.id, day })

  snoozeOccurrence(p.id, day, 2)
  ops = captureWire(e, seen)
  const sid = derivedId("planned-snooze", p.id, day)
  expect(ops).toEqual([
    expect.objectContaining({
      kind: "upsert",
      name: "planned_snooze",
      id: sid,
    }),
  ])
  const first = ops[0].data?.until_day as string
  snoozeOccurrence(p.id, day, 1)
  ops = captureWire(e, seen)
  expect(ops).toEqual([
    expect.objectContaining({
      id: sid,
      data: { until_day: addDays(first, 1) },
    }),
  ])
})

test("a budget's categories are budget_category rows; a name edit is the name only", () => {
  const { e } = setup()
  const b = addBudget({
    name: "Food",
    categoryIds: ["food", "coffee"],
    limit: 18000,
    rollover: false,
  })
  const ops = captureWire(e, seen)
  expect(upserts(ops, "budget")[0].data).toEqual({
    name: "Food",
    limit_minor: 1800000,
    rollover: false,
    start_date: today(),
    archived: false,
  })
  const links = upserts(ops, "budget_category")
  expect(links.map((l) => l.id)).toEqual([
    derivedId("budget-category", b.id, derivedId("category", USER, "food")),
    derivedId("budget-category", b.id, derivedId("category", USER, "coffee")),
  ])
  updateBudget(b.id, { categoryIds: ["food"], name: "Food & drink" })
  const next = captureWire(e, seen)
  expect(next.map((o) => [o.kind, o.name])).toEqual([
    ["upsert", "budget"],
    ["delete", "budget_category"],
  ])
  expect(next[0].data).toEqual({ name: "Food & drink" })
})

test("deleting a category with its records moved: the moves reach the server before the delete", () => {
  const { e, acct } = setup()
  const c = addCategory({
    name: "Snacks",
    kind: "expense",
    icon: "🍪",
    discretionary: true,
  })
  const r = logExpense({ amount: 45, accountId: acct.id, categoryId: c.id })
  captureWire(e, seen)
  deleteCategoryMoving(c.id, "food")
  const ops = captureWire(e, seen)
  expect(ops.map((o) => [o.kind, o.name, o.id])).toEqual([
    ["upsert", "fin_record", r.id],
    ["delete", "category", c.id],
  ])
  expect(ops[0].data).toEqual({
    category_id: derivedId("category", USER, "food"),
  })
})

test("re-saving a look-back keeps its id and sends the change only", () => {
  const e = synced()
  saveLookBack("2026-09", "first", {
    savingsRate: 0.2,
    income: 50000,
    spend: 40000,
  })
  const [created] = upserts(captureWire(e, seen), "look_back")
  expect(created.data).toEqual({
    period: "2026-09",
    note: "first",
    snapshot: {
      savings_rate: 0.2,
      income_minor: 5000000,
      spend_minor: 4000000,
    },
  })
  saveLookBack("2026-09", "second", {
    savingsRate: 0.2,
    income: 50000,
    spend: 40000,
  })
  const ops = captureWire(e, seen)
  expect(ops).toEqual([
    expect.objectContaining({ id: created.id, data: { note: "second" } }),
  ])
})

test("advisor threads and their messages", () => {
  const e = synced()
  const t = newThread("Can I afford a phone?")
  pushMessage(t, { role: "user", text: "₱24,999 phone?", scope: "aggregates" })
  pushMessage(t, {
    role: "ai",
    text: "Pick a scope",
    answer: "needs-scope",
    scope: "aggregates",
  })
  const ops = captureWire(e, seen)
  expect(upserts(ops, "advisor_thread")[0].data).toEqual({
    title: "Can I afford a phone?",
  })
  const msgs = upserts(ops, "advisor_message")
  expect(msgs.map((m) => m.data)).toEqual([
    {
      thread_id: t,
      role: "user",
      text: "₱24,999 phone?",
      answer: null,
      scope: "aggregates",
    },
    {
      thread_id: t,
      role: "ai",
      text: "Pick a scope",
      answer: { text: "needs-scope" },
      scope: "aggregates",
    },
  ])
})

test("settings: one row, centavos, the server-remembered fields never written", () => {
  const { e, acct } = setup()
  updateSettings({ safetyFloor: 25000.5, horizon: 24 })
  logExpense({ amount: 10, accountId: acct.id, categoryId: "coffee" })
  const ops = captureWire(e, seen)
  const [st] = upserts(ops, "finance_settings")
  expect(st.id).toBe(derivedId("singleton", USER, "finance_settings"))
  expect(st.data).toEqual({ safety_floor_minor: 2500050, horizon: 24 })
})

// ---------------------------------------------------------------------------
// Pull: natural keys and no echo
// ---------------------------------------------------------------------------

test("settings never send a demo slug as the default account", () => {
  const settings = settingsMapper(USER, cats)
  const s = finStore.get()
  const [row] = settings.list(s)
  const send = (defaultAccountId: string) =>
    settings.toServer({ ...row, value: { ...row.value, defaultAccountId } }, s)
  // The seed's "gcash" survives until the first pull replaces it.
  expect(send("gcash").default_account_id).toBeNull()
  const id = "0d6f1c1e-6f4a-4c11-9a51-3a3b8f2f0a10"
  expect(send(id).default_account_id).toBe(id)
})

test("a pulled look-back for a period held under another id replaces the local one", () => {
  const e = synced()
  saveLookBack("2026-09", "device", { savingsRate: 0.2, income: 1, spend: 1 })
  e.capture()
  const serverId = derivedId("look-back", USER, "2026-09")
  e.apply([
    {
      entity: "look_back",
      id: serverId,
      version: 3,
      deleted: false,
      row: {
        id: serverId,
        period: "2026-09",
        note: "server",
        saved_at: "2026-10-01T02:00:00Z",
        snapshot: { savings_rate: 0.2, income_minor: 100, spend_minor: 100 },
      },
    },
  ])
  const lbs = finStore.get().lookbacks
  expect(lbs).toEqual([
    expect.objectContaining({ id: serverId, note: "server" }),
  ])
})

test("pulled children fold into their parents and nothing is echoed back", () => {
  const { e, acct } = setup()
  const p = addPlanned({
    name: "Water",
    type: "expense",
    amount: 450,
    estimated: true,
    accountId: acct.id,
    schedule: { kind: "monthly", day: 12 },
    end: { kind: "never" },
    autoLog: false,
    isWhatIf: false,
    inProjection: true,
  })
  const b = addBudget({
    name: "Bills",
    categoryIds: null,
    limit: 9000,
    rollover: true,
  })
  e.capture()
  const day = `${today().slice(0, 8)}12`
  const food = derivedId("category", USER, "food")
  e.apply([
    {
      entity: "planned_skip",
      id: "0b6f0c55-9a1f-4f68-8f0e-2b2f0b3f7c10",
      version: 5,
      deleted: false,
      row: {
        id: "0b6f0c55-9a1f-4f68-8f0e-2b2f0b3f7c10",
        planned_id: p.id,
        on_day: day,
      },
    },
    {
      entity: "budget_category",
      id: "1c6f0c55-9a1f-4f68-8f0e-2b2f0b3f7c10",
      version: 6,
      deleted: false,
      row: {
        id: "1c6f0c55-9a1f-4f68-8f0e-2b2f0b3f7c10",
        budget_id: b.id,
        category_id: food,
      },
    },
  ])
  const s = finStore.get()
  expect(s.planned.find((x) => x.id === p.id)?.skipped).toEqual([day])
  expect(s.budgets.find((x) => x.id === b.id)?.categoryIds).toEqual(["food"])
  expect(e.capture()).toEqual([])
  // A pulled delete of the link (by the id the server derives) clears it.
  e.apply([
    {
      entity: "budget_category",
      id: derivedId("budget-category", b.id, food),
      version: 7,
      deleted: true,
      row: null,
    },
  ])
  expect(
    finStore.get().budgets.find((x) => x.id === b.id)?.categoryIds,
  ).toBeNull()
  expect(e.capture()).toEqual([])
})

// ---------------------------------------------------------------------------
// The wire sample for backend/tests/modules/finance/unit/test_mobile_wire.py
// ---------------------------------------------------------------------------

afterAll(() => {
  // Every id the device sends is a UUID (the server's column type).
  for (const w of wire) {
    const d = w.data as Record<string, unknown>
    for (const [k, v] of Object.entries(d ?? {}))
      if ((k === "id" || k.endsWith("_id")) && v !== null)
        expect([k, isUuid(String(v))]).toEqual([k, true])
  }
  // Each test re-creates the default categories: keep one of each payload.
  const unique = [...new Map(wire.map((w) => [JSON.stringify(w), w])).values()]
  writeStableFixture(join(__dirname, "fixtures", "finance-wire.json"), unique)
})
