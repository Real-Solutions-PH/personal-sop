// What the Projection counts in one month, listed under that month's row:
// each planned occurrence (income in green, money out in red) and each
// record already logged for a later day this month. A planned row opens
// its planned item; a logged row opens its record. Titles wrap, never cut.
import * as C from "@domain/finance/calc"
import type { FinRecord } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { View } from "react-native"
import { Copy, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { useMoney } from "./finance"

/** The signed effect a logged record has on the counted accounts. */
const loggedSign = (r: FinRecord) =>
  r.type === "income" ? 1 : r.type === "expense" ? -1 : 0

function Row({
  icon,
  title,
  meta,
  amount,
  onPress,
  label,
}: {
  icon: string
  title: string
  meta: string
  amount: number
  onPress: () => void
  label: string
}) {
  const t = useTheme(),
    money = useMoney()
  return (
    <Tap label={label} onPress={onPress} style={{ paddingVertical: 8 }}>
      <Line style={{ alignItems: "flex-start", gap: 10 }}>
        <View
          style={{
            height: 32,
            width: 32,
            borderRadius: 16,
            backgroundColor: t.soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Copy size={14}>{icon}</Copy>
        </View>
        <View style={{ flex: 1 }}>
          <Copy size={14} weight="medium">
            {title}
          </Copy>
          <Copy size={12} muted>
            {meta}
          </Copy>
        </View>
        <Copy
          size={14}
          weight="semibold"
          style={{
            color: amount > 0 ? t.good : amount < 0 ? t.bad : t.muted,
          }}
        >
          {amount > 0 ? "+" : amount < 0 ? "−" : ""}
          {money(Math.abs(amount))}
        </Copy>
      </Line>
    </Tap>
  )
}

export function ProjectedItems({ month }: { month: C.ProjMonth }) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    icon = (categoryId: string | undefined, fallback: string) =>
      s.categories.find((c) => c.id === categoryId)?.icon ?? fallback
  if (!month.items.length && !month.logged.length)
    return (
      <Copy size={12} muted style={{ paddingVertical: 8 }}>
        Nothing planned this month
        {month.unplanned > 0
          ? `; only everyday spending of ${money(month.unplanned)}`
          : ""}
      </Copy>
    )
  return (
    <View testID={`projected-items-${month.key}`}>
      {month.items.map((x) => (
        <Row
          key={`${x.item.id}-${x.orig}`}
          icon={icon(x.item.categoryId, x.item.type === "income" ? "＋" : "⇄")}
          title={x.item.name}
          meta={`${C.dayLabel(x.day)} · ${
            x.item.type === "income"
              ? "Income"
              : x.item.type === "expense"
                ? "Planned expense"
                : "Planned transfer"
          }${x.item.estimated ? " · estimate" : ""}`}
          amount={x.amount}
          label={`${x.item.name}, ${C.dayLabel(x.day)}, ${x.amount > 0 ? "in" : "out"} ${money(Math.abs(x.amount))}. Open the planned item`}
          onPress={() => go(`/finance/planned/${x.item.id}`)}
        />
      ))}
      {month.logged.map((r) => {
        const title =
          r.payee ??
          s.categories.find((c) => c.id === r.categoryId)?.name ??
          (r.type === "transfer" ? "Transfer" : "Record")
        return (
          <Row
            key={r.id}
            icon={icon(r.categoryId, r.type === "transfer" ? "⇄" : "💸")}
            title={title}
            meta={`${C.dayLabel(C.recDay(r))} · Logged ahead, already in today's balance`}
            amount={loggedSign(r) * r.amount}
            label={`${title}, logged for ${C.dayLabel(C.recDay(r))}. Open the record`}
            onPress={() => go(`/finance/records/${r.id}`)}
          />
        )
      })}
      {month.unplanned > 0 && (
        <Line
          style={{
            justifyContent: "space-between",
            gap: 12,
            paddingVertical: 8,
          }}
        >
          <Copy size={12} muted style={{ flex: 1 }}>
            Everyday spending, 3-month average
          </Copy>
          <Copy size={12} weight="medium" style={{ color: t.bad }}>
            −{money(month.unplanned)}
          </Copy>
        </Line>
      )}
    </View>
  )
}
