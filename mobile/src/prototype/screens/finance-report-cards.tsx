// The report cards the Finance home and the Reports screen share: savings
// rate, spend by category, net worth against what repeats, budget history,
// top payees and day-of-week spend. Each takes the period's report data; a
// card with nothing to show renders its real layout dimmed with one hint.
import * as C from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import { expectedTrend } from "@domain/finance/forecast"
import { isCustom, type Period, type reportData } from "@domain/finance/reports"
import { ChevronRight } from "lucide-react-native"
import { createContext, type ReactNode, useContext } from "react"
import { View } from "react-native"
import { FinanceLineChart } from "../chart"
import {
  BudgetColumns,
  ChartLegend,
  Donut,
  FIN_PALETTE,
  FinanceBars,
} from "../finance-charts"
import { Copy, Frame, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { useMoney } from "./finance"
import { EmptyFoot } from "./locked-preview"

export type ReportData = ReturnType<typeof reportData>
type CardProps = { d: ReportData; period: Period }

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
// What an empty card draws, dimmed: a plausible month for someone in Manila.
// Payees are places paid, never category names.
const SAMPLE_PAYEES: [string, number][] = [
  ["Puregold", 6480],
  ["Meralco", 3215],
  ["Grab", 1870],
  ["Starbucks", 940],
]
const SAMPLE_CATS = [
  { name: "Food", icon: "🍜", v: 38 },
  { name: "Bills", icon: "🧾", v: 24 },
  { name: "Transport", icon: "🚕", v: 16 },
  { name: "Shopping", icon: "🛍️", v: 13 },
  { name: "Fun", icon: "🎬", v: 9 },
]
const SAMPLE_WEEKDAY = [620, 310, 280, 340, 360, 890, 1040]
const DIM = 0.32
const delta = (a: number, b: number) =>
  b ? Math.round(((a - b) / b) * 100) : 0

/** The one step that fills a spending card: log a transaction. */
const LOG_SPEND = { label: "Add expense", href: "/finance?add=expense" }
/** True where the page already offers Add expense once (the Reports
 * overview, under its savings card), so each empty card below keeps only
 * its hint instead of repeating the same button. */
const SAMPLE_BUDGET_PCTS = [
  [0.7, 0.9, 0.4],
  [0.5, 1.1, 0.3],
  [0.8, 0.6, 0.5],
  [0.4, 0.7, 0.2],
]
export const SpendActionShown = createContext(false)

/** The query that carries a period to a report's detail screen. */
export const periodQuery = (p: Period) =>
  isCustom(p) ? `?from=${p.from}&to=${p.to}` : `?period=${p}`

export function ReportCard({
  title,
  href,
  children,
  empty,
}: {
  title: string
  /** Where the card opens; none on the page it would open, where it is
   * drawn as a plain card with no chevron. */
  href?: string
  children: ReactNode
  /** When set, the body (drawn from sample data) is dimmed, with why it
   * is empty and the one step that fills it under it. */
  empty?: { hint: string; action: { label: string; href: string } }
}) {
  const t = useTheme(),
    shown = useContext(SpendActionShown),
    action =
      shown && empty?.action.href === LOG_SPEND.href ? undefined : empty?.action
  const card = (
    <Frame style={{ padding: 16 }}>
      <Line style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <Copy size={14} weight="medium">
          {title}
        </Copy>
        {href && <ChevronRight size={16} color={t.muted} />}
      </Line>
      <View style={{ opacity: empty ? DIM : 1 }}>{children}</View>
      {empty && <EmptyFoot hint={empty.hint} action={action} />}
    </Frame>
  )
  return href ? (
    <Tap onPress={() => go(href)} label={title}>
      {card}
    </Tap>
  ) : (
    card
  )
}

/** Income, spent (against the period before) and the share kept. */
export function SavingsRateCard({
  d,
  href = "/finance/reports",
}: CardProps & { href?: string }) {
  const t = useTheme()
  const money = useMoney()
  // Nothing logged: a plausible month, dimmed, over the step that fills it.
  const none = !(d.flow.income > 0) && !(d.flow.spend > 0)
  const flow = none ? { ...d.flow, income: 45000, spend: 36900 } : d.flow
  const items = [
    { label: "Income", value: money(flow.income) },
    {
      label: "Spent",
      value: money(flow.spend),
      delta: none ? 0 : delta(d.flow.spend, d.prev.spend),
    },
  ]
  // Income and spent share a row, each shrinking to fit its half rather
  // than cutting a figure short; the savings rate gets a row of its own.
  return (
    <Tap onPress={() => go(href)} label="Savings rate">
      <View style={{ gap: 8, opacity: none ? DIM : 1 }}>
        <Line style={{ gap: 8, alignItems: "stretch" }}>
          {items.map((x) => (
            <Frame key={x.label} style={{ padding: 12, flex: 1 }}>
              <Copy size={24} weight="displayMedium" fit>
                {x.value}
              </Copy>
              <Copy size={12} muted>
                {x.label}
                {!!x.delta && (
                  <Copy
                    size={12}
                    style={{ color: x.delta > 0 ? t.bad : t.good }}
                  >
                    {"  "}
                    {x.delta > 0 ? "▲" : "▼"}
                    {Math.abs(x.delta)}%
                  </Copy>
                )}
              </Copy>
            </Frame>
          ))}
        </Line>
        <Frame style={{ padding: 12 }}>
          <Line style={{ justifyContent: "space-between", gap: 12 }}>
            <Copy size={14} muted style={{ flex: 1 }}>
              Savings rate
            </Copy>
            <Copy size={24} weight="displayMedium">
              {C.pct(C.savingsRate(flow))}
            </Copy>
          </Line>
        </Frame>
      </View>
      {none && (
        <EmptyFoot
          testID="savings-empty"
          hint="Log what comes in and goes out to see how much you keep."
          action={LOG_SPEND}
        />
      )}
    </Tap>
  )
}

/** The spend donut with the top category's icon and share in the middle. */
export function CategoryCard({ d, period }: CardProps) {
  const t = useTheme()
  const none = !(d.flow.spend > 0)
  // Empty, the card draws a plausible month (shares of 100) dimmed.
  const byCat: [string, number][] = none
    ? SAMPLE_CATS.map((c) => [c.name, c.v])
    : d.byCat
  const cats = none
    ? new Map(SAMPLE_CATS.map((c) => [c.name, { name: c.name, icon: c.icon }]))
    : d.cats
  const spend = none ? 100 : d.flow.spend
  const top = byCat[0]
  const topCat = top ? cats.get(top[0]) : undefined
  const share = (v: number) => (spend > 0 ? Math.round((v / spend) * 100) : 0)
  return (
    <ReportCard
      title="Spend by category"
      href={`/finance/reports/category${periodQuery(period)}`}
      empty={
        none
          ? { hint: "Your spending, split by category.", action: LOG_SPEND }
          : undefined
      }
    >
      <Line style={{ gap: 16 }}>
        <Donut values={byCat.map((x) => x[1])} size={112}>
          <View
            accessible
            accessibilityLabel={
              topCat
                ? `Most spent on ${topCat.name}, ${share(top?.[1] ?? 0)}%`
                : "No spending"
            }
            style={{ alignItems: "center" }}
          >
            <Copy size={28}>{topCat?.icon ?? "💸"}</Copy>
            <Copy size={12} muted>
              {share(top?.[1] ?? 0)}%
            </Copy>
          </View>
        </Donut>
        <View style={{ flex: 1, gap: 6 }}>
          {byCat.slice(0, 5).map(([id, v], i) => (
            <Line key={id} style={{ gap: 8 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: t[FIN_PALETTE[i % 7]],
                }}
              />
              <Copy size={12} style={{ flex: 1 }}>
                {cats.get(id)?.icon} {cats.get(id)?.name ?? "Other"}
              </Copy>
              <Copy size={12} muted>
                {share(v)}%
              </Copy>
            </Line>
          ))}
        </View>
      </Line>
    </ReportCard>
  )
}

/** The window the net worth chart covers: the whole budget month for
 * "this month", so the plan line runs past today; the period otherwise. */
export function trendRange(s: FinState, d: ReportData, period: Period) {
  if (period === "this") {
    const sd = s.settings.monthStartDay
    const [from, to] = C.monthRange(C.monthOf(C.today(), sd), sd)
    return { from, to }
  }
  return { from: d.r.from, to: isCustom(period) ? period.to : d.r.to }
}

/** Actual net worth against the line the repeating items alone draw. */
export function ExpectedNetWorthCard({
  d,
  period,
  s,
  linked = true,
}: CardProps & { s: FinState; linked?: boolean }) {
  const t = useTheme()
  const money = useMoney()
  const r = trendRange(s, d, period)
  const e = expectedTrend(s, r.from, r.to)
  const n = e.days.length
  const step = n > 35 ? Math.ceil((n - 1) / 4) : 7
  const labels = e.days.map((k, i) =>
    i === n - 1 || i % step === 0 ? C.shortDate(k) : "",
  )
  // No accounts, no balance to draw: a gently rising sample line, dimmed.
  const none = !s.accounts.length
  if (none) e.actual = e.actual.map((_, i) => 82000 + i * 260 + (i % 4) * 900)
  const last = e.actual.length - 1
  const gap =
    e.gapToday ?? (last >= 0 ? e.actual[last] - e.expected[last] : null)
  const when =
    e.gapToday !== null ? "today" : `by ${C.shortDate(e.days[last] ?? r.to)}`
  const caption = none
    ? ""
    : !e.hasRecurring
      ? "Add your salary and bills as scheduled items to see the expected line."
      : gap === null
        ? ""
        : `${money(Math.abs(gap))} ${gap >= 0 ? "above" : "below"} expected ${when}`
  return (
    <ReportCard
      title="Expected vs actual net worth"
      href={
        linked ? `/finance/reports/networth${periodQuery(period)}` : undefined
      }
      empty={
        none
          ? {
              hint: "Add your accounts to track what you own over time.",
              action: { label: "Set up", href: "/finance/setup" },
            }
          : undefined
      }
    >
      <View
        accessible
        accessibilityLabel={`Net worth against what repeats. ${caption}`}
      >
        <FinanceLineChart
          height={170}
          labels={labels}
          zero={[...e.actual, ...e.expected].some((v) => v < 0)}
          series={[
            ...(e.hasRecurring
              ? [{ values: e.expected, color: t.muted, dashed: true }]
              : []),
            { values: e.actual, color: t.fin, area: true },
          ]}
        />
      </View>
      <View style={{ gap: 6, marginTop: 6 }}>
        <ChartLegend
          items={[
            { label: "Actual", color: t.fin },
            ...(e.hasRecurring
              ? [
                  {
                    label: "Expected from what repeats",
                    color: t.muted,
                    dashed: true,
                  },
                ]
              : []),
          ]}
        />
        {!!caption && (
          <Copy
            size={12}
            style={{
              color:
                !e.hasRecurring || gap === null
                  ? t.muted
                  : gap >= 0
                    ? t.good
                    : t.bad,
            }}
          >
            {caption}
          </Copy>
        )}
      </View>
    </ReportCard>
  )
}

/** Each budget's last three months as columns against 100%. */
export function BudgetHistoryCard({ d, s }: CardProps & { s: FinState }) {
  const sd = s.settings.monthStartDay
  const sample = (pcts: number[]) =>
    pcts.map((pct, i) => ({
      from: C.addMonths(C.monthOf(C.today(), sd), i - 2),
      pct,
      spent: 1,
    }))
  // Budgets set but nothing spent yet: each budget keeps its name over
  // sample months, so the card shows what it will hold instead of dashes.
  const unspent =
    d.budgets.length > 0 &&
    d.budgets.every(({ hist }) => hist.every((h) => !h.spent))
  const rows = !d.budgets.length
    ? [
        {
          b: { id: "sample", name: "Monthly spend" },
          hist: sample([0.6, 0.8, 0.5]),
        },
      ]
    : unspent
      ? d.budgets.map(({ b }, i) => ({
          b,
          hist: sample(SAMPLE_BUDGET_PCTS[i % SAMPLE_BUDGET_PCTS.length]),
        }))
      : d.budgets
  return (
    <ReportCard
      title="Budget history"
      href="/finance/budgets"
      empty={
        !d.budgets.length
          ? {
              hint: "Set a monthly budget.",
              action: { label: "Set budget", href: "/finance/budgets?new=1" },
            }
          : unspent
            ? {
                hint: "How each budget went, month by month, once you spend.",
                action: LOG_SPEND,
              }
            : undefined
      }
    >
      <View style={{ gap: 16 }}>
        {rows.map(({ b, hist }) => (
          <Line key={b.id} style={{ gap: 12, alignItems: "flex-start" }}>
            <Copy size={12} style={{ width: 112, paddingTop: 2 }}>
              {b.name}
            </Copy>
            <BudgetColumns
              hist={hist.map((h) => ({
                label: C.monthLabel(
                  h.from.length > 7 ? C.monthOf(h.from, sd) : h.from,
                ),
                pct: h.pct,
                spent: h.spent,
              }))}
            />
          </Line>
        ))}
      </View>
    </ReportCard>
  )
}

/** The four biggest payees, each with a bar against the biggest. */
export function TopPayeesCard({ d, period }: CardProps) {
  const t = useTheme()
  const money = useMoney()
  const none = !d.payees.length
  // Empty, the card shows the kind of places people pay, with amounts.
  const rows = none ? SAMPLE_PAYEES : d.payees.slice(0, 4)
  const max = Math.max(1, ...rows.map((x) => x[1]))
  return (
    <ReportCard
      title="Top payees"
      href={`/finance/reports/payees${periodQuery(period)}`}
      empty={
        none
          ? {
              hint: "Where your money goes, by who you paid.",
              action: LOG_SPEND,
            }
          : undefined
      }
    >
      <View style={{ gap: 10 }}>
        {rows.map(([name, v]) => (
          <View key={name} style={{ gap: 4 }}>
            <Line
              style={{
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <Copy size={14} style={{ flex: 1 }}>
                {name}
              </Copy>
              <Copy size={14}>{money(v)}</Copy>
            </Line>
            <View
              style={{ height: 4, borderRadius: 2, backgroundColor: t.soft }}
            >
              <View
                style={{
                  width: `${(v / max) * 100}%`,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: t.fin,
                }}
              />
            </View>
          </View>
        ))}
      </View>
    </ReportCard>
  )
}

/** Average spend per weekday, the priciest day at full strength. */
export function WeekdayCard({ d, period }: CardProps) {
  const money = useMoney()
  const none = !(Math.max(0, ...d.weekdayAvg) > 0)
  const avg = none ? SAMPLE_WEEKDAY : d.weekdayAvg
  const max = Math.max(...avg)
  const top = avg.indexOf(max)
  return (
    <ReportCard
      title="Day-of-week spend"
      href={`/finance/reports/weekday${periodQuery(period)}`}
      empty={
        none
          ? { hint: "Which days you spend the most.", action: LOG_SPEND }
          : undefined
      }
    >
      <FinanceBars data={avg} labels={WD} highlight={top} />
      <Copy size={12} muted style={{ marginTop: 8 }}>
        {WD[top]} is your priciest day (avg {money(max)})
      </Copy>
    </ReportCard>
  )
}
