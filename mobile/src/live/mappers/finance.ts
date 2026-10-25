// Finance mappers: the prototype finance store <-> the server's finance sync
// entities (backend/app/modules/finance/sync.py).
//
// Shapes:
// - Local amounts are major units of the user's currency (float); the
//   server holds integer hundredths (``*_minor``) for every currency, also
//   zero-decimal ones such as JPY (see shared/prototype/lib/money.ts).
//   ``toMinor`` / ``fromMinor`` are the only conversions.
// - The seeded categories keep their slug ids on the device ("food",
//   "fees", "adjust"...: the prototype's actions name them). The server
//   gives each the id ``derivedId("category", userId, slug)``; every
//   category reference is translated at this boundary.
// - Nested local collections are child entities: a budget's
//   ``categoryIds`` (budget_category), a planned item's ``skipped`` and
//   ``snoozed`` (planned_skip, planned_snooze) and a thread's ``messages``
//   (advisor_message). Child ids are the ids the server derives, so a
//   child is identified by its natural key on both sides.
//
// Mapper order is push order within one capture: categories go LAST, so a
// category deleted with its records moved elsewhere (deleteCategoryMoving)
// reaches the server after the record, planned and budget edits that empty
// it; the server's plain category delete then has nothing left to refuse.
//
// Statement imports are REST-only (server-driven): no mapper.

import { balanceOf, recDay } from "@domain/finance/calc"
import {
  type Account,
  type AdvisorMsg,
  type AdvisorThread,
  type Budget,
  CATEGORIES,
  type Category,
  type FinRecord,
  type FinSettings,
  type FinState,
  type LookBack,
  type PlannedItem,
} from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { derivedId, isUuid } from "@domain/lib/ids"
import type { ActionOp, Mapper, Payload } from "../mapper"
import { singleton } from "./helpers"

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/** Major units -> hundredths, half-up. ``toPrecision(12)`` drops float noise first
 * (1.005 * 100 is 100.49999999999999), so the .5 is seen as a .5. */
export const toMinor = (major: number): number =>
  Math.round(Number.parseFloat((major * 100).toPrecision(12)))

/** Hundredths -> major units. */
export const fromMinor = (minor: unknown): number => Number(minor) / 100

/** The device keeps an account colour as a theme variable
 * ("var(--acct-emerald)", up to 19 characters); the server's column holds 16.
 * The wire carries the bare token ("emerald"); anything else passes as is. */
const ACCT_VAR = /^var\(--acct-([a-z]+)\)$/
export const colorOut = (c: string): string => ACCT_VAR.exec(c)?.[1] ?? c
export const colorIn = (v: unknown): string => {
  const c = String(v)
  return /^[a-z]+$/.test(c) && c !== "fin" ? `var(--acct-${c})` : c
}

const str = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : String(v)

/** Instants are ISO strings; normalised so ordering by string still works
 * (the server writes "...Z" without milliseconds). */
const instant = (v: unknown): string => new Date(String(v)).toISOString()

/** Translates category ids between the device (slugs for the seeded ones)
 * and the server (UUIDs). */
export function categoryIds(userId: string) {
  const toServer = new Map<string, string>()
  const toLocal = new Map<string, string>()
  for (const c of CATEGORIES) {
    const id = derivedId("category", userId, c.id)
    toServer.set(c.id, id)
    toLocal.set(id, c.id)
  }
  return {
    out: (id: string | undefined): string | null =>
      id ? (toServer.get(id) ?? id) : null,
    in: (id: unknown): string | undefined => {
      const s = str(id)
      return s === undefined ? undefined : (toLocal.get(s) ?? s)
    },
  }
}

type Cats = ReturnType<typeof categoryIds>

/** Replace by id, drop deleted, append new (store order kept). */
function upsertList<T>(
  list: T[],
  ups: T[],
  dels: string[],
  idOf: (t: T) => string,
): T[] {
  const gone = new Set(dels)
  const byId = new Map(ups.map((u) => [idOf(u), u]))
  const out = list
    .filter((x) => !gone.has(idOf(x)))
    .map((x) => {
      const u = byId.get(idOf(x))
      if (u) byId.delete(idOf(x))
      return u ?? x
    })
  return [...out, ...byId.values()]
}

