import * as C from "@domain/finance/calc"
import {
  backRangeError,
  type DateRange,
  dayMonth,
  isDayKey,
  rangeLabel,
} from "@domain/finance/forecast"
import { isCustom, type Period, reportData } from "@domain/finance/reports"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { ChevronRight, Share2 } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { FinanceLineChart } from "../chart"
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
import { Button, DateField, Empty, Screen, Sheet, shareText } from "../ui"
import { useMoney } from "./finance"
import { RecurringNet } from "./finance-monthly-net"
import { FinPill } from "./finance-planned"
import { FinChip } from "./finance-projection"
import {
  BudgetHistoryCard,
  CategoryCard,
  ExpectedNetWorthCard,
  periodQuery,
  ReportCard,
  SavingsRateCard,
  TopPayeesCard,
  WeekdayCard,
} from "./finance-report-cards"

type Fixed = "this" | "last" | "3m"
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  TITLES: Record<string, string> = {
    category: "Spend by category",
    cashflow: "Cash flow",
    networth: "Net worth",
    payees: "Top payees",
    weekday: "Day-of-week spend",
  },
  FIXED: { value: Fixed; label: string }[] = [
    { value: "this", label: "This month" },
    { value: "last", label: "Last month" },
    { value: "3m", label: "3 months" },
  ],
  delta = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0)

/** The period a link asked for: a valid ``from``/``to`` first, then
 * ``period``, else this month. */
export function periodFromParams(p: {
  from?: string
  to?: string
  period?: string
}): Period {
  if (isDayKey(p.from) && isDayKey(p.to)) {
    const r = { from: p.from, to: p.to }
    if (!backRangeError(r)) return r
  }
  return FIXED.some((x) => x.value === p.period) ? (p.period as Fixed) : "this"
}

/** Quick picks for a look-back range, all ending today. */
function quickRanges(): { label: string; range: DateRange }[] {
  const t = dayKey()
  return [
    { label: "Last 7 days", range: { from: C.addDays(t, -6), to: t } },
    { label: "Last 30 days", range: { from: C.addDays(t, -29), to: t } },
    { label: "Last 90 days", range: { from: C.addDays(t, -89), to: t } },
    { label: "This year", range: { from: `${t.slice(0, 4)}-01-01`, to: t } },
  ]
}

