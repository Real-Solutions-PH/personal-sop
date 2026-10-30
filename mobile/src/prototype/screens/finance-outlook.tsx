import type { Occurrence } from "@domain/finance/calc"
import * as N from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { useState } from "react"
import { View } from "react-native"
import { FinanceLineChart } from "../chart"
import {
  Copy,
  Frame,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { useMoney } from "./finance"
import { FinPill } from "./finance-planned"

const SHOWN = 8

/** What is scheduled from today on: every bill and income still to come
 * (overdue ones too), what they add up to, and the balance on hand they
 * lead to day by day, lowest point marked. "This month" runs to the end of
 * the budget month; "3 months" looks 90 days ahead. */
export function FinanceOutlook() {
  const t = useTheme()
  const s = finStore.use((s) => s)
  const money = useMoney()
  const [range, setRange] = useState<"month" | "90">("month")
  const [all, setAll] = useState(false)
  const today = dayKey()
  const mk = N.monthOf(today, s.settings.monthStartDay)
  const to =
    range === "month"
      ? N.monthRange(mk, s.settings.monthStartDay)[1]
      : N.addDays(today, 90)
  const o = N.outlook(s, to)
  const items = all ? o.items : o.items.slice(0, SHOWN)
  const dip = o.low.value < 0
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
        {range === "month"
          ? `Rest of ${N.monthLabel(mk, true)}`
          : "Next 3 months"}
      </SectionHeading>
      <Segmented
        value={range}
        onChange={(v) => {
          setRange(v as "month" | "90")
          setAll(false)
        }}
        options={[
          { value: "month", label: "This month" },
          { value: "90", label: "3 months" },
        ]}
      />
      <Frame style={{ padding: 16, marginTop: 12, gap: 16 }}>
        <Line style={{ gap: 8, alignItems: "flex-start" }}>
          {[
            { label: "To pay", value: o.toPay, color: t.bad, sign: "−" },
            { label: "Coming in", value: o.comingIn, color: t.good, sign: "+" },
            {
              label: `On hand by ${N.dayLabel(to)}`,
              value: o.end,
              color: o.end < 0 ? t.bad : t.fin,
              sign: "",
            },
          ].map((m) => (
            <View key={m.label} style={{ flex: 1, gap: 2 }}>
              <Copy
                size={18}
                weight="semibold"
                lines={1}
                style={{ color: m.color }}
              >
                {m.value && m.sign ? m.sign : ""}
                {money(Math.abs(m.value))}
              </Copy>
              <Copy size={12} muted lines={2}>
                {m.label}
              </Copy>
            </View>
          ))}
        </Line>
        <View style={{ gap: 6 }}>
          <FinanceLineChart
            series={[
              {
                values: o.days.map((d) => d.balance),
                color: t.fin,
                area: true,
              },
            ]}
            labels={o.days.map((d) => N.dayLabel(d.day))}
            zero={dip}
            height={150}
          />
          <Copy size={12} muted style={{ color: dip ? t.bad : t.muted }}>
            {o.days.length > 1
              ? `Expected balance on hand, today ${money(o.start)} · lowest ${money(o.low.value)} on ${N.dayLabel(o.low.day)}${dip ? " (below zero)" : ""}`
              : `On hand today ${money(o.start)}`}
          </Copy>
        </View>
      </Frame>
      <Frame
        style={{ paddingHorizontal: 16, paddingVertical: 4, marginTop: 12 }}
      >
        {items.map((x) => (
          <OutlookRow key={`${x.item.id}-${x.orig}`} x={x} />
        ))}
        {o.items.length > SHOWN && (
          <Tap
            onPress={() => setAll(!all)}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Copy
              size={14}
              weight="medium"
              style={{ color: t.fin, textAlign: "center" }}
            >
              {all ? "Show fewer" : `Show all ${o.items.length}`}
            </Copy>
          </Tap>
        )}
        {!o.items.length && (
          <Copy
            size={14}
            muted
            style={{ paddingVertical: 16, textAlign: "center" }}
          >
            Nothing scheduled{" "}
            {range === "month"
              ? "for the rest of the month"
              : "in the next 3 months"}
            .
          </Copy>
        )}
      </Frame>
    </View>
  )
}

/** One scheduled item: icon, name, day with its status, and amount. Tap
 * opens the item. */
export function OutlookRow({ x }: { x: Occurrence }) {
  const t = useTheme()
  const s = finStore.use((s) => s)
  const money = useMoney()
  return (
    <Tap
      onPress={() => go(`/finance/planned/${x.item.id}`)}
      style={{ minHeight: 56, justifyContent: "center" }}
    >
      <Line>
        <View
          style={{
            height: 40,
            width: 40,
            borderRadius: 20,
            backgroundColor: t.soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Copy>
            {s.categories.find((c) => c.id === x.item.categoryId)?.icon ??
              (x.item.type === "income" ? "＋" : "⇄")}
          </Copy>
        </View>
        <View style={{ flex: 1 }}>
          <Copy weight="medium" lines={1}>
            {x.item.name}
          </Copy>
          <Line style={{ gap: 6 }}>
            <Copy size={12} muted>
              {N.dayLabel(x.day)}
            </Copy>
            {x.status === "overdue" && <FinPill tone="bad">overdue</FinPill>}
            {x.status === "due" && <FinPill tone="warn">due</FinPill>}
            {x.item.estimated && <FinPill>estimate</FinPill>}
          </Line>
        </View>
        <Copy
          weight="medium"
          style={{ color: x.item.type === "income" ? t.good : t.text }}
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
  )
}