// ---------------------------------------------------------------------------
// account
// ---------------------------------------------------------------------------

export function accountMapper(): Mapper<FinState, Account> {
  return {
    entity: "account",
    store: finStore,
    list: (s) => s.accounts,
    id: (a) => a.id,
    toServer: (a) => ({
      name: a.name,
      type: a.type,
      opening_minor: toMinor(a.opening),
      opening_date: a.openingDate,
      limit_minor: a.limit === undefined ? null : toMinor(a.limit),
      color: colorOut(a.color),
      in_net_worth: a.inNetWorth,
      in_projection: a.inProjection,
      archived: a.archived,
      manual: Boolean(a.manual),
      sort_order: a.order,
      last_reconciled: a.lastReconciled ?? null,
      rate_bp: a.rate === undefined ? null : Math.round(a.rate * 100),
      matures_on: a.maturesOn ?? null,
      goal_minor: a.goal === undefined ? null : toMinor(a.goal),
      goal_by: a.goalBy ?? null,
    }),
    fromServer: (row) => ({
      id: String(row.id),
      name: String(row.name),
      type: row.type as Account["type"],
      opening: fromMinor(row.opening_minor),
      openingDate: String(row.opening_date),
      limit: row.limit_minor == null ? undefined : fromMinor(row.limit_minor),
      color: colorIn(row.color),
      inNetWorth: Boolean(row.in_net_worth),
      inProjection: Boolean(row.in_projection),
      archived: Boolean(row.archived),
      lastReconciled: str(row.last_reconciled),
      manual: row.manual ? true : undefined,
      order: Number(row.sort_order),
      rate: row.rate_bp == null ? undefined : Number(row.rate_bp) / 100,
      maturesOn: str(row.matures_on),
      goal: row.goal_minor == null ? undefined : fromMinor(row.goal_minor),
      goalBy: str(row.goal_by),
    }),
    merge: (s, ups, dels) => ({
      ...s,
      accounts: upsertList(s.accounts, ups, dels, (a) => a.id).sort(
        (a, b) => a.order - b.order,
      ),
    }),
  }
}

// ---------------------------------------------------------------------------
// category
// ---------------------------------------------------------------------------

export function categoryMapper(cats: Cats): Mapper<FinState, Category> {
  // Pulled positions, consumed by the merge that follows.
  const pulledOrder = new Map<string, number>()
  return {
    entity: "category",
    store: finStore,
    list: (s) => s.categories,
    id: (c) => cats.out(c.id) as string,
    toServer: (c, s) => ({
      name: c.name,
      kind: c.kind,
      parent_id: cats.out(c.parentId),
      icon: c.icon,
      discretionary: c.discretionary,
      archived: c.archived,
      // The store's order is the list order.
      sort_order: Math.max(
        0,
        s.categories.findIndex((x) => x.id === c.id),
      ),
      system: Boolean(c.system),
    }),
    fromServer: (row) => {
      const id = cats.in(row.id) as string
      pulledOrder.set(id, Number(row.sort_order ?? 0))
      return {
        id,
        name: String(row.name),
        kind: row.kind === "income" ? "income" : "expense",
        parentId: cats.in(row.parent_id),
        icon: String(row.icon),
        discretionary: Boolean(row.discretionary),
        archived: Boolean(row.archived),
        system: row.system ? true : undefined,
      }
    },
    merge: (s, ups, dels) => {
      const local = dels.map((d) => cats.in(d) as string)
      const merged = upsertList(s.categories, ups, local, (c) => c.id)
      const key = new Map(
        merged.map((c, i) => [c.id, pulledOrder.get(c.id) ?? i]),
      )
      pulledOrder.clear()
      const pos = new Map(merged.map((c, i) => [c.id, i]))
      return {
        ...s,
        categories: [...merged].sort(
          (a, b) =>
            (key.get(a.id) ?? 0) - (key.get(b.id) ?? 0) ||
            (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0),
        ),
      }
    },
    // Built-in categories are the server's to mark.
    actionFields: ["system"],
  }
}

