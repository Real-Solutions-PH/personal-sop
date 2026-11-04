// Money in and out per budget month, as vertical bars side by side, on the
// Cash flow page. The current month reads like the Finance home's cash flow
// card: what has happened solid, what is still scheduled dashed on top.
// Tapping a month shows its numbers under the chart.
import * as N from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import { useState } from "react"
import { View } from "react-native"
import { ChartLegend } from "../finance-charts"
import { GrowBar } from "../motion"
import { Copy, Frame, Line, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { useMoney } from "./finance"

export interface MonthFlow {
  /** The budget month, ``YYYY-MM``. */
  key: string
  income: number
  spend: number
  /** Still scheduled to month end; the current month only. */
  aheadIn: number
  aheadOut: number
  current: boolean
}

/** The last ``n`` budget months up to the current one, oldest first. */
export function monthlyFlow(
  s: FinState,
  n = 6,
  today = N.today(),
): MonthFlow[] {
  const sd = s.settings.monthStartDay,
    now = N.monthOf(today, sd)
  return Array.from({ length: n }, (_, i) => {
    const key = N.addMonths(now, i - (n - 1)),
      [from, to] = N.monthRange(key, sd),
      f = N.flowIn(s, from, to),
      current = key === now,
      ahead = current ? N.scheduledFlow(s, to) : { income: 0, spend: 0 }
    return {
      key,
      income: f.income,
      spend: f.spend,
      aheadIn: ahead.income,
      aheadOut: ahead.spend,
      current,
    }
  })
}

const H = 140

/** One bar: done solid at the base, still scheduled dashed above it. */
function Bar({
  done,
  ahead,
  max,
  color,
  index,
}: {
  done: number
  ahead: number
  max: number
  color: string
  index: number
}) {
  const t = useTheme(),
    total = Math.max(0, done) + Math.max(0, ahead),
    // A month with nothing still gets a sliver, so a zero reads as zero.
    h = total > 0 ? Math.max(3, (total / max) * H) : 2
  return (
    <GrowBar
      index={index}
      height={h}
      style={{ flex: 1, justifyContent: "flex-end" }}
    >
      {ahead > 0 && (
        <View
          style={{
            flex: ahead,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: color,
            backgroundColor: `${color}26`,
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
            borderBottomWidth: done > 0 ? 0 : 1,
          }}
        />
      )}
      <View
        style={{
          flex: total > 0 ? Math.max(0, done) : 1,
          backgroundColor: total > 0 ? color : t.line,
          borderTopLeftRadius: ahead > 0 ? 0 : 4,
          borderTopRightRadius: ahead > 0 ? 0 : 4,
        }}
      />
    </GrowBar>
  )
}

export function MonthlyFlowBars({ s }: { s: FinState }) {
  const t = useTheme(),
    money = useMoney(),
    months = monthlyFlow(s),
    [picked, setPicked] = useState(months[months.length - 1].key),
    m = months.find((x) => x.key === picked) ?? months[months.length - 1],
    max = Math.max(
      1,
      ...months.flatMap((x) => [x.income + x.aheadIn, x.spend + x.aheadOut]),
    ),
    inAll = m.income + m.aheadIn,
    outAll = m.spend + m.aheadOut,
    net = inAll - outAll,
    scheduled = m.aheadIn > 0 || m.aheadOut > 0
  return (
    <Frame testID="monthly-flow" style={{ padding: 16, gap: 12 }}>
      <Copy size={12} muted>
        In and out by month
      </Copy>
      <Line style={{ alignItems: "flex-end", gap: 4 }}>
        {months.map((x, i) => {
          const on = x.key === m.key
          return (
            <Tap
              key={x.key}
              label={`${N.monthLabel(x.key, true)}: in ${money(x.income + x.aheadIn)}, out ${money(x.spend + x.aheadOut)}${x.current ? ", including what is still scheduled" : ""}`}
              selected={on}
              onPress={() => setPicked(x.key)}
              style={{
                flex: 1,
                alignItems: "stretch",
                gap: 6,
                paddingTop: 8,
                paddingBottom: 6,
                paddingHorizontal: 4,
                borderRadius: 10,
                borderWidth: 1,
                // Selection by ink outline, never the area colour.
                borderColor: on ? t.text : "transparent",
              }}
            >
              <Line style={{ height: H, alignItems: "flex-end", gap: 3 }}>
                <Bar
                  done={x.income}
                  ahead={x.aheadIn}
                  max={max}
                  color={t.good}
                  index={i * 2}
                />
                <Bar
                  done={x.spend}
                  ahead={x.aheadOut}
                  max={max}
                  color={t.bad}
                  index={i * 2 + 1}
                />
              </Line>
              <Copy
                size={12}
                weight={on ? "semibold" : undefined}
                muted={!on}
                style={{ textAlign: "center" }}
              >
                {N.monthLabel(x.key)}
              </Copy>
            </Tap>
          )
        })}
      </Line>
      <ChartLegend
        items={[
          { label: "In", color: t.good },
          { label: "Out", color: t.bad },
          { label: "Still scheduled", color: t.muted, dashed: true },
        ]}
      />
      <View
        testID="monthly-flow-detail"
        style={{
          gap: 8,
          paddingTop: 12,
          borderTopWidth: 1,
          borderColor: t.line,
        }}
      >
        <Copy size={14} weight="semibold">
          {N.monthLabel(m.key, true)}
          {m.current
            ? scheduled
              ? " · with what's scheduled"
              : " · so far"
            : ""}
        </Copy>
        {[
          {
            label: "In",
            value: inAll,
            note: m.aheadIn > 0 ? `${money(m.income)} so far` : "",
            color: t.good,
          },
          {
            label: "Out",
            value: outAll,
            note: m.aheadOut > 0 ? `${money(m.spend)} so far` : "",
            color: t.bad,
          },
        ].map((r) => (
          <Line
            key={r.label}
            style={{ justifyContent: "space-between", alignItems: "baseline" }}
          >
            <Copy size={14} muted style={{ flex: 1 }}>
              {r.label}
              {r.note ? (
                <Copy size={12} muted>
                  {`  ${r.note}`}
                </Copy>
              ) : null}
            </Copy>
            <Copy size={18} weight="semibold" style={{ color: r.color }}>
              {money(r.value)}
            </Copy>
          </Line>
        ))}
        <Line
          style={{ justifyContent: "space-between", alignItems: "baseline" }}
        >
          <Copy size={14} muted style={{ flex: 1 }}>
            {m.current && scheduled ? "Expected net" : "Net"}
          </Copy>
          <Copy
            size={18}
            weight="semibold"
            style={{ color: net >= 0 ? t.good : t.bad }}
          >
            {net > 0 ? "+" : net < 0 ? "−" : ""}
            {money(Math.abs(net))}
          </Copy>
        </Line>
      </View>
    </Frame>
  )
}