function CustomRangeSheet({
  open,
  initial,
  onClose,
  onApply,
}: {
  open: boolean
  initial: DateRange
  onClose: () => void
  onApply: (r: DateRange) => void
}) {
  const [draft, setDraft] = useState(initial)
  const [seen, setSeen] = useState(initial)
  // Reopening starts from the range on screen.
  if (initial.from !== seen.from || initial.to !== seen.to) {
    setSeen(initial)
    setDraft(initial)
  }
  return (
    <Sheet title="Custom range" open={open} onClose={onClose}>
      <Line style={{ gap: 8, flexWrap: "wrap" }}>
        {quickRanges().map((q) => (
          <FinChip
            key={q.label}
            label={q.label}
            active={q.range.from === draft.from && q.range.to === draft.to}
            onPress={() => setDraft(q.range)}
          />
        ))}
      </Line>
      <Line>
        <View style={{ flex: 1 }}>
          <DateField
            label="From"
            value={draft.from}
            onChangeText={(from) => setDraft({ ...draft, from })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <DateField
            label="To"
            value={draft.to}
            onChangeText={(to) => setDraft({ ...draft, to })}
          />
        </View>
      </Line>
      <Button
        onPress={() => {
          const bad =
            !isDayKey(draft.from) || !isDayKey(draft.to)
              ? "Pick both dates"
              : backRangeError(draft)
          if (bad) {
            toast.error(bad)
            return
          }
          onApply(draft)
          toast(`Showing ${rangeLabel(draft)}`)
        }}
      >
        Apply
      </Button>
    </Sheet>
  )
}

export function Reports({ kind }: { kind?: string }) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    params = useLocalSearchParams<{
      period?: string
      from?: string
      to?: string
    }>(),
    [p, setP] = useState<Period>(() => periodFromParams(params)),
    [sheet, setSheet] = useState(false),
    d = reportData(s, p),
    custom = isCustom(p),
    prevCats = d.prev.byCat,
    q = periodQuery(p),
    nwFrom = custom ? d.r.from : C.addDays(dayKey(), -(d.nw.length - 1)),
    // This month's scheduled income and bills still to come (overdue
    // too): the month as it is expected to end.
    ahead = C.scheduledFlow(s, d.r.to),
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
            size={22}
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
  if (kind && !TITLES[kind])
    return (
      <Screen title="Report">
        <Empty
          title="Unknown report"
          action={<Button href="/finance/reports">All reports</Button>}
        />
      </Screen>
    )
  const segValue = custom ? "custom" : p
  const body = (
    <>
      {kind && (
        <Copy size={12} muted style={{ paddingHorizontal: 4 }}>
          {C.shortDate(d.r.from)} – {C.shortDate(d.r.to)} vs{" "}
          {C.shortDate(d.r.prevFrom)} – {C.shortDate(d.r.prevTo)}
        </Copy>
      )}
      {!kind ? (
        <>
          <SavingsRateCard
            d={d}
            period={p}
            href={`/finance/reports/cashflow${q}`}
          />
          {p === "this" && (ahead.income > 0 || ahead.spend > 0) && (
            <Tap onPress={() => go("/finance/planned")}>
              <Frame
                style={{
                  padding: 12,
                  gap: 4,
                  borderColor: `${t.fin}4d`,
                  backgroundColor: `${t.fin}0d`,
                }}
              >
                <Copy size={12} style={{ color: t.fin }}>
                  With what's scheduled, by {C.shortDate(d.r.to)}
                </Copy>
                <Copy size={14}>
                  Income {money(d.flow.income + ahead.income)} · Spent{" "}
                  {money(d.flow.spend + ahead.spend)} · Savings rate{" "}
                  {C.pct(
                    C.savingsRate({
                      ...d.flow,
                      income: d.flow.income + ahead.income,
                      spend: d.flow.spend + ahead.spend,
                    }),
                  )}
                </Copy>
              </Frame>
            </Tap>
          )}
          <CategoryCard d={d} period={p} />
          <ExpectedNetWorthCard d={d} period={p} s={s} />
          <BudgetHistoryCard d={d} period={p} s={s} />
          <TopPayeesCard d={d} period={p} />
          <WeekdayCard d={d} period={p} />
          <ReportCard
            title="Income vs expense"
            href={`/finance/reports/cashflow${q}`}
          >
            <PairBars
              pairs={d.months.map((m) => [m.income, m.spend])}
              labels={d.months.map((m) => C.monthLabel(m.key))}
            />
            {p === "this" && <RecurringNet s={s} />}
          </ReportCard>
          <Button
            tone="quiet"
            href={`/finance/review?from=${d.r.from}&to=${d.r.to}`}
          >{`Review ${custom ? d.r.label : d.r.label.toLowerCase()}`}</Button>
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
                        {d.cats.get(id)?.icon} {d.cats.get(id)?.name ?? "Other"}
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
            labels={d.nw.map((_, i) =>
              i % Math.max(1, Math.round(d.nw.length / 6)) === 0
                ? C.shortDate(C.addDays(nwFrom, i))
                : "",
            )}
          />
          <View style={{ paddingHorizontal: 8, paddingBottom: 8, gap: 4 }}>
            <Copy size={12} muted>
              Assets minus credit card debt. Investments at their last manual
              value.
            </Copy>
            <FinPill
              tone={(d.nw.at(-1) ?? 0) >= (d.nw[0] ?? 0) ? "good" : "bad"}
            >
              {C.pct(
                ((d.nw.at(-1) ?? 0) - (d.nw[0] ?? 0)) / Math.abs(d.nw[0] || 1),
                1,
              )}{" "}
              in {d.nw.length} days
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
            priciest day.
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
    </>
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
            shareText(`Savings rate ${C.pct(C.savingsRate(d.flow))} · Unfurl`)
          }
        />
      }
    >
      <Segmented
        value={segValue}
        onChange={(v) => {
          if (v === "custom") setSheet(true)
          else setP(v as Fixed)
        }}
        options={[
          ...FIXED,
          {
            value: "custom",
            label: custom
              ? `${dayMonth(p.from)} – ${dayMonth(p.to)}`
              : "Custom",
          },
        ]}
      />
      {custom ? (
        <View style={{ gap: 12 }}>{body}</View>
      ) : (
        <SwipeSegments
          value={p}
          options={FIXED.map((o) => o.value)}
          onChange={setP}
          gap={12}
        >
          {body}
        </SwipeSegments>
      )}
      <CustomRangeSheet
        open={sheet}
        initial={custom ? p : { from: C.addDays(dayKey(), -29), to: dayKey() }}
        onClose={() => setSheet(false)}
        onApply={(r) => {
          setP(r)
          setSheet(false)
        }}
      />
    </Screen>
  )
}
