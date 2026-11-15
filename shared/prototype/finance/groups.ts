"use client"
// Shared savings goals and shared budgets. Amounts are integer hundredths
// (centavos) of the group's currency, end to end.
//
// Like loans (./loans.ts), each member's phone holds the server's view of a
// group (a ``shared_member`` row of kind goal or budget); the actions below
// change it optimistically and live/mappers/shared.ts sends one
// ``finance.goal.*`` / ``finance.budget.*`` / ``finance.shared.respond``
// action per change.
//
// A goal's balance is the accepted deposits less the accepted withdrawals:
// computed here from the entries, as the server does. A budget's spending is
// read from each member's own ledger on the server; this phone shows the
// server's figure.

import { newId } from "../lib/ids"
import type { LoanPerson, PaymentStatus } from "./loans"
import { memberId, sharedStore } from "./loans"

export type GroupRole = "owner" | "member"
export type MemberStatus = "invited" | "active" | "declined" | "left"

export interface GroupMember {
  person: LoanPerson
  role: GroupRole
  status: MemberStatus
  /** Goal: what they put in, net. Budget: what they spent this month. */
  amount: number
}

export interface GoalEntry {
  id: string
  kind: "deposit" | "withdrawal"
  status: PaymentStatus
  amount: number
  onDate: string
  note?: string
  byId: string
  /** The viewer's own account (only on their own entries). */
  accountId?: string
  decidedAt?: string
  decidedBy?: string
  reason?: string
  createdAt: string
}

export interface SharedGoal {
  /** This member's row id. */
  id: string
  goalId: string
  role: GroupRole
  myStatus: MemberStatus
  status: "active" | "closed"
  name: string
  currency: string
  target?: number
  deadline?: string
  members: GroupMember[]
  entries: GoalEntry[]
  createdAt: string
  local?: boolean
}

export interface SharedBudget {
  id: string
  budgetId: string
  role: GroupRole
  myStatus: MemberStatus
  status: "active" | "closed"
  name: string
  currency: string
  limit: number
  /** YYYY-MM of the figures below. */
  month: string
  spent: number
  /** The viewer's own categories that count (empty: all spending). */
  myCategoryIds: string[]
  members: GroupMember[]
  createdAt: string
  local?: boolean
}

export interface GoalSummary {
  balance: number
  /** Withdrawals waiting for another member. */
  pending: number
  /** Net put in, per member id. */
  byMember: Record<string, number>
  progress: number
}

export function goalSummary(g: SharedGoal): GoalSummary {
  let balance = 0
  let pending = 0
  const byMember: Record<string, number> = {}
  for (const e of g.entries) {
    if (e.status === "accepted") {
      const v = e.kind === "deposit" ? e.amount : -e.amount
      balance += v
      byMember[e.byId] = (byMember[e.byId] ?? 0) + v
    } else if (e.status === "sent" && e.kind === "withdrawal")
      pending += e.amount
  }
  return {
    balance,
    pending,
    byMember,
    progress: g.target ? Math.max(0, Math.min(1, balance / g.target)) : 0,
  }
}

/** What a new withdrawal may be at most. */
export const goalRoom = (g: SharedGoal) => {
  const s = goalSummary(g)
  return Math.max(0, s.balance - s.pending)
}

export const budgetPct = (b: SharedBudget) => (b.limit ? b.spent / b.limit : 0)

// ---------------------------------------------------------------- actions

const nowIso = () => new Date().toISOString()

function updateGoal(goalId: string, fn: (g: SharedGoal) => SharedGoal) {
  sharedStore.set((s) => ({
    ...s,
    goals: s.goals.map((g) => (g.goalId === goalId ? fn(g) : g)),
  }))
}

function updateBudget(budgetId: string, fn: (b: SharedBudget) => SharedBudget) {
  sharedStore.set((s) => ({
    ...s,
    budgets: s.budgets.map((b) => (b.budgetId === budgetId ? fn(b) : b)),
  }))
}

const invite = (p: LoanPerson): GroupMember => ({
  person: p,
  role: "member",
  status: "invited",
  amount: 0,
})

