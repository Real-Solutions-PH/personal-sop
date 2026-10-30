import * as C from "@domain/finance/calc"
import type { BackPreset } from "@domain/finance/forecast"
import { rangeReport } from "@domain/finance/reports"
import { finStore } from "@domain/finance/store"
import { useLocalSearchParams } from "expo-router"
import { ChevronRight, Share2 } from "lucide-react-native"
import type { ReactNode } from "react"
import { useWindowDimensions, View } from "react-native"
import { FinanceLineChart } from "../chart"
import {
  BudgetHistory,
  ChartLegend,
  Donut,
  FIN_PALETTE,
  FinanceBars,
} from "../finance-charts"
import { border, Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { BackPicker, useBack } from "../range-picker"
import { useTheme } from "../theme"
import { Button, Empty, Screen, shareText } from "../ui"
import { useMoney } from "./finance"
import { FinPill } from "./finance-planned"
import { StatsShell } from "./stats-shell"

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  TITLES: Record<string, string> = {
    category: "Spend by category",
    cashflow: "Cash flow",
    networth: "Net worth",
    payees: "Top payees",
    weekday: "Day-of-week spend",
  },
  PRESETS: BackPreset[] = ["this", "last", "3m", "6m", "1y"],
  // "Last 3 mo" reads "last 3 mo" mid-sentence; month names keep their case.
  inline = (label: string) =>
    label.startsWith("Last ") ? `l${label.slice(1)}` : label,
  delta = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0)
