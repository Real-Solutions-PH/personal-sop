"use client"

import {
  ArrowRight,
  Bot,
  CalendarClock,
  ChevronRight,
  Eye,
  EyeOff,
  FileUp,
  FolderTree,
  History,
  LineChart as LineIcon,
  ListOrdered,
  PiggyBank,
  Plus,
  Settings,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { privacyStore, togglePrivacy } from "../../lib/privacy"
import {
  Bar,
  Btn,
  Card,
  Empty,
  Money,
  Ring,
  Screen,
  SectionTitle,
  Sparkline,
  Stat,
} from "../../ui/kit"
import { confirmRecord } from "../actions"
import {
  acctMap,
  addDays,
  addMonths,
  balances,
  budgetView,
  catMap,
  compact,
  dayLabel,
  flowIn,
  lastReconciledDays,
  monthLabel,
  monthOf,
  monthRange,
  netWorth,
  netWorthSeries,
  occurrencesIn,
  project,
  today,
} from "../calc"
import { openSheet } from "../sheets"
import { useFin } from "../store"
import {
  AcctIcon,
  CatIcon,
  LoadingList,
  PairBars,
  Pill,
  RecordRow,
  StaleBanner,
  useDemoState,
} from "../ui"

export function FinanceHome() {
  const s = useFin()
  const demo = useDemoState()
  const hidden = privacyStore.use((x) => x.hidden)
  const d = useMemo(() => {
    const t = today()
    const sd = s.settings.monthStartDay
    const mk = monthOf(t, sd)
    const [from, to] = monthRange(mk, sd)
    const bal = balances(s)
    const nwSeries = netWorthSeries(s, 90)
    const nw = netWorth(s, bal)
    const nw30 = nwSeries[nwSeries.length - 31] ?? nw
    const flow = flowIn(s, from, to)
    const trio = [-2, -1, 0].map((i) => {
      const [f, tt] = monthRange(addMonths(mk, i), sd)
      const fl = flowIn(s, f, tt)
      return { key: addMonths(mk, i), income: fl.income, spend: fl.spend }
    })
    const overall = s.budgets.find((b) => !b.archived && b.categoryIds === null)
    const views = s.budgets
      .filter((b) => !b.archived)
      .map((b) => budgetView(s, b))
    const proj = project(s, {
      horizon: s.settings.horizon,
      includeUnplanned: s.settings.includeUnplanned,
      excludedPlanned: s.settings.projExcludedPlanned,
    })
    const upcoming = occurrencesIn(s, t, addDays(t, 7)).filter(
      (o) => o.status !== "paid" && o.status !== "skipped",
    )
    const overdue = occurrencesIn(s, addDays(t, -14), addDays(t, -1)).filter(
      (o) => o.status === "overdue",
    )
    const stale = s.accounts.filter(
      (a) =>
        !a.archived &&
        (a.type === "ewallet" || a.type === "bank") &&
        (lastReconciledDays(a) ?? 999) > s.settings.nudgeDays,
    )
    const pending = s.records.filter((r) => r.status === "pending")
    const lastMonth = addMonths(mk, -1)
    const reviewSaved = s.lookbacks.some((l) => l.period === lastMonth)
    return {
      mk,
      bal,
      nw,
      nwDelta: nw30 ? ((nw - nw30) / Math.abs(nw30)) * 100 : 0,
      nwSeries,
      flow,
      trio,
      overall: overall ? budgetView(s, overall) : null,
      views,
      proj,
      upcoming: [...overdue, ...upcoming],
      stale,
      pending,
      lastMonth,
      reviewSaved,
      liquid: s.accounts
        .filter((a) => a.inProjection && !a.archived)
        .reduce((x, a) => x + bal[a.id], 0),
      owed: s.accounts
        .filter((a) => a.type === "credit" && !a.archived)
        .reduce((x, a) => x + bal[a.id], 0),
    }
  }, [s])
  const cats = useMemo(() => catMap(s), [s])
  const accts = useMemo(() => acctMap(s), [s])

  const actions = (
    <>
      <button
        type="button"
        aria-label={hidden ? "Show amounts" : "Hide amounts"}
        onClick={togglePrivacy}
        className="grid size-10 place-items-center rounded-full hover:bg-muted"
      >
        {hidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
      <Link
        href="/finance/settings"
        aria-label="Finance settings"
        className="grid size-10 place-items-center rounded-full hover:bg-muted"
      >
        <Settings className="size-5" />
      </Link>
    </>
  )

  if (demo === "loading")
    return (
      <Screen title="Finance" back actions={actions}>
        <LoadingList />
      </Screen>
    )

  if (demo === "empty" || s.accounts.length === 0)
    return (
      <Screen title="Finance" back actions={actions}>
        <Empty
          icon={<Wallet className="size-10" />}
          title="Add your accounts"
          body="Cash, GCash, Maya, your bank and credit card — with today's balances. Takes a minute, then logging is 2 taps."
          action={
            <Btn href="/finance/setup" accent="fin">
              Set up Finance
            </Btn>
          }
        />
      </Screen>
    )

  const accounts = s.accounts
    .filter((a) => !a.archived)
    .sort((a, b) => a.order - b.order)
  const topBudgets = d.views
    .filter((v) => v.b.categoryIds !== null)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3)
  const lastProj = d.proj.months[d.proj.months.length - 1]

  return (
    <Screen title="Finance" back actions={actions}>
      {demo === "error" && <StaleBanner />}

      {/* Net worth */}
      <Card className="overflow-hidden pb-0">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-muted-foreground text-xs">Net worth</div>
            <Money
              value={d.nw}
              className="font-semibold text-3xl tracking-tight"
            />
            <div
              className={cn(
                "num text-xs",
                d.nwDelta >= 0 ? "text-good" : "text-bad",
              )}
            >
              {d.nwDelta >= 0 ? "▲" : "▼"} {Math.abs(d.nwDelta).toFixed(1)}%
              <span className="text-muted-foreground"> vs 30 days ago</span>
            </div>
          </div>
          <div className="text-right text-xs">
            <div className="text-muted-foreground">Available</div>
            <Money value={d.liquid} className="font-medium" />
            <div className="mt-1 text-muted-foreground">Card owed</div>
            <Money value={Math.abs(d.owed)} className="font-medium text-bad" />
          </div>
        </div>
        <Sparkline
          data={d.nwSeries}
          accent="fin"
          height={56}
          className="-mx-4 mt-2 w-[calc(100%+2rem)]"
        />
      </Card>

      {/* Quick actions */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {[
          {
            label: "Add",
            icon: Plus,
            onClick: () => openSheet({ kind: "quick-add" }),
          },
          { label: "Import", icon: FileUp, href: "/finance/import" },
          {
            label: "What if?",
            icon: Sparkles,
            href: "/finance/projection?whatif=1",
          },
          { label: "Advisor", icon: Bot, href: "/finance/advisor" },
        ].map((a) => {
          const inner = (
            <>
              <span className="grid size-11 place-items-center rounded-2xl bg-fin/15 text-fin">
                <a.icon className="size-5" />
              </span>
              <span className="text-xs">{a.label}</span>
            </>
          )
          const cls =
            "flex flex-col items-center gap-1.5 rounded-2xl py-2 active:bg-muted/60"
          return a.href ? (
            <Link key={a.label} href={a.href} className={cls}>
              {inner}
            </Link>
          ) : (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className={cls}
            >
              {inner}
            </button>
          )
        })}
      </div>

      {/* Accounts strip */}
      <SectionTitle
        action={
          <Link href="/finance/accounts" className="text-fin text-xs">
            All accounts
          </Link>
        }
      >
        Accounts
      </SectionTitle>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {accounts.map((a) => (
          <Link
            key={a.id}
            href={`/finance/accounts/${a.id}`}
            className="w-36 shrink-0 rounded-2xl border border-border/60 bg-card p-3 active:bg-muted/60"
          >
            <div className="flex items-center gap-2">
              <AcctIcon acct={a} size="sm" />
              <span className="truncate text-muted-foreground text-xs">
                {a.name}
              </span>
            </div>
            <Money
              value={d.bal[a.id]}
              className={cn(
                "mt-2 block font-semibold",
                d.bal[a.id] < 0 && "text-bad",
              )}
            />
            {a.type === "credit" && a.limit ? (
              <Bar
                value={Math.abs(d.bal[a.id]) / a.limit}
                accent="fin"
                className="mt-2 h-1.5"
              />
            ) : (
              <div className="mt-2 text-[10px] text-muted-foreground">
                {a.manual
                  ? "manual value"
                  : a.lastReconciled
                    ? `matched ${lastReconciledDays(a)}d ago`
                    : "never matched"}
              </div>
            )}
          </Link>
        ))}
      </div>

      {/* Nudges */}
      {(d.stale.length > 0 || d.pending.length > 0) && (
        <div className="mt-3 space-y-2">
          {d.stale.slice(0, 2).map((a) => (
            <Link
              key={a.id}
              href={`/finance/import?account=${a.id}`}
              className="flex items-center gap-3 rounded-2xl bg-warn/10 px-3 py-2.5 text-sm"
            >
              <History className="size-4 text-warn" />
              <span className="flex-1">
                {a.name} not matched with a statement
                {a.lastReconciled
                  ? ` for ${lastReconciledDays(a)} days`
                  : " yet"}
              </span>
              <span className="font-semibold text-warn">Import</span>
            </Link>
          ))}
          {d.pending.length > 0 && (
            <Card className="p-3">
              <div className="mb-1 flex items-center gap-2 text-sm">
                <Pill tone="warn">{d.pending.length} to check</Pill>
                <span className="text-muted-foreground">
                  AI drafts to double-check
                </span>
              </div>
              {d.pending.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <RecordRow
                      r={r}
                      cats={cats}
                      accts={accts}
                      href={`/finance/records/${r.id}`}
                    />
                  </div>
                  <Btn
                    variant="secondary"
                    className="h-9"
                    onClick={() => confirmRecord(r.id)}
                  >
                    OK
                  </Btn>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* This month */}
      <SectionTitle
        action={
          <Link href="/finance/budgets" className="text-fin text-xs">
            Budgets
          </Link>
        }
      >
        {monthLabel(d.mk, true)}
      </SectionTitle>
      <Card href="/finance/budgets">
        <div className="flex items-center gap-4">
          <Ring
            value={d.overall ? d.overall.pct : 0}
            size={84}
            stroke={9}
            accent={d.overall && d.overall.pct > d.overall.pace ? "fit" : "fin"}
          >
            <div>
              <div className="num font-semibold text-lg leading-none">
                {d.overall ? Math.round(d.overall.pct * 100) : 0}%
              </div>
              <div className="text-[10px] text-muted-foreground">of budget</div>
            </div>
          </Ring>
          <div className="grid flex-1 grid-cols-2 gap-3">
            <Stat label="Spent" value={<Money value={d.flow.spend} />} />
            <Stat
              label="Budget"
              value={<Money value={d.overall?.limit ?? 0} />}
            />
            <Stat
              label="Safe to spend / day"
              value={<Money value={d.overall?.safePerDay ?? 0} />}
              accent="fin"
            />
            <Stat label="Days left" value={d.overall?.daysLeft ?? "—"} />
          </div>
        </div>
        <div className="mt-4 space-y-2.5">
          {topBudgets.map((v) => (
            <div key={v.b.id}>
              <div className="mb-1 flex justify-between text-xs">
                <span>{v.b.name}</span>
                <span
                  className={cn(
                    "num",
                    v.pct > 1
                      ? "text-bad"
                      : v.pct > v.pace
                        ? "text-warn"
                        : "text-muted-foreground",
                  )}
                >
                  {Math.round(v.pct * 100)}%
                </span>
              </div>
              <div className="relative">
                <Bar value={v.pct} accent="fin" />
                <span
                  className="absolute top-[-2px] h-3 w-0.5 rounded bg-foreground/60"
                  style={{ left: `${v.pace * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Cash flow */}
      <Card className="mt-3" href="/finance/reports/cashflow">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-medium text-sm">Cash flow</div>
          <div className="flex gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-good/80" /> In
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-bad/70" /> Out
            </span>
          </div>
        </div>
        <div className="flex items-end gap-4">
          <div className="w-28 shrink-0 space-y-2">
            <Stat
              label="Net this month"
              value={<Money value={d.flow.income - d.flow.spend} signed />}
            />
            <div className="text-muted-foreground text-xs">
              In <Money value={d.flow.income} /> · Out{" "}
              <Money value={d.flow.spend} />
            </div>
          </div>
          <div className="flex-1">
            <PairBars
              pairs={d.trio.map((x) => [x.income, x.spend])}
              labels={d.trio.map((x) => monthLabel(x.key))}
              height={72}
            />
          </div>
        </div>
      </Card>

      {/* Projection teaser */}
      <Card className="mt-3 border-fin/30 bg-fin/5" href="/finance/projection">
        <div className="flex items-center gap-2 text-fin text-xs">
          <PiggyBank className="size-4" /> Savings projection
        </div>
        {d.proj.hasIncome ? (
          <>
            <div className="mt-1 flex items-end justify-between gap-2">
              <div>
                <Money
                  value={lastProj?.end ?? d.proj.start}
                  className="font-semibold text-2xl"
                />
                <div className="text-muted-foreground text-xs">
                  by {lastProj ? monthLabel(lastProj.key, true) : ""} ·{" "}
                  <span className="text-good">
                    +{hidden ? "₱•••" : compact(d.proj.avgSurplus)}/mo
                  </span>
                </div>
              </div>
              <span className="flex items-center gap-1 font-semibold text-fin text-sm">
                Plan a purchase <ArrowRight className="size-4" />
              </span>
            </div>
            <Sparkline
              data={[d.proj.start, ...d.proj.months.map((m) => m.end)]}
              accent="fin"
              height={44}
              className="mt-2"
            />
          </>
        ) : (
          <div className="mt-1 text-sm">
            Add your salary as a scheduled payment to unlock the forecast.
          </div>
        )}
      </Card>

      {/* Shortcuts */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        {[
          {
            href: "/finance/records",
            label: "Transactions",
            icon: ListOrdered,
          },
          { href: "/finance/accounts", label: "Accounts", icon: Wallet },
          { href: "/finance/budgets", label: "Budgets", icon: Target },
          { href: "/finance/planned", label: "Scheduled", icon: CalendarClock },
          { href: "/finance/reports", label: "Reports", icon: LineIcon },
          {
            href: "/finance/categories",
            label: "Categories",
            icon: FolderTree,
          },
          { href: "/finance/imports", label: "Imports", icon: History },
          { href: "/finance/settings", label: "Settings", icon: Settings },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-border/60 bg-card py-3 text-xs active:bg-muted/60"
          >
            <l.icon className="size-5 text-muted-foreground" />
            {l.label}
          </Link>
        ))}
      </div>

      {/* Upcoming */}
      <SectionTitle
        action={
          <Link href="/finance/planned" className="text-fin text-xs">
            Scheduled
          </Link>
        }
      >
        Next 7 days
      </SectionTitle>
      <Card className="py-1">
        {d.upcoming.length === 0 && (
          <div className="py-4 text-center text-muted-foreground text-sm">
            Nothing scheduled this week.
          </div>
        )}
        {d.upcoming.slice(0, 6).map((o) => (
          <button
            key={`${o.item.id}-${o.orig}`}
            type="button"
            onClick={() =>
              openSheet({ kind: "due", plannedId: o.item.id, day: o.orig })
            }
            className="flex min-h-14 w-full items-center gap-3 text-left"
          >
            {o.item.type === "transfer" ? (
              <span className="grid size-10 place-items-center rounded-full bg-muted">
                ⇄
              </span>
            ) : (
              <CatIcon cat={cats.get(o.item.categoryId ?? "")} />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{o.item.name}</div>
              <div className="text-muted-foreground text-xs">
                {dayLabel(o.day)}
                {o.status === "overdue" && (
                  <Pill tone="bad" className="ml-1.5">
                    overdue
                  </Pill>
                )}
                {o.status === "due" && (
                  <Pill tone="warn" className="ml-1.5">
                    due
                  </Pill>
                )}
              </div>
            </div>
            <Money
              value={o.item.type === "income" ? o.item.amount : -o.item.amount}
              signed={o.item.type !== "transfer"}
              className="font-medium"
            />
          </button>
        ))}
      </Card>

      {/* Look-back */}
      <Card
        className="mt-3 flex items-center gap-3"
        href={`/finance/review?period=${d.lastMonth}`}
      >
        <span className="grid size-11 place-items-center rounded-2xl bg-life/15 text-life">
          <CalendarClock className="size-5" />
        </span>
        <div className="flex-1">
          <div className="font-medium">
            {monthLabel(d.lastMonth, true)} review{" "}
            {d.reviewSaved ? "" : "ready"}
          </div>
          <div className="text-muted-foreground text-xs">
            Where it went, leaks, wins & misses
          </div>
        </div>
        {!d.reviewSaved && <Pill tone="fin">new</Pill>}
        <ChevronRight className="size-4 text-muted-foreground" />
      </Card>

      {/* Recent */}
      <SectionTitle
        action={
          <Link href="/finance/records" className="text-fin text-xs">
            All transactions
          </Link>
        }
      >
        Recent
      </SectionTitle>
      <Card className="py-1">
        {[...s.records]
          .reverse()
          .slice(0, 5)
          .map((r) => (
            <RecordRow
              key={r.id}
              r={r}
              cats={cats}
              accts={accts}
              href={`/finance/records/${r.id}`}
            />
          ))}
      </Card>
    </Screen>
  )
}
