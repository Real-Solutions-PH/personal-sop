"use client"
import {
  type Period as AnyPeriod,
  reportData,
} from "../../../../../shared/prototype/finance/reports"

export { periodRange } from "../../../../../shared/prototype/finance/reports"

import { ChevronRight, Share2 } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { type ReactNode, useMemo } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Bars,
  Btn,
  Card,
  Empty,
  Money,
  Screen,
  Segmented,
  Sparkline,
  Stat,
} from "../../ui/kit"
import {
  addDays,
  monthLabel,
  pct,
  savingsRate,
  shortDate,
  today,
} from "../calc"
import { useFin } from "../store"
import { Donut, LineChart, PALETTE, PairBars, Pill, useDemoState } from "../ui"

// The web reports offer the fixed periods only; custom ranges are mobile's.
type Period = Exclude<AnyPeriod, object>
function usePeriod(): [Period, (p: Period) => void] {
  const sp = useSearchParams()
  const router = useRouter()
  const p = (sp.get("period") as Period) || "this"
  return [p, (v) => router.replace(`?period=${v}`, { scroll: false })]
}

const PERIODS = [
  { value: "this" as const, label: "This month" },
  { value: "last" as const, label: "Last month" },
  { value: "3m" as const, label: "3 months" },
]

const delta = (a: number, b: number) =>
  b ? Math.round(((a - b) / b) * 100) : 0
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// ------------------------------------------------------------------ FIN-30