// ---------------------------------------------------------------------------
// fin_record
// ---------------------------------------------------------------------------

const signed = (r: FinRecord) =>
  r.type === "income" ? r.amount : r.type === "expense" ? -r.amount : 0

export function recordMapper(cats: Cats): Mapper<FinState, FinRecord> {
  return {
    entity: "fin_record",
    store: finStore,
    // A transfer's fee after the transfer: the transfer's create (with its
    // fee_minor) is what makes the server write the fee row.
    list: (s) => [
      ...s.records.filter((r) => !r.feeOf),
      ...s.records.filter((r) => r.feeOf),
    ],
    id: (r) => r.id,
    toServer: (r, s) => {
      const out: Payload = {
        type: r.type,
        amount_minor: toMinor(r.amount),
        account_id: r.accountId,
        to_account_id: r.toAccountId ?? null,
        category_id: cats.out(r.categoryId),
        at: r.at,
        payee: r.payee ?? null,
        note: r.note ?? null,
        source: r.source,
        is_refund: Boolean(r.isRefund),
        status: r.status,
        // Server-owned (actionFields): written by settle, imports, adjust,
        // the fee split and the edit stamp.
        planned_id: r.plannedId ?? null,
        planned_on: r.plannedOn ?? null,
        import_id: r.importId ?? null,
        is_adjustment: Boolean(r.isAdjustment),
        fee_of: r.feeOf ?? null,
        edited_at: r.editedAt ?? null,
        orig_currency: r.origCurrency ?? null,
        orig_amount_minor:
          r.origCurrency && r.origAmount ? toMinor(r.origAmount) : null,
        // The rate the device converted at; the server keeps it, so the
        // peso amount on both sides agrees.
        fx_rate: r.origCurrency && r.fxRate ? String(r.fxRate) : null,
      }
      if (r.type === "transfer") {
        const fee = s.records.find((x) => x.feeOf === r.id)
        // Read on create only; the fee row is edited as its own record.
        if (fee) out.fee_minor = toMinor(fee.amount)
      }
      if (r.isAdjustment) {
        // The server locks these on an adjustment (adjustment_locked).
        delete out.type
        delete out.account_id
        delete out.to_account_id
      }
      return out
    },
    fromServer: (row) => ({
      id: String(row.id),
      type: row.type as FinRecord["type"],
      amount: fromMinor(row.amount_minor),
      accountId: String(row.account_id),
      toAccountId: str(row.to_account_id),
      categoryId: cats.in(row.category_id),
      at: instant(row.at),
      payee: str(row.payee),
      note: str(row.note),
      source: row.source as FinRecord["source"],
      receipt: row.receipt_media_id ? true : undefined,
      plannedId: str(row.planned_id),
      plannedOn: str(row.planned_on),
      importId: str(row.import_id),
      isRefund: row.is_refund ? true : undefined,
      isAdjustment: row.is_adjustment ? true : undefined,
      feeOf: str(row.fee_of),
      status: row.status === "pending" ? "pending" : "cleared",
      editedAt: row.edited_at ? instant(row.edited_at) : undefined,
      origCurrency: str(row.orig_currency),
      origAmount:
        row.orig_amount_minor != null
          ? fromMinor(row.orig_amount_minor)
          : undefined,
      fxRate: row.fx_rate != null ? Number(row.fx_rate) : undefined,
    }),
    merge: (s, ups, dels) => ({
      ...s,
      records: upsertList(s.records, ups, dels, (r) => r.id).sort((a, b) =>
        a.at.localeCompare(b.at),
      ),
    }),
    actionFields: [
      "planned_id",
      "planned_on",
      "import_id",
      "is_adjustment",
      "fee_of",
      "edited_at",
    ],
    actions: (prev, next, s) => {
      if (!next) return []
      const out: ActionOp[] = []
      if (!prev) {
        if (
          next.plannedId &&
          next.plannedOn &&
          next.id ===
            derivedId("planned-record", next.plannedId, next.plannedOn)
        )
          out.push({
            name: "finance.settle",
            data: {
              planned_id: next.plannedId,
              day: next.plannedOn,
              amount_minor: toMinor(next.amount),
              account_id: next.accountId,
              paid_on: recDay(next),
            },
          })
        const acct = s.accounts.find((a) => a.id === next.accountId)
        if (next.isAdjustment && acct) {
          // The balance the user typed: the balance without this record,
          // plus the record's own signed amount.
          const without = {
            ...s,
            records: s.records.filter((r) => r.id !== next.id),
          }
          out.push({
            name: "finance.adjust_balance",
            data: {
              account_id: next.accountId,
              actual_minor:
                toMinor(balanceOf(without, acct)) + toMinor(signed(next)),
              note: next.note ?? null,
              record_id: next.id,
            },
          })
        }
      } else if (prev.status === "pending" && next.status === "cleared") {
        out.push({
          name: "finance.confirm_record",
          data: { record_id: next.id },
        })
      }
      return out
    },
  }
}

