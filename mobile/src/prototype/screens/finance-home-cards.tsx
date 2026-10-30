// The Finance home's own sections: what is left of the budgets, this
// month's cash flow (what happened, what is still scheduled, and the money
// on hand to the month's end), and the savings projection.
import * as N from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import { PiggyBank } from "lucide-react-native"
import { Text, View } from "react-native"
import { FinanceLineChart, Sparkline } from "../chart"
import { ChartLegend, ExpectedBars } from "../finance-charts"
import { Bar, Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Ring } from "../visual"
import { useMoney } from "./finance"
import { RecurringNet } from "./finance-monthly-net"
import { OutlookRow } from "./finance-outlook"

const SHOWN = 3
const signed = (money: (v: number) => string, v: number) =>
  `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`

/** The month's budget headline (the overall budget, or the category
 * budgets added together when there is none) and the three fullest
 * category budgets. Dimmed only when there is no budget at all. */
export function BudgetsSection({ s }: { s: FinState }) {
  const t = useTheme()
  const money = useMoney()
  const sum = N.budgetSummary(s)
  const top = s.budgets
    .filter((b) => !b.archived && b.categoryIds !== null)
    .map((b) => N.budgetView(s, b))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, SHOWN)
  const left = sum?.left ?? 0
  const scope = !sum
    ? "Set a monthly budget"
    : sum.source === "overall"
      ? `Left of ${money(sum.limit)} this month`
      : `Left of ${money(sum.limit)} across ${sum.count} category ${sum.count === 1 ? "budget" : "budgets"}`
  const tiles = [
    {
      label: "Safe / day",
      value: money(sum?.safePerDay ?? 0),
      color: t.fin,
    },
    { label: "Spent", value: money(sum?.spent ?? 0), color: t.text },
  ]
  return (
    <View>
      <SectionHeading
        action={
          <Tap onPress={() => go("/finance/budgets")}>
            <Copy size={12} style={{ color: t.fin }}>
              All budgets
            </Copy>
          </Tap>
        }
      >
        Budgets
      </SectionHeading>
      <Frame style={{ padding: 16 }}>
        <Tap onPress={() => go("/finance/budgets")} label="Budgets">
          <View style={{ opacity: sum ? 1 : 0.32, gap: 16 }}>
            <Line style={{ gap: 16 }}>
              <Ring
                value={sum ? Math.max(0, 1 - sum.pct) : 0}
                size={84}
                strokeWidth={9}
                color={sum && sum.pct > sum.pace ? t.warn : t.fin}
              >
                <Copy size={18} weight="semibold">
                  {sum
                    ? `${Math.max(0, Math.round((1 - sum.pct) * 100))}%`
                    : "—"}
                </Copy>
                <Copy size={12} muted>
                  left
                </Copy>
              </Ring>
              <View style={{ flex: 1, gap: 2 }}>
                <Copy
                  size={28}
                  weight="display"
                  fit
                  style={{ color: left < 0 ? t.bad : t.text }}
                >
                  {left < 0 ? `−${money(-left)}` : money(left)}
                </Copy>
                <Copy size={12} muted>
                  {scope}
                </Copy>
                {sum && (
                  <Copy size={12} muted>
                    {sum.daysLeft === 1
                      ? "1 day left"
                      : `${sum.daysLeft} days left`}
                  </Copy>
                )}
              </View>
            </Line>
            <Line style={{ gap: 12, alignItems: "flex-start" }}>
              {tiles.map((m) => (
                <View key={m.label} style={{ flex: 1 }}>
                  <Copy
                    size={20}
                    weight="display"
                    fit
                    style={{ color: m.color }}
                  >
                    {m.value}
                  </Copy>
                  <Copy size={12} muted>
                    {m.label}
                  </Copy>
                </View>
              ))}
            </Line>
          </View>
          {top.length > 0 && (
            <View style={{ marginTop: 16, gap: 10 }}>
              {top.map((v) => (
                <View key={v.b.id}>
                  <Line
                    style={{
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <Copy size={12} style={{ flex: 1 }}>
                      {v.b.name} ·{" "}
                      {v.limit >= v.spent
                        ? `${money(v.limit - v.spent)} left`
                        : `${money(v.spent - v.limit)} over`}
                    </Copy>
                    <Copy
                      size={12}
                      style={{
                        color:
                          v.pct > 1 ? t.bad : v.pct > v.pace ? t.warn : t.muted,
                      }}
                    >
                      {Math.round(v.pct * 100)}%
                    </Copy>
                  </Line>
                  <Bar
                    value={v.pct}
                    color={v.pct > 1 ? t.bad : t.fin}
                    target={v.pace}
                  />
                </View>
              ))}
            </View>
          )}
        </Tap>
      </Frame>
    </View>
  )
}

/** This budget month in one card: the expected net at month end, in and out
 * so far against what is expected, the money on hand to month end, and
 * what is still scheduled. */
export function CashFlowSection({ s }: { s: FinState }) {
  const t = useTheme()
  const money = useMoney()
  const sd = s.settings.monthStartDay
  const mk = N.monthOf(N.today(), sd)
  const [mFrom, mTo] = N.monthRange(mk, sd)
  const flow = N.flowIn(s, mFrom, mTo)
  const sched = N.scheduledFlow(s, mTo)
  const expIn = flow.income + sched.income
  const expOut = flow.spend + sched.spend
  const expNet = expIn - expOut
  const o = N.outlook(s, mTo)
  const dip = o.low.value < 0
  return (
    <View>
      <SectionHeading
        action={
          <Tap onPress={() => go("/finance/planned")}>
            <Copy size={12} style={{ color: t.fin }}>
              Scheduled
            </Copy>
          </Tap>
        }
      >
        {`Cash flow, ${N.monthLabel(mk, true)}`}
      </SectionHeading>
      <Frame style={{ padding: 16, gap: 16 }}>
        <Tap
          onPress={() => go("/finance/reports/cashflow")}
          label={`Expected net by ${N.shortDate(mTo)}`}
        >
          <Copy size={12} muted>
            Expected net by {N.shortDate(mTo)}
          </Copy>
          <Copy
            size={30}
            weight="displayMedium"
            fit
            style={{ color: expNet >= 0 ? t.good : t.bad }}
          >
            {signed(money, expNet)}
          </Copy>
          <Copy size={12} muted>
            So far {signed(money, flow.income - flow.spend)}
          </Copy>
          <View style={{ marginTop: 12, gap: 8 }}>
            <ExpectedBars
              rows={[
                {
                  label: "In",
                  done: flow.income,
                  ahead: sched.income,
                  color: t.good,
                  value: `${money(flow.income)} of ${money(expIn)}`,
                },
                {
                  label: "Out",
                  done: flow.spend,
                  ahead: sched.spend,
                  color: t.bad,
                  value: `${money(flow.spend)} of ${money(expOut)}`,
                },
              ]}
            />
            <ChartLegend
              items={[
                { label: "So far", color: t.muted },
                { label: "Still scheduled", color: t.muted, dashed: true },
              ]}
            />
          </View>
        </Tap>
        <View
          style={{
            gap: 12,
            paddingTop: 16,
            borderTopWidth: 1,
            borderColor: t.line,
          }}
        >
          <View style={{ gap: 8 }}>
            {[
              { label: "To pay", value: o.toPay, color: t.bad, sign: "−" },
              {
                label: "Coming in",
                value: o.comingIn,
                color: t.good,
                sign: "+",
              },
              {
                label: `On hand by ${N.shortDate(mTo)}`,
                value: o.end,
                color: o.end < 0 ? t.bad : t.fin,
                sign: "",
              },
            ].map((m) => (
              <Line
                key={m.label}
                style={{
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                }}
              >
                <Copy size={14} muted style={{ flex: 1 }}>
                  {m.label}
                </Copy>
                <Copy size={18} weight="semibold" style={{ color: m.color }}>
                  {m.value && m.sign ? m.sign : ""}
                  {money(Math.abs(m.value))}
                </Copy>
              </Line>
            ))}
          </View>
          {o.days.length > 1 && (
            <FinanceLineChart
              height={96}
              zero={dip}
              labels={o.days.map((d, i) =>
                i === 0 || i === o.days.length - 1 ? N.shortDate(d.day) : "",
              )}
              series={[
                {
                  values: o.days.map((d) => d.balance),
                  color: t.fin,
                  area: true,
                },
              ]}
            />
          )}
          <Copy size={12} muted style={{ color: dip ? t.bad : t.muted }}>
            Lowest {money(o.low.value)} on {N.dayLabel(o.low.day)}
            {dip ? " (below zero)" : ""}
          </Copy>
        </View>
        {o.items.length > 0 && (
          <View>
            {o.items.slice(0, SHOWN).map((x) => (
              <OutlookRow key={`${x.item.id}-${x.orig}`} x={x} />
            ))}
            {o.items.length > SHOWN && (
              <Tap
                onPress={() => go("/finance/planned")}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Copy
                  size={14}
                  weight="medium"
                  style={{ color: t.fin, textAlign: "center" }}
                >
                  Show all {o.items.length}
                </Copy>
              </Tap>
            )}
          </View>
        )}
        <View style={{ marginTop: -12 }}>
          <RecurringNet s={s} />
        </View>
      </Frame>
    </View>
  )
}

/** Where the savings go over the projection's horizon. */
export function SavingsSection({ s }: { s: FinState }) {
  const t = useTheme()
  const money = useMoney()
  const proj = N.project(s, {
    horizon: s.settings.horizon,
    includeUnplanned: s.settings.includeUnplanned,
    excludedPlanned: s.settings.projExcludedPlanned,
  })
  const last = proj.months.at(-1)
  return (
    <Frame
      style={{
        padding: 16,
        marginTop: 12,
        borderColor: `${t.fin}4d`,
        backgroundColor: `${t.fin}0d`,
      }}
    >
      <Tap onPress={() => go("/finance/projection")}>
        <Line style={{ gap: 8 }}>
          <PiggyBank size={16} color={t.fin} />
          <Copy size={12} style={{ color: t.fin, flex: 1 }}>
            Savings projection
          </Copy>
          {proj.hasIncome && (
            <Copy size={14} weight="semibold" style={{ color: t.fin }}>
              Plan a purchase →
            </Copy>
          )}
        </Line>
        {proj.hasIncome ? (
          <>
            <View style={{ marginTop: 4 }}>
              <Copy size={24} weight="semibold" fit>
                {money(last?.end ?? proj.start)}
              </Copy>
              <Copy size={12} muted>
                by {last ? N.monthLabel(last.key, true) : ""} ·{" "}
                <Text style={{ color: proj.avgSurplus >= 0 ? t.good : t.bad }}>
                  {signed(money, proj.avgSurplus)} a month
                </Text>
              </Copy>
            </View>
            <View style={{ marginTop: 8 }}>
              <Sparkline
                values={[proj.start, ...proj.months.map((m) => m.end)]}
                color={t.fin}
                height={44}
                label="Savings projection"
              />
            </View>
          </>
        ) : (
          <Copy size={14} style={{ marginTop: 4 }}>
            Add your salary as a scheduled payment to unlock the forecast.
          </Copy>
        )}
      </Tap>
    </Frame>
  )
}
