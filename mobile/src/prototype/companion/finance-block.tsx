// Fern's money card (the ``finance`` block): drawn with a reply about money,
// from the phone's synced finance records, the same way the nutrition card
// draws the day's food. What was spent on the reply's day leads; the
// month's budget is one bar with the expected spend marked on it; the next
// seven days' bills follow with their live countdowns. No new numbers:
// every figure comes from the Finance home's own calc.
import * as N from "@domain/finance/calc"
import type { PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { CalendarCheck, CalendarClock, Wallet } from "lucide-react-native"
import { View } from "react-native"
import { syncReady } from "@/live/ready"
import { Bar, border, Copy, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useMoney } from "../screens/finance"
import { SpentLeft } from "../screens/finance-home-cards"
import { FinPill, PlannedIcon } from "../screens/finance-planned"
import { EmptyFoot } from "../screens/locked-preview"
import { fonts, useTheme } from "../theme"
import { useNow } from "../ui"

/** Bills drawn on the card; the rest is one tap away on Finance. */
const SHOWN = 3
// Drawn dimmed when there is no budget yet: a plausible month.
const SAMPLE = { limit: 15000, spent: 5700, pct: 0.38, pace: 0.45 }
const TONE = {
  overdue: "bad",
  today: "warn",
  soon: "warn",
  later: "muted",
} as const

export function FinanceBlock({ day }: { day: string }) {
  const t = useTheme(),
    s = finStore.use((s) => s),
    money = useMoney(),
    sync = syncReady((x) => x),
    now = useNow(60_000),
    today = dayKey(),
    isToday = day === today
  const heading = (
    <Line style={{ gap: 6 }}>
      <Wallet size={14} color={t.fin} />
      <Copy size={12} weight="medium" muted>
        {`MONEY · ${isToday ? "TODAY" : N.dayLabel(day).toUpperCase()}`}
      </Copy>
    </Line>
  )
  if (!sync.ready || sync.failed)
    return (
      <View style={{ gap: 8 }} testID="finance-block-pending">
        {heading}
        <Copy size={13} muted>
          {sync.failed
            ? "Couldn't load your money. It shows once the app syncs."
            : "Loading your money…"}
        </Copy>
      </View>
    )
  const spent = N.flowIn(s, day, day).spend,
    real = N.budgetSummary(s),
    sum = real ?? SAMPLE,
    over = sum.spent > sum.limit,
    week = N.upcomingWeek(s),
    bills = [...week.overdue, ...week.days.flatMap((d) => d.items)].filter(
      (o) => o.status !== "paid",
    ),
    signed = (p: PlannedItem) =>
      `${p.type === "income" ? "+" : p.type === "expense" ? "−" : ""}${money(p.amount)}`
  return (
    <View style={{ gap: 14 }} testID="finance-block">
      <Tap label="Open finance" onPress={() => go("/finance")}>
        <View style={{ gap: 12 }}>
          {heading}
          <Line style={{ alignItems: "flex-end", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Copy size={12} muted>
                {isToday ? "Spent today" : "Spent that day"}
              </Copy>
              <Copy size={28} weight="display" fit>
                {money(spent)}
              </Copy>
            </View>
            {real && (
              <View style={{ alignItems: "flex-end" }}>
                <Copy size={12} muted>
                  Safe to spend / day
                </Copy>
                <Copy
                  size={16}
                  weight="semibold"
                  style={{ color: real.safePerDay > 0 ? t.fin : t.bad }}
                >
                  {money(real.safePerDay)}
                </Copy>
              </View>
            )}
          </Line>
          <View style={{ gap: 6, opacity: real ? 1 : 0.32 }}>
            <Line style={{ justifyContent: "space-between", gap: 8 }}>
              <Copy size={12} style={{ flex: 1 }}>
                {real?.source === "categories"
                  ? `This month · ${real.count} budgets`
                  : "This month's budget"}
              </Copy>
              <SpentLeft spent={sum.spent} limit={sum.limit} />
            </Line>
            {/* Left of the budget, with where it should be by today marked. */}
            <Bar
              value={Math.max(0, 1 - sum.pct)}
              color={over ? t.bad : sum.pct > sum.pace ? t.warn : t.fin}
              target={Math.max(0, 1 - sum.pace)}
            />
          </View>
        </View>
      </Tap>
      {!real && (
        <EmptyFoot
          testID="finance-block-no-budget"
          hint="A monthly budget shows what is safe to spend each day."
          action={{ label: "Set budget", href: "/finance/budgets?new=1" }}
        />
      )}
      <View
        style={{
          gap: 8,
          borderTopWidth: 1,
          borderColor: border(t.line, 0.5),
          paddingTop: 10,
        }}
      >
        <Line style={{ gap: 6 }}>
          {bills.length ? (
            <CalendarClock size={14} color={t.muted} />
          ) : (
            <CalendarCheck size={14} color={t.fin} />
          )}
          <Copy size={12} weight="medium" muted style={{ flex: 1 }}>
            {bills.length ? "NEXT 7 DAYS" : "Nothing due in the next 7 days"}
          </Copy>
          {week.dueTotal > 0 && (
            <Copy size={12} weight="semibold">
              {`${money(week.dueTotal)} due`}
            </Copy>
          )}
        </Line>
        {bills.slice(0, SHOWN).map((o) => {
          const c = N.countdown(o.day, new Date(now))
          return (
            <Tap
              key={`${o.item.id}-${o.orig}`}
              label={`${o.item.name}, ${signed(o.item)}, ${c.label}`}
              onPress={() => go(`/finance/planned/${o.item.id}`)}
            >
              <Line style={{ alignItems: "flex-start", gap: 10 }}>
                <PlannedIcon p={o.item} />
                {/* The name wraps; it is never cut. */}
                <Copy size={14} weight="medium" style={{ flex: 1 }}>
                  {o.item.name}
                </Copy>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Copy
                    size={14}
                    weight="semibold"
                    style={{
                      color:
                        o.item.type === "income"
                          ? t.fin
                          : c.state === "overdue"
                            ? t.bad
                            : t.text,
                    }}
                  >
                    {signed(o.item)}
                  </Copy>
                  <FinPill tone={TONE[c.state]}>{c.label}</FinPill>
                </View>
              </Line>
            </Tap>
          )
        })}
        {bills.length > SHOWN && (
          <Tap label="See all upcoming" onPress={() => go("/finance")}>
            <Copy
              size={12}
              style={{ color: t.fin, fontFamily: fonts.medium }}
            >{`${bills.length - SHOWN} more on Finance`}</Copy>
          </Tap>
        )}
      </View>
    </View>
  )
}
