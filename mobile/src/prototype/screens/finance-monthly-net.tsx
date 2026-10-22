// Estimated monthly net: what a typical month leaves you with, from the
// income and bills that repeat (salary, rent, subscriptions, instalments).
// One-off items and what-ifs stay out; the Scheduled screen shows the same
// numbers from the same calculation.
import * as C from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import { dayKey } from "@domain/lib/day"
import { ChevronRight } from "lucide-react-native"
import { View } from "react-native"
import { Copy, Frame, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { useMoney } from "./finance"
import { LockedPreview } from "./locked-preview"

const SAMPLE: C.RecurringMonth = {
  income: 60000,
  out: 38500,
  net: 21500,
  incomeItems: [],
  outItems: [],
}

export function MonthlyNet({ s }: { s: FinState }) {
  const t = useTheme()
  const money = useMoney()
  const real = C.recurringMonth(s, dayKey())
  const empty = !real.incomeItems.length && !real.outItems.length
  const m = empty ? SAMPLE : real
  const good = m.net >= 0
  const total = Math.max(m.income, m.out, 1)
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
  const rows = [
    {
      label: "Recurring income",
      value: m.income,
      note: empty ? "" : count(real.incomeItems.length, "item"),
      color: t.good,
    },
    {
      label: "Recurring bills",
      value: m.out,
      note: empty ? "" : count(real.outItems.length, "item"),
      color: t.bad,
    },
  ]
  return (
    <LockedPreview
      locked={empty}
      color={t.fin}
      title="See your monthly net"
      detail="Add your salary and the bills that repeat each month, and this shows what a typical month leaves you with."
      action={{ label: "Add scheduled", href: "/finance/planned" }}
    >
      <Tap
        label={`Estimated monthly net ${good ? "" : "minus "}${money(Math.abs(m.net))}`}
        onPress={() => go("/finance/planned")}
      >
        <Frame style={{ padding: 16, gap: 12 }}>
          <Line style={{ justifyContent: "space-between" }}>
            <Copy size={14} weight="medium">
              Estimated monthly net
            </Copy>
            <ChevronRight size={16} color={t.muted} />
          </Line>
          <View style={{ gap: 2 }}>
            <Copy
              size={30}
              weight="displayMedium"
              lines={1}
              style={{ color: good ? t.good : t.bad }}
            >
              {good ? "+" : "−"}
              {money(Math.abs(m.net))}
            </Copy>
            <Copy size={12} muted>
              {good
                ? "left over in a typical month"
                : "short in a typical month"}
            </Copy>
          </View>
          <View style={{ gap: 10 }}>
            {rows.map((r) => (
              <View key={r.label} style={{ gap: 4 }}>
                <Line style={{ justifyContent: "space-between" }}>
                  <Copy size={12} muted>
                    {r.label}
                    {r.note ? ` · ${r.note}` : ""}
                  </Copy>
                  <Copy size={12} weight="medium">
                    {money(r.value)}
                  </Copy>
                </Line>
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: t.soft,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      width: `${Math.round((r.value / total) * 100)}%`,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: r.color,
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
          <Copy size={12} muted>
            From what repeats on your schedule, per month. One-off payments and
            what-ifs aren't counted.
          </Copy>
        </Frame>
      </Tap>
    </LockedPreview>
  )
}
