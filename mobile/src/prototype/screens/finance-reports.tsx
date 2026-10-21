import * as C from "@domain/finance/calc"
import { type Period, reportData } from "@domain/finance/reports"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { ChevronRight, Share2 } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { useWindowDimensions, View } from "react-native"
import { FinanceLineChart, Sparkline } from "../chart"
import { Donut, FIN_PALETTE, FinanceBars, PairBars } from "../finance-charts"
import { SwipeSegments } from "../motion"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, Empty, Screen, shareText } from "../ui"
import { useMoney } from "./finance"
import { FinPill } from "./finance-planned"

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  TITLES: Record<string, string> = {
    category: "Spend by category",
    cashflow: "Cash flow",
    networth: "Net worth",
    payees: "Top payees",
    weekday: "Day-of-week spend",
  },
  PERIODS = [
    { value: "this" as const, label: "This month" },
    { value: "last" as const, label: "Last month" },
    { value: "3m" as const, label: "3 months" },
  ],
  delta = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0)
export function Reports({ kind }: { kind?: string }) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    narrow = useWindowDimensions().width < 380,
    params = useLocalSearchParams<{ period?: Period }>(),
    [p, setP] = useState<Period>(params.period ?? "this"),
    d = reportData(s, p),
    prevCats = d.prev.byCat,
    q = `?period=${p}`,
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
    <Screen
      title={kind ? TITLES[kind] : "Reports"}
      actions={
        <IconTap
          icon={Share2}
          label="Share"
          size={40}
          color={t.text}
          onPress={() =>
            shareText(
              `Savings rate ${C.pct(C.savingsRate(d.flow))} · Personal SOP`,
            )
          }
        />
      }
    >
      <Segmented value={p} onChange={setP} options={PERIODS} />
      <SwipeSegments
        value={p}
        options={PERIODS.map((o) => o.value)}
        onChange={setP}
      >
        {kind && (
          <Copy size={12} muted style={{ paddingHorizontal: 4 }}>
            {C.shortDate(d.r.from)} – {C.shortDate(d.r.to)} vs{" "}
            {C.shortDate(d.r.prevFrom)} – {C.shortDate(d.r.prevTo)}
          </Copy>
        )}
        {!kind ? (
          <>
            {stats([
              { label: "Income", value: money(d.flow.income) },
              {
                label: "Spent",
                value: money(d.flow.spend),
                delta: delta(d.flow.spend, d.prev.spend),
                down: true,
              },
              {
                label: "Savings rate",
                value: C.pct(C.savingsRate(d.flow)),
                color: t.fin,
              },
            ])}
            {card(
              "Spend by category",
              `/finance/reports/category${q}`,
              <Line style={{ gap: 16 }}>
                <Donut values={d.byCat.map((x) => x[1])} size={112}>
                  <Copy size={10} muted>
                    top
                  </Copy>
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
              "Income vs expense",
              `/finance/reports/cashflow${q}`,
              <PairBars
                pairs={d.months.map((m) => [m.income, m.spend])}
                labels={d.months.map((m) => C.monthLabel(m.key))}
              />,
            )}
            {card(
              "Cash flow trend",
              `/finance/reports/cashflow${q}`,
              <>
                <Sparkline
                  label="Cash flow trend"
                  values={d.daily}
                  color={t.fin}
                  height={56}
                />
                <Copy size={12} muted style={{ marginTop: 4 }}>
                  Running total over {d.r.label.toLowerCase()}
                </Copy>
              </>,
            )}
            {card(
              "Net worth trend",
              `/finance/reports/networth${q}`,
              <Sparkline
                label="Net worth trend"
                values={d.nw}
                color={t.life}
                height={56}
              />,
            )}
            {card(
              "Top payees",
              `/finance/reports/payees${q}`,
              d.payees.slice(0, 4).map(([name, v]) => (
                <Line
                  key={name}
                  style={{
                    justifyContent: "space-between",
                    paddingVertical: 4,
                  }}
                >
                  <Copy size={14}>{name}</Copy>
                  <Copy size={14}>{money(v)}</Copy>
                </Line>
              )),
            )}
            {card(
              "Budget history",
              "/finance/budgets",
              <View style={{ gap: 8 }}>
                {d.budgets.map(({ b, hist }) => (
                  <Line key={b.id} style={{ gap: 8 }}>
                    <Copy size={12} lines={1} style={{ width: 112 }}>
                      {b.name}
                    </Copy>
                    {hist.map((h) => (
                      <View
                        key={h.from}
                        style={{
                          flex: 1,
                          borderRadius: 6,
                          paddingVertical: 4,
                          backgroundColor:
                            h.spent === 0
                              ? t.soft
                              : h.pct > 1
                                ? `${t.bad}33`
                                : `${t.good}26`,
                        }}
                      >
                        <Copy
                          size={12}
                          style={{
                            textAlign: "center",
                            color:
                              h.spent === 0
                                ? t.text
                                : h.pct > 1
                                  ? t.bad
                                  : t.good,
                          }}
                        >
                          {C.monthLabel(h.from.slice(0, 7))}{" "}
                          {h.spent ? `${Math.round(h.pct * 100)}%` : "—"}
                        </Copy>
                      </View>
                    ))}
                  </Line>
                ))}
              </View>,
            )}
            {card(
              "Day-of-week spend",
              `/finance/reports/weekday${q}`,
              <FinanceBars data={d.weekdayAvg} labels={WD} />,
            )}
            <Button
              tone="quiet"
              href={`/finance/review?from=${d.r.from}&to=${d.r.to}`}
            >{`Review ${d.r.label.toLowerCase()}`}</Button>
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
              series={[{ values: d.nw, color: t.fin, area: true }]}
              labels={Array.from({ length: 90 }, (_, i) =>
                i % 15 === 0 ? C.shortDate(C.addDays(dayKey(), i - 89)) : "",
              )}
            />
            <View style={{ paddingHorizontal: 8, paddingBottom: 8, gap: 4 }}>
              <Copy size={12} muted>
                Assets minus credit card debt. Investments at their last manual
                value.
              </Copy>
              <FinPill tone={d.nw[89] >= d.nw[0] ? "good" : "bad"}>
                {C.pct((d.nw[89] - d.nw[0]) / Math.abs(d.nw[0] || 1), 1)} in 90
                days
              </FinPill>
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
      </SwipeSegments>
    </Screen>
  )
}
