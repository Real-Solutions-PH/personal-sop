"use client"

import {
  Archive,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  FileUp,
  Pencil,
  Plus,
  Scale,
  Wallet,
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { type ReactNode, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  Bar,
  Btn,
  Card,
  Empty,
  Money,
  Row,
  Screen,
  SectionTitle,
  Stat,
} from "../../ui/kit"
import { updateAccount } from "../actions"
import {
  accountSeries,
  acctMap,
  addDays,
  balances,
  catMap,
  diffDays,
  flowIn,
  lastReconciledDays,
  monthOf,
  monthRange,
  netWorth,
  occurrencesIn,
  recDay,
  savingsView,
  shortDate,
  today,
} from "../calc"
import type { Account, AccountType, FinState } from "../data"
import { openSheet } from "../sheets"
import { useFin } from "../store"
import {
  ACCT_GROUP,
  AcctIcon,
  LineChart,
  LoadingList,
  Pill,
  RecordRow,
  StaleBanner,
  undoToast,
  useDemoState,
} from "../ui"

const ORDER: AccountType[] = ["cash", "ewallet", "bank", "credit", "investment"]

/** Interest, maturity and goal for a savings account or time deposit. */
function SavingsPanel({
  s,
  account: a,
  balance,
}: {
  s: FinState
  account: Account
  balance: number
}) {
  const v = savingsView(s, a, balance)
  const row = (label: string, value: ReactNode) => (
    <div key={label} className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="num">{value}</span>
    </div>
  )
  return (
    <Card className="mt-3 space-y-2">
      {v.goalProgress !== null && a.goal && (
        <>
          <div className="flex justify-between text-sm">
            <span>Goal</span>
            <span className="num">
              <Money value={Math.max(0, balance)} /> / <Money value={a.goal} />
            </span>
          </div>
          <Bar value={v.goalProgress} accent="fin" />
          <div
            className={cn(
              "text-xs",
              v.goalProgress >= 1 ? "text-good" : "text-muted-foreground",
            )}
          >
            {v.goalProgress >= 1 ? (
              "Goal reached"
            ) : v.perMonth !== null && a.goalBy ? (
              <>
                <Money value={v.perMonth} /> a month to reach it by{" "}
                {shortDate(a.goalBy)}
              </>
            ) : (
              <>
                <Money value={a.goal - balance} /> to go
              </>
            )}
          </div>
        </>
      )}
      {a.rate !== undefined && row("Interest", `${a.rate}% a year`)}
      {v.monthlyInterest !== null &&
        row("Est. a month, after 20% tax", <Money value={v.monthlyInterest} />)}
      {row("Interest earned this year", <Money value={v.earnedThisYear} />)}
      {v.maturesIn !== null &&
        a.maturesOn &&
        row(
          v.maturesIn > 0 ? "Matures" : "Matured",
          `${shortDate(a.maturesOn)}${v.maturesIn > 0 ? ` · ${v.maturesIn}d` : ""}`,
        )}
      {v.maturityValue !== null &&
        v.maturesIn !== null &&
        v.maturesIn > 0 &&
        row("Value at maturity, after tax", <Money value={v.maturityValue} />)}
    </Card>
  )
}

/** Card line for a time deposit or a goal, else null. */
function savingsNote(a: Account, balance: number): ReactNode {
  if (a.maturesOn) {
    const days = diffDays(a.maturesOn, today())
    return days > 0 ? (
      `Matures in ${days}d`
    ) : (
      <span className="text-warn">Matured</span>
    )
  }
  if (a.goal)
    return `${Math.round((Math.max(0, balance) / a.goal) * 100)}% of goal`
  return null
}

// ------------------------------------------------------------------ FIN-09

export function AccountsScreen() {
  const s = useFin()
  const demo = useDemoState()
  const [reorder, setReorder] = useState(false)
  const bal = useMemo(() => balances(s), [s])
  const nw = useMemo(() => netWorth(s, bal), [s, bal])
  const live = s.accounts
    .filter((a) => !a.archived)
    .sort((a, b) => a.order - b.order)
  const archived = s.accounts.filter((a) => a.archived).length
  const move = (id: string, dir: -1 | 1) => {
    const i = live.findIndex((a) => a.id === id)
    const j = i + dir
    if (j < 0 || j >= live.length) return
    updateAccount(live[i].id, { order: live[j].order })
    updateAccount(live[j].id, { order: live[i].order })
  }
  const actions = (
    <>
      <button
        type="button"
        onClick={() => setReorder(!reorder)}
        className={cn(
          "h-10 rounded-full px-3 text-sm",
          reorder ? "text-fin" : "text-muted-foreground",
        )}
      >
        {reorder ? "Done" : "Reorder"}
      </button>
      <button
        type="button"
        aria-label="Add account"
        onClick={() => openSheet({ kind: "account" })}
        className="grid size-10 place-items-center rounded-full hover:bg-muted"
      >
        <Plus className="size-5" />
      </button>
    </>
  )
  if (demo === "loading")
    return (
      <Screen title="Accounts" back actions={actions}>
        <LoadingList />
      </Screen>
    )
  if (demo === "empty" || live.length === 0)
    return (
      <Screen title="Accounts" back actions={actions}>
        <Empty
          icon={<Wallet className="size-10" />}
          title="No accounts yet"
          body="Add where your money lives — cash, GCash, bank, cards."
          action={
            <Btn accent="fin" onClick={() => openSheet({ kind: "account" })}>
              Add account
            </Btn>
          }
        />
      </Screen>
    )
  return (
    <Screen title="Accounts" back actions={actions}>
      {demo === "error" && <StaleBanner />}
      <Card className="flex items-center justify-between">
        <Stat label="Net worth" value={<Money value={nw} />} accent="fin" />
        <div className="text-right text-muted-foreground text-xs">
          {live.length} accounts
          <br />
          credit cards count as debt
        </div>
      </Card>
      {reorder ? (
        <Card className="mt-4 py-1">
          {live.map((a, i) => (
            <div key={a.id} className="flex items-center gap-3 py-2">
              <AcctIcon acct={a} />
              <span className="flex-1 font-medium">{a.name}</span>
              <button
                type="button"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => move(a.id, -1)}
                className="grid size-9 place-items-center rounded-lg bg-muted disabled:opacity-30"
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={i === live.length - 1}
                onClick={() => move(a.id, 1)}
                className="grid size-9 place-items-center rounded-lg bg-muted disabled:opacity-30"
              >
                <ArrowDown className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      ) : (
        ORDER.map((t) => {
          const group = live.filter((a) => a.type === t)
          if (!group.length) return null
          const sum = group.reduce((x, a) => x + bal[a.id], 0)
          return (
            <div key={t}>
              <SectionTitle
                action={
                  <Money
                    value={sum}
                    className="text-muted-foreground text-xs"
                  />
                }
              >
                {ACCT_GROUP[t]}
              </SectionTitle>
              <Card className="px-3 py-1">
                {group.map((a) => {
                  const days = lastReconciledDays(a)
                  return (
                    <Row
                      key={a.id}
                      href={`/finance/accounts/${a.id}`}
                      icon={<AcctIcon acct={a} />}
                      title={a.name}
                      subtitle={
                        a.type === "credit" && a.limit ? (
                          <span className="flex items-center gap-2">
                            <Bar
                              value={Math.abs(bal[a.id]) / a.limit}
                              accent="fin"
                              className="h-1.5 w-16"
                            />
                            {Math.round((Math.abs(bal[a.id]) / a.limit) * 100)}%
                            of limit
                          </span>
                        ) : savingsNote(a, bal[a.id]) ? (
                          savingsNote(a, bal[a.id])
                        ) : a.manual ? (
                          "Manual value"
                        ) : days === null ? (
                          "Never matched"
                        ) : (
                          <span
                            className={cn(
                              days > s.settings.nudgeDays && "text-warn",
                            )}
                          >
                            Matched {days === 0 ? "today" : `${days}d ago`}
                          </span>
                        )
                      }
                      right={
                        <Money
                          value={bal[a.id]}
                          className={cn(
                            "font-semibold",
                            bal[a.id] < 0 && "text-bad",
                          )}
                        />
                      }
                    />
                  )
                })}
              </Card>
            </div>
          )
        })
      )}
      <Link
        href="/finance/rates"
        className="mt-4 block text-center text-fin text-sm"
      >
        Compare savings rates
      </Link>
      {archived > 0 && (
        <Link
          href="/finance/archived"
          className="mt-4 block text-center text-muted-foreground text-sm"
        >
          Show {archived} archived
        </Link>
      )}
    </Screen>
  )
}

// ------------------------------------------------------------------ FIN-10

export function AccountDetail() {
  const { id } = useParams<{ id: string }>()
  const s = useFin()
  const a = s.accounts.find((x) => x.id === id)
  const d = useMemo(() => {
    if (!a) return null
    const t = today()
    const bal = balances(s)[a.id]
    const series = accountSeries(s, a, 60)
    const [from, to] = monthRange(
      monthOf(t, s.settings.monthStartDay),
      s.settings.monthStartDay,
    )
    let inflow = 0
    let outflow = 0
    for (const r of s.records) {
      const k = recDay(r)
      if (k < from || k > to) continue
      if (r.accountId === a.id) {
        if (r.type === "income") inflow += r.amount
        else outflow += r.amount
      } else if (r.toAccountId === a.id) inflow += r.amount
    }
    const recs = s.records
      .filter((r) => r.accountId === a.id || r.toAccountId === a.id)
      .reverse()
    const nextPay = occurrencesIn(s, t, addDays(t, 45)).find(
      (o) => o.item.toAccountId === a.id && o.status !== "paid",
    )
    return {
      bal,
      series,
      inflow,
      outflow,
      recs,
      nextPay,
      flow: flowIn(s, from, to),
    }
  }, [s, a])
  const cats = useMemo(() => catMap(s), [s])
  const accts = useMemo(() => acctMap(s), [s])
  if (!a || !d)
    return (
      <Screen title="Account" back="/finance/accounts">
        <Empty
          title="Account not found"
          action={<Btn href="/finance/accounts">All accounts</Btn>}
        />
      </Screen>
    )
  const imports = s.imports.filter((i) => i.accountId === a.id)
  const days = lastReconciledDays(a)
  const labels = Array.from({ length: 60 }, (_, i) =>
    i % 15 === 0 ? shortDate(addDays(today(), i - 59)) : "",
  )
  return (
    <Screen
      title={a.name}
      back
      actions={
        <button
          type="button"
          aria-label="Edit account"
          onClick={() => openSheet({ kind: "account", id: a.id })}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Pencil className="size-5" />
        </button>
      }
    >
      <div className="flex items-center gap-3 py-2">
        <AcctIcon acct={a} />
        <div>
          <Money
            value={d.bal}
            className={cn(
              "font-semibold text-3xl tracking-tight",
              d.bal < 0 && "text-bad",
            )}
          />
          <div className="text-muted-foreground text-xs">
            {a.type === "credit"
              ? "Balance owed"
              : a.manual
                ? "Current value (manual)"
                : "Balance"}
          </div>
        </div>
      </div>
      <Card className="px-2 pb-1">
        <LineChart
          series={[{ values: d.series, tone: "fin", area: true }]}
          labels={labels}
          height={140}
        />
      </Card>

      {!!(a.rate !== undefined || a.maturesOn || a.goal) && (
        <SavingsPanel s={s} account={a} balance={d.bal} />
      )}

      {a.type === "credit" && a.limit ? (
        <Card className="mt-3">
          <div className="mb-2 flex justify-between text-sm">
            <span>Credit used</span>
            <span className="num">
              <Money value={Math.abs(d.bal)} /> / <Money value={a.limit} />
            </span>
          </div>
          <Bar value={Math.abs(d.bal) / a.limit} accent="fin" />
          {d.nextPay && (
            <button
              type="button"
              onClick={() =>
                openSheet({
                  kind: "due",
                  plannedId: d.nextPay!.item.id,
                  day: d.nextPay!.orig,
                })
              }
              className="mt-3 flex w-full items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-left text-sm"
            >
              <span>
                Next: {d.nextPay.item.name}
                <span className="block text-muted-foreground text-xs">
                  {shortDate(d.nextPay.day)}
                </span>
              </span>
              <Money value={d.nextPay.item.amount} className="font-semibold" />
            </button>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Pill tone="good">Paid in full 3 cycles in a row</Pill>
          </div>
        </Card>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Card>
            <Stat label="In this month" value={<Money value={d.inflow} />} />
          </Card>
          <Card>
            <Stat label="Out this month" value={<Money value={d.outflow} />} />
          </Card>
        </div>
      )}

      <div className="mt-3 grid grid-cols-4 gap-2">
        {[
          {
            l: "Transfer",
            i: ArrowLeftRight,
            f: () =>
              openSheet({
                kind: "record",
                prefill: { type: "transfer", accountId: a.id },
              }),
          },
          {
            l: a.manual ? "Update" : "Adjust",
            i: Scale,
            f: () => openSheet({ kind: "adjust", accountId: a.id }),
          },
          { l: "Import", i: FileUp, href: `/finance/import?account=${a.id}` },
          {
            l: "Archive",
            i: Archive,
            f: () =>
              openSheet({
                kind: "confirm",
                title: `Archive ${a.name}?`,
                body: `It has ${d.recs.length} transactions, so it can't be deleted. Archiving hides it from lists and pickers but keeps history.`,
                confirm: "Archive",
                danger: true,
                onConfirm: () => {
                  updateAccount(a.id, { archived: true })
                  undoToast(`${a.name} archived`, () =>
                    updateAccount(a.id, { archived: false }),
                  )
                },
              }),
          },
        ].map((x) =>
          x.href ? (
            <Link
              key={x.l}
              href={x.href}
              className="flex flex-col items-center gap-1 rounded-2xl bg-card py-3 text-xs active:bg-muted"
            >
              <x.i className="size-5 text-fin" /> {x.l}
            </Link>
          ) : (
            <button
              key={x.l}
              type="button"
              onClick={x.f}
              className="flex flex-col items-center gap-1 rounded-2xl bg-card py-3 text-xs active:bg-muted"
            >
              <x.i className="size-5 text-fin" /> {x.l}
            </button>
          ),
        )}
      </div>

      {!a.manual && (
        <Card className="mt-3 flex items-center justify-between text-sm">
          <span>
            Last matched with statement
            <span
              className={cn(
                "block text-xs",
                days !== null && days > s.settings.nudgeDays
                  ? "text-warn"
                  : "text-muted-foreground",
              )}
            >
              {a.lastReconciled
                ? `${shortDate(a.lastReconciled)} · ${days} days ago`
                : "Never"}
            </span>
          </span>
          <Btn
            variant="secondary"
            href={`/finance/import?account=${a.id}`}
            className="h-9"
          >
            Match with statement
          </Btn>
        </Card>
      )}

      <SectionTitle
        action={
          <Link
            href={`/finance/records?account=${a.id}`}
            className="text-fin text-xs"
          >
            See all {d.recs.length}
          </Link>
        }
      >
        Transactions
      </SectionTitle>
      <Card className="px-2 py-0.5">
        {d.recs.length === 0 && (
          <div className="py-6 text-center text-muted-foreground text-sm">
            No transactions on this account yet.
          </div>
        )}
        {d.recs.slice(0, 12).map((r) => (
          <RecordRow
            key={r.id}
            r={r}
            cats={cats}
            accts={accts}
            href={`/finance/records/${r.id}`}
          />
        ))}
      </Card>

      {imports.length > 0 && (
        <>
          <SectionTitle>Imports</SectionTitle>
          <Card className="px-3 py-1">
            {imports.map((i) => (
              <Row
                key={i.id}
                href={
                  i.status === "review"
                    ? `/finance/import/${i.id}`
                    : "/finance/imports"
                }
                title={i.fileName}
                subtitle={`${shortDate(i.from)} – ${shortDate(i.to)}`}
                right={
                  <Pill
                    tone={
                      i.status === "done"
                        ? "good"
                        : i.status === "failed"
                          ? "bad"
                          : "warn"
                    }
                  >
                    {i.status}
                  </Pill>
                }
              />
            ))}
          </Card>
        </>
      )}
    </Screen>
  )
}
