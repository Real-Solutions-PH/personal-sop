"use client"
// Joint accounts: one person's finance account shared with others. Amounts
// are integer hundredths (centavos) of the account's currency, end to end.
//
// The account stays in its owner's ledger (their finStore, their records);
// a member's transaction is written there by the server, marked with who
// logged it. Everyone else in it holds the server's view of the account (a
// ``shared_member`` row of kind ``account``, mapped by
// live/mappers/shared.ts): its balance, the newest transactions, the
// members, and the owner's categories to log against. The actions below
// change that view optimistically; the mapper sends one
// ``finance.account.*`` / ``finance.shared.respond`` action per change and
// the server's next view replaces the optimistic one.
//
// Sharing, removing people and invite links are online-only (REST,
// live/joint-accounts.ts): they need the other person to exist anyway.

import { newId } from "../lib/ids"
import type { LoanPerson } from "./loans"
import { sharedStore } from "./loans"

export type JointRole = "owner" | "member"
export type JointStatus = "invited" | "active" | "declined" | "left"
export type JointRecordKind =
  | "expense"
  | "income"
  | "transfer_in"
  | "transfer_out"

export interface JointMember {
  person: LoanPerson
  role: JointRole
  status: JointStatus
}

export interface JointCategory {
  id: string
  name: string
  icon: string
  kind: "expense" | "income"
  parentId?: string
}

export interface JointRecord {
  id: string
  kind: JointRecordKind
  /** Always positive; ``signed`` is the effect on the balance. */
  amount: number
  signed: number
  at: string
  day: string
  payee?: string
  note?: string
  categoryId?: string
  categoryName?: string
  categoryIcon?: string
  /** Who logged it (the owner for their own). */
  byId: string
  isAdjustment?: boolean
  pending?: boolean
  /** Logged on this phone, not yet seen back from the server. */
  local?: boolean
}

export interface SharedAccount {
  /** This member's row id. */
  id: string
  accountId: string
  role: JointRole
  myStatus: JointStatus
  name: string
  type: string
  color: string
  currency: string
  archived: boolean
  inNetWorth: boolean
  balance: number
  owner: LoanPerson
  members: JointMember[]
  records: JointRecord[]
  recordsTotal: number
  categories: JointCategory[]
  sharedAt: string
}

const accountsOf = () => sharedStore.get().accounts ?? []

function update(accountId: string, fn: (a: SharedAccount) => SharedAccount) {
  sharedStore.set((s) => ({
    ...s,
    accounts: (s.accounts ?? []).map((a) =>
      a.accountId === accountId ? fn(a) : a,
    ),
  }))
}

/** The joint account (my view of it), by the owner's account id. */
export const jointAccount = (accountId: string) =>
  accountsOf().find((a) => a.accountId === accountId)

/** People in it with me, active first (the owner leads). */
export const activeMembers = (a: SharedAccount) =>
  a.members.filter((m) => m.status === "active")

/** Joint accounts someone else owns that I'm in: the ones my own ledger
 * doesn't hold. */
export const memberAccounts = (list: SharedAccount[] = accountsOf()) =>
  list.filter(
    (a) => a.role === "member" && a.myStatus === "active" && !a.archived,
  )

/** What joint accounts I'm a member of add to my net worth, in major units
 * of ``currency`` (another currency is left out, never converted here). */
export function jointWorth(
  list: SharedAccount[] | undefined,
  currency: string,
): number {
  return memberAccounts(list ?? [])
    .filter((a) => a.inNetWorth && a.currency === currency)
    .reduce((n, a) => n + a.balance / 100, 0)
}

/** Accept or decline an invitation. */
export function respondAccount(accountId: string, accept: boolean) {
  update(accountId, (a) =>
    a.myStatus === "invited"
      ? { ...a, myStatus: accept ? "active" : "declined" }
      : a,
  )
}

/** Leave a joint account someone else owns. */
export function leaveAccount(accountId: string) {
  update(accountId, (a) =>
    a.role === "member" && a.myStatus === "active"
      ? { ...a, myStatus: "left" }
      : a,
  )
}

export interface NewJointRecord {
  type: "expense" | "income"
  /** Centavos, > 0. */
  amount: number
  day: string
  categoryId?: string
  payee?: string
  note?: string
  me: string
}

/** Log an expense or income on the joint account; the balance moves at
 * once and the server's view confirms it. */
export function addJointRecord(accountId: string, r: NewJointRecord): string {
  const id = newId()
  update(accountId, (a) => {
    const cat = a.categories.find((c) => c.id === r.categoryId)
    const signed = r.type === "income" ? r.amount : -r.amount
    const rec: JointRecord = {
      id,
      kind: r.type,
      amount: r.amount,
      signed,
      at: new Date().toISOString(),
      day: r.day,
      payee: r.payee?.trim() || undefined,
      note: r.note?.trim() || undefined,
      categoryId: cat?.id,
      categoryName: cat?.name,
      categoryIcon: cat?.icon,
      byId: r.me,
      local: true,
    }
    return {
      ...a,
      balance: a.balance + signed,
      records: [rec, ...a.records],
      recordsTotal: a.recordsTotal + 1,
    }
  })
  return id
}
