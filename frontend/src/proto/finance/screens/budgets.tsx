"use client"

import { Pencil, Plus, Sparkles, Target } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useMemo } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Bar,
  Btn,
  Card,
  Empty,
  Money,
  Ring,
  Screen,
  SectionTitle,
  Stat,
} from "../../ui/kit"
import { addBudget } from "../actions"
import {
  acctMap,
  addDays,
  addMonths,
  avgSpend,
  type BudgetView,
  budgetView,
  catMap,
  diffDays,
  inScope,
  isFlow,
  monthLabel,
  monthOf,
  recDay,
  shortDate,
  today,
} from "../calc"
import { openSheet } from "../sheets"
import { useFin } from "../store"
import { LineChart, LoadingList, Pill, RecordRow, useDemoState } from "../ui"

function BudgetCard({ v }: { v: BudgetView }) {
  const over = v.pct > 1
  const ahead = !over && v.pct > v.pace + 0.05
  return (
    <Card href={`/finance/budgets/${v.b.id}`} className="mb-2">
      <div className="flex items-center justify-between">
        <div className="font-medium">{v.b.name}</div>
        {over ? (
          <Pill tone="bad">
            over by <Money value={v.spent - v.limit} />
          </Pill>
        ) : ahead ? (
          <Pill tone="warn">ahead of pace</Pill>
        ) : (
          <Pill tone="good">on track</Pill>
        )}
      </div>
      <div className="relative mt-3">
        <Bar value={v.pct} accent="fin" className="h-2.5" />
        <span
          className="absolute -top-1 h-4.5 w-0.5 rounded bg-foreground/70"
          style={{ left: `${v.pace * 100}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span className={cn("num", over && "text-bad")}>
          <Money value={v.spent} /> of <Money value={v.limit} />
        </span>
        <span className="text-muted-foreground">
          {v.daysLeft} days left · <Money value={v.safePerDay} />
          /day
        </span>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ FIN-16

export function BudgetsScreen() {
  const s = useFin()
  const demo = useDemoState()
  const views = useMemo(
    () => s.budgets.filter((b) => !b.archived).map((b) => budgetView(s, b)),
    [s],
  )
  const starter = useMemo(
    () =>
      [
        { name: "Food", ids: ["food"] },
        { name: "Transport", ids: ["transport"] },
        { name: "Fun & shopping", ids: ["shopping", "entertainment", "subs"] },
      ].map((x) => ({
        ...x,
        limit: Math.max(1000, Math.round(avgSpend(s, x.ids) / 500) * 500),
      })),
    [s],
  )
  const archived = s.budgets.filter((b) => b.archived).length
  const mk = monthOf(today(), s.settings.monthStartDay)
  const kept = views.filter((v) => v.pct <= 1).length
  const add = (
    <button
      type="button"
      aria-label="Add budget"
      onClick={() => openSheet({ kind: "budget" })}
      className="grid size-10 place-items-center rounded-full hover:bg-muted"
    >
      <Plus className="size-5" />
    </button>
  )
  if (demo === "loading")
    return (
      <Screen title="Budgets" back actions={add}>
        <LoadingList />
      </Screen>
    )
  if (demo === "empty" || views.length === 0)
    return (
      <Screen title="Budgets" back actions={add}>
        <Empty
          icon={<Target className="size-10" />}
          title="Set your first budget"
          body="Based on your last 3 months, here's a starter set:"
        />
        <Card className="-mt-6 space-y-2">
          {starter.map((x) => (
            <div key={x.name} className="flex justify-between text-sm">
              <span>{x.name}</span>
              <Money value={x.limit} className="font-medium" />
            </div>
          ))}
          <Btn
            accent="fin"
            className="mt-2 w-full"
            onClick={() => {
              for (const x of starter)
                addBudget({
                  name: x.name,
                  categoryIds: x.ids,
                  limit: x.limit,
                  rollover: false,
                })
              toast("3 budgets added")
            }}
          >
            <Sparkles className="size-4" /> Add these
          </Btn>
          <Btn
            variant="ghost"
            className="w-full"
            onClick={() => openSheet({ kind: "budget" })}
          >
            Make my own
          </Btn>
        </Card>
      </Screen>
    )
  const overall = views.filter((v) => v.b.categoryIds === null)
  const rest = views
    .filter((v) => v.b.categoryIds !== null)
    .sort((a, b) => b.pct - a.pct)
  return (
    <Screen title="Budgets" back actions={add}>
      <Card className="flex items-center justify-between">
        <Stat
          label={`${monthLabel(mk, true)} so far`}
          value={`${kept}/${views.length}`}
          accent="fin"
        />
        <div className="text-right text-muted-foreground text-xs">
          budgets within limit
          <br />
          Bar marker = where you should be today
        </div>
      </Card>
      <SectionTitle>Overall</SectionTitle>
      {overall.map((v) => (
        <BudgetCard key={v.b.id} v={v} />
      ))}
      <SectionTitle>By category</SectionTitle>
      {rest.map((v) => (
        <BudgetCard key={v.b.id} v={v} />
      ))}
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

// ------------------------------------------------------------------ FIN-17

export function BudgetDetail() {
  const { id } = useParams<{ id: string }>()
  const s = useFin()
  const b = s.budgets.find((x) => x.id === id)
  const d = useMemo(() => {
    if (!b) return null
    const v = budgetView(s, b)
    const cats = catMap(s)
    const t = today()
    const total = diffDays(v.to, v.from) + 1
    const byDay = new Map<string, number>()
    const recs = s.records
      .filter((r) => {
        const k = recDay(r)
        return (
          isFlow(r) &&
          k >= v.from &&
          k <= v.to &&
          (r.type === "expense" || r.isRefund) &&
          inScope(r.categoryId, b.categoryIds, cats)
        )
      })
      .reverse()
    for (const r of recs)
      byDay.set(
        recDay(r),
        (byDay.get(recDay(r)) ?? 0) +
          (r.type === "expense" ? r.amount : -r.amount),
      )
    const actual: number[] = []
    const ideal: number[] = []
    let cum = 0
    for (let i = 0; i < total; i++) {
      const k = addDays(v.from, i)
      ideal.push((b.limit * (i + 1)) / total)
      if (k <= t) {
        cum += byDay.get(k) ?? 0
        actual.push(cum)
      }
    }
    const mk = monthOf(t, s.settings.monthStartDay)
    const past = [1, 2, 3].map((i) => budgetView(s, b, addMonths(mk, -i)))
    const labels = Array.from({ length: total }, (_, i) =>
      i % 7 === 0 ? shortDate(addDays(v.from, i)) : "",
    )
    return { v, actual, ideal, past, recs, labels }
  }, [s, b])
  const cats = useMemo(() => catMap(s), [s])
  const accts = useMemo(() => acctMap(s), [s])
  if (!b || !d)
    return (
      <Screen title="Budget" back="/finance/budgets">
        <Empty
          title="Budget not found"
          action={<Btn href="/finance/budgets">All budgets</Btn>}
        />
      </Screen>
    )
  const { v } = d
  const scope = b.categoryIds
    ? b.categoryIds.map((x) => cats.get(x)?.name).join(", ")
    : "All spending"
  return (
    <Screen
      title={b.name}
      back
      actions={
        <button
          type="button"
          aria-label="Edit budget"
          onClick={() => openSheet({ kind: "budget", id: b.id })}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Pencil className="size-5" />
        </button>
      }
    >
      <div className="text-muted-foreground text-xs">{scope} · monthly</div>
      <Card className="mt-3 flex items-center gap-4">
        <Ring value={v.pct} size={96} stroke={10} accent="fin">
          <div>
            <div
              className={cn(
                "num font-semibold text-xl",
                v.pct > 1 && "text-bad",
              )}
            >
              {Math.round(v.pct * 100)}%
            </div>
            <div className="text-[10px] text-muted-foreground">used</div>
          </div>
        </Ring>
        <div className="grid flex-1 grid-cols-2 gap-3">
          <Stat label="Spent" value={<Money value={v.spent} />} />
          <Stat
            label="Left"
            value={<Money value={Math.max(0, v.limit - v.spent)} />}
          />
          <Stat
            label="Safe to spend / day"
            value={<Money value={v.safePerDay} />}
            accent="fin"
          />
          <Stat label="Days left" value={v.daysLeft} />
        </div>
      </Card>
      <SectionTitle>Pace</SectionTitle>
      <Card className="px-2 pb-1">
        <LineChart
          series={[
            { values: d.ideal, tone: "muted", dashed: true },
            {
              values: d.actual,
              tone: v.pct > v.pace ? "bad" : "fin",
              area: true,
            },
          ]}
          labels={d.labels}
          height={150}
          zero
        />
        <div className="px-2 pb-2 text-muted-foreground text-xs">
          Dashed = even pace to the limit.{" "}
          {v.pct > v.pace
            ? "You're ahead of pace — slow down to finish under."
            : "You're under pace. Nice."}
        </div>
      </Card>
      <SectionTitle>Past months</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {d.past.map((p) => (
          <Card key={p.from} className="p-3 text-center">
            <div className="text-muted-foreground text-xs">
              {monthLabel(p.from.slice(0, 7))}
            </div>
            <div
              className={cn(
                "num font-semibold",
                p.pct > 1 ? "text-bad" : "text-good",
              )}
            >
              {Math.round(p.pct * 100)}%
            </div>
            <div className="text-[11px]">
              {p.spent === 0 ? "no data" : p.pct > 1 ? "blown" : "kept"}
            </div>
          </Card>
        ))}
      </div>
      <SectionTitle
        action={
          <Link
            href={`/finance/records?${b.categoryIds?.[0] ? `cat=${b.categoryIds[0]}&` : ""}from=${v.from}&to=${v.to}`}
            className="text-fin text-xs"
          >
            View in transactions
          </Link>
        }
      >
        This month's transactions ({d.recs.length})
      </SectionTitle>
      <Card className="px-2 py-0.5">
        {d.recs.slice(0, 15).map((r) => (
          <RecordRow
            key={r.id}
            r={r}
            cats={cats}
            accts={accts}
            href={`/finance/records/${r.id}`}
          />
        ))}
        {d.recs.length === 0 && (
          <div className="py-6 text-center text-muted-foreground text-sm">
            Nothing spent here yet this month.
          </div>
        )}
      </Card>
    </Screen>
  )
}
