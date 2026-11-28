// Shared money (loans, shared goals, shared budgets) <-> the server's
// ``shared_member`` rows and the ``finance.loan.*`` / ``finance.goal.*`` /
// ``finance.budget.*`` / ``finance.shared.respond`` actions
// (backend/app/modules/shared_finance/sync.py).
//
// A member row is the server's view of one loan for this member, written
// only by the server: the device never sends it as fields. Every change a
// person makes on a loan (the actions in @domain/finance/loans) is turned
// here into one action op, queued in the outbox while offline; the server's
// next view of the loan then replaces the optimistic one.
//
// Amounts are integer hundredths on both sides (no conversion), dates are
// YYYY-MM-DD, instants ISO.

import type {
  JointCategory,
  JointMember,
  JointRecord,
  JointStatus,
  SharedAccount,
} from "@domain/finance/joint"
import type {
  GoalEntry,
  GroupMember,
  MemberStatus,
  SharedBudget,
  SharedGoal,
} from "@domain/finance/groups"
import {
  type Loan,
  type LoanEvent,
  type LoanPayment,
  type LoanPerson,
  type SharedState,
  sharedStore,
} from "@domain/finance/loans"
import type { ActionOp, Mapper, Payload } from "../mapper"
import { categoryIds } from "./finance"

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

// ---------------------------------------------------------------- goals, budgets

export const GROUP_ACTIONS = [
  "finance.goal.create",
  "finance.budget.create",
  "finance.shared.respond",
  "finance.budget.categories",
  "finance.goal.entry",
  "finance.goal.withdraw",
  "finance.goal.decide",
] as const

export const ACCOUNT_ACTIONS = [
  "finance.account.record",
  "finance.account.leave",
] as const

const SHARED_ACTIONS = [...LOAN_ACTIONS, ...GROUP_ACTIONS, ...ACCOUNT_ACTIONS]

/** Category ids between the phone (slugs for the seeded ones) and the
 * server (UUIDs). */
type Cats = ReturnType<typeof categoryIds>

function members(v: unknown): GroupMember[] {
  return ((v ?? []) as Row[]).map((m) => ({
    person: person(m.person),
    role: m.role === "owner" ? "owner" : "member",
    status: String(m.status) as MemberStatus,
    amount: num(m.amount_minor),
  }))
}

function entry(v: Row): GoalEntry {
  return {
    id: String(v.id),
    kind: v.kind === "withdrawal" ? "withdrawal" : "deposit",
    status: v.status as GoalEntry["status"],
    amount: num(v.amount_minor),
    onDate: String(v.on_date),
    note: str(v.note),
    byId: String(v.by_id),
    accountId: str(v.account_id),
    decidedAt: v.decided_at ? instant(v.decided_at) : undefined,
    decidedBy: str(v.decided_by),
    reason: str(v.reason),
    createdAt: instant(v.created_at),
  }
}

export function goalFromRow(row: Payload): SharedGoal | null {
  if (row.kind !== "goal") return null
  const d = (row.data ?? {}) as Row
  return {
    id: String(row.id),
    goalId: String(row.object_id),
    role: row.role === "owner" ? "owner" : "member",
    myStatus: String(d.my_status ?? row.status) as MemberStatus,
    status: d.status === "closed" ? "closed" : "active",
    name: String(d.name ?? ""),
    currency: String(d.currency ?? "PHP"),
    target: d.target_minor == null ? undefined : num(d.target_minor),
    deadline: str(d.deadline),
    members: members(d.members),
    entries: ((d.entries ?? []) as Row[]).map(entry),
    createdAt: instant(d.created_at),
  }
}

export function budgetFromRow(row: Payload, cats: Cats): SharedBudget | null {
  if (row.kind !== "budget") return null
  const d = (row.data ?? {}) as Row
  return {
    id: String(row.id),
    budgetId: String(row.object_id),
    role: row.role === "owner" ? "owner" : "member",
    myStatus: String(d.my_status ?? row.status) as MemberStatus,
    status: d.status === "closed" ? "closed" : "active",
    name: String(d.name ?? ""),
    currency: String(d.currency ?? "PHP"),
    limit: num(d.limit_minor),
    month: String(d.month ?? ""),
    spent: num(d.spent_minor),
    myCategoryIds: ((d.my_category_ids ?? []) as unknown[])
      .map((c) => cats.in(c))
      .filter((c): c is string => !!c),
    members: members(d.members),
    createdAt: instant(d.created_at),
  }
}

const invited = (ms: GroupMember[]) =>
  ms.filter((m) => m.role === "member").map((m) => m.person.id)

