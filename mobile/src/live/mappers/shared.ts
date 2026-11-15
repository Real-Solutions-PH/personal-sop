// Shared money (loans) <-> the server's ``shared_member`` rows and the
// ``finance.loan.*`` actions (backend/app/modules/shared_finance/sync.py).
//
// A member row is the server's view of one loan for this member, written
// only by the server: the device never sends it as fields. Every change a
// person makes on a loan (the actions in @domain/finance/loans) is turned
// here into one action op, queued in the outbox while offline; the server's
// next view of the loan then replaces the optimistic one.
//
// Amounts are integer hundredths on both sides (no conversion), dates are
// YYYY-MM-DD, instants ISO.

import {
  type Loan,
  type LoanEvent,
  type LoanPayment,
  type LoanPerson,
  type SharedState,
  sharedStore,
} from "@domain/finance/loans"
import type { ActionOp, Mapper, Payload } from "../mapper"

export const LOAN_ACTIONS = [
  "finance.loan.create",
  "finance.loan.respond",
  "finance.loan.cancel",
  "finance.loan.pay",
  "finance.loan.withdraw",
  "finance.loan.decide",
  "finance.loan.cash",
] as const

type Row = Record<string, unknown>

const str = (v: unknown): string | undefined =>
  v === null || v === undefined || v === "" ? undefined : String(v)
const num = (v: unknown) => Number(v ?? 0)
const instant = (v: unknown) => new Date(String(v)).toISOString()

function person(v: unknown): LoanPerson {
  const p = (v ?? {}) as Row
  return {
    id: String(p.id ?? ""),
    name: String(p.name ?? "Someone"),
    handle: str(p.handle),
    photoMediaId: str(p.photo_media_id),
  }
}

function payment(v: Row): LoanPayment {
  return {
    id: String(v.id),
    kind: v.kind === "cash" ? "cash" : "transfer",
    status: v.status as LoanPayment["status"],
    amount: num(v.amount_minor),
    paidOn: String(v.paid_on),
    note: str(v.note),
    byId: String(v.by_id),
    proofMediaId: str(v.proof_media_id),
    accountId: str(v.account_id),
    recordId: str(v.record_id),
    decidedAt: v.decided_at ? instant(v.decided_at) : undefined,
    reason: str(v.reason),
    createdAt: instant(v.created_at),
  }
}

function loanEvent(v: Row): LoanEvent {
  return {
    kind: String(v.kind),
    at: instant(v.at),
    actorId: String(v.actor_id),
    paymentId: str(v.payment_id),
    amount: v.amount_minor == null ? undefined : num(v.amount_minor),
    text: str(v.text),
  }
}

/** A pulled member row -> the local loan (null for a kind this phone
 * doesn't show yet). */
export function loanFromRow(row: Payload): Loan | null {
  if (row.kind !== "loan") return null
  const d = (row.data ?? {}) as Row
  const sch = (d.schedule ?? {}) as Row
  return {
    id: String(row.id),
    loanId: String(row.object_id),
    role: row.role === "lender" ? "lender" : "borrower",
    status: String(d.status ?? row.status) as Loan["status"],
    lender: person(d.lender),
    borrower: person(d.borrower),
    principal: num(d.principal_minor),
    interest: num(d.interest_minor),
    total: num(d.total_minor),
    currency: String(d.currency ?? "PHP"),
    purpose: str(d.purpose),
    accountId: str(d.account_id),
    schedule:
      sch.kind === "monthly"
        ? {
            kind: "monthly",
            count: num(sch.count),
            start: String(sch.start),
            day: num(sch.day),
          }
        : { kind: "custom", count: num(sch.count) },
    installments: ((d.installments ?? []) as Row[]).map((i) => ({
      n: num(i.n),
      due: String(i.due),
      amount: num(i.amount_minor),
    })),
    payments: ((d.payments ?? []) as Row[]).map(payment),
    events: ((d.events ?? []) as Row[]).map(loanEvent),
    createdAt: instant(d.created_at),
    closedAt: d.closed_at ? instant(d.closed_at) : undefined,
  }
}

