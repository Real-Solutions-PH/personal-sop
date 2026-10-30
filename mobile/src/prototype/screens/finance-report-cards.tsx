// The report cards the Finance home and the Reports screen share: savings
// rate, spend by category, net worth against what repeats, budget history,
// top payees and day-of-week spend. Each takes the period's report data; a
// card with nothing to show renders its real layout dimmed with one hint.
import * as C from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import { expectedTrend } from "@domain/finance/forecast"
import { isCustom, type Period, type reportData } from "@domain/finance/reports"
import { ChevronRight } from "lucide-react-native"
import type { ReactNode } from "react"
import { useWindowDimensions, View } from "react-native"
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

export type ReportData = ReturnType<typeof reportData>
type CardProps = { d: ReportData; period: Period }

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DIM = 0.32
const delta = (a: number, b: number) =>
  b ? Math.round(((a - b) / b) * 100) : 0

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
  href: string
  children: ReactNode
  /** When set, the body is dimmed and this hint shows under it. */
  empty?: string
}) {
  const t = useTheme()
  return (
    <Tap onPress={() => go(href)} label={title}>
      <Frame style={{ padding: 16 }}>
        <Line style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <Copy size={14} weight="medium">
            {title}
          </Copy>
          <ChevronRight size={16} color={t.muted} />
        </Line>
        <View style={{ opacity: empty ? DIM : 1 }}>{children}</View>
        {empty && (
          <Copy size={12} muted style={{ marginTop: 8 }}>
            {empty}
          </Copy>
        )}
      </Frame>
    </Tap>
  )
}

/** Income, spent (against the period before) and the share kept. */
export function SavingsRateCard({
  d,
  href = "/finance/reports",
}: CardProps & { href?: string }) {
  const t = useTheme()
  const money = useMoney()
  const narrow = useWindowDimensions().width < 380
  const items = [
    { label: "Income", value: money(d.flow.income) },
    {
      label: "Spent",
      value: money(d.flow.spend),
      delta: delta(d.flow.spend, d.prev.spend),
    },
    {
      label: "Savings rate",
      value: C.pct(C.savingsRate(d.flow)),
      color: t.fin,
    },
  ]
  return (
    <Tap onPress={() => go(href)} label="Savings rate">
      <Line style={{ gap: 8, alignItems: "stretch" }}>
        {items.map((x) => (
          <Frame key={x.label} style={{ padding: 12, flex: 1 }}>
            <Copy
              size={narrow ? 22 : 30}
              weight="displayMedium"
              lines={1}
              style={{ color: x.color ?? t.text }}
            >
              {x.value}
            </Copy>
            <Copy size={12} muted lines={1}>
              {x.label}
              {!!x.delta && (
                <Copy size={12} style={{ color: x.delta > 0 ? t.bad : t.good }}>
                  {"  "}
                  {x.delta > 0 ? "▲" : "▼"}
                  {Math.abs(x.delta)}%
                </Copy>
              )}
            </Copy>
          </Frame>
        ))}
      </Line>
    </Tap>
  )
}

/** The spend donut with the top category's icon and share in the middle. */
export function CategoryCard({ d, period }: CardProps) {
  const t = useTheme()
  const spend = d.flow.spend
  const top = d.byCat[0]
  const topCat = top ? d.cats.get(top[0]) : undefined
  const share = (v: number) => (spend > 0 ? Math.round((v / spend) * 100) : 0)
  return (
    <ReportCard
      title="Spend by category"
      href={`/finance/reports/category${periodQuery(period)}`}
      empty={spend > 0 ? undefined : "Spending you log shows up here."}
    >
      <Line style={{ gap: 16 }}>
        <Donut values={d.byCat.map((x) => x[1])} size={112}>
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
          {d.byCat.slice(0, 5).map(([id, v], i) => (
            <Line key={id} style={{ gap: 8 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: t[FIN_PALETTE[i % 7]],
                }}
              />
              <Copy size={12} lines={1} style={{ flex: 1 }}>
                {d.cats.get(id)?.icon} {d.cats.get(id)?.name ?? "Other"}
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
}: CardProps & { s: FinState }) {
  const t = useTheme()
  const money = useMoney()
  const r = trendRange(s, d, period)
  const e = expectedTrend(s, r.from, r.to)
  const n = e.days.length
  const step = n > 35 ? Math.ceil((n - 1) / 4) : 7
  const labels = e.days.map((k, i) =>
    i === n - 1 || i % step === 0 ? C.shortDate(k) : "",
  )
  const last = e.actual.length - 1
  const gap =
    e.gapToday ?? (last >= 0 ? e.actual[last] - e.expected[last] : null)
  const when =
    e.gapToday !== null ? "today" : `by ${C.shortDate(e.days[last] ?? r.to)}`
  const caption = !e.hasRecurring
    ? "Add your salary and bills as scheduled items to see the expected line."
    : gap === null
      ? ""
      : `${money(Math.abs(gap))} ${gap >= 0 ? "above" : "below"} expected ${when}`
  return (
    <ReportCard
      title="Expected vs actual net worth"
      href={`/finance/reports/networth${periodQuery(period)}`}
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
  const rows = d.budgets.length
    ? d.budgets
    : [
        {
          b: { id: "sample", name: "Monthly spend" },
          hist: [0.6, 0.8, 0.5].map((pct, i) => ({
            from: C.addMonths(C.monthOf(C.today(), sd), i - 2),
            pct,
            spent: 1,
          })),
        },
      ]
  return (
    <ReportCard
      title="Budget history"
      href="/finance/budgets"
      empty={d.budgets.length ? undefined : "Set a monthly budget."}
    >
      <View style={{ gap: 16 }}>
        {rows.map(({ b, hist }) => (
          <Line key={b.id} style={{ gap: 12, alignItems: "flex-start" }}>
            <Copy size={12} lines={1} style={{ width: 112, paddingTop: 2 }}>
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
  const rows = d.payees.length
    ? d.payees.slice(0, 4)
    : ([
        ["Groceries", 3],
        ["Coffee", 2],
        ["Transport", 1],
      ] as [string, number][])
  const max = Math.max(1, ...rows.map((x) => x[1]))
  return (
    <ReportCard
      title="Top payees"
      href={`/finance/reports/payees${periodQuery(period)}`}
      empty={d.payees.length ? undefined : "Add payees to your records."}
    >
      <View style={{ gap: 10 }}>
        {rows.map(([name, v]) => (
          <View key={name} style={{ gap: 4 }}>
            <Line style={{ justifyContent: "space-between" }}>
              <Copy size={14} lines={1} style={{ flex: 1 }}>
                {name}
              </Copy>
              <Copy size={14}>{d.payees.length ? money(v) : ""}</Copy>
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
  const max = Math.max(...d.weekdayAvg)
  const top = d.weekdayAvg.indexOf(max)
  return (
    <ReportCard
      title="Day-of-week spend"
      href={`/finance/reports/weekday${periodQuery(period)}`}
      empty={max > 0 ? undefined : "Spending you log shows up here."}
    >
      <FinanceBars
        data={d.weekdayAvg}
        labels={WD}
        highlight={max > 0 ? top : undefined}
      />
      {max > 0 && (
        <Copy size={12} muted style={{ marginTop: 8 }}>
          {WD[top]} is your priciest day (avg {money(max)})
        </Copy>
      )}
    </ReportCard>
  )
}
