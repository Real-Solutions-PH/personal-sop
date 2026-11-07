// Money in and out per budget month, as vertical bars side by side, on the
// Cash flow page. The current month reads like the Finance home's cash flow
// card: what has happened solid, what is still scheduled dashed on top.
// Tapping a month shows its numbers under the chart; the arrows step a month
// at a time, up to a year ahead, where every bar is what is scheduled.
import * as N from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import { scheduledBetween } from "@domain/finance/forecast"
import { ChevronLeft, ChevronRight } from "lucide-react-native"
import { useMemo, useState } from "react"
import { View } from "react-native"
import { ChartLegend } from "../finance-charts"
import { GrowBar } from "../motion"
import { Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { useMoney } from "./finance"

export interface MonthFlow {
  /** The budget month, ``YYYY-MM``. */
  key: string
  income: number
  spend: number
  /** Still scheduled to month end: the current month's rest, and all of a
   * future month. */
  aheadIn: number
  aheadOut: number
  current: boolean
  future: boolean
}

/** How far ahead the chart steps. */
export const MONTHS_AHEAD = 12
/** How far back the arrows step (the six months first shown). */
export const MONTHS_BACK = 5

/** ``n`` budget months ending ``end`` months after the current one (0 = the
 * current month), oldest first. */
export function monthlyFlow(
  s: FinState,
  n = 6,
  today = N.today(),
  end = 0,
): MonthFlow[] {
  const sd = s.settings.monthStartDay,
    now = N.monthOf(today, sd)
  return Array.from({ length: n }, (_, i) => {
    const key = N.addMonths(now, end + i - (n - 1)),
      [from, to] = N.monthRange(key, sd),
      current = key === now,
      future = key > now,
      // A future month can hold records too (a bill paid ahead and dated on
      // its due day); paid occurrences leave the scheduled part, so nothing
      // counts twice.
      f = N.flowIn(s, from, to),
      ahead = current
        ? N.scheduledFlow(s, to)
        : future
          ? scheduledBetween(s, from, to)
          : { income: 0, spend: 0 }
    return {
      key,
      income: f.income,
      spend: f.spend,
      aheadIn: ahead.income,
      aheadOut: ahead.spend,
      current,
      future,
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
    // The picked month and the last of the six bars, each in months from
    // the current one. Stepping past either edge slides the bars along, so
    // the picked month always has its bar; tapping a bar leaves them put.
    [view, setView] = useState({ at: 0, end: 0 }),
    { at, end } = view,
    step = (d: number) => {
      const next = at + d
      setView({
        at: next,
        end: Math.min(Math.max(end, next), Math.max(0, next + 5)),
      })
    },
    months = useMemo(() => monthlyFlow(s, 6, N.today(), end), [s, end]),
    m = months[months.length - 1 + at - end],
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
      <Line style={{ justifyContent: "space-between" }}>
        <Copy size={12} muted style={{ flex: 1 }}>
          In and out by month
        </Copy>
        {/* Hidden at either end rather than shown doing nothing. */}
        <Line style={{ gap: 4, marginVertical: -10, marginRight: -10 }}>
          {at > -MONTHS_BACK && (
            <IconTap
              size={40}
              icon={ChevronLeft}
              label="Earlier month"
              color={t.text}
              onPress={() => step(-1)}
            />
          )}
          {at < MONTHS_AHEAD && (
            <IconTap
              size={40}
              icon={ChevronRight}
              label="Later month"
              color={t.text}
              onPress={() => step(1)}
            />
          )}
        </Line>
      </Line>
      <Line style={{ alignItems: "flex-end", gap: 4 }}>
        {months.map((x, i) => {
          const on = x.key === m.key
          return (
            <Tap
              key={x.key}
              label={`${N.monthLabel(x.key, true)}: in ${money(x.income + x.aheadIn)}, out ${money(x.spend + x.aheadOut)}${x.current ? ", including what is still scheduled" : x.future ? ", all scheduled" : ""}`}
              selected={on}
              onPress={() =>
                setView({ at: end - (months.length - 1) + i, end })
              }
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
          {m.future
            ? " · scheduled"
            : m.current
              ? scheduled
                ? " · with what's scheduled"
                : " · so far"
              : ""}
        </Copy>
        {[
          {
            label: "In",
            value: inAll,
            note: m.current && m.aheadIn > 0 ? `${money(m.income)} so far` : "",
            color: t.good,
          },
          {
            label: "Out",
            value: outAll,
            note: m.current && m.aheadOut > 0 ? `${money(m.spend)} so far` : "",
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
            {m.future || (m.current && scheduled) ? "Expected net" : "Net"}
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
