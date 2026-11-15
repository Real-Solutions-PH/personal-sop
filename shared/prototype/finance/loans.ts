"use client"
// Loans between two people (shared money). Every amount here is an integer
// count of hundredths (centavos) of the loan's currency, end to end: the
// server's ``*_minor``, never a float.
//
// A loan lives on the server as its own tables; each member's phone holds a
// synced view of it (the ``shared_member`` row, mapped by
// live/mappers/shared.ts). The actions below change that view optimistically
// and the mapper turns each change into one ``finance.loan.*`` sync action,
// queued while offline. The server's next view replaces the optimistic one.
//
// ``loanSummary`` mirrors backend/app/modules/shared_finance/logic.py: the
// confirmed payments are laid over the installments oldest first.

import { derivedId, newId } from "../lib/ids"
import { createStore } from "../lib/store"
import type { SharedBudget, SharedGoal } from "./groups"

export type LoanRole = "lender" | "borrower"
export type LoanStatus =
  | "invited"
  | "active"
  | "declined"
  | "cancelled"
  | "paid"
export type PaymentStatus = "sent" | "accepted" | "rejected" | "withdrawn"
export type InstallmentState =
  | "paid"
  | "partial"
  | "overdue"
  | "due"
  | "upcoming"

export interface LoanPerson {
  id: string
  name: string
  handle?: string
  photoMediaId?: string
}

export interface Installment {
  n: number
  /** YYYY-MM-DD */
  due: string
  amount: number
}

export interface LoanPayment {
  id: string
  kind: "transfer" | "cash"
  status: PaymentStatus
  amount: number
  paidOn: string
  note?: string
  byId: string
  proofMediaId?: string
  /** A photo picked on this phone, shown until the server's copy loads. */
  proofUri?: string
  /** This member's own account: where it left (borrower) or arrived
   * (lender). */
  accountId?: string
  recordId?: string
  decidedAt?: string
  reason?: string
  createdAt: string
}

export interface LoanEvent {
  kind: string
  at: string
  actorId: string
  paymentId?: string
  amount?: number
  text?: string
}

export type LoanSchedule =
  | { kind: "monthly"; count: number; start: string; day: number }
  | { kind: "custom"; count: number }

export interface Loan {
  /** This member's row id (``memberId``). */
  id: string
  loanId: string
  role: LoanRole
  status: LoanStatus
  lender: LoanPerson
  borrower: LoanPerson
  principal: number
  interest: number
  total: number
  currency: string
  purpose?: string
  /** The lender's own account it was paid from (lender only). */
  accountId?: string
  /** Also log the principal as an expense on that account (lender, when
   * making it). */
  logOutlay?: boolean
  schedule: LoanSchedule
  installments: Installment[]
  payments: LoanPayment[]
  events: LoanEvent[]
  createdAt: string
  closedAt?: string
  /** Made on this phone and not yet seen back from the server. */
  local?: boolean
}

export interface SharedState {
  loans: Loan[]
  goals: SharedGoal[]
  budgets: SharedBudget[]
}

export const sharedStore = createStore<SharedState>("finance-shared", () => ({
  loans: [],
  goals: [],
  budgets: [],
}))

export const EMPTY_SHARED: SharedState = { loans: [], goals: [], budgets: [] }

/** The id of ``userId``'s member row of a shared loan, goal or budget (the
 * server derives the same). */
export const memberId = (
  userId: string,
  objectId: string,
  kind: "loan" | "goal" | "budget" = "loan",
) => derivedId("shared-member", userId, `${kind}:${objectId}`)

// ---------------------------------------------------------------- arithmetic

const pad = (n: number) => String(n).padStart(2, "0")
const daysIn = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate()

/** ``day``'s month moved by ``months``, on day ``dom`` (clamped to the
 * month's last day). */
export function addMonthsOn(day: string, months: number, dom: number): string {
  const [y, m] = day.split("-").map(Number)
  const idx = m - 1 + months
  const yy = y + Math.floor(idx / 12)
  const mm = (((idx % 12) + 12) % 12) + 1
  return `${yy}-${pad(mm)}-${pad(Math.min(dom, daysIn(yy, mm)))}`
}

/** ``count`` monthly installments of ``total``: equal shares, leftover
 * centavos on the earliest, the first in ``start``'s month unless ``dom``
 * is already past. */