// ---------------------------------------------------------------------------
// budget + budget_category
// ---------------------------------------------------------------------------

export function budgetMapper(): Mapper<FinState, Budget> {
  return {
    entity: "budget",
    store: finStore,
    list: (s) => s.budgets,
    id: (b) => b.id,
    toServer: (b) => ({
      name: b.name,
      limit_minor: toMinor(b.limit),
      rollover: b.rollover,
      start_date: b.startDate,
      archived: b.archived,
      period: b.period,
    }),
    fromServer: (row, s) => ({
      id: String(row.id),
      name: String(row.name),
      // The scope arrives as budget_category rows.
      categoryIds:
        s.budgets.find((b) => b.id === String(row.id))?.categoryIds ?? null,
      period: "monthly",
      limit: fromMinor(row.limit_minor),
      rollover: Boolean(row.rollover),
      startDate: String(row.start_date),
      archived: Boolean(row.archived),
    }),
    merge: (s, ups, dels) => ({
      ...s,
      budgets: upsertList(s.budgets, ups, dels, (b) => b.id),
    }),
    // Every budget is monthly; the server holds it.
    actionFields: ["period"],
  }
}

interface BudgetLink {
  id: string
  budgetId: string
  categoryId: string
}

export function budgetCategoryMapper(cats: Cats): Mapper<FinState, BudgetLink> {
  const linkId = (budgetId: string, categoryId: string) =>
    derivedId("budget-category", budgetId, cats.out(categoryId) as string)
  return {
    entity: "budget_category",
    store: finStore,
    // ``categoryIds: null`` (all expense categories) is no rows.
    list: (s) =>
      s.budgets.flatMap((b) =>
        (b.categoryIds ?? []).map((c) => ({
          id: linkId(b.id, c),
          budgetId: b.id,
          categoryId: c,
        })),
      ),
    id: (l) => l.id,
    toServer: (l) => ({
      budget_id: l.budgetId,
      category_id: cats.out(l.categoryId),
    }),
    fromServer: (row) => {
      const budgetId = String(row.budget_id)
      const categoryId = cats.in(row.category_id) as string
      // Keyed by (budget, category): the derived id, whatever id it came in.
      return { id: linkId(budgetId, categoryId), budgetId, categoryId }
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const gone = new Set(dels)
      return {
        ...s,
        budgets: s.budgets.map((b) => {
          const kept = (b.categoryIds ?? []).filter(
            (c) => !gone.has(linkId(b.id, c)),
          )
          const added = ups
            .filter((u) => u.budgetId === b.id && !kept.includes(u.categoryId))
            .map((u) => u.categoryId)
          const next = [...kept, ...new Set(added)]
          const same =
            next.length === (b.categoryIds ?? []).length &&
            next.every((c, i) => c === b.categoryIds?.[i])
          if (same) return b
          return { ...b, categoryIds: next.length ? next : null }
        }),
      }
    },
  }
}

