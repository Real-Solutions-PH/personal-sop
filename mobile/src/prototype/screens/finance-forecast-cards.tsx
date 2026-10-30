// The Finance home's two forward-looking sections. Cash flow merges this
// month so far with what is still scheduled, then forecasts the money on
// hand up to a picked date; Savings projection does the same over months.
import * as N from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import {
  type AheadPreset,
  dailyForecast,
  liquidSeries,
} from "@domain/finance/forecast"
import { dayKey } from "@domain/lib/day"
import { useState } from "react"
import { Text, View } from "react-native"
import { FinanceLineChart } from "../chart"
import { ChartLegend, ExpectedBars } from "../finance-charts"
import { Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { go } from "../navigation"
import { AheadPicker, useAhead } from "../range-picker"
import { fonts, useTheme } from "../theme"
import { useMoney } from "./finance"
import { RecurringNet } from "./finance-monthly-net"
import { FinPill } from "./finance-planned"

const SHOWN = 5
/** "today", "tomorrow" or "on Wed, Nov 4", to follow a value. */
const onDay = (k: string) => {
  const l = N.dayLabel(k)
  return l === "Today" || l === "Tomorrow" ? l.toLowerCase() : `on ${l}`
}
const signed = (money: (v: number) => string, v: number) =>
  `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`

/** Every ``step``-th point, always keeping the last. */
function every<T>(xs: T[], step: number): T[] {
  if (step <= 1) return xs
  return xs.filter((_, i) => i % step === 0 || i === xs.length - 1)
}
/** At most ``max`` evenly spaced points, always keeping the last. */
const thin = <T,>(xs: T[], max = 120) => every(xs, Math.ceil(xs.length / max))

export function CashFlowSection({ s }: { s: FinState }) {
  const t = useTheme()
  const money = useMoney()
  const [all, setAll] = useState(false)
  const today = dayKey()
  const sd = s.settings.monthStartDay
  const mk = N.monthOf(today, sd)
  const [mFrom, mTo] = N.monthRange(mk, sd)
  const ahead = useAhead(s, "month")
  // This month: what has happened, and what is still scheduled.
  const flow = N.flowIn(s, mFrom, mTo)
  const sched = N.scheduledFlow(s, mTo)
  const expIn = flow.income + sched.income
  const expOut = flow.spend + sched.spend
  const expNet = expIn - expOut
  // Up to the picked date: the money on hand day by day.
  const f = dailyForecast(s, ahead.to)
  const pastAll = liquidSeries(s, mFrom, today)
  // One step for both lines, so a day is as wide before today as after.
  const step = Math.ceil((pastAll.length + f.days.length) / 150)
  const past = every(pastAll, step)
  const future = every(f.days, step)
  const out = f.scheduledOut + f.everydayOut
  const dip = f.low.value < 0
  const items = all ? f.items : f.items.slice(0, SHOWN)
  const labels = [...past.map(() => ""), ...future.slice(1).map(() => "")]
  labels[0] = N.shortDate(mFrom)
  labels[past.length - 1] = "Today"
  labels[labels.length - 1] = N.shortDate(ahead.to)
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
        Cash flow
      </SectionHeading>
      <Frame style={{ padding: 16, gap: 16 }}>
        <Tap
          onPress={() => go("/finance/reports/cashflow")}
          label={`Expected net for ${N.monthLabel(mk, true)}`}
        >
          <View style={{ gap: 2 }}>
            <Copy size={12} muted>
              Expected net for {N.monthLabel(mk, true)}
            </Copy>
            <Copy
              size={30}
              weight="displayMedium"
              lines={1}
              style={{ color: expNet >= 0 ? t.text : t.bad }}
            >
              {signed(money, expNet)}
            </Copy>
            <Copy size={12} muted>
              So far {signed(money, flow.income - flow.spend)}
              {sched.income || sched.spend
                ? ` · ${signed(money, sched.income - sched.spend)} still scheduled`
                : ""}
            </Copy>
          </View>
          <View style={{ marginTop: 12, gap: 8 }}>
            <ExpectedBars
              rows={[
                {
                  label: "In",
                  done: flow.income,
                  ahead: sched.income,
                  color: t.good,
                  value: money(expIn),
                },
                {
                  label: "Out",
                  done: flow.spend,
                  ahead: sched.spend,
                  color: t.bad,
                  value: money(expOut),
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
          <RecurringNet s={s} />
        </Tap>
        <View
          style={{
            gap: 12,
            paddingTop: 16,
            borderTopWidth: 1,
            borderColor: t.line,
          }}
        >
          <AheadPicker
            value={ahead.sel}
            onChange={ahead.setSel}
            to={ahead.to}
            presets={["month", "3m", "6m", "1y"]}
          />
          <Line style={{ gap: 8, alignItems: "flex-start" }}>
            {[
              { label: "Coming in", value: `+${money(f.comingIn)}` },
              { label: "Going out", value: `−${money(out)}` },
              {
                label: `On hand by ${N.shortDate(ahead.to)}`,
                value: money(f.end),
                color: f.end < 0 ? t.bad : t.text,
              },
            ].map((m) => (
              <View key={m.label} style={{ flex: 1, gap: 2 }}>
                <Copy
                  size={18}
                  weight="semibold"
                  lines={1}
                  style={{ color: m.color ?? t.text }}
                >
                  {m.value}
                </Copy>
                <Copy size={12} muted lines={2}>
                  {m.label}
                </Copy>
              </View>
            ))}
          </Line>
          <View style={{ gap: 6 }}>
            <FinanceLineChart
              height={150}
              zero={dip}
              marker={past.length - 1}
              labels={labels}
              series={[
                { values: past, color: t.fin, area: true },
                {
                  values: future.map((d) => d.balance),
                  color: t.fin,
                  dashed: true,
                  offset: past.length - 1,
                },
              ]}
            />
            <ChartLegend
              items={[
                { label: "On hand", color: t.fin },
                { label: "Expected", color: t.fin, dashed: true },
              ]}
            />
            <Copy size={12} muted style={{ color: dip ? t.bad : t.muted }}>
              Lowest {money(f.low.value)} {onDay(f.low.day)}
              {dip ? " (below zero)" : ""}.
              {f.everydayOut > 0
                ? ` Going out includes ${money(f.everydayOut)} of everyday spending at your 3-month average.`
                : ""}
            </Copy>
          </View>
        </View>
        {f.items.length > 0 && (
          <View style={{ gap: 0 }}>
            <Copy size={12} muted>
              Coming up · {f.items.length}
            </Copy>
            {items.map((x) => (
              <Tap
                key={`${x.item.id}-${x.orig}`}
                onPress={() => go(`/finance/planned/${x.item.id}`)}
                style={{ minHeight: 48, justifyContent: "center" }}
              >
                <Line>
                  <Copy style={{ width: 24, textAlign: "center" }}>
                    {s.categories.find((c) => c.id === x.item.categoryId)
                      ?.icon ?? (x.item.type === "income" ? "＋" : "⇄")}
                  </Copy>
                  <View style={{ flex: 1 }}>
                    <Copy size={14} weight="medium" lines={1}>
                      {x.item.name}
                    </Copy>
                    <Line style={{ gap: 6 }}>
                      <Copy size={12} muted>
                        {N.dayLabel(x.day)}
                      </Copy>
                      {x.status === "overdue" && (
                        <FinPill tone="bad">overdue</FinPill>
                      )}
                      {x.status === "due" && <FinPill tone="warn">due</FinPill>}
                    </Line>
                  </View>
                  <Copy
                    size={14}
                    weight="medium"
                    style={{
                      color: x.item.type === "income" ? t.good : t.text,
                    }}
                  >
                    {x.item.type === "income"
                      ? "+"
                      : x.item.type === "expense"
                        ? "−"
                        : ""}
                    {money(x.item.amount)}
                  </Copy>
                </Line>
              </Tap>
            ))}
            {f.items.length > SHOWN && (
              <Tap
                onPress={() => setAll(!all)}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Copy
                  size={14}
                  weight="medium"
                  style={{ color: t.fin, textAlign: "center" }}
                >
                  {all ? "Show fewer" : `Show all ${f.items.length}`}
                </Copy>
              </Tap>
            )}
          </View>
        )}
      </Frame>
    </View>
  )
}

const HORIZON: Record<6 | 12 | 24, AheadPreset> = {
  6: "6m",
  12: "1y",
  24: "2y",
}
const MONTHS: Partial<Record<AheadPreset, number>> = {
  "6m": 6,
  "1y": 12,
  "2y": 24,
}

export function SavingsSection({ s }: { s: FinState }) {
  const t = useTheme()
  const money = useMoney()
  const ahead = useAhead(s, HORIZON[s.settings.horizon] ?? "1y")
  const preset = "preset" in ahead.sel ? ahead.sel.preset : null
  // Month presets match the Projection screen's month-end figures; a picked
  // day is read off the day-by-day forecast.
  const proj = N.project(s, {
    horizon: (preset && MONTHS[preset]) || s.settings.horizon,
    includeUnplanned: s.settings.includeUnplanned,
    excludedPlanned: s.settings.projExcludedPlanned,
  })
  const daily = preset ? null : dailyForecast(s, ahead.to)
  const last = proj.months.at(-1)
  const value = daily ? daily.end : (last?.end ?? proj.start)
  const by = daily
    ? N.shortDate(ahead.to)
    : last
      ? N.monthLabel(last.key, true)
      : ""
  const byShort = daily
    ? by
    : last
      ? `${N.monthLabel(last.key)} '${last.key.slice(2, 4)}`
      : ""
  const series = daily
    ? thin(
        daily.days.map((d) => d.balance),
        120,
      )
    : [proj.start, ...proj.months.map((m) => m.end)]
  const floor = s.settings.safetyFloor
  return (
    <View>
      <SectionHeading
        action={
          <Tap onPress={() => go("/finance/projection?whatif=1")}>
            <Copy size={12} style={{ color: t.fin }}>
              Plan a purchase
            </Copy>
          </Tap>
        }
      >
        Savings projection
      </SectionHeading>
      <Frame style={{ padding: 16, gap: 12 }}>
        {proj.hasIncome ? (
          <>
            <AheadPicker
              value={ahead.sel}
              onChange={ahead.setSel}
              to={ahead.to}
              presets={["6m", "1y", "2y"]}
            />
            <Tap onPress={() => go("/finance/projection")} label="Projection">
              <Line
                style={{
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Copy size={12} muted>
                    Available by {by}
                  </Copy>
                  <Copy
                    size={30}
                    weight="displayMedium"
                    lines={1}
                    style={{ color: value < 0 ? t.bad : t.text }}
                  >
                    {money(value)}
                  </Copy>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Copy size={12} muted>
                    Avg left over
                  </Copy>
                  <Copy
                    size={14}
                    weight="semibold"
                    style={{ color: proj.avgSurplus >= 0 ? t.good : t.bad }}
                  >
                    {signed(money, proj.avgSurplus)}/mo
                  </Copy>
                </View>
              </Line>
              <View style={{ marginTop: 8 }}>
                <FinanceLineChart
                  height={130}
                  floor={floor > 0 ? floor : undefined}
                  zero={series.some((v) => v < 0)}
                  labels={series.map((_, i) =>
                    i === 0 ? "Now" : i === series.length - 1 ? byShort : "",
                  )}
                  series={[{ values: series, color: t.fin, area: true }]}
                />
              </View>
              <Copy size={12} muted>
                From {money(proj.start)} on hand now
                {daily
                  ? `, lowest ${money(daily.low.value)} on ${N.shortDate(daily.low.day)}`
                  : `, lowest ${money(proj.low.value)} in ${N.monthLabel(proj.low.key)}`}
                .
              </Copy>
            </Tap>
          </>
        ) : (
          <Tap onPress={() => go("/finance/planned")}>
            <Text
              style={{ fontFamily: fonts.body, fontSize: 14, color: t.text }}
            >
              Add your salary as a scheduled payment to unlock the forecast.
            </Text>
          </Tap>
        )}
      </Frame>
    </View>
  )
}