export function goalActions(
  prev: SharedGoal | undefined,
  next: SharedGoal | undefined,
  me: string,
): ActionOp[] {
  if (!next) return []
  const goal_id = next.goalId
  if (!prev) {
    if (!next.local || next.role !== "owner") return []
    return [
      {
        name: "finance.goal.create",
        data: {
          id: goal_id,
          name: next.name,
          target_minor: next.target ?? null,
          deadline: next.deadline ?? null,
          member_ids: invited(next.members),
        },
      },
    ]
  }
  const out: ActionOp[] = []
  if (prev.myStatus === "invited" && next.myStatus !== "invited")
    out.push({
      name: "finance.shared.respond",
      data: {
        kind: "goal",
        object_id: goal_id,
        accept: next.myStatus === "active",
        category_ids: [],
      },
    })
  const before = new Map(prev.entries.map((e) => [e.id, e]))
  for (const e of next.entries) {
    const was = before.get(e.id)
    if (!was) {
      if (e.byId === me && e.accountId)
        out.push({
          name: "finance.goal.entry",
          data: {
            id: e.id,
            goal_id,
            kind: e.kind,
            amount_minor: e.amount,
            on_date: e.onDate,
            account_id: e.accountId,
            note: e.note ?? null,
          },
        })
      continue
    }
    if (was.status !== "sent" || e.status === "sent") continue
    if (e.status === "withdrawn" && e.byId === me)
      out.push({
        name: "finance.goal.withdraw",
        data: { goal_id, entry_id: e.id },
      })
    else if (
      (e.status === "accepted" || e.status === "rejected") &&
      e.byId !== me
    )
      out.push({
        name: "finance.goal.decide",
        data: {
          goal_id,
          entry_id: e.id,
          accept: e.status === "accepted",
          reason: e.status === "rejected" ? (e.reason ?? null) : null,
        },
      })
  }
  return out
}

export function budgetActions(
  prev: SharedBudget | undefined,
  next: SharedBudget | undefined,
  cats: Cats,
): ActionOp[] {
  if (!next) return []
  const ids = next.myCategoryIds.map((c) => cats.out(c)).filter(Boolean)
  if (!prev) {
    if (!next.local || next.role !== "owner") return []
    return [
      {
        name: "finance.budget.create",
        data: {
          id: next.budgetId,
          name: next.name,
          limit_minor: next.limit,
          member_ids: invited(next.members),
          category_ids: ids,
        },
      },
    ]
  }
  if (prev.myStatus === "invited" && next.myStatus !== "invited")
    return [
      {
        name: "finance.shared.respond",
        data: {
          kind: "budget",
          object_id: next.budgetId,
          accept: next.myStatus === "active",
          category_ids: next.myStatus === "active" ? ids : [],
        },
      },
    ]
  if (
    next.myStatus === "active" &&
    prev.myCategoryIds.join() !== next.myCategoryIds.join()
  )
    return [
      {
        name: "finance.budget.categories",
        data: { budget_id: next.budgetId, category_ids: ids },
      },
    ]
  return []
}

// ---------------------------------------------------------------- joint accounts

function jointMembers(v: unknown): JointMember[] {
  return ((v ?? []) as Row[]).map((m) => ({
    person: person(m.person),
    role: m.role === "owner" ? "owner" : "member",
    status: String(m.status) as JointStatus,
  }))
}

export function jointRecord(v: Row): JointRecord {
  return {
    id: String(v.id),
    kind: String(v.kind) as JointRecord["kind"],
    amount: num(v.amount_minor),
    signed: num(v.signed_minor),
    at: instant(v.at),
    day: String(v.day),
    payee: str(v.payee),
    note: str(v.note),
    categoryId: str(v.category_id),
    categoryName: str(v.category_name),
    categoryIcon: str(v.category_icon),
    byId: String(v.by_id),
    isAdjustment: v.is_adjustment ? true : undefined,
    pending: v.pending ? true : undefined,
  }
}

function jointCategory(v: Row): JointCategory {
  return {
    id: String(v.id),
    name: String(v.name ?? ""),
    icon: String(v.icon ?? "tag"),
    kind: v.kind === "income" ? "income" : "expense",
    parentId: str(v.parent_id),
  }
}

export function accountFromRow(row: Payload): SharedAccount | null {
  if (row.kind !== "account") return null
  const d = (row.data ?? {}) as Row
  return {
    id: String(row.id),
    accountId: String(row.object_id),
    role: row.role === "owner" ? "owner" : "member",
    myStatus: String(d.my_status ?? row.status) as JointStatus,
    name: String(d.name ?? ""),
    type: String(d.type ?? "bank"),
    color: String(d.color ?? "fin"),
    currency: String(d.currency ?? "PHP"),
    archived: Boolean(d.archived),
    inNetWorth: d.in_net_worth !== false,
    balance: num(d.balance_minor),
    owner: person(d.owner),
    members: jointMembers(d.members),
    records: ((d.records ?? []) as Row[]).map(jointRecord),
    recordsTotal: num(d.records_total),
    categories: ((d.categories ?? []) as Row[]).map(jointCategory),
    sharedAt: instant(d.shared_at ?? new Date(0).toISOString()),
  }
}

