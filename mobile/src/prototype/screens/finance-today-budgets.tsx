// The budgets on the Today finance card: each live budget's spent against
// its limit on one bar, with a marker where an even pace would be today,
// coloured by how it stands. A row opens its budget. With no budget the
// rows are drawn dimmed, with the one step that fills them.
import * as N from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import { Gauge } from "lucide-react-native"
import { View } from "react-native"
import { Bar, border, Copy, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { useMoney } from "./finance"
import { SpentLeft } from "./finance-home-cards"
import { Dimmed, EmptyFoot } from "./locked-preview"

/** Rows the card draws before "N more". */
const SHOWN = 4
/** Spent share from which a budget reads as close to its limit. */
const CLOSE = 0.8

export type BudgetTone = "good" | "warn" | "bad"
/** Over the limit is bad; close to it, or spending ahead of an even pace,
 * is a warning (the same rule as the card's "of budget used"); anything
 * else is fine. */
export function budgetTone(v: { pct: number; pace: number }): BudgetTone {
  if (v.pct > 1) return "bad"
  if (v.pct >= CLOSE || v.pct > v.pace) return "warn"
  return "good"
}
/** How a budget stands, for a screen reader. */
const standing = (v: { pct: number; pace: number }) => {
  const tone = budgetTone(v)
  if (tone === "bad") return "over"
  if (tone === "good") return "on track"
  return v.pct >= CLOSE ? "close to the limit" : "ahead of pace"
}

const SAMPLE = [
  { name: "Food", spent: 5700, limit: 12000, pct: 0.48, pace: 0.45 },
  { name: "Transport", spent: 2900, limit: 3500, pct: 0.83, pace: 0.45 },
]

function Row({
  name,
  spent,
  limit,
  pct,
  pace,
}: {
  name: string
  spent: number
  limit: number
  pct: number
  pace: number
}) {
  const t = useTheme(),
    tone = budgetTone({ pct, pace })
  return (
    <View style={{ gap: 6, paddingVertical: 6 }}>
      <Line style={{ gap: 8, alignItems: "flex-start" }}>
        {/* The name wraps; it is never cut. */}
        <Copy size={14} style={{ flex: 1 }}>
          {name}
        </Copy>
        <SpentLeft spent={spent} limit={limit} />
      </Line>
      <Bar value={Math.min(1, pct)} color={t[tone]} target={pace} />
    </View>
  )
}

export function TodayBudgets() {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    views = s.budgets
      .filter((b) => !b.archived)
      .map((b) => N.budgetView(s, b))
      // The overall budget heads the list; then the fullest first.
      .sort(
        (a, b) =>
          Number(b.b.categoryIds === null) - Number(a.b.categoryIds === null) ||
          b.pct - a.pct,
      ),
    more = views.length - SHOWN
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderColor: border(t.line, 0.5),
        paddingTop: 8,
      }}
    >
      <Tap onPress={() => go("/finance/budgets")} label="All budgets">
        <Line style={{ gap: 8 }}>
          <Gauge size={16} color={t.fin} />
          <Copy size={14} style={{ flex: 1 }}>
            Budgets
          </Copy>
          {more > 0 && (
            <Copy size={12} style={{ color: t.fin }}>
              {more} more ›
            </Copy>
          )}
        </Line>
      </Tap>
      {views.slice(0, SHOWN).map((v) => (
        <Tap
          key={v.b.id}
          label={`${v.b.name} budget: ${money(v.spent)} of ${money(v.limit)} spent, ${Math.round(v.pct * 100)}%, ${standing(v)}`}
          onPress={() => go(`/finance/budgets/${v.b.id}`)}
        >
          <Row
            name={v.b.name}
            spent={v.spent}
            limit={v.limit}
            pct={v.pct}
            pace={v.pace}
          />
        </Tap>
      ))}
      {!views.length && (
        <View testID="today-budgets-empty">
          <Dimmed>
            {SAMPLE.map((x) => (
              <Row key={x.name} {...x} />
            ))}
          </Dimmed>
          <EmptyFoot
            hint="A budget shows what is left each month."
            action={{ label: "Set budget", href: "/finance/budgets?new=1" }}
          />
        </View>
      )}
    </View>
  )
}