export function monthlyInstallments(
  total: number,
  count: number,
  start: string,
  dom: number,
): Installment[] {
  if (count < 1 || total < count) return []
  const offset = addMonthsOn(start, 0, dom) < start ? 1 : 0
  const share = Math.floor(total / count)
  const extra = total - share * count
  return Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    due: addMonthsOn(start, i + offset, dom),
    amount: share + (i < extra ? 1 : 0),
  }))
}

export interface InstallmentView extends Installment {
  paid: number
  state: InstallmentState
}

export interface LoanSummary {
  paid: number
  pending: number
  remaining: number
  overdue: number
  installments: InstallmentView[]
  next: InstallmentView | null
  /** Installments fully paid. */
  done: number
}

export function loanSummary(loan: Loan, today: string): LoanSummary {
  const accepted = loan.payments
    .filter((p) => p.status === "accepted")
    .reduce((a, p) => a + p.amount, 0)
  const pending = loan.payments
    .filter((p) => p.status === "sent")
    .reduce((a, p) => a + p.amount, 0)
  let left = accepted
  const installments = [...loan.installments]
    .sort((a, b) => a.due.localeCompare(b.due) || a.n - b.n)
    .map((i): InstallmentView => {
      const paid = Math.max(0, Math.min(i.amount, left))
      left -= paid
      const state: InstallmentState =
        paid >= i.amount
          ? "paid"
          : i.due < today
            ? "overdue"
            : i.due === today
              ? "due"
              : paid > 0
                ? "partial"
                : "upcoming"
      return { ...i, paid, state }
    })
  return {
    paid: accepted,
    pending,
    remaining: Math.max(0, loan.total - accepted),
    overdue: installments
      .filter((i) => i.state === "overdue")
      .reduce((a, i) => a + i.amount - i.paid, 0),
    installments,
    next: installments.find((i) => i.state !== "paid") ?? null,
    done: installments.filter((i) => i.state === "paid").length,
  }
}

/** What a new payment may be at most: the total less what is confirmed and
 * what is still waiting for the lender. */
export const room = (loan: Loan) => {
  const s = loanSummary(loan, "")
  return Math.max(0, s.remaining - s.pending)
}

/** The next payment's suggested amount: what is left of the next
 * installment, never more than the room left. */
export function suggestedPayment(loan: Loan, today: string): number {
  const s = loanSummary(loan, today)
  const next = s.next ? s.next.amount - s.next.paid : 0
  return Math.min(room(loan), next || room(loan))
}

// ---------------------------------------------------------------- actions

const nowIso = () => new Date().toISOString()

function update(loanId: string, fn: (l: Loan) => Loan) {
  sharedStore.set((s) => ({
    ...s,
    loans: s.loans.map((l) => (l.loanId === loanId ? fn(l) : l)),
  }))
}

const event = (
  kind: string,
  actorId: string,
  extra: Partial<LoanEvent> = {},
): LoanEvent => ({ kind, at: nowIso(), actorId, ...extra })

export interface NewLoan {
  me: LoanPerson
  borrower: LoanPerson
  principal: number
  interest?: number
  currency: string
  purpose?: string
  accountId?: string
  logOutlay?: boolean
  count: number
  start: string
  day: number
}

/** The lender's new loan, invited until the borrower accepts. */
export function createLoan(n: NewLoan): Loan {
  const loanId = newId()
  const total = n.principal + (n.interest ?? 0)
  const loan: Loan = {
    id: memberId(n.me.id, loanId),
    loanId,
    role: "lender",
    status: "invited",
    lender: n.me,
    borrower: n.borrower,
    principal: n.principal,
    interest: n.interest ?? 0,
    total,
    currency: n.currency,
    purpose: n.purpose?.trim() || undefined,
    accountId: n.accountId,
    logOutlay: n.accountId ? n.logOutlay : undefined,
    schedule: { kind: "monthly", count: n.count, start: n.start, day: n.day },
    installments: monthlyInstallments(total, n.count, n.start, n.day),
    payments: [],
    events: [event("created", n.me.id, { amount: total })],
    createdAt: nowIso(),
    local: true,
  }
  sharedStore.set((s) => ({ ...s, loans: [loan, ...s.loans] }))
  return loan
}

/** After the server refused a new loan, goal or budget: drop the ones it never took (the
 * full pull that follows brings back every one it did). */
export function dropUnconfirmed(creates: boolean) {
  if (!creates) return
  sharedStore.set((s) => ({
    ...s,
    loans: s.loans.filter((l) => !l.local),
    goals: (s.goals ?? []).filter((g) => !g.local),
    budgets: (s.budgets ?? []).filter((b) => !b.local),
  }))
}