export function ReportsHub() {
  const s = useFin()
  const demo = useDemoState()
  const [p, setP] = usePeriod()
  const d = useMemo(() => reportData(s, p), [s, p])
  const q = `?period=${p}`
  if (demo === "empty" || s.records.length === 0)
    return (
      <Screen title="Reports" back>
        <Empty
          title="Nothing to report yet"
          body="Reports fill in after a couple of weeks of logging."
        />
      </Screen>
    )
  return (
    <Screen
      title="Reports"
      back
      actions={
        <button
          type="button"
          aria-label="Share card"
          onClick={() =>
            toast("Share card sent to M6 — percentages only, never ₱")
          }
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Share2 className="size-5" />
        </button>
      }
    >
      <Segmented value={p} onChange={setP} options={PERIODS} />
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Card className="p-3">
          <Stat label="Income" value={<Money value={d.flow.income} />} />
        </Card>
        <Card className="p-3">
          <Stat
            label="Spent"
            value={<Money value={d.flow.spend} />}
            delta={delta(d.flow.spend, d.prev.spend)}
            goodWhen="down"
          />
        </Card>
        <Card className="p-3">
          <Stat
            label="Savings rate"
            value={pct(savingsRate(d.flow))}
            accent="fin"
          />
        </Card>
      </div>

      <ReportCard
        title="Spend by category"
        href={`/finance/reports/category${q}`}
      >
        <div className="flex items-center gap-4">
          <Donut values={d.byCat.map((x) => x[1])} size={112}>
            <div className="text-[10px] text-muted-foreground">top</div>
          </Donut>
          <div className="min-w-0 flex-1 space-y-1.5">
            {d.byCat.slice(0, 5).map(([id, v], i) => (
              <div key={id} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    PALETTE[i % PALETTE.length].bg,
                  )}
                />
                <span className="flex-1 truncate">
                  {d.cats.get(id)?.name ?? "Other"}
                </span>
                <span className="num text-muted-foreground">
                  {Math.round((v / d.flow.spend) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </ReportCard>

      <ReportCard
        title="Income vs expense"
        href={`/finance/reports/cashflow${q}`}
      >
        <PairBars
          pairs={d.months.map((m) => [m.income, m.spend])}
          labels={d.months.map((m) => monthLabel(m.key))}
        />
      </ReportCard>

      <ReportCard
        title="Cash flow trend"
        href={`/finance/reports/cashflow${q}`}
      >
        <Sparkline data={d.daily} accent="fin" height={56} />
        <div className="mt-1 text-muted-foreground text-xs">
          Running total over {d.r.label.toLowerCase()}
        </div>
      </ReportCard>

      <ReportCard
        title="Net worth trend"
        href={`/finance/reports/networth${q}`}
      >
        <Sparkline data={d.nw} accent="life" height={56} />
      </ReportCard>

      <ReportCard title="Top payees" href={`/finance/reports/payees${q}`}>
        {d.payees.slice(0, 4).map(([name, v]) => (
          <div key={name} className="flex justify-between py-1 text-sm">
            <span>{name}</span>
            <Money value={v} />
          </div>
        ))}
      </ReportCard>

      <ReportCard title="Budget history" href="/finance/budgets">
        <div className="space-y-2">
          {d.budgets.map(({ b, hist }) => (
            <div key={b.id} className="flex items-center gap-2 text-xs">
              <span className="w-28 truncate">{b.name}</span>
              {hist.map((h) => (
                <span
                  key={h.from}
                  className={cn(
                    "flex-1 rounded-md py-1 text-center",
                    h.spent === 0
                      ? "bg-muted"
                      : h.pct > 1
                        ? "bg-bad/20 text-bad"
                        : "bg-good/15 text-good",
                  )}
                >
                  {monthLabel(h.from.slice(0, 7))}{" "}
                  {h.spent ? `${Math.round(h.pct * 100)}%` : "—"}
                </span>
              ))}
            </div>
          ))}
        </div>
      </ReportCard>

      <ReportCard
        title="Day-of-week spend"
        href={`/finance/reports/weekday${q}`}
      >
        <Bars
          data={d.weekdayAvg}
          labels={WD}
          accent="fin"
          highlightLast={false}
          height={64}
        />
      </ReportCard>

      <Btn
        variant="secondary"
        className="mt-4 w-full"
        href={`/finance/review?from=${d.r.from}&to=${d.r.to}`}
      >
        Review {d.r.label.toLowerCase()}
      </Btn>
    </Screen>
  )
}

function ReportCard({
  title,
  href,
  children,
}: {
  title: string
  href: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className="mt-3 block rounded-2xl border border-border/60 bg-card p-4 active:bg-muted/60"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-medium text-sm">{title}</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </div>
      {children}
    </Link>
  )
}

// ------------------------------------------------------------------ FIN-31

const TITLES: Record<string, string> = {
  category: "Spend by category",
  cashflow: "Cash flow",
  networth: "Net worth",
  payees: "Top payees",
  weekday: "Day-of-week spend",
}

export function ReportDetail() {
  const { kind } = useParams<{ kind: string }>()
  const s = useFin()
  const [p, setP] = usePeriod()
  const d = useMemo(() => reportData(s, p), [s, p])
  const prevCats = useMemo(() => {
    const m = new Map<string, number>()
    for (const [k, v] of d.prev.byCat) m.set(k, v)
    return m
  }, [d])
  const recHref = (extra: string) =>
    `/finance/records?from=${d.r.from}&to=${d.r.to}${extra}`
  if (!TITLES[kind])
    return (
      <Screen title="Report" back="/finance/reports">
        <Empty
          title="Unknown report"
          action={<Btn href="/finance/reports">All reports</Btn>}
        />
      </Screen>
    )
  return (
    <Screen
      title={TITLES[kind]}
      back
      actions={
        <button
          type="button"
          aria-label="Share"
          onClick={() => toast("Share card sent to M6 — percentages only")}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Share2 className="size-5" />
        </button>
      }
    >
      <Segmented value={p} onChange={setP} options={PERIODS} />
      <div className="mt-2 px-1 text-muted-foreground text-xs">
        {shortDate(d.r.from)} – {shortDate(d.r.to)} vs {shortDate(d.r.prevFrom)}{" "}
        – {shortDate(d.r.prevTo)}
      </div>

      {kind === "category" && (
        <>
          <Card className="mt-3 flex flex-col items-center">
            <Donut values={d.byCat.map((x) => x[1])} size={180}>
              <div>
                <Money value={d.flow.spend} className="font-semibold text-lg" />
                <div className="text-[10px] text-muted-foreground">spent</div>
              </div>
            </Donut>
          </Card>
          <Card className="mt-3 px-3 py-1">
            {d.byCat.map(([id, v], i) => {
              const prev = prevCats.get(id) ?? 0
              const dl = delta(v, prev)
              return (
                <Link
                  key={id}
                  href={recHref(`&cat=${id}`)}
                  className="flex items-center gap-3 py-2.5"
                >
                  <span
                    className={cn(
                      "size-3 rounded-full",
                      PALETTE[i % PALETTE.length].bg,
                    )}
                  />
                  <span className="flex-1 text-sm">
                    {d.cats.get(id)?.icon} {d.cats.get(id)?.name ?? "Other"}
                    <span className="block text-muted-foreground text-xs">
                      {Math.round((v / d.flow.spend) * 100)}% of spend
                    </span>
                  </span>
                  <span className="text-right">
                    <Money value={v} className="font-medium text-sm" />
                    {prev > 0 && (
                      <span
                        className={cn(
                          "num block text-[11px]",
                          dl > 0 ? "text-bad" : "text-good",
                        )}
                      >
                        {dl > 0 ? "▲" : "▼"}
                        {Math.abs(dl)}%
                      </span>
                    )}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              )
            })}
          </Card>
        </>
      )}

      {kind === "cashflow" && (
        <>
          <Card className="mt-3 px-2">
            <LineChart
              series={[{ values: d.daily, tone: "fin", area: true }]}
              labels={Array.from({ length: d.days }, (_, i) =>
                i % 7 === 0 ? shortDate(addDays(d.r.from, i)) : "",
              )}
              zero
            />
          </Card>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Card className="p-3">
              <Stat
                label="In"
                value={<Money value={d.flow.income} />}
                delta={delta(d.flow.income, d.prev.income)}
              />
            </Card>
            <Card className="p-3">
              <Stat
                label="Out"
                value={<Money value={d.flow.spend} />}
                delta={delta(d.flow.spend, d.prev.spend)}
                goodWhen="down"
              />
            </Card>
            <Card className="p-3">
              <Stat
                label="Net"
                value={<Money value={d.flow.income - d.flow.spend} />}
              />
            </Card>
          </div>
          <Card className="mt-3 p-0">
            <table className="num w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-border/60 border-b">
                  <th className="px-3 py-2 text-left font-medium">Month</th>
                  <th className="px-2 py-2 text-right font-medium">In</th>
                  <th className="px-2 py-2 text-right font-medium">Out</th>
                  <th className="px-3 py-2 text-right font-medium">Saved</th>
                </tr>
              </thead>
              <tbody>
                {d.months.map((m) => (
                  <tr
                    key={m.key}
                    className="border-border/40 border-b last:border-0"
                  >
                    <td className="px-3 py-2">{monthLabel(m.key)}</td>
                    <td className="px-2 py-2 text-right">
                      <Money value={m.income} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Money value={m.spend} />
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right",
                        m.income - m.spend < 0 ? "text-bad" : "text-good",
                      )}
                    >
                      {m.income ? pct((m.income - m.spend) / m.income) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {kind === "networth" && (
        <Card className="mt-3 px-2">
          <LineChart
            series={[{ values: d.nw, tone: "fin", area: true }]}
            labels={Array.from({ length: 90 }, (_, i) =>
              i % 15 === 0 ? shortDate(addDays(today(), i - 89)) : "",
            )}
          />
          <div className="px-2 pb-2 text-muted-foreground text-xs">
            Assets minus credit card debt. Investments at their last manual
            value.{" "}
            <Pill tone={d.nw[89] >= d.nw[0] ? "good" : "bad"}>
              {pct((d.nw[89] - d.nw[0]) / Math.abs(d.nw[0] || 1), 1)} in 90 days
            </Pill>
          </div>
        </Card>
      )}

      {kind === "payees" && (
        <Card className="mt-3 px-3 py-1">
          {d.payees.map(([name, v], i) => (
            <Link
              key={name}
              href={recHref(`&q=${encodeURIComponent(name)}`)}
              className="flex items-center gap-3 py-2.5 text-sm"
            >
              <span className="num w-5 text-muted-foreground">{i + 1}</span>
              <span className="flex-1">{name}</span>
              <Money value={v} className="font-medium" />
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </Card>
      )}

      {kind === "weekday" && (
        <Card className="mt-3">
          <Bars
            data={d.weekdayAvg}
            labels={WD}
            accent="fin"
            highlightLast={false}
            height={140}
          />
          <div className="mt-3 space-y-1 text-sm">
            {d.weekdayAvg.map((v, i) => (
              <div key={WD[i]} className="flex justify-between">
                <span>{WD[i]}</span>
                <span className="text-muted-foreground">
                  avg <Money value={v} />
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 text-muted-foreground text-xs">
            {WD[d.weekdayAvg.indexOf(Math.max(...d.weekdayAvg))]} is your
            priciest day — usually groceries and eating out.
          </div>
        </Card>
      )}
      <div className="mt-3 text-center text-muted-foreground text-xs">
        <Link href={recHref("")} className="text-fin">
          Open these transactions
        </Link>
      </div>
    </Screen>
  )
}
