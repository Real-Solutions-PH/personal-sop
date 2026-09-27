"use client"

// Cross-module surfaces: the Today card and the Plan-tab panel.

import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  History,
  PiggyBank,
  Plus,
  Wallet,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { Btn, Card, Money } from "../ui/kit"
import {
  deleteRecords,
  settleOccurrence,
  skipOccurrence,
  unskipOccurrence,
} from "./actions"
import {
  addDays,
  addMonths,
  budgetView,
  catMap,
  dayLabel,
  flowIn,
  lastReconciledDays,
  monthLabel,
  monthOf,
  type Occurrence,
  occurrencesIn,
  project,
  today,
} from "./calc"
import { FinSheets, openSheet } from "./sheets"
import { useFin } from "./store"
import { CatIcon, Pill, undoToast } from "./ui"

function DueRow({ o }: { o: Occurrence }) {
  const s = useFin()
  const cat = s.categories.find((c) => c.id === o.item.categoryId)
  const p = o.item
  return (
    <div className="flex items-center gap-2 py-1.5">
      <button
        type="button"
        onClick={() => openSheet({ kind: "due", plannedId: p.id, day: o.orig })}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {p.type === "transfer" ? (
          <span className="grid size-7 place-items-center rounded-full bg-muted text-sm">
            ⇄
          </span>
        ) : (
          <CatIcon cat={cat} size="sm" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">{p.name}</span>
          <span
            className={cn(
              "text-[11px]",
              o.status === "overdue" ? "text-bad" : "text-muted-foreground",
            )}
          >
            {o.status === "overdue"
              ? `Overdue · ${dayLabel(o.day)}`
              : dayLabel(o.day)}{" "}
            · <Money value={p.amount} />
          </span>
        </span>
      </button>
      <Btn
        variant="secondary"
        className="h-8 px-2.5 text-xs"
        onClick={() => {
          skipOccurrence(p.id, o.orig)
          undoToast(`Skipped ${p.name}`, () => unskipOccurrence(p.id, o.orig))
        }}
      >
        Skip
      </Btn>
      <Btn
        accent="fin"
        className="h-8 px-2.5 text-xs"
        onClick={() => {
          if (p.estimated)
            return openSheet({ kind: "due", plannedId: p.id, day: o.orig })
          const r = settleOccurrence(p.id, o.orig, { amount: p.amount })
          if (r)
            undoToast(
              `${p.type === "income" ? "Received" : "Paid"} ${p.name}`,
              () => deleteRecords([r.id]),
            )
        }}
      >
        {p.type === "income" ? "Got it" : "Paid"}
      </Btn>
    </div>
  )
}

/** Today dashboard card (IA §6): spend today, due items, alerts, nudges. */
export function FinanceTodayCard() {
  const s = useFin()
  const [open, setOpen] = useState(true)
  const d = useMemo(() => {
    if (!s.accounts.length) return null
    const t = today()
    const sd = s.settings.monthStartDay
    const todayFlow = flowIn(s, t, t)
    const overall = s.budgets.find((b) => !b.archived && b.categoryIds === null)
    const ov = overall ? budgetView(s, overall) : null
    const due = occurrencesIn(s, addDays(t, -14), addDays(t, 1)).filter(
      (o) => o.status === "overdue" || o.status === "due",
    )
    const alerts = s.budgets
      .filter((b) => !b.archived && b.categoryIds !== null)
      .map((b) => budgetView(s, b))
      .filter((v) => v.pct >= 0.8)
      .sort((a, b) => b.pct - a.pct)
    const stale = s.accounts.find(
      (a) =>
        !a.archived &&
        (a.type === "ewallet" || a.type === "bank") &&
        (lastReconciledDays(a) ?? 999) > s.settings.nudgeDays,
    )
    const pending = s.records.filter((r) => r.status === "pending").length
    const mk = monthOf(t, sd)
    const lastMonth = addMonths(mk, -1)
    const dom = Number(t.slice(8, 10))
    const reviewReady =
      dom <= 7 && !s.lookbacks.some((l) => l.period === lastMonth)
    const proj = project(s, {
      horizon: 12,
      includeUnplanned: s.settings.includeUnplanned,
      excludedPlanned: s.settings.projExcludedPlanned,
    })
    return {
      spent: todayFlow.spend,
      ov,
      due,
      alerts,
      stale,
      pending,
      reviewReady,
      lastMonth,
      proj,
    }
  }, [s])
  if (!d)
    return (
      <>
        <Card href="/finance/setup" className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-fin/15 text-fin">
            <Wallet className="size-5" />
          </span>
          <div className="flex-1">
            <div className="font-medium">Set up money tracking</div>
            <div className="text-muted-foreground text-xs">
              Add accounts — then logging is 2 taps.
            </div>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Card>
        <FinSheets />
      </>
    )
  const last = d.proj.months[d.proj.months.length - 1]
  return (
    <>
      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <Link
            href="/finance"
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <span className="grid size-10 place-items-center rounded-2xl bg-fin/15 text-fin">
              <Wallet className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="text-muted-foreground text-xs">Spent today</div>
              <Money value={d.spent} className="font-semibold text-xl" />
            </div>
          </Link>
          {d.ov && (
            <div className="text-right text-xs">
              <div className="text-muted-foreground">Safe to spend / day</div>
              <Money
                value={d.ov.safePerDay}
                className="font-semibold text-fin"
              />
            </div>
          )}
          <button
            type="button"
            aria-label="Quick add expense"
            onClick={() => openSheet({ kind: "quick-add" })}
            className="grid size-10 place-items-center rounded-full bg-fin text-background active:scale-95"
          >
            <Plus className="size-5" />
          </button>
        </div>

        {d.due.length > 0 && (
          <div className="border-border/50 border-t pt-2">
            {d.due.slice(0, 3).map((o) => (
              <DueRow key={`${o.item.id}-${o.orig}`} o={o} />
            ))}
          </div>
        )}

        {(d.alerts.length > 0 || d.stale || d.pending > 0 || d.reviewReady) && (
          <div className="space-y-1.5 border-border/50 border-t pt-2 text-sm">
            {d.alerts.slice(0, 2).map((v) => (
              <Link
                key={v.b.id}
                href={`/finance/budgets/${v.b.id}`}
                className="flex items-center gap-2"
              >
                <AlertTriangle
                  className={cn("size-4", v.pct > 1 ? "text-bad" : "text-warn")}
                />
                <span className="flex-1">
                  {v.b.name} budget at {Math.round(v.pct * 100)}%
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
            {d.reviewReady && (
              <Link
                href={`/finance/review?period=${d.lastMonth}`}
                className="flex items-center gap-2"
              >
                <CalendarClock className="size-4 text-life" />
                <span className="flex-1">
                  {monthLabel(d.lastMonth, true)} review ready
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            )}
            {d.stale && (
              <Link
                href={`/finance/import?account=${d.stale.id}`}
                className="flex items-center gap-2"
              >
                <History className="size-4 text-warn" />
                <span className="flex-1">
                  {d.stale.name} not matched with a statement for{" "}
                  {lastReconciledDays(d.stale) ?? "a while"} days
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            )}
            {d.pending > 0 && (
              <Link
                href="/finance/records?pending=1"
                className="flex items-center gap-2"
              >
                <Pill tone="warn">{d.pending}</Pill>
                <span className="flex-1">
                  AI-drafted transactions to confirm
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            )}
          </div>
        )}

        {d.proj.hasIncome && last && (
          <div className="border-border/50 border-t pt-2">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="flex w-full items-center gap-2 text-left text-sm"
            >
              <PiggyBank className="size-4 text-fin" />
              <span className="flex-1">Projection</span>
              <span className="text-muted-foreground text-xs">
                {open ? "hide" : "show"}
              </span>
            </button>
            {open && (
              <Link
                href="/finance/projection"
                className="mt-1 flex items-center justify-between rounded-xl bg-fin/5 px-3 py-2 text-sm"
              >
                <span>
                  <Money value={last.end} className="font-semibold" /> by{" "}
                  {monthLabel(last.key)} {last.key.slice(2, 4)}
                </span>
                <span className="font-medium text-fin text-xs">What if? ›</span>
              </Link>
            )}
          </div>
        )}
      </Card>
      <FinSheets />
    </>
  )
}

/** Plan tab: next 14 days of bills and paydays (read-only overlay lives in useCalendar). */
export function FinancePlanPanel() {
  const s = useFin()
  const items = useMemo(() => {
    const t = today()
    return occurrencesIn(s, addDays(t, -7), addDays(t, 14)).filter(
      (o) => o.status !== "skipped" && (o.status !== "paid" || o.day >= t),
    )
  }, [s])
  const cats = useMemo(() => catMap(s), [s])
  return (
    <>
      <Card className="px-3 py-1">
        {items.length === 0 && (
          <div className="py-4 text-center text-muted-foreground text-sm">
            No bills or paydays in the next 2 weeks.
          </div>
        )}
        {items.map((o) => (
          <Link
            key={`${o.item.id}-${o.orig}`}
            href={`/finance/planned/${o.item.id}`}
            className="flex items-center gap-3 py-2"
          >
            {o.item.type === "transfer" ? (
              <span className="grid size-7 place-items-center rounded-full bg-muted text-sm">
                ⇄
              </span>
            ) : (
              <CatIcon cat={cats.get(o.item.categoryId ?? "")} size="sm" />
            )}
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-sm",
                  o.status === "paid" && "text-muted-foreground line-through",
                )}
              >
                {o.item.name}
              </span>
              <span
                className={cn(
                  "text-[11px]",
                  o.status === "overdue" ? "text-bad" : "text-muted-foreground",
                )}
              >
                {dayLabel(o.day)}
              </span>
            </span>
            <Money
              value={o.item.type === "income" ? o.item.amount : -o.item.amount}
              signed={o.item.type !== "transfer"}
              className="text-sm"
            />
          </Link>
        ))}
      </Card>
      <FinSheets />
    </>
  )
}
