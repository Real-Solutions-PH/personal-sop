// The Net worth report's charts beyond the daily line: how much it moved
// each month, what it is made of today, and where what is scheduled takes
// it next. Each reads the same accounts the line does (in net worth, not
// archived).
import * as C from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import { useMemo } from "react"
import { View } from "react-native"
import { FinanceLineChart } from "../chart"
import { GrowBar } from "../motion"
import { border, Copy, Frame, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { useMoney } from "./finance"

const signed = (money: (n: number) => string, v: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${money(Math.abs(v))}`

/** Net worth at the end of each of the last ``n`` budget months (the
 * current one up to today), and the change each month made. */
export function monthlyNetWorth(s: FinState, n = 6, today = C.today()) {
  const sd = s.settings.monthStartDay,
    now = C.monthOf(today, sd),
    keys = Array.from({ length: n }, (_, i) => C.addMonths(now, i - (n - 1))),
    first = C.monthRange(keys[0], sd)[0],
    // One value per day from the day before the first month to today.
    days = C.diffDays(today, first) + 2,
    series = C.netWorthSeries(s, days),
    at = (day: string) =>
      series[Math.min(series.length - 1, C.diffDays(day, first) + 1)] ?? 0,
    startValue = series[0] ?? 0
  let prev = startValue
  return keys.map((key) => {
    const end = C.monthRange(key, sd)[1],
      value = at(end < today ? end : today),
      change = value - prev
    prev = value
    return { key, value, change, current: key === now }
  })
}

/** Diverging bars: one row per month, gains right of the line in green,
 * losses left in red, the amount at the end. */
export function NetWorthByMonth({ s }: { s: FinState }) {
  const t = useTheme(),
    money = useMoney(),
    months = useMemo(() => monthlyNetWorth(s), [s]),
    max = Math.max(1, ...months.map((m) => Math.abs(m.change))),
    avg = months.reduce((a, m) => a + m.change, 0) / months.length
  return (
    <Frame testID="networth-by-month" style={{ padding: 16, gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Copy size={14} weight="medium">
          Change each month
        </Copy>
        <Copy
          size={12}
          weight="medium"
          style={{ color: avg > 0 ? t.good : avg < 0 ? t.bad : t.muted }}
        >
          {signed(money, avg)} a month on average
        </Copy>
      </View>
      {months.map((m, i) => {
        const w = `${(Math.abs(m.change) / max) * 100}%` as const,
          color = m.change >= 0 ? t.good : t.bad
        return (
          <View
            key={m.key}
            accessible
            accessibilityLabel={`${C.monthLabel(m.key, true)}${m.current ? " so far" : ""}: ${signed(money, m.change)}, ending on ${money(m.value)}`}
            style={{ gap: 4 }}
          >
            <Line style={{ justifyContent: "space-between", gap: 8 }}>
              <Copy size={12} muted={!m.current} weight="medium">
                {C.monthLabel(m.key)}
                {m.current ? " so far" : ""}
              </Copy>
              <Copy size={12} weight="semibold" style={{ color }}>
                {signed(money, m.change)}
              </Copy>
            </Line>
            <Line style={{ gap: 0, height: 10 }}>
              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  justifyContent: "flex-end",
                }}
              >
                {m.change < 0 && (
                  <View style={{ width: w, height: 10 }}>
                    <GrowBar
                      index={i}
                      height={10}
                      style={{
                        backgroundColor: color,
                        borderTopLeftRadius: 4,
                        borderBottomLeftRadius: 4,
                      }}
                    />
                  </View>
                )}
              </View>
              <View style={{ width: 1, height: 14, backgroundColor: t.line }} />
              <View style={{ flex: 1, flexDirection: "row" }}>
                {m.change > 0 && (
                  <View style={{ width: w, height: 10 }}>
                    <GrowBar
                      index={i}
                      height={10}
                      style={{
                        backgroundColor: color,
                        borderTopRightRadius: 4,
                        borderBottomRightRadius: 4,
                      }}
                    />
                  </View>
                )}
              </View>
            </Line>
          </View>
        )
      })}
    </Frame>
  )
}

const TYPE_LABEL: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  ewallet: "E-wallet",
  credit: "Credit card",
  investment: "Investment",
}

/** Today's net worth account by account: what each holds (or owes) as a
 * bar against the largest, owed in red. A row opens its account. */
export function NetWorthMakeup({ s }: { s: FinState }) {
  const t = useTheme(),
    money = useMoney(),
    bal = C.balances(s),
    rows = s.accounts
      .filter((a) => a.inNetWorth && !a.archived)
      .map((a) => ({ a, v: bal[a.id] ?? 0 }))
      .filter((r) => r.v !== 0)
      .sort((x, y) => Math.abs(y.v) - Math.abs(x.v)),
    max = Math.max(1, ...rows.map((r) => Math.abs(r.v))),
    own = rows.filter((r) => r.v > 0).reduce((a, r) => a + r.v, 0),
    owe = rows.filter((r) => r.v < 0).reduce((a, r) => a - r.v, 0)
  if (!rows.length) return null
  return (
    <Frame testID="networth-makeup" style={{ padding: 16, gap: 4 }}>
      <Copy size={14} weight="medium">
        What it's made of
      </Copy>
      <Copy size={12} muted style={{ marginBottom: 6 }}>
        You own{" "}
        <Copy size={12} weight="semibold">
          {money(own)}
        </Copy>
        {owe > 0 ? (
          <>
            {" · you owe "}
            <Copy size={12} weight="semibold" style={{ color: t.bad }}>
              {money(owe)}
            </Copy>
          </>
        ) : null}
      </Copy>
      {rows.map(({ a, v }, i) => (
        <Tap
          key={a.id}
          label={`${a.name}: ${v < 0 ? "owes " : ""}${money(Math.abs(v))}. Open the account`}
          onPress={() => go(`/finance/accounts/${a.id}`)}
          style={{
            paddingVertical: 8,
            gap: 6,
            borderTopWidth: i ? 1 : 0,
            borderColor: border(t.line, 0.4),
          }}
        >
          <Line style={{ justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Copy size={14} weight="medium">
                {a.name}
              </Copy>
              <Copy size={12} muted>
                {TYPE_LABEL[a.type] ?? a.type}
                {v > 0 && own > 0 ? ` · ${C.pct(v / own)} of what you own` : ""}
              </Copy>
            </View>
            <Copy
              size={14}
              weight="semibold"
              style={{ color: v < 0 ? t.bad : t.text }}
            >
              {v < 0 ? "−" : ""}
              {money(Math.abs(v))}
            </Copy>
          </Line>
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: border(t.line, 0.5),
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${(Math.abs(v) / max) * 100}%`,
                height: 6,
                borderRadius: 3,
                backgroundColor: v < 0 ? t.bad : t.fin,
              }}
            />
          </View>
        </Tap>
      ))}
    </Frame>
  )
}

