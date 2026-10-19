"use client"
import { derivedId } from "../lib/ids"
import { uid } from "../lib/store"
import {
  addDays,
  balanceOf,
  recDay,
  reconcile,
  statementClosing,
  today,
} from "./calc"
import {
  type Account,
  type AdvisorScope,
  type Budget,
  type Category,
  emptyState,
  type FinRecord,
  type FinSettings,
  type FinState,
  type ImportRow,
  type PlannedItem,
  type StatementImport,
} from "./data"
import { finStore, sampleStatements } from "./store"

const set = (fn: (s: FinState) => FinState) => finStore.set(fn)
const nowIso = () => new Date().toISOString()
export type NewRecord = Omit<FinRecord, "id" | "status" | "source" | "at"> &
  Partial<Pick<FinRecord, "id" | "status" | "source" | "at">>
export function addRecord(input: NewRecord): FinRecord {
  const r: FinRecord = {
    status: "cleared",
    source: "manual",
    at: nowIso(),
    ...input,
    id: input.id ?? uid(),
  }
  set((s) => ({
    ...s,
    records: [...s.records, r].sort((a, b) => a.at.localeCompare(b.at)),
    settings: {
      ...s.settings,
      lastAccountId:
        r.type !== "transfer" ? r.accountId : s.settings.lastAccountId,
      lastCategoryId:
        r.type === "expense" && r.categoryId
          ? r.categoryId
          : s.settings.lastCategoryId,
    },
  }))
  return r
}
export function logExpense(input: {
  amount: number
  accountId?: string
  categoryId?: string
  payee?: string
  note?: string
  at?: string
  source?: FinRecord["source"]
  pending?: boolean
}): FinRecord {
  const st = finStore.get().settings
  return addRecord({
    type: "expense",
    amount: input.amount,
    accountId: input.accountId ?? st.lastAccountId ?? st.defaultAccountId,
    categoryId: input.categoryId,
    payee: input.payee,
    note: input.note,
    at: input.at,
    source: input.source ?? "chat",
    status: input.pending ? "pending" : "cleared",
  })
}
export function logIncome(input: {
  amount: number
  accountId?: string
  categoryId?: string
  payee?: string
  note?: string
  at?: string
  source?: FinRecord["source"]
  isRefund?: boolean
}): FinRecord {
  const st = finStore.get().settings
  return addRecord({
    type: "income",
    amount: input.amount,
    accountId: input.accountId ?? st.defaultAccountId,
    categoryId: input.categoryId ?? (input.isRefund ? undefined : "other-in"),
    payee: input.payee,
    note: input.note,
    at: input.at,
    isRefund: input.isRefund,
    source: input.source ?? "chat",
  })
}
export function logTransfer(input: {
  from: string
  to: string
  amount: number
  fee?: number
  note?: string
  at?: string
  source?: FinRecord["source"]
}): {
  transfer: FinRecord
  fee?: FinRecord
} {
  const transfer = addRecord({
    type: "transfer",
    amount: input.amount,
    accountId: input.from,
    toAccountId: input.to,
    note: input.note,
    at: input.at,
    source: input.source ?? "manual",
  })
  const fee = input.fee
    ? addRecord({
        // The server derives the same id when it writes a transfer's fee.
        id: derivedId("transfer-fee", transfer.id, "fee"),
        type: "expense",
        amount: input.fee,
        accountId: input.from,
        categoryId: "fees",
        payee: "Transfer fee",
        feeOf: transfer.id,
        at: input.at,
        source: input.source ?? "manual",
      })
    : undefined
  return { transfer, fee }
}
export function updateRecord(id: string, patch: Partial<FinRecord>) {
  set((s) => ({
    ...s,
    records: s.records
      .map((r) => (r.id === id ? { ...r, ...patch, editedAt: nowIso() } : r))
      .sort((a, b) => a.at.localeCompare(b.at)),
  }))
}
export function deleteRecords(ids: string[]): FinRecord[] {
  const all = finStore.get().records
  const gone = all.filter(
    (r) => ids.includes(r.id) || (r.feeOf && ids.includes(r.feeOf)),
  )
  const goneIds = new Set(gone.map((r) => r.id))
  set((s) => ({ ...s, records: s.records.filter((r) => !goneIds.has(r.id)) }))
  return gone
}
export const deleteRecord = (id: string) => deleteRecords([id])
export function restoreRecords(rs: FinRecord[]) {
  set((s) => ({
    ...s,
    records: [...s.records, ...rs].sort((a, b) => a.at.localeCompare(b.at)),
  }))
}
export function recategorise(ids: string[], categoryId: string) {
  set((s) => ({
    ...s,
    records: s.records.map((r) =>
      ids.includes(r.id) ? { ...r, categoryId, editedAt: nowIso() } : r,
    ),
  }))
}
export function duplicateRecord(id: string): FinRecord | undefined {
  const r = finStore.get().records.find((x) => x.id === id)
  if (!r) return
  const {
    id: _id,
    at: _at,
    importId: _i,
    plannedId: _p,
    plannedOn: _o,
    ...rest
  } = r
  return addRecord({ ...rest, source: "manual", status: "cleared" })
}
export const confirmRecord = (id: string) =>
  updateRecord(id, { status: "cleared" })
