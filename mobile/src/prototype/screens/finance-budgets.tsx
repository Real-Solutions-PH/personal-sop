import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { Pencil, Plus } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { FinanceLineChart } from "../chart"
import {
  Bar,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, Empty, Screen } from "../ui"
import { Ring } from "../visual"
import { useMoney } from "./finance"
import { BudgetEditor } from "./finance-budget-editor"
import { FinanceRecord } from "./finance-home"
export function Budgets({ id }: { id?: string }) {
  const t = useTheme(),
    s = finStore.use((s) => s),
    money = useMoney(),
    b = s.budgets.find((b) => b.id === id),
    [open, setOpen] = useState(false),
    views = s.budgets.filter((b) => !b.archived).map((b) => C.budgetView(s, b)),
    mk = C.monthOf(dayKey(), s.settings.monthStartDay),
    catMap = C.catMap(s),
    v = b ? C.budgetView(s, b) : null
  const recs =
      b && v
        ? s.records
            .filter((r) => {
              const d = C.recDay(r)
              return (
                C.isFlow(r) &&
                d >= v.from &&
                d <= v.to &&
                (r.type === "expense" || r.isRefund) &&
                C.inScope(r.categoryId, b.categoryIds, catMap)
              )
            })
            .reverse()
        : [],
    total = v ? C.diffDays(v.to, v.from) + 1 : 0,
    ideal = b
      ? Array.from({ length: total }, (_, i) => (b.limit * (i + 1)) / total)
      : [],
    actual: number[] = []
  if (v) {
    let sum = 0
    for (let i = 0; i < total; i++) {
      const d = C.addDays(v.from, i)
      if (d > dayKey()) break
      sum += recs
        .filter((r) => C.recDay(r) === d)
        .reduce((a, r) => a + (r.type === "expense" ? r.amount : -r.amount), 0)
      actual.push(sum)
    }
  }
  const card = (view: C.BudgetView) => {
    const over = view.pct > 1,
      ahead = !over && view.pct > view.pace + 0.05,
      color = over ? t.bad : ahead ? t.warn : t.good
    return (
      <Frame key={view.b.id} style={{ marginBottom: 8 }}>
        <Tap
          onPress={() => go(`/finance/budgets/${view.b.id}`)}
          style={{ padding: 16 }}
        >
          <Line style={{ justifyContent: "space-between" }}>
            <Copy weight="medium">{view.b.name}</Copy>
            <Copy
              size={11}
              style={{
                color,
                backgroundColor: `${color}1a`,
                borderRadius: 99,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              {over
                ? `over by ${money(view.spent - view.limit)}`
                : ahead
                  ? "ahead of pace"
                  : "on track"}
            </Copy>
          </Line>
          <View style={{ marginTop: 12 }}>
            <Bar value={view.pct} color={t.fin} target={view.pace} />
          </View>
          <Line style={{ justifyContent: "space-between", marginTop: 8 }}>
            <Copy size={12} style={{ color: over ? t.bad : t.text }}>
              {money(view.spent)} of {money(view.limit)}
            </Copy>
            <Copy size={12} muted>
              {view.daysLeft} days left · {money(view.safePerDay)}/day
            </Copy>
          </Line>
        </Tap>
      </Frame>
    )
  }
  return (
    <Screen
      prototypeLayout
      title={b?.name ?? (id ? "Budget" : "Budgets")}
      actions={
        <IconTap
          size={40}
          icon={b ? Pencil : Plus}
          label={b ? "Edit budget" : "Add budget"}
          color={t.text}
          onPress={() => setOpen(true)}
        />
      }
    >
      {id && !b ? (
        <Empty title="Budget not found" />
      ) : b && v ? (
        <>
          <Copy size={12} muted>
            {b.categoryIds
              ? b.categoryIds.map((id) => catMap.get(id)?.name).join(", ")
              : "All spending"}{" "}
            · monthly
          </Copy>
          <Frame style={{ padding: 16 }}>
            <Line style={{ gap: 16 }}>
              <Ring value={v.pct} size={96} strokeWidth={10} color={t.fin}>
                <Copy
                  size={20}
                  weight="semibold"
                  style={{ color: v.pct > 1 ? t.bad : t.text }}
                >
                  {Math.round(v.pct * 100)}%
                </Copy>
                <Copy size={10} muted>
                  used
                </Copy>
              </Ring>
              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  flexWrap: "wrap",
                  rowGap: 12,
                }}
              >
                {[
                  ["Spent", money(v.spent)],
                  ["Left", money(Math.max(0, v.limit - v.spent))],
                  ["Safe to spend / day", money(v.safePerDay)],
                  ["Days left", String(v.daysLeft)],
                ].map(([label, value], i) => (
                  <View key={label} style={{ width: "50%", paddingRight: 4 }}>
                    <Copy
                      size={30}
                      weight="displayMedium"
                      style={{ color: i === 2 ? t.fin : t.text }}
                    >
                      {value}
                    </Copy>
                    <Copy size={12} muted>
                      {label}
                    </Copy>
                  </View>
                ))}
              </View>
            </Line>
          </Frame>
          <View style={{ marginTop: -12 }}>
            <SectionHeading>Pace</SectionHeading>
            <Frame
              style={{ paddingHorizontal: 8, paddingTop: 16, paddingBottom: 4 }}
            >
              <FinanceLineChart
                series={[
                  { values: ideal, color: t.muted, dashed: true },
                  {
                    values: actual,
                    color: v.pct > v.pace ? t.bad : t.fin,
                    area: true,
                  },
                ]}
                labels={Array.from({ length: total }, (_, i) =>
                  C.shortDate(C.addDays(v.from, i)),
                )}
                height={150}
                zero
              />
              <Copy
                size={12}
                muted
                style={{ paddingHorizontal: 8, paddingBottom: 8 }}
              >
                Dashed = even pace to the limit.{" "}
                {v.pct > v.pace
                  ? "You're ahead of pace — slow down to finish under."
                  : "You're under pace. Nice."}
              </Copy>
            </Frame>
          </View>
          <View style={{ marginTop: -12 }}>
            <SectionHeading>Past months</SectionHeading>
            <Line style={{ gap: 8 }}>
              {[1, 2, 3].map((i) => {
                const p = C.budgetView(s, b, C.addMonths(mk, -i))
                return (
                  <Frame
                    key={i}
                    style={{ flex: 1, padding: 12, alignItems: "center" }}
                  >
                    <Copy size={12} muted>
                      {C.monthLabel(p.from.slice(0, 7))}
                    </Copy>
                    <Copy
                      weight="semibold"
                      style={{ color: p.pct > 1 ? t.bad : t.good }}
                    >
                      {Math.round(p.pct * 100)}%
                    </Copy>
                    <Copy size={11}>
                      {p.spent === 0 ? "no data" : p.pct > 1 ? "blown" : "kept"}
                    </Copy>
                  </Frame>
                )
              })}
            </Line>
          </View>
          <View style={{ marginTop: -12 }}>
            <SectionHeading
              action={
                <Tap
                  onPress={() =>
                    go(
                      `/finance/records?${b.categoryIds?.[0] ? `cat=${b.categoryIds[0]}&` : ""}from=${v.from}&to=${v.to}`,
                    )
                  }
                >
                  <Copy size={12} style={{ color: t.fin }}>
                    View in transactions
                  </Copy>
                </Tap>
              }
            >
              This month's transactions ({recs.length})
            </SectionHeading>
            <Frame style={{ paddingHorizontal: 8, paddingVertical: 2 }}>
              {recs.slice(0, 15).map((r) => (
                <FinanceRecord key={r.id} record={r} />
              ))}
              {!recs.length && (
                <Copy
                  size={14}
                  muted
                  style={{ paddingVertical: 24, textAlign: "center" }}
                >
                  Nothing spent here yet this month.
                </Copy>
              )}
            </Frame>
          </View>
        </>
      ) : views.length ? (
        <>
          <Frame style={{ padding: 16 }}>
            <Line style={{ justifyContent: "space-between" }}>
              <View>
                <Copy size={30} weight="displayMedium" style={{ color: t.fin }}>
                  {views.filter((v) => v.pct <= 1).length}/{views.length}
                </Copy>
                <Copy size={12} muted>
                  {C.monthLabel(mk, true)} so far
                </Copy>
              </View>
              <Copy
                size={12}
                muted
                style={{ flex: 1, marginLeft: 12, textAlign: "right" }}
              >
                budgets within limit{"\n"}Marker = today's pace
              </Copy>
            </Line>
          </Frame>
          <View style={{ marginTop: -12 }}>
            <SectionHeading>Overall</SectionHeading>
            {views.filter((v) => v.b.categoryIds === null).map(card)}
            <SectionHeading>By category</SectionHeading>
            {views
              .filter((v) => v.b.categoryIds !== null)
              .sort((a, b) => b.pct - a.pct)
              .map(card)}
          </View>
          {s.budgets.some((b) => b.archived) && (
            <Tap onPress={() => go("/finance/archived")}>
              <Copy size={14} muted style={{ textAlign: "center" }}>
                Show {s.budgets.filter((b) => b.archived).length} archived
              </Copy>
            </Tap>
          )}
        </>
      ) : (
        <>
          <Empty title="Set your first budget" />
          <Frame style={{ padding: 16, gap: 8 }}>
            <Copy size={14} muted>
              Based on your last 3 months, here's a starter set:
            </Copy>
            {[
              { name: "Food", ids: ["food"] },
              { name: "Transport", ids: ["transport"] },
              {
                name: "Fun & shopping",
                ids: ["shopping", "entertainment", "subs"],
              },
            ].map((x) => (
              <Line key={x.name} style={{ justifyContent: "space-between" }}>
                <Copy size={14}>{x.name}</Copy>
                <Copy size={14}>
                  {money(
                    Math.max(
                      1000,
                      Math.round(C.avgSpend(s, x.ids) / 500) * 500,
                    ),
                  )}
                </Copy>
              </Line>
            ))}
            <Button
              onPress={() => {
                for (const x of [
                  { name: "Food", ids: ["food"] },
                  { name: "Transport", ids: ["transport"] },
                  {
                    name: "Fun & shopping",
                    ids: ["shopping", "entertainment", "subs"],
                  },
                ])
                  A.addBudget({
                    name: x.name,
                    categoryIds: x.ids,
                    limit: Math.max(
                      1000,
                      Math.round(C.avgSpend(s, x.ids) / 500) * 500,
                    ),
                    rollover: false,
                  })
              }}
            >
              Add these
            </Button>
            <Button tone="quiet" onPress={() => setOpen(true)}>
              Make my own
            </Button>
          </Frame>
        </>
      )}
      {open && <BudgetEditor id={id} onClose={() => setOpen(false)} />}
    </Screen>
  )
}