/** Net worth today carried forward month by month by what the Projection
 * expects: scheduled income and bills, and everyday spending when the
 * Projection includes it. */
export function NetWorthAhead({ s }: { s: FinState }) {
  const t = useTheme(),
    money = useMoney(),
    proj = useMemo(
      () =>
        C.project(s, {
          horizon: 6,
          includeUnplanned: s.settings.includeUnplanned,
          excludedPlanned: s.settings.projExcludedPlanned,
        }),
      [s],
    ),
    now = C.netWorth(s),
    values = [now, ...proj.months.map((m) => now + (m.endBase - proj.start))],
    last = values.at(-1) ?? now,
    diff = last - now
  if (!proj.hasIncome) return null
  return (
    <Tap
      label="Where it's heading. Open the projection"
      onPress={() => go("/finance/projection")}
    >
      <Frame testID="networth-ahead" style={{ padding: 16, gap: 6 }}>
        <Copy size={14} weight="medium">
          Where it's heading
        </Copy>
        <Line style={{ alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <Copy size={22} weight="displayMedium">
            {money(last)}
          </Copy>
          <Copy
            size={12}
            weight="semibold"
            style={{ color: diff >= 0 ? t.good : t.bad }}
          >
            {signed(money, diff)} by{" "}
            {C.monthLabel(proj.months.at(-1)?.key ?? "", true)}
          </Copy>
        </Line>
        <FinanceLineChart
          height={150}
          zero={values.some((v) => v < 0)}
          labels={["Now", ...proj.months.map((m) => C.monthLabel(m.key))]}
          series={[{ values, color: t.fin, area: true, dashed: true }]}
        />
        <Copy size={12} muted>
          From what's scheduled
          {s.settings.includeUnplanned
            ? ` and your everyday average of ${money(proj.avgUnplanned)} a month`
            : ""}
          . Tap for the full projection.
        </Copy>
      </Frame>
    </Tap>
  )
}