export function createGoal(n: {
  me: LoanPerson
  members: LoanPerson[]
  name: string
  currency: string
  target?: number
  deadline?: string
}): SharedGoal {
  const goalId = newId()
  const g: SharedGoal = {
    id: memberId(n.me.id, goalId, "goal"),
    goalId,
    role: "owner",
    myStatus: "active",
    status: "active",
    name: n.name.trim(),
    currency: n.currency,
    target: n.target || undefined,
    deadline: n.deadline || undefined,
    members: [
      { person: n.me, role: "owner", status: "active", amount: 0 },
      ...n.members.map(invite),
    ],
    entries: [],
    createdAt: nowIso(),
    local: true,
  }
  sharedStore.set((s) => ({ ...s, goals: [g, ...s.goals] }))
  return g
}

export function createBudget(n: {
  me: LoanPerson
  members: LoanPerson[]
  name: string
  currency: string
  limit: number
  categoryIds: string[]
  month: string
}): SharedBudget {
  const budgetId = newId()
  const b: SharedBudget = {
    id: memberId(n.me.id, budgetId, "budget"),
    budgetId,
    role: "owner",
    myStatus: "active",
    status: "active",
    name: n.name.trim(),
    currency: n.currency,
    limit: n.limit,
    month: n.month,
    spent: 0,
    myCategoryIds: n.categoryIds,
    members: [
      { person: n.me, role: "owner", status: "active", amount: 0 },
      ...n.members.map(invite),
    ],
    createdAt: nowIso(),
    local: true,
  }
  sharedStore.set((s) => ({ ...s, budgets: [b, ...s.budgets] }))
  return b
}

/** Join (or decline) a goal I was invited to. */
export function respondGoal(goalId: string, accept: boolean) {
  updateGoal(goalId, (g) =>
    g.myStatus === "invited"
      ? { ...g, myStatus: accept ? "active" : "declined" }
      : g,
  )
}

/** Join (with the categories of mine that count) or decline a budget. */
export function respondBudget(
  budgetId: string,
  accept: boolean,
  categoryIds: string[] = [],
) {
  updateBudget(budgetId, (b) =>
    b.myStatus === "invited"
      ? {
          ...b,
          myStatus: accept ? "active" : "declined",
          myCategoryIds: accept ? categoryIds : b.myCategoryIds,
        }
      : b,
  )
}

export function setBudgetCategories(budgetId: string, categoryIds: string[]) {
  updateBudget(budgetId, (b) =>
    b.myStatus === "active" ? { ...b, myCategoryIds: categoryIds } : b,
  )
}

/** Money in (counts at once) or a request to take some out. */
export function addEntry(
  goalId: string,
  e: {
    kind: "deposit" | "withdrawal"
    amount: number
    onDate: string
    accountId: string
    note?: string
    me: string
  },
): string {
  const id = newId()
  updateGoal(goalId, (g) => ({
    ...g,
    entries: [
      ...g.entries,
      {
        id,
        kind: e.kind,
        status: e.kind === "deposit" ? "accepted" : "sent",
        amount: e.amount,
        onDate: e.onDate,
        note: e.note?.trim() || undefined,
        byId: e.me,
        accountId: e.accountId,
        decidedAt: e.kind === "deposit" ? nowIso() : undefined,
        createdAt: nowIso(),
      },
    ],
  }))
  return id
}

function setEntry(goalId: string, entryId: string, patch: Partial<GoalEntry>) {
  updateGoal(goalId, (g) => {
    const e = g.entries.find((x) => x.id === entryId)
    if (!e || e.status !== "sent") return g
    return {
      ...g,
      entries: g.entries.map((x) =>
        x.id === entryId ? { ...x, ...patch, decidedAt: nowIso() } : x,
      ),
    }
  })
}

/** Another member okays (or turns down, saying why) a withdrawal. */
export function decideEntry(
  goalId: string,
  entryId: string,
  accept: boolean,
  me: string,
  reason = "",
) {
  setEntry(goalId, entryId, {
    status: accept ? "accepted" : "rejected",
    decidedBy: me,
    reason: accept ? undefined : reason.trim(),
  })
}

/** The asker takes back a withdrawal nobody answered. */
export function withdrawEntry(goalId: string, entryId: string, me: string) {
  setEntry(goalId, entryId, { status: "withdrawn", decidedBy: me })
}
