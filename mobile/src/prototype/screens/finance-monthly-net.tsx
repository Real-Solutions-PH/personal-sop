// The monthly net from what repeats (salary, rent, subscriptions,
// instalments), as a footer line inside the cash flow cards. One-off items
// and what-ifs stay out; the Scheduled screen shows the same numbers from
// the same calculation.
import * as C from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import { dayKey } from "@domain/lib/day"
import { Repeat } from "lucide-react-native"
import { Text, View } from "react-native"
import { Copy, Line } from "../native-kit"
import { fonts, useTheme } from "../theme"
import { useMoney } from "./finance"

/** Nothing when no income or bill repeats yet. */
export function RecurringNet({ s }: { s: FinState }) {
  const t = useTheme()
  const money = useMoney()
  const m = C.recurringMonth(s, dayKey())
  if (!m.incomeItems.length && !m.outItems.length) return null
  const good = m.net >= 0
  return (
    <Line
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderColor: t.line,
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <View style={{ paddingTop: 1 }}>
        <Repeat size={14} color={t.muted} />
      </View>
      <Copy size={12} muted style={{ flex: 1 }}>
        Monthly net from what repeats{" "}
        <Text
          style={{
            color: good ? t.good : t.bad,
            fontFamily: fonts.medium,
          }}
        >
          {good ? "+" : "−"}
          {money(Math.abs(m.net))}
        </Text>{" "}
        (in {money(m.income)} · out {money(m.out)})
      </Copy>
    </Line>
  )
}