export function addAccount(
  input: Omit<Account, "id" | "order" | "archived" | "openingDate"> & {
    openingDate?: string
  },
): Account {
  const acc: Account = {
    openingDate: today(),
    ...input,
    id: uid(),
    archived: false,
    order: finStore.get().accounts.length,
  }
  set((s) => ({ ...s, accounts: [...s.accounts, acc] }))
  return acc
}
export function updateAccount(id: string, patch: Partial<Account>) {
  set((s) => ({
    ...s,
    accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  }))
}
export function deleteAccount(id: string): boolean {
  const s = finStore.get()
  if (s.records.some((r) => r.accountId === id || r.toAccountId === id))
    return false
  set((x) => ({ ...x, accounts: x.accounts.filter((a) => a.id !== id) }))
  return true
}
export function adjustBalance(
  accountId: string,
  actual: number,
  note?: string,
) {
  const s = finStore.get()
  const acct = s.accounts.find((a) => a.id === accountId)
  if (!acct) return
  const diff = actual - balanceOf(s, acct)
  if (!diff) return
  return addRecord({
    type: diff > 0 ? "income" : "expense",
    amount: Math.abs(diff),
    accountId,
    categoryId: "adjust",
    payee: acct.manual ? "Market value update" : "Balance adjustment",
    note,
    isAdjustment: true,
    source: "adjustment",
  })
}
export function addCategory(
  input: Omit<Category, "id" | "archived">,
): Category {
  const c: Category = { ...input, id: uid(), archived: false }
  set((s) => ({ ...s, categories: [...s.categories, c] }))
  return c
}
export function updateCategory(id: string, patch: Partial<Category>) {
  set((s) => ({
    ...s,
    categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  }))
}
function reassignCategory(s: FinState, from: string, to: string): FinState {
  return {
    ...s,
    records: s.records.map((r) =>
      r.categoryId === from ? { ...r, categoryId: to } : r,
    ),
    planned: s.planned.map((p) =>
      p.categoryId === from ? { ...p, categoryId: to } : p,
    ),
    budgets: s.budgets.map((b) =>
      b.categoryIds?.includes(from)
        ? {
            ...b,
            categoryIds: [
              ...new Set(b.categoryIds.map((x) => (x === from ? to : x))),
            ],
          }
        : b,
    ),
  }
}
export function categoryUses(s: FinState, id: string) {
  return {
    records: s.records.filter((r) => r.categoryId === id).length,
    planned: s.planned.filter((p) => p.categoryId === id).length,
    budgets: s.budgets.filter((b) => b.categoryIds?.includes(id)).length,
  }
}
export function deleteCategoryMoving(id: string, to?: string): () => void {
  const s0 = finStore.get()
  const idx = s0.categories.findIndex((c) => c.id === id)
  if (idx < 0) return () => {}
  const cat = s0.categories[idx]
  const recIds = new Set(
    s0.records.filter((r) => r.categoryId === id).map((r) => r.id),
  )
  const planIds = new Set(
    s0.planned.filter((p) => p.categoryId === id).map((p) => p.id),
  )
  const budgetCats = new Map(
    s0.budgets
      .filter((b) => b.categoryIds?.includes(id))
      .map((b) => [b.id, b.categoryIds]),
  )
  const subIds = new Set(
    s0.categories.filter((c) => c.parentId === id).map((c) => c.id),
  )
  const wasLast = s0.settings.lastCategoryId === id
  set((s) => {
    const moved = to ? reassignCategory(s, id, to) : s
    return {
      ...moved,
      categories: moved.categories
        .filter((c) => c.id !== id)
        .map((c) => (c.parentId === id ? { ...c, parentId: undefined } : c)),
      settings: wasLast
        ? { ...moved.settings, lastCategoryId: to }
        : moved.settings,
    }
  })
  return () =>
    set((s) => {
      const categories = s.categories.map((c) =>
        subIds.has(c.id) ? { ...c, parentId: id } : c,
      )
      categories.splice(Math.min(idx, categories.length), 0, cat)
      return {
        ...s,
        categories,
        records: s.records.map((r) =>
          recIds.has(r.id) ? { ...r, categoryId: id } : r,
        ),
        planned: s.planned.map((p) =>
          planIds.has(p.id) ? { ...p, categoryId: id } : p,
        ),
        budgets: s.budgets.map((b) =>
          budgetCats.has(b.id)
            ? { ...b, categoryIds: budgetCats.get(b.id) ?? b.categoryIds }
            : b,
        ),
        settings: wasLast ? { ...s.settings, lastCategoryId: id } : s.settings,
      }
    })
}
function placeCategory(
  list: Category[],
  id: string,
  parentId: string | undefined,
  beforeId?: string,
): Category[] {
  const c = list.find((x) => x.id === id)
  if (!c) return list
  const rest = list.filter((x) => x.id !== id)
  let at = beforeId ? rest.findIndex((x) => x.id === beforeId) : -1
  if (at < 0) {
    at = rest.length
    for (let i = rest.length - 1; i >= 0; i--)
      if (rest[i].id === parentId || rest[i].parentId === parentId) {
        at = i + 1
        break
      }
  }
  rest.splice(at, 0, { ...c, parentId })
  return rest
}
export function moveSubCategory(
  id: string,
  parentId: string,
  beforeId?: string,
): () => void {
  const list = finStore.get().categories
  const i = list.findIndex((c) => c.id === id)
  if (i < 0) return () => {}
  const oldParent = list[i].parentId
  const oldNext = list.slice(i + 1).find((c) => c.parentId === oldParent)?.id
  set((s) => ({
    ...s,
    categories: placeCategory(s.categories, id, parentId, beforeId),
  }))
  return () =>
    set((s) => ({
      ...s,
      categories: placeCategory(s.categories, id, oldParent, oldNext),
    }))
}
export function deleteCategory(id: string): boolean {
  const s = finStore.get()
  if (s.records.some((r) => r.categoryId === id)) return false
  set((x) => ({ ...x, categories: x.categories.filter((c) => c.id !== id) }))
  return true
}
export function addBudget(
  input: Omit<Budget, "id" | "archived" | "startDate" | "period">,
): Budget {
  const b: Budget = {
    ...input,
    id: uid(),
    archived: false,
    period: "monthly",
    startDate: today(),
  }
  set((s) => ({ ...s, budgets: [...s.budgets, b] }))
  return b
}
export function updateBudget(id: string, patch: Partial<Budget>) {
  set((s) => ({
    ...s,
    budgets: s.budgets.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  }))
}
export function deleteBudget(id: string) {
  set((s) => ({ ...s, budgets: s.budgets.filter((b) => b.id !== id) }))
}
export function addPlanned(
  input: Omit<
    PlannedItem,
    "id" | "archived" | "skipped" | "snoozed" | "start"
  > & {
    start?: string
  },
): PlannedItem {
  const p: PlannedItem = {
    start: today(),
    ...input,
    id: uid(),
    archived: false,
    skipped: [],
    snoozed: {},
  }
  set((s) => ({ ...s, planned: [...s.planned, p] }))
  return p
}
export function updatePlanned(id: string, patch: Partial<PlannedItem>) {
  set((s) => ({
    ...s,
    planned: s.planned.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  }))
}
export function deletePlanned(id: string): boolean {
  const s = finStore.get()
  if (s.records.some((r) => r.plannedId === id)) return false
  set((x) => ({ ...x, planned: x.planned.filter((p) => p.id !== id) }))
  return true
}
export function settleOccurrence(
  plannedId: string,
  day: string,
  input: {
    amount: number
    accountId?: string
    date?: string
  },
): FinRecord | undefined {
  const p = finStore.get().planned.find((x) => x.id === plannedId)
  if (!p) return
  const d = input.date ?? today()
  const now = new Date()
  const iso = new Date(
    `${d}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`,
  ).toISOString()
  return addRecord({
    // One record per occurrence, the id the server derives when it settles.
    id: derivedId("planned-record", p.id, day),
    type: p.type,
    amount: input.amount,
    accountId: input.accountId ?? p.accountId,
    toAccountId: p.toAccountId,
    categoryId: p.categoryId,
    payee: p.name,
    plannedId: p.id,
    plannedOn: day,
    at: iso,
    source: "planned",
  })
}
export function skipOccurrence(plannedId: string, day: string) {
  const p = finStore.get().planned.find((x) => x.id === plannedId)
  if (p) updatePlanned(plannedId, { skipped: [...p.skipped, day] })
}
export function unskipOccurrence(plannedId: string, day: string) {
  const p = finStore.get().planned.find((x) => x.id === plannedId)
  if (p)
    updatePlanned(plannedId, { skipped: p.skipped.filter((x) => x !== day) })
}
export function snoozeOccurrence(plannedId: string, day: string, days = 1) {
  const p = finStore.get().planned.find((x) => x.id === plannedId)
  if (!p) return
  const cur = p.snoozed[day] ?? day
  const base = cur < today() ? today() : cur
  updatePlanned(plannedId, {
    snoozed: { ...p.snoozed, [day]: addDays(base, days) },
  })
}
export type SampleFile = "gcash-pdf" | "bpi-pdf" | "maya-shot" | "blurry"
export const SAMPLE_FILES: {
  key: SampleFile
  name: string
  type: StatementImport["fileType"]
  size: string
  hint: string
}[] = [
  {
    key: "gcash-pdf",
    name: "GCash_Transaction_History.pdf",
    type: "pdf",
    size: "186 KB",
    hint: "Exported from GCash › Profile › Transactions",
  },
  {
    key: "bpi-pdf",
    name: "BPI_SA_eStatement.pdf",
    type: "pdf",
    size: "212 KB",
    hint: "Password-protected (hint: 1234)",
  },
  {
    key: "maya-shot",
    name: "Screenshot_Maya_history.png",
    type: "image",
    size: "1.1 MB",
    hint: "A Maya screenshot",
  },
  {
    key: "blurry",
    name: "IMG_5520.jpg",
    type: "image",
    size: "3.4 MB",
    hint: "Blurry photo",
  },
]
export function startImport(accountId: string, file: SampleFile): string {
  const meta = SAMPLE_FILES.find((f) => f.key === file) ?? SAMPLE_FILES[0]
  const id = `imp-${uid()}`
  const imp: StatementImport = {
    id,
    accountId,
    fileName: meta.name,
    fileType: meta.type,
    from: addDays(today(), -32),
    to: addDays(today(), -1),
    closing: 0,
    status: "parsing",
    createdAt: nowIso(),
    rows: [],
    createdIds: [],
    changed: [],
    fileKept: true,
  }
  set((s) => ({ ...s, imports: [imp, ...s.imports] }))
  return id
}
export function parseImport(
  id: string,
  file: SampleFile,
  opts: {
    password?: string
    forceAccount?: string
  } = {},
): "ok" | "password" | "bad-password" | "wrong-account" | "unreadable" {
  const s = finStore.get()
  const imp = s.imports.find((x) => x.id === id)
  if (!imp) return "unreadable"
  if (file === "blurry") {
    patchImport(id, {
      status: "failed",
      error: "Couldn't read this image — it's too blurry.",
    })
    return "unreadable"
  }
  if (file === "bpi-pdf" && !opts.password) return "password"
  if (file === "bpi-pdf" && opts.password !== "1234") return "bad-password"
  const detected =
    file === "bpi-pdf" ? "bpi" : file === "maya-shot" ? "maya" : "gcash"
  const accountId = opts.forceAccount ?? imp.accountId
  if (detected !== accountId && !opts.forceAccount) return "wrong-account"
  if (detected === "maya") {
    patchImport(id, {
      status: "failed",
      accountId,
      error:
        "0 transactions found in the screenshot — try a longer scroll capture.",
    })
    return "unreadable"
  }
  const rows = sampleStatements()[detected as "gcash" | "bpi"]
  const parsed = reconcile(s, accountId, rows, id)
  patchImport(id, {
    accountId,
    status: "review",
    rows: parsed,
    from: rows[0]?.date ?? imp.from,
    to: rows[rows.length - 1]?.date ?? imp.to,
    closing: statementClosing(
      s,
      accountId,
      rows[rows.length - 1]?.date ?? imp.to,
      parsed,
    ),
  })
  return "ok"
}
export function patchImport(id: string, patch: Partial<StatementImport>) {
  set((s) => ({
    ...s,
    imports: s.imports.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }))
}
export function patchRows(
  importId: string,
  rowIds: string[],
  patch: Partial<ImportRow>,
) {
  set((s) => ({
    ...s,
    imports: s.imports.map((x) =>
      x.id === importId
        ? {
            ...x,
            rows: x.rows.map((r) =>
              rowIds.includes(r.id) ? { ...r, ...patch } : r,
            ),
          }
        : x,
    ),
  }))
}
export function commitImport(importId: string): {
  gap: number
  created: number
  updated: number
} {
  const s = finStore.get()
  const imp = s.imports.find((x) => x.id === importId)
  if (imp?.status !== "review") return { gap: 0, created: 0, updated: 0 }
  const recs = new Map(s.records.map((r) => [r.id, r]))
  const created: FinRecord[] = []
  const changed: {
    id: string
    before: FinRecord
  }[] = []
  const updates = new Map<string, Partial<FinRecord>>()
  const iso = (date: string, time: string) =>
    new Date(`${date}T${time}:00`).toISOString()
  let ignored = 0
  let matched = 0
  for (const r of imp.rows) {
    if (r.decision === "ignore") {
      ignored++
      continue
    }
    const target = r.matchId ? recs.get(r.matchId) : undefined
    if (r.state === "matched" && target) {
      matched++
      changed.push({ id: target.id, before: target })
      updates.set(target.id, {
        importId,
        at: recDay(target) === r.date ? iso(r.date, r.time) : target.at,
        payee: target.payee ?? r.payee,
      })
    } else if (r.state === "probable" && target) {
      changed.push({ id: target.id, before: target })
      const patch: Partial<FinRecord> = { importId }
      if (r.decision === "take" || r.decision === "merge")
        patch.amount = r.amount
      if (r.decision === "take") patch.at = iso(r.date, r.time)
      if (r.decision === "take" && !target.categoryId)
        patch.categoryId = r.categoryId
      updates.set(target.id, patch)
    } else if (r.state === "new" || r.decision === "accept") {
      const base = {
        id: uid(),
        at: iso(r.date, r.time),
        status: "cleared" as const,
        source: "import" as const,
        importId,
        note: r.raw,
      }
      if (r.isTransfer)
        created.push({
          ...base,
          type: "transfer",
          amount: r.amount,
          accountId: r.direction === "in" ? "bpi" : imp.accountId,
          toAccountId: r.direction === "in" ? imp.accountId : "bpi",
          payee: "Cash-in via InstaPay",
        })
      else
        created.push({
          ...base,
          type: r.direction === "in" ? "income" : "expense",
          amount: r.amount,
          accountId: imp.accountId,
          categoryId: r.categoryId ?? r.suggestedCategoryId,
          payee: r.payee,
        })
    }
  }
  set((x) => ({
    ...x,
    records: [
      ...x.records.map((r) =>
        updates.has(r.id) ? { ...r, ...updates.get(r.id) } : r,
      ),
      ...created,
    ].sort((a, b) => a.at.localeCompare(b.at)),
    accounts: x.accounts.map((a) =>
      a.id === imp.accountId ? { ...a, lastReconciled: imp.to } : a,
    ),
    imports: x.imports.map((i) =>
      i.id === importId
        ? {
            ...i,
            status: "done",
            fileKept: false,
            createdIds: created.map((c) => c.id),
            changed,
            counts: {
              matched,
              created: created.length,
              updated: changed.length - matched,
              ignored,
            },
          }
        : i,
    ),
  }))
  const after = finStore.get()
  const acct = after.accounts.find((a) => a.id === imp.accountId)
  const gap = acct ? imp.closing - balanceOf(after, acct, imp.to) : 0
  return { gap, created: created.length, updated: changed.length - matched }
}
export function undoImport(importId: string) {
  const imp = finStore.get().imports.find((x) => x.id === importId)
  if (imp?.status !== "done") return
  const before = new Map(imp.changed.map((c) => [c.id, c.before]))
  const createdIds = new Set(imp.createdIds)
  set((s) => ({
    ...s,
    records: s.records
      .filter((r) => !createdIds.has(r.id))
      .map((r) => before.get(r.id) ?? r),
    imports: s.imports.map((i) =>
      i.id === importId ? { ...i, status: "undone" } : i,
    ),
  }))
}
export function restoreImport(imp: StatementImport) {
  set((s) => ({
    ...s,
    imports: [imp, ...s.imports.filter((i) => i.id !== imp.id)],
  }))
}
export function deleteImport(importId: string) {
  set((s) => ({ ...s, imports: s.imports.filter((i) => i.id !== importId) }))
}
export function saveLookBack(
  period: string,
  note: string,
  snapshot: {
    savingsRate: number
    income: number
    spend: number
  },
) {
  set((s) => {
    // A period has one review: re-saving keeps its id.
    const id = s.lookbacks.find((l) => l.period === period)?.id ?? uid()
    return {
      ...s,
      lookbacks: [
        ...s.lookbacks.filter((l) => l.period !== period),
        { id, period, note, savedAt: nowIso(), snapshot },
      ],
    }
  })
}
export function newThread(title: string): string {
  const id = uid()
  set((s) => ({
    ...s,
    threads: [{ id, title, createdAt: nowIso(), messages: [] }, ...s.threads],
  }))
  return id
}
export function pushMessage(
  threadId: string,
  msg: {
    role: "user" | "ai"
    text: string
    answer?: string
    scope: AdvisorScope
  },
) {
  set((s) => ({
    ...s,
    threads: s.threads.map((t) =>
      t.id === threadId
        ? {
            ...t,
            messages: [...t.messages, { ...msg, id: uid(), at: nowIso() }],
          }
        : t,
    ),
  }))
}
export function deleteThread(id: string) {
  set((s) => ({ ...s, threads: s.threads.filter((t) => t.id !== id) }))
}
export function updateSettings(patch: Partial<FinSettings>) {
  set((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
}
export function startFresh() {
  set((s) => emptyState(s.settings))
}
export const resetFinance = () => finStore.reset()
export function recordsBetween(from: string, to: string) {
  return finStore.get().records.filter((r) => {
    const k = recDay(r)
    return k >= from && k <= to
  })
}