/** The ops one local change of a loan stands for. */
export function loanActions(
  prev: Loan | undefined,
  next: Loan | undefined,
): ActionOp[] {
  if (!next) return []
  const loan_id = next.loanId
  if (!prev) {
    if (next.role !== "lender" || next.status !== "invited") return []
    const s = next.schedule
    return [
      {
        name: "finance.loan.create",
        data: {
          id: loan_id,
          borrower_id: next.borrower.id,
          principal_minor: next.principal,
          interest_minor: next.interest,
          purpose: next.purpose ?? null,
          account_id: next.accountId ?? null,
          log_outlay: Boolean(next.accountId && next.logOutlay),
          schedule:
            s.kind === "monthly"
              ? { kind: "monthly", count: s.count, start: s.start, day: s.day }
              : {
                  kind: "custom",
                  installments: next.installments.map((i) => ({
                    due: i.due,
                    amount_minor: i.amount,
                  })),
                },
        },
      },
    ]
  }
  const out: ActionOp[] = []
  if (
    next.role === "borrower" &&
    prev.status === "invited" &&
    (next.status === "active" || next.status === "declined")
  )
    out.push({
      name: "finance.loan.respond",
      data: { loan_id, accept: next.status === "active" },
    })
  if (
    next.role === "lender" &&
    prev.status !== "cancelled" &&
    next.status === "cancelled"
  )
    out.push({ name: "finance.loan.cancel", data: { loan_id } })
  const before = new Map(prev.payments.map((p) => [p.id, p]))
  for (const p of next.payments) {
    const was = before.get(p.id)
    if (!was) {
      if (p.kind === "transfer" && next.role === "borrower" && p.accountId)
        out.push({
          name: "finance.loan.pay",
          data: {
            loan_id,
            id: p.id,
            amount_minor: p.amount,
            paid_on: p.paidOn,
            account_id: p.accountId,
            proof_media_id: p.proofMediaId ?? null,
            note: p.note ?? null,
          },
        })
      else if (p.kind === "cash" && next.role === "lender" && p.accountId)
        out.push({
          name: "finance.loan.cash",
          data: {
            loan_id,
            id: p.id,
            amount_minor: p.amount,
            paid_on: p.paidOn,
            account_id: p.accountId,
            note: p.note ?? null,
          },
        })
      continue
    }
    if (was.status !== "sent" || p.status === "sent") continue
    if (next.role === "borrower" && p.status === "withdrawn")
      out.push({
        name: "finance.loan.withdraw",
        data: { loan_id, payment_id: p.id },
      })
    else if (
      next.role === "lender" &&
      (p.status === "accepted" || p.status === "rejected")
    )
      out.push({
        name: "finance.loan.decide",
        data: {
          loan_id,
          payment_id: p.id,
          accept: p.status === "accepted",
          account_id: p.status === "accepted" ? (p.accountId ?? null) : null,
          reason: p.status === "rejected" ? (p.reason ?? null) : null,
        },
      })
  }
  return out
}

export function sharedMemberMapper(): Mapper<SharedState, Loan> {
  return {
    entity: "shared_member",
    store: sharedStore,
    list: (s) => s.loans,
    id: (l) => l.id,
    // Never sent as fields (actionsOnly); what the snapshot compares.
    toServer: (l) => ({ status: l.status, payments: l.payments.length }),
    fromServer: (row) => loanFromRow(row),
    merge: (s, ups, dels) => {
      const gone = new Set(dels)
      const byId = new Map(ups.map((l) => [l.id, l]))
      const kept = s.loans
        .filter((l) => !gone.has(l.id))
        .map((l) => {
          const u = byId.get(l.id)
          if (!u) return l
          byId.delete(l.id)
          // A photo picked on this phone stays shown until it is replaced.
          const local = new Map(l.payments.map((p) => [p.id, p.proofUri]))
          return {
            ...u,
            payments: u.payments.map((p) =>
              local.get(p.id) ? { ...p, proofUri: local.get(p.id) } : p,
            ),
          }
        })
      return {
        ...s,
        loans: [...byId.values(), ...kept].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
      }
    },
    actionsOnly: true,
    heldBy: LOAN_ACTIONS,
    // A refused loan action leaves this phone's optimistic view ahead of
    // the server: pull it again.
    resyncOnReject: LOAN_ACTIONS,
    actions: loanActions,
  }
}

export const sharedMappers = () => [sharedMemberMapper()]