// ---------------------------------------------------------------------------
// planned_item + planned_skip + planned_snooze
// ---------------------------------------------------------------------------

export function plannedMapper(cats: Cats): Mapper<FinState, PlannedItem> {
  return {
    entity: "planned_item",
    store: finStore,
    list: (s) => s.planned,
    id: (p) => p.id,
    toServer: (p) => ({
      name: p.name,
      type: p.type,
      amount_minor: toMinor(p.amount),
      estimated: p.estimated,
      account_id: p.accountId,
      to_account_id: p.toAccountId ?? null,
      category_id: cats.out(p.categoryId),
      schedule: p.schedule,
      start: p.start,
      end_rule: p.end,
      auto_log: p.autoLog,
      is_what_if: p.isWhatIf,
      is_installment: Boolean(p.isInstallment),
      in_projection: p.inProjection,
      archived: p.archived,
    }),
    fromServer: (row, s) => {
      const cur = s.planned.find((p) => p.id === String(row.id))
      return {
        id: String(row.id),
        name: String(row.name),
        type: row.type as PlannedItem["type"],
        amount: fromMinor(row.amount_minor),
        estimated: Boolean(row.estimated),
        accountId: String(row.account_id),
        toAccountId: str(row.to_account_id),
        categoryId: cats.in(row.category_id),
        schedule: row.schedule as PlannedItem["schedule"],
        start: String(row.start),
        end: row.end_rule as PlannedItem["end"],
        autoLog: Boolean(row.auto_log),
        isWhatIf: Boolean(row.is_what_if),
        isInstallment: row.is_installment ? true : undefined,
        inProjection: Boolean(row.in_projection),
        archived: Boolean(row.archived),
        // These arrive as planned_skip / planned_snooze rows.
        skipped: cur?.skipped ?? [],
        snoozed: cur?.snoozed ?? {},
      }
    },
    merge: (s, ups, dels) => ({
      ...s,
      planned: upsertList(s.planned, ups, dels, (p) => p.id),
    }),
  }
}

interface Skip {
  id: string
  plannedId: string
  day: string
}

const skipId = (plannedId: string, day: string) =>
  derivedId("planned-skip", plannedId, day)

/** A skip is created by its upsert (the server's hook is skip_occurrence);
 * an un-skip is the finance.unskip action, then an idempotent delete. */
export function plannedSkipMapper(): Mapper<FinState, Skip> {
  return {
    entity: "planned_skip",
    store: finStore,
    list: (s) =>
      s.planned.flatMap((p) =>
        p.skipped.map((day) => ({
          id: skipId(p.id, day),
          plannedId: p.id,
          day,
        })),
      ),
    id: (k) => k.id,
    toServer: (k) => ({ planned_id: k.plannedId, on_day: k.day }),
    fromServer: (row) => {
      const plannedId = String(row.planned_id)
      const day = String(row.on_day)
      return { id: skipId(plannedId, day), plannedId, day }
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const gone = new Set(dels)
      return {
        ...s,
        planned: s.planned.map((p) => {
          const kept = p.skipped.filter((d) => !gone.has(skipId(p.id, d)))
          const added = ups
            .filter((u) => u.plannedId === p.id && !kept.includes(u.day))
            .map((u) => u.day)
          if (!added.length && kept.length === p.skipped.length) return p
          return { ...p, skipped: [...kept, ...new Set(added)] }
        }),
      }
    },
    actions: (prev, next, s) =>
      prev && !next && s.planned.some((p) => p.id === prev.plannedId)
        ? [
            {
              name: "finance.unskip",
              data: { planned_id: prev.plannedId, day: prev.day },
            },
          ]
        : [],
  }
}

interface Snooze {
  id: string
  plannedId: string
  day: string
  until: string
}

const snoozeId = (plannedId: string, day: string) =>
  derivedId("planned-snooze", plannedId, day)