export function respondLoan(loanId: string, accept: boolean) {
  update(loanId, (l) =>
    l.role === "borrower" && l.status === "invited"
      ? {
          ...l,
          status: accept ? "active" : "declined",
          events: [
            ...l.events,
            event(accept ? "accepted" : "declined", l.borrower.id),
          ],
        }
      : l,
  )
}

export function cancelLoan(loanId: string) {
  update(loanId, (l) =>
    l.role === "lender" && (l.status === "invited" || l.status === "active")
      ? {
          ...l,
          status: "cancelled",
          closedAt: nowIso(),
          events: [...l.events, event("cancelled", l.lender.id)],
        }
      : l,
  )
}

export interface NewPayment {
  amount: number
  paidOn: string
  accountId: string
  note?: string
  proofMediaId?: string
  proofUri?: string
}

/** The borrower's payment, sent for the lender to confirm. */
export function sendPayment(loanId: string, p: NewPayment): string {
  const id = newId()
  update(loanId, (l) => ({
    ...l,
    payments: [
      ...l.payments,
      {
        id,
        kind: "transfer",
        status: "sent",
        amount: p.amount,
        paidOn: p.paidOn,
        note: p.note?.trim() || undefined,
        byId: l.borrower.id,
        proofMediaId: p.proofMediaId,
        proofUri: p.proofUri,
        accountId: p.accountId,
        createdAt: nowIso(),
      },
    ],
    events: [
      ...l.events,
      event("payment_sent", l.borrower.id, { paymentId: id, amount: p.amount }),
    ],
  }))
  return id
}

/** Cash the lender got in hand: confirmed straight away. */
export function recordCash(loanId: string, p: NewPayment): string {
  const id = newId()
  update(loanId, (l) => {
    const next: Loan = {
      ...l,
      payments: [
        ...l.payments,
        {
          id,
          kind: "cash",
          status: "accepted",
          amount: p.amount,
          paidOn: p.paidOn,
          note: p.note?.trim() || undefined,
          byId: l.lender.id,
          accountId: p.accountId,
          decidedAt: nowIso(),
          createdAt: nowIso(),
        },
      ],
      events: [
        ...l.events,
        event("cash_recorded", l.lender.id, {
          paymentId: id,
          amount: p.amount,
        }),
      ],
    }
    return closeIfPaid(next)
  })
  return id
}

function closeIfPaid(l: Loan): Loan {
  const s = loanSummary(l, "")
  return l.status === "active" && s.remaining === 0
    ? {
        ...l,
        status: "paid",
        closedAt: nowIso(),
        events: [
          ...l.events,
          event("paid_off", l.lender.id, { amount: s.paid }),
        ],
      }
    : l
}

function decideOne(
  loanId: string,
  paymentId: string,
  patch: Partial<LoanPayment>,
  kind: string,
  actor: (l: Loan) => string,
) {
  update(loanId, (l) => {
    const p = l.payments.find((x) => x.id === paymentId)
    if (!p || p.status !== "sent") return l
    const next = {
      ...l,
      payments: l.payments.map((x) =>
        x.id === paymentId ? { ...x, ...patch, decidedAt: nowIso() } : x,
      ),
      events: [
        ...l.events,
        event(kind, actor(l), {
          paymentId,
          amount: p.amount,
          text: patch.reason,
        }),
      ],
    }
    return kind === "payment_accepted" ? closeIfPaid(next) : next
  })
}

/** The lender confirms a sent payment into one of their accounts. */
export function acceptPayment(
  loanId: string,
  paymentId: string,
  accountId: string,
) {
  decideOne(
    loanId,
    paymentId,
    { status: "accepted", accountId },
    "payment_accepted",
    (l) => l.lender.id,
  )
}

/** The lender turns a sent payment down, saying why. */
export function rejectPayment(
  loanId: string,
  paymentId: string,
  reason: string,
) {
  decideOne(
    loanId,
    paymentId,
    { status: "rejected", reason: reason.trim() },
    "payment_rejected",
    (l) => l.lender.id,
  )
}

/** The borrower takes back a payment the lender hasn't answered. */
export function withdrawPayment(loanId: string, paymentId: string) {
  decideOne(
    loanId,
    paymentId,
    { status: "withdrawn" },
    "payment_withdrawn",
    (l) => l.borrower.id,
  )
}
