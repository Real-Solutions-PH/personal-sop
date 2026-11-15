import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as L from "@domain/finance/loans"
import type { StorageAdapter } from "@domain/lib/store"
import { SyncEngine } from "../engine"
import type { Http } from "../http"
import { loanActions, loanFromRow, sharedMappers } from "../mappers/shared"
import { createOutbox, type SyncOp } from "../outbox"

const KAI = "11111111-1111-4111-8111-111111111111"
const MIA = "22222222-2222-4222-8222-222222222222"
const ACCT = "33333333-3333-4333-8333-333333333333"
const LOAN = "44444444-4444-4444-8444-444444444444"
const MEDIA = "55555555-5555-4555-8555-555555555555"

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
function engine() {
  const storage = memoryStorage()
  return new SyncEngine({
    http: noHttp,
    storage,
    outbox: createOutbox(storage),
    mappers: sharedMappers(),
    online: () => false,
  })
}

// Every op, for the backend's wire-format check (tests/modules/shared_finance).
const wire: Omit<SyncOp, "op_id" | "at">[] = []
const strip = (op: SyncOp) => {
  const { op_id: _o, at: _a, ...rest } = op
  // Ids minted on the device change every run: the fixture stays stable.
  const data = { ...op.data } as Record<string, unknown>
  if (typeof data.id === "string") data.id = LOAN
  if (typeof data.payment_id === "string") data.payment_id = LOAN
  if (typeof data.loan_id === "string") data.loan_id = LOAN
  return { ...rest, data }
}

beforeEach(() => L.sharedStore.reset())

afterAll(() => {
  const dir = join(__dirname, "fixtures")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "shared-finance-wire.json"),
    `${JSON.stringify(wire, null, 2)}\n`,
  )
})

/** A member row as the server pulls it. */
function row(role: L.LoanRole, extra: Record<string, unknown> = {}) {
  const me = role === "lender" ? KAI : MIA
  return {
    id: L.memberId(me, LOAN),
    version: 7,
    kind: "loan",
    object_id: LOAN,
    role,
    status: "active",
    data: {
      id: LOAN,
      role,
      status: "active",
      lender: { id: KAI, name: "Kai", handle: "kai", photo_media_id: null },
      borrower: { id: MIA, name: "Mia", handle: null, photo_media_id: null },
      principal_minor: 1_200_000,
      interest_minor: 0,
      total_minor: 1_200_000,
      currency: "PHP",
      purpose: "Phone",
      account_id: role === "lender" ? ACCT : null,
      schedule: { kind: "monthly", count: 6, start: "2026-11-15", day: 15 },
      installments: L.monthlyInstallments(1_200_000, 6, "2026-11-15", 15).map(
        (i) => ({ n: i.n, due: i.due, amount_minor: i.amount }),
      ),
      payments: [],
      events: [],
      created_at: "2026-11-15T03:00:00Z",
      ...extra,
    },
  }
}

function seed(role: L.LoanRole, extra: Record<string, unknown> = {}) {
  const loan = loanFromRow(row(role, extra))
  if (!loan) throw new Error("no loan")
  L.sharedStore.set({ loans: [loan] })
  return loan
}

it("a new loan is one create action carrying its schedule", () => {
  const e = engine()
  e.capture()
  const loan = L.createLoan({
    me: { id: KAI, name: "Kai" },
    borrower: { id: MIA, name: "Mia" },
    principal: 1_200_000,
    currency: "PHP",
    purpose: " Phone ",
    accountId: ACCT,
    logOutlay: true,
    count: 6,
    start: "2026-11-15",
    day: 15,
  })
  expect(loan.id).toBe(L.memberId(KAI, loan.loanId))
  expect(loan.installments.map((i) => i.amount)).toEqual(Array(6).fill(200_000))
  const ops = e.capture()
  expect(ops).toHaveLength(1)
  expect(ops[0]).toMatchObject({
    kind: "action",
    name: "finance.loan.create",
    data: {
      id: loan.loanId,
      borrower_id: MIA,
      principal_minor: 1_200_000,
      interest_minor: 0,
      purpose: "Phone",
      account_id: ACCT,
      log_outlay: true,
      schedule: { kind: "monthly", count: 6, start: "2026-11-15", day: 15 },
    },
  })
  wire.push(strip(ops[0]))
  // Nothing more until it changes again; the row itself is never sent.
  expect(e.capture()).toEqual([])
})