/** A snooze is written whole (until_day), so an offline snooze replays to
 * the same day whatever the server's today is. */
export function plannedSnoozeMapper(): Mapper<FinState, Snooze> {
  return {
    entity: "planned_snooze",
    store: finStore,
    list: (s) =>
      s.planned.flatMap((p) =>
        Object.entries(p.snoozed).map(([day, until]) => ({
          id: snoozeId(p.id, day),
          plannedId: p.id,
          day,
          until,
        })),
      ),
    id: (z) => z.id,
    toServer: (z) => ({
      planned_id: z.plannedId,
      on_day: z.day,
      until_day: z.until,
    }),
    fromServer: (row) => {
      const plannedId = String(row.planned_id)
      const day = String(row.on_day)
      return {
        id: snoozeId(plannedId, day),
        plannedId,
        day,
        until: String(row.until_day),
      }
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const gone = new Set(dels)
      return {
        ...s,
        planned: s.planned.map((p) => {
          const mine = ups.filter((u) => u.plannedId === p.id)
          const hit = Object.keys(p.snoozed).some((d) =>
            gone.has(snoozeId(p.id, d)),
          )
          if (!mine.length && !hit) return p
          const snoozed: Record<string, string> = {}
          for (const [d, u] of Object.entries(p.snoozed))
            if (!gone.has(snoozeId(p.id, d))) snoozed[d] = u
          for (const u of mine) snoozed[u.day] = u.until
          return { ...p, snoozed }
        }),
      }
    },
  }
}

// ---------------------------------------------------------------------------
// look_back
// ---------------------------------------------------------------------------

export function lookBackMapper(): Mapper<FinState, LookBack> {
  return {
    entity: "look_back",
    store: finStore,
    list: (s) => s.lookbacks,
    id: (l) => l.id,
    toServer: (l) => ({
      period: l.period,
      note: l.note,
      snapshot: {
        savings_rate: l.snapshot.savingsRate,
        income_minor: toMinor(l.snapshot.income),
        spend_minor: toMinor(l.snapshot.spend),
      },
      saved_at: l.savedAt,
    }),
    fromServer: (row) => {
      const snap = (row.snapshot ?? {}) as Payload
      return {
        id: String(row.id),
        period: String(row.period),
        note: String(row.note ?? ""),
        savedAt: instant(row.saved_at),
        snapshot: {
          savingsRate: Number(snap.savings_rate),
          income: fromMinor(snap.income_minor),
          spend: fromMinor(snap.spend_minor),
        },
      }
    },
    // One review per period (the server's natural key): a pulled row
    // replaces a local one for the same period under another id.
    merge: (s, ups, dels) => {
      const periods = new Map(ups.map((u) => [u.period, u.id]))
      const kept = s.lookbacks.filter(
        (l) => !periods.has(l.period) || periods.get(l.period) === l.id,
      )
      return { ...s, lookbacks: upsertList(kept, ups, dels, (l) => l.id) }
    },
    // The server stamps saved_at.
    actionFields: ["saved_at"],
  }
}

// ---------------------------------------------------------------------------
// advisor_thread + advisor_message
// ---------------------------------------------------------------------------

export function threadMapper(): Mapper<FinState, AdvisorThread> {
  return {
    entity: "advisor_thread",
    store: finStore,
    list: (s) => s.threads,
    id: (t) => t.id,
    toServer: (t) => ({ title: t.title, created_at: t.createdAt }),
    fromServer: (row, s) => ({
      id: String(row.id),
      title: String(row.title),
      createdAt: instant(row.created_at),
      messages: s.threads.find((t) => t.id === String(row.id))?.messages ?? [],
    }),
    merge: (s, ups, dels) => ({
      ...s,
      threads: upsertList(s.threads, ups, dels, (t) => t.id).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    }),
    actionFields: ["created_at"],
  }
}

type Message = AdvisorMsg & { threadId: string }