export function Reports({
  kind,
  embedded = false,
}: {
  kind?: string
  embedded?: boolean
}) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    narrow = useWindowDimensions().width < 380,
    params = useLocalSearchParams<{ period?: BackPreset }>(),
    back = useBack(
      s,
      PRESETS.includes(params.period as BackPreset)
        ? (params.period as BackPreset)
        : "this",
    ),
    d = rangeReport(s, back.range, back.label),
    prevCats = d.prev.byCat,
    preset = "preset" in back.sel ? back.sel.preset : null,
    q = preset ? `?period=${preset}` : "",
    topId = d.byCat[0]?.[0],
    topCat = topId ? d.cats.get(topId) : undefined,
    recHref = (extra = "") =>
      `/finance/records?from=${d.r.from}&to=${d.r.to}${extra}`
  const stats = (
    items: {
      label: string
      value: string
      color?: string
      delta?: number
      down?: boolean
    }[],
  ) => (
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
            {x.delta !== undefined && x.delta !== 0 && (
              <Copy
                size={12}
                style={{ color: x.delta > 0 !== !!x.down ? t.good : t.bad }}
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
  )
  const card = (title: string, href: string, children: ReactNode) => (
    <Tap onPress={() => go(href)}>
      <Frame style={{ padding: 16 }}>
        <Line style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <Copy size={14} weight="medium">
            {title}
          </Copy>
          <ChevronRight size={16} color={t.muted} />
        </Line>
        {children}
      </Frame>
    </Tap>
  )
  if (kind && !TITLES[kind])
    return (
      <Screen title="Report">
        <Empty
          title="Unknown report"
          action={<Button href="/finance/reports">All reports</Button>}
        />
      </Screen>
    )
  return (
    <StatsShell
      embedded={embedded}
      title={kind ? TITLES[kind] : "Reports"}
      actions={
        <IconTap
          icon={Share2}
          label="Share"
          size={40}
          color={t.text}
          onPress={() =>
            shareText(`Savings rate ${C.pct(C.savingsRate(d.flow))} · Unfurl`)
          }
        />
      }
    >
      <BackPicker value={back.sel} onChange={back.setSel} range={back.range} />
      <View style={{ gap: 12 }}>
        {kind && (
          <Copy size={12} muted style={{ paddingHorizontal: 4 }}>
            {C.shortDate(d.r.from)} – {C.shortDate(d.r.to)} vs{" "}
            {C.shortDate(d.r.prevFrom)} – {C.shortDate(d.r.prevTo)}
          </Copy>
        )}
        {!kind ? (
          <>
            {card(
              "Savings rate",
              `/finance/reports/cashflow${q}`,
              <Line style={{ gap: 16, alignItems: "flex-end" }}>
                <View>
                  <Copy
                    size={30}
                    weight="displayMedium"
                    style={{
                      color: C.savingsRate(d.flow) < 0 ? t.bad : t.text,
                    }}
                  >
                    {C.pct(C.savingsRate(d.flow))}
                  </Copy>
                  <Copy size={12} muted>
                    of income kept · {d.r.label}
                  </Copy>
                </View>
                <View style={{ flex: 1, alignItems: "flex-end", gap: 2 }}>
                  <Copy size={12} muted lines={1}>
                    In {money(d.flow.income)}
                  </Copy>
                  <Copy size={12} muted lines={1}>
                    Out {money(d.flow.spend)}
                    {delta(d.flow.spend, d.prev.spend) !== 0 && (
                      <Copy
                        size={12}
                        style={{
                          color:
                            delta(d.flow.spend, d.prev.spend) > 0
                              ? t.bad
                              : t.good,
                        }}
                      >
                        {"  "}
                        {delta(d.flow.spend, d.prev.spend) > 0 ? "▲" : "▼"}
                        {Math.abs(delta(d.flow.spend, d.prev.spend))}%
                      </Copy>
                    )}
                  </Copy>
                </View>
              </Line>,
            )}
            {card(
              "Spend by category",
              `/finance/reports/category${q}`,
              <Line style={{ gap: 16 }}>
                <Donut values={d.byCat.map((x) => x[1])} size={112}>
                  <View
                    accessible
                    accessibilityLabel={
                      topCat ? `Top: ${topCat.name}` : "No spending"
                    }
                  >
                    <Copy size={28}>{topCat?.icon ?? "—"}</Copy>
                  </View>
                  {topId && d.flow.spend > 0 && (
                    <Copy size={12} muted>
                      {Math.round(
                        ((d.byCat[0]?.[1] ?? 0) / d.flow.spend) * 100,
                      )}
                      %
                    </Copy>
                  )}
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
                        {d.cats.get(id)?.name ?? "Other"}
                      </Copy>
                      <Copy size={12} muted>
                        {Math.round((v / d.flow.spend) * 100)}%
                      </Copy>
                    </Line>
                  ))}
                </View>
              </Line>,
            )}
            {card(
              "Cash flow vs expected",
              `/finance/reports/networth${q}`,
              <View style={{ gap: 6 }}>
                <FinanceLineChart
                  height={150}
                  labels={d.vs.days.map((k, i) =>
                    i === 0 || i === d.vs.days.length - 1 ? C.shortDate(k) : "",
                  )}
                  series={[
                    { values: d.vs.expected, color: t.muted, dashed: true },
                    { values: d.vs.actual, color: t.fin, area: true },
                  ]}
                />
                <ChartLegend
                  items={[
                    { label: "Actual net worth", color: t.fin },
                    {
                      label: "Expected from what repeats",
                      color: t.muted,
                      dashed: true,
                    },
                  ]}
                />
                <Copy size={12} muted>
                  {d.vs.days.length < 2
                    ? "Not enough days in this window yet."
                    : Math.abs(d.vs.gap) < 1
                      ? "Right on what your repeating income and bills predict."
                      : `${money(Math.abs(d.vs.gap))} ${d.vs.gap > 0 ? "above" : "below"} what your repeating income and bills predict by ${C.shortDate(d.vs.days.at(-1) ?? d.r.to)}.`}
                </Copy>
              </View>,
            )}
            {d.budgets.length > 0 &&
              card(
                "Budget history",
                "/finance/budgets",
                <BudgetHistory
                  rows={d.budgets.map(({ b, hist }) => ({
                    id: b.id,
                    name: b.name,
                    hist: hist.map((h) => ({
                      key: h.from,
                      pct: h.pct,
                      spent: h.spent,
                    })),
                  }))}
                  monthLabel={(from) =>
                    C.monthLabel(C.monthOf(from, s.settings.monthStartDay))
                  }
                  left={(id) => {
                    const v = d.budgets.find((x) => x.b.id === id)?.hist.at(-1)
                    if (!v) return ""
                    return v.limit >= v.spent
                      ? `${money(v.limit - v.spent)} left`
                      : `${money(v.spent - v.limit)} over`
                  }}
                />,
              )}
            {card(
              "Top payees",
              `/finance/reports/payees${q}`,
              d.payees.length ? (
                d.payees.slice(0, 4).map(([name, v]) => (
                  <Line
                    key={name}
                    style={{
                      justifyContent: "space-between",
                      paddingVertical: 4,
                    }}
                  >
                    <Copy size={14} lines={1} style={{ flex: 1 }}>
                      {name}
                    </Copy>
                    <Copy size={14}>{money(v)}</Copy>
                  </Line>
                ))
              ) : (
                <Copy size={14} muted>
                  No payees in this window.
                </Copy>
              ),
            )}
            {card(
              "Day-of-week spend",
              `/finance/reports/weekday${q}`,
              <FinanceBars data={d.weekdayAvg} labels={WD} />,
            )}
            <Button
              tone="quiet"
              href={`/finance/review?from=${d.r.from}&to=${d.r.to}`}
            >{`Review ${inline(d.r.label)}`}</Button>
          </>
        ) : kind === "category" ? (
          <>
            <Frame style={{ padding: 16, alignItems: "center" }}>
              <Donut values={d.byCat.map((x) => x[1])} size={180}>
                <Copy size={18} weight="semibold">
                  {money(d.flow.spend)}
                </Copy>
                <Copy size={10} muted>
                  spent
                </Copy>
              </Donut>
            </Frame>
            <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
              {d.byCat.map(([id, v], i) => {
                const prev = prevCats.get(id) ?? 0,
                  dl = delta(v, prev)
                return (
                  <Tap key={id} onPress={() => go(recHref(`&cat=${id}`))}>
                    <Line style={{ paddingVertical: 10 }}>
                      <View
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 6,
                          backgroundColor: t[FIN_PALETTE[i % 7]],
                        }}
                      />
                      <View style={{ flex: 1 }}>
                        <Copy size={14}>
                          {d.cats.get(id)?.icon}{" "}
                          {d.cats.get(id)?.name ?? "Other"}
                        </Copy>
                        <Copy size={12} muted>
                          {Math.round((v / d.flow.spend) * 100)}% of spend
                        </Copy>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Copy size={14} weight="medium">
                          {money(v)}
                        </Copy>
                        {prev > 0 && (
                          <Copy
                            size={11}
                            style={{ color: dl > 0 ? t.bad : t.good }}
                          >
                            {dl > 0 ? "▲" : "▼"}
                            {Math.abs(dl)}%
                          </Copy>
                        )}
                      </View>
                      <ChevronRight size={16} color={t.muted} />
                    </Line>
                  </Tap>
                )
              })}
            </Frame>
          </>
        ) : kind === "cashflow" ? (
          <>
            <Frame style={{ paddingHorizontal: 8, paddingVertical: 16 }}>
              <FinanceLineChart
                series={[{ values: d.daily, color: t.fin, area: true }]}
                labels={Array.from({ length: d.days }, (_, i) =>
                  i % 7 === 0 ? C.shortDate(C.addDays(d.r.from, i)) : "",
                )}
                zero
              />
            </Frame>
            {stats([
              {
                label: "In",
                value: money(d.flow.income),
                delta: delta(d.flow.income, d.prev.income),
              },
              {
                label: "Out",
                value: money(d.flow.spend),
                delta: delta(d.flow.spend, d.prev.spend),
                down: true,
              },
              { label: "Net", value: money(d.flow.income - d.flow.spend) },
            ])}
            <Frame>
              <Line
                style={{
                  gap: 0,
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderColor: border(t.line, 0.6),
                }}
              >
                {["Month", "In", "Out", "Saved"].map((v, i) => (
                  <Copy
                    key={v}
                    size={12}
                    weight="medium"
                    muted
                    style={{
                      flex: 1,
                      paddingHorizontal: 8,
                      textAlign: i ? "right" : "left",
                    }}
                  >
                    {v}
                  </Copy>
                ))}
              </Line>
              {d.months.map((m) => (
                <Line
                  key={m.key}
                  style={{
                    gap: 0,
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderColor: border(t.line, 0.4),
                  }}
                >
                  {[
                    C.monthLabel(m.key),
                    money(m.income),
                    money(m.spend),
                    m.income ? C.pct((m.income - m.spend) / m.income) : "—",
                  ].map((v, i) => (
                    <Copy
                      key={`col-${i}`}
                      size={12}
                      style={{
                        flex: 1,
                        paddingHorizontal: 8,
                        textAlign: i ? "right" : "left",
                        color:
                          i === 3
                            ? m.income - m.spend < 0
                              ? t.bad
                              : t.good
                            : t.text,
                      }}
                    >
                      {v}
                    </Copy>
                  ))}
                </Line>
              ))}
            </Frame>
          </>
        ) : kind === "networth" ? (
          <Frame style={{ paddingHorizontal: 8, paddingVertical: 16 }}>
            <FinanceLineChart
              series={[
                { values: d.vs.expected, color: t.muted, dashed: true },
                { values: d.vs.actual, color: t.fin, area: true },
              ]}
              labels={d.vs.days.map((k, i) =>
                i % Math.max(1, Math.round(d.vs.days.length / 5)) === 0
                  ? C.shortDate(k)
                  : "",
              )}
            />
            <View style={{ paddingHorizontal: 8, paddingBottom: 8, gap: 4 }}>
              <ChartLegend
                items={[
                  { label: "Actual net worth", color: t.fin },
                  {
                    label: "Expected from what repeats",
                    color: t.muted,
                    dashed: true,
                  },
                ]}
              />
              <Copy size={12} muted>
                Assets minus credit card debt. Investments at their last manual
                value. The dashed line adds only your repeating income and
                bills, on their days, to where you started.
              </Copy>
              {(d.vs.actual.length ?? 0) > 1 && (
                <FinPill
                  tone={
                    (d.vs.actual.at(-1) ?? 0) >= (d.vs.actual[0] ?? 0)
                      ? "good"
                      : "bad"
                  }
                >
                  {C.pct(
                    ((d.vs.actual.at(-1) ?? 0) - (d.vs.actual[0] ?? 0)) /
                      Math.abs(d.vs.actual[0] || 1),
                    1,
                  )}{" "}
                  over {inline(d.r.label)}
                </FinPill>
              )}
            </View>
          </Frame>
        ) : kind === "payees" ? (
          <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            {d.payees.map(([name, v], i) => (
              <Tap
                key={name}
                onPress={() => go(recHref(`&q=${encodeURIComponent(name)}`))}
              >
                <Line style={{ paddingVertical: 10 }}>
                  <Copy size={14} muted style={{ width: 20 }}>
                    {i + 1}
                  </Copy>
                  <Copy size={14} style={{ flex: 1 }}>
                    {name}
                  </Copy>
                  <Copy size={14} weight="medium">
                    {money(v)}
                  </Copy>
                  <ChevronRight size={16} color={t.muted} />
                </Line>
              </Tap>
            ))}
          </Frame>
        ) : (
          <Frame style={{ padding: 16 }}>
            <FinanceBars data={d.weekdayAvg} labels={WD} height={140} />
            <View style={{ marginTop: 12, gap: 4 }}>
              {d.weekdayAvg.map((v, i) => (
                <Line key={WD[i]} style={{ justifyContent: "space-between" }}>
                  <Copy size={14}>{WD[i]}</Copy>
                  <Copy size={14} muted>
                    avg {money(v)}
                  </Copy>
                </Line>
              ))}
            </View>
            <Copy size={12} muted style={{ marginTop: 12 }}>
              {WD[d.weekdayAvg.indexOf(Math.max(...d.weekdayAvg))]} is your
              priciest day — usually groceries and eating out.
            </Copy>
          </Frame>
        )}
        {kind && (
          <Tap onPress={() => go(recHref())}>
            <Copy size={12} style={{ color: t.fin, textAlign: "center" }}>
              Open these transactions
            </Copy>
          </Tap>
        )}
      </View>
    </StatsShell>
  )
}