it("the borrower accepts, pays with proof and withdraws", () => {
  const e = engine()
  seed("borrower", { status: "invited" })
  L.sharedStore.set((s) => ({
    loans: s.loans.map((l) => ({ ...l, status: "invited" as const })),
  }))
  e.capture()
  L.respondLoan(LOAN, true)
  const [respond] = e.capture()
  expect(respond).toMatchObject({
    name: "finance.loan.respond",
    data: { loan_id: LOAN, accept: true },
  })
  wire.push(strip(respond))

  const pid = L.sendPayment(LOAN, {
    amount: 200_000,
    paidOn: "2026-11-15",
    accountId: ACCT,
    proofMediaId: MEDIA,
    note: "GCash ref 1234",
  })
  const [pay] = e.capture()
  expect(pay).toMatchObject({
    name: "finance.loan.pay",
    data: {
      loan_id: LOAN,
      id: pid,
      amount_minor: 200_000,
      paid_on: "2026-11-15",
      account_id: ACCT,
      proof_media_id: MEDIA,
      note: "GCash ref 1234",
    },
  })
  wire.push(strip(pay))
  const loan = L.sharedStore.get().loans[0]
  expect(L.loanSummary(loan, "2026-11-15")).toMatchObject({
    paid: 0,
    pending: 200_000,
    remaining: 1_200_000,
  })
  expect(L.room(loan)).toBe(1_000_000)

  L.withdrawPayment(LOAN, pid)
  const [withdraw] = e.capture()
  expect(withdraw).toMatchObject({
    name: "finance.loan.withdraw",
    data: { loan_id: LOAN, payment_id: pid },
  })
  wire.push(strip(withdraw))
})

it("the lender confirms one payment, rejects another and records cash", () => {
  const e = engine()
  const sent = (id: string) => ({
    id,
    kind: "transfer",
    status: "sent",
    amount_minor: 200_000,
    paid_on: "2026-11-15",
    note: null,
    by_id: MIA,
    proof_media_id: null,
    account_id: null,
    record_id: null,
    decided_at: null,
    reason: null,
    created_at: "2026-11-15T04:00:00Z",
  })
  seed("lender", { payments: [sent("p1"), sent("p2")] })
  e.capture()
  L.acceptPayment(LOAN, "p1", ACCT)
  const [accept] = e.capture()
  expect(accept).toMatchObject({
    name: "finance.loan.decide",
    data: {
      loan_id: LOAN,
      payment_id: "p1",
      accept: true,
      account_id: ACCT,
      reason: null,
    },
  })
  wire.push(strip(accept))
  L.rejectPayment(LOAN, "p2", " Not in my account yet ")
  const [reject] = e.capture()
  expect(reject).toMatchObject({
    name: "finance.loan.decide",
    data: {
      payment_id: "p2",
      accept: false,
      account_id: null,
      reason: "Not in my account yet",
    },
  })
  wire.push(strip(reject))
  // Deciding again changes nothing locally, so nothing is sent.
  L.acceptPayment(LOAN, "p2", ACCT)
  expect(e.capture()).toEqual([])

  const cid = L.recordCash(LOAN, {
    amount: 100_000,
    paidOn: "2026-11-16",
    accountId: ACCT,
  })
  const [cash] = e.capture()
  expect(cash).toMatchObject({
    name: "finance.loan.cash",
    data: {
      loan_id: LOAN,
      id: cid,
      amount_minor: 100_000,
      paid_on: "2026-11-16",
      account_id: ACCT,
      note: null,
    },
  })
  wire.push(strip(cash))
  const s = L.loanSummary(L.sharedStore.get().loans[0], "2026-11-16")
  expect(s.paid).toBe(300_000)
  expect(s.remaining).toBe(900_000)
  expect(s.installments[0].state).toBe("paid")
  expect(s.installments[1].state).toBe("partial")
})

it("the lender cancels an invite", () => {
  const e = engine()
  seed("lender", { status: "invited" })
  L.sharedStore.set((s) => ({
    loans: s.loans.map((l) => ({ ...l, status: "invited" as const })),
  }))
  e.capture()
  L.cancelLoan(LOAN)
  const [cancel] = e.capture()
  expect(cancel).toMatchObject({
    name: "finance.loan.cancel",
    data: { loan_id: LOAN },
  })
  wire.push(strip(cancel))
})