export function accountActions(
  prev: SharedAccount | undefined,
  next: SharedAccount | undefined,
): ActionOp[] {
  if (!prev || !next) return []
  const account_id = next.accountId
  const out: ActionOp[] = []
  if (prev.myStatus === "invited" && next.myStatus !== "invited")
    out.push({
      name: "finance.shared.respond",
      data: {
        kind: "account",
        object_id: account_id,
        accept: next.myStatus === "active",
        category_ids: [],
      },
    })
  if (prev.myStatus === "active" && next.myStatus === "left")
    out.push({ name: "finance.account.leave", data: { account_id } })
  const before = new Set(prev.records.map((r) => r.id))
  for (const r of next.records) {
    if (before.has(r.id) || !r.local) continue
    if (r.kind !== "expense" && r.kind !== "income") continue
    out.push({
      name: "finance.account.record",
      data: {
        id: r.id,
        account_id,
        type: r.kind,
        amount_minor: r.amount,
        on_date: r.day,
        category_id: r.categoryId ?? null,
        payee: r.payee ?? null,
        note: r.note ?? null,
      },
    })
  }
  return out
}

// ---------------------------------------------------------------- the mapper

export type SharedRow = Loan | SharedGoal | SharedBudget | SharedAccount
const isLoan = (r: SharedRow): r is Loan => "loanId" in r
const isGoal = (r: SharedRow): r is SharedGoal => "goalId" in r
const isBudget = (r: SharedRow): r is SharedBudget => "budgetId" in r
const isAccount = (r: SharedRow): r is SharedAccount => "accountId" in r

function byNewest<T extends { createdAt: string }>(a: T, b: T) {
  return b.createdAt.localeCompare(a.createdAt)
}

function upsert<T extends { id: string }>(
  list: T[],
  ups: T[],
  gone: Set<string>,
  keep: (old: T, next: T) => T = (_o, n) => n,
): T[] {
  const byId = new Map(ups.map((u) => [u.id, u]))
  const kept = list
    .filter((x) => !gone.has(x.id))
    .map((x) => {
      const u = byId.get(x.id)
      if (!u) return x
      byId.delete(x.id)
      return keep(x, u)
    })
  return [...byId.values(), ...kept]
}

export function sharedMemberMapper(
  userId = "",
): Mapper<SharedState, SharedRow> {
  const cats = categoryIds(userId)
  return {
    entity: "shared_member",
    store: sharedStore,
    list: (s) => [
      ...s.loans,
      ...(s.goals ?? []),
      ...(s.budgets ?? []),
      ...(s.accounts ?? []),
    ],
    id: (r) => r.id,
    // Never sent as fields (actionsOnly); what the snapshot compares.
    toServer: (r) =>
      isLoan(r)
        ? { status: r.status, payments: r.payments.length }
        : isGoal(r)
          ? { status: r.myStatus, entries: r.entries.length }
          : isAccount(r)
            ? { status: r.myStatus, records: r.records.length }
            : { status: r.myStatus, categories: r.myCategoryIds.join() },
    fromServer: (row) =>
      row.kind === "loan"
        ? loanFromRow(row)
        : row.kind === "goal"
          ? goalFromRow(row)
          : row.kind === "account"
            ? accountFromRow(row)
            : budgetFromRow(row, cats),
    merge: (s, ups, dels) => {
      const gone = new Set(dels)
      return {
        ...s,
        loans: upsert(s.loans, ups.filter(isLoan), gone, (old, u) => {
          // A photo picked on this phone stays shown until it is replaced.
          const local = new Map(old.payments.map((p) => [p.id, p.proofUri]))
          return {
            ...u,
            payments: u.payments.map((p) =>
              local.get(p.id) ? { ...p, proofUri: local.get(p.id) } : p,
            ),
          }
        }).sort(byNewest),
        goals: upsert(s.goals ?? [], ups.filter(isGoal), gone).sort(byNewest),
        budgets: upsert(s.budgets ?? [], ups.filter(isBudget), gone).sort(
          byNewest,
        ),
        accounts: upsert(s.accounts ?? [], ups.filter(isAccount), gone).sort(
          (a, b) => b.sharedAt.localeCompare(a.sharedAt),
        ),
      }
    },
    actionsOnly: true,
    heldBy: SHARED_ACTIONS,
    // A refused action leaves this phone's optimistic view ahead of the
    // server: pull it again.
    resyncOnReject: SHARED_ACTIONS,
    actions: (prev, next) => {
      const row = next ?? prev
      if (!row) return []
      if (isLoan(row))
        return loanActions(prev as Loan | undefined, next as Loan | undefined)
      if (isAccount(row))
        return accountActions(
          prev as SharedAccount | undefined,
          next as SharedAccount | undefined,
        )
      if (isGoal(row))
        return goalActions(
          prev as SharedGoal | undefined,
          next as SharedGoal | undefined,
          userId,
        )
      return budgetActions(
        prev as SharedBudget | undefined,
        next as SharedBudget | undefined,
        cats,
      )
    },
  }
}

export const sharedMappers = (userId = "") => [sharedMemberMapper(userId)]