export function messageMapper(): Mapper<FinState, Message> {
  return {
    entity: "advisor_message",
    store: finStore,
    list: (s) =>
      s.threads.flatMap((t) =>
        t.messages.map((m) => ({ ...m, threadId: t.id })),
      ),
    id: (m) => m.id,
    toServer: (m) => ({
      thread_id: m.threadId,
      role: m.role,
      text: m.text,
      // The device keeps a marker string ("needs-scope"); the server a dict.
      answer: m.answer === undefined ? null : { text: m.answer },
      scope: m.scope,
      at: m.at,
    }),
    fromServer: (row) => {
      const answer = (row.answer ?? null) as Payload | null
      return {
        id: String(row.id),
        threadId: String(row.thread_id),
        role: row.role === "ai" ? "ai" : "user",
        text: String(row.text),
        at: instant(row.at),
        answer: typeof answer?.text === "string" ? answer.text : undefined,
        scope: row.scope === "records" ? "records" : "aggregates",
      }
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      return {
        ...s,
        threads: s.threads.map((t) => {
          const mine = ups.filter((u) => u.threadId === t.id)
          if (!mine.length && !t.messages.some((m) => dels.includes(m.id)))
            return t
          const messages = upsertList(
            t.messages,
            mine.map(({ threadId: _t, ...m }) => m),
            dels,
            (m) => m.id,
          ).sort((a, b) => a.at.localeCompare(b.at))
          return { ...t, messages }
        }),
      }
    },
    // The server stamps a message's time.
    actionFields: ["at"],
  }
}

// ---------------------------------------------------------------------------
// finance_settings (one row per user)
// ---------------------------------------------------------------------------

export function settingsMapper(userId: string, cats: Cats) {
  const m = singleton<FinState, FinSettings>({
    entity: "finance_settings",
    userId,
    store: finStore,
    read: (s) => s.settings,
    write: (s, v) => ({ ...s, settings: v }),
    toServer: (v) => ({
      // Before the first pull the device still holds the demo seed's
      // "gcash": a slug is no account id, and the server refused the row.
      default_account_id: isUuid(v.defaultAccountId)
        ? v.defaultAccountId
        : null,
      month_start_day: v.monthStartDay,
      horizon: v.horizon,
      include_unplanned: v.includeUnplanned,
      safety_floor_minor: toMinor(v.safetyFloor),
      ai_scope: v.aiScope,
      disclaimer_ack: v.disclaimerAck,
      nudge_days: v.nudgeDays,
      proj_excluded_planned: v.projExcludedPlanned,
      // Server-owned: it remembers these when a record is written.
      last_account_id:
        v.lastAccountId && isUuid(v.lastAccountId) ? v.lastAccountId : null,
      last_category_id: cats.out(v.lastCategoryId),
    }),
    fromServer: (row, cur) => ({
      ...cur,
      defaultAccountId: str(row.default_account_id) ?? "",
      lastAccountId: str(row.last_account_id),
      lastCategoryId: cats.in(row.last_category_id),
      monthStartDay: Number(row.month_start_day),
      horizon: Number(row.horizon) as FinSettings["horizon"],
      includeUnplanned: Boolean(row.include_unplanned),
      safetyFloor: fromMinor(row.safety_floor_minor),
      aiScope: row.ai_scope === "records" ? "records" : "aggregates",
      disclaimerAck: Boolean(row.disclaimer_ack),
      nudgeDays: Number(row.nudge_days),
      projExcludedPlanned: ((row.proj_excluded_planned ?? []) as unknown[]).map(
        String,
      ),
    }),
  })
  return { ...m, actionFields: ["last_account_id", "last_category_id"] }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function financeMappers(userId: string) {
  const cats = categoryIds(userId)
  return [
    accountMapper(),
    plannedMapper(cats),
    plannedSkipMapper(),
    plannedSnoozeMapper(),
    recordMapper(cats),
    budgetMapper(),
    budgetCategoryMapper(cats),
    lookBackMapper(),
    threadMapper(),
    messageMapper(),
    categoryMapper(cats),
    settingsMapper(userId, cats),
  ]
}