it("only the right member's changes become actions", () => {
  const borrower = loanFromRow(row("borrower"))!
  const lender = loanFromRow(row("lender"))!
  const pay: L.LoanPayment = {
    id: "x",
    kind: "transfer",
    status: "sent",
    amount: 1,
    paidOn: "2026-11-15",
    byId: MIA,
    accountId: ACCT,
    createdAt: "2026-11-15T00:00:00Z",
  }
  // A lender's view never sends a borrower's payment, and vice versa.
  expect(loanActions(lender, { ...lender, payments: [pay] })).toEqual([])
  expect(
    loanActions(
      { ...borrower, payments: [pay] },
      { ...borrower, payments: [{ ...pay, status: "accepted" }] },
    ),
  ).toEqual([])
  // A pulled loan the lender didn't make on this phone is no create.
  expect(loanActions(undefined, borrower)).toEqual([])
  expect(loanActions(borrower, undefined)).toEqual([])
})

it("maps a pulled member row and keeps this phone's proof photo", () => {
  const m = sharedMappers()[0]
  const pulled = m.fromServer(
    row("borrower", {
      payments: [
        {
          id: "p1",
          kind: "transfer",
          status: "accepted",
          amount_minor: 200_000,
          paid_on: "2026-11-15",
          note: "Nov",
          by_id: MIA,
          proof_media_id: MEDIA,
          account_id: ACCT,
          record_id: "r1",
          decided_at: "2026-11-15T05:00:00Z",
          reason: null,
          created_at: "2026-11-15T04:00:00Z",
        },
      ],
    }),
    L.sharedStore.get(),
  )
  expect(pulled).toMatchObject({
    id: L.memberId(MIA, LOAN),
    loanId: LOAN,
    role: "borrower",
    lender: { id: KAI, name: "Kai", handle: "kai" },
    accountId: undefined,
    payments: [
      {
        id: "p1",
        amount: 200_000,
        status: "accepted",
        proofMediaId: MEDIA,
        recordId: "r1",
      },
    ],
  })
  const local = { ...pulled!, payments: [{ ...pulled!.payments[0], proofUri: "file:///p.jpg" }] }
  const merged = m.merge({ loans: [local] }, [pulled!], [])
  expect(merged.loans[0].payments[0].proofUri).toBe("file:///p.jpg")
  expect(m.merge(merged, [], [pulled!.id]).loans).toEqual([])
  expect(m.fromServer({ ...row("lender"), kind: "goal" }, merged)).toBeNull()
})

describe("loan arithmetic matches the server", () => {
  it("splits leftover centavos onto the earliest installments", () => {
    const rows = L.monthlyInstallments(1_200_000, 7, "2026-01-01", 1)
    expect(rows.reduce((a, r) => a + r.amount, 0)).toBe(1_200_000)
    expect(rows.map((r) => r.amount)).toEqual([
      171_429, 171_429, 171_429, 171_429, 171_428, 171_428, 171_428,
    ])
  })

  it("clamps the day to the month and starts next month when past", () => {
    expect(
      L.monthlyInstallments(300, 3, "2026-01-20", 31).map((r) => r.due),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"])
    expect(
      L.monthlyInstallments(200, 2, "2026-01-20", 5).map((r) => r.due),
    ).toEqual(["2026-02-05", "2026-03-05"])
    expect(L.monthlyInstallments(2, 3, "2026-01-01", 1)).toEqual([])
  })

  it("marks overdue, due and upcoming against today", () => {
    const loan = seed("lender")
    const due = L.loanSummary(loan, "2026-11-15")
    expect(due.installments[0].state).toBe("due")
    const late = L.loanSummary(loan, "2026-12-20")
    expect(late.installments.slice(0, 3).map((i) => i.state)).toEqual([
      "overdue",
      "overdue",
      "upcoming",
    ])
    expect(late.overdue).toBe(400_000)
    expect(late.next?.n).toBe(1)
    expect(L.suggestedPayment(loan, "2026-12-20")).toBe(200_000)
  })
})
