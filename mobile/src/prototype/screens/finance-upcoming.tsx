// The Finance home's first answer: what is due from today through the next
// seven days. Overdue bills lead in red, then one group per day that holds
// something, each row with a live countdown, the amount and the account; the
// week's total due sits on the heading. Worked out on the phone from the
// synced store with the same rules the server uses (occurrencesIn), in the
// person's business day, never the UTC calendar.
import * as C from "@domain/finance/calc"
import type { FinState, PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { CalendarClock, CloudOff } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { syncReady } from "@/live/ready"
import { border, Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, useNow } from "../ui"
import { useMoney } from "./finance"
import { FinPill, PlannedIcon } from "./finance-planned"
import { Dimmed, EmptyFoot } from "./locked-preview"

/** Rows drawn before "Show N more": the week fits on a phone's first
 * screen with the net worth card above it. */
const FIRST_ROWS = 5

export function UpcomingWeek() {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    sync = syncReady((x) => x),
    // A minute tick keeps the countdowns honest and moves the list on at
    // the day's rollover without leaving the page.
    now = useNow(60_000),
    [all, setAll] = useState(false)
  if (!sync.ready) return <UpcomingLoading />
  if (sync.failed) return <UpcomingError />
  const week = C.upcomingWeek(s),
    rows = [
      ...week.overdue.map((o) => ({ o, group: "Overdue" })),
      ...week.days.flatMap((d) =>
        d.items.map((o) => ({ o, group: C.dayLabel(d.day) })),
      ),
    ],
    shown = all ? rows : rows.slice(0, FIRST_ROWS),
    signed = (p: PlannedItem) =>
      `${p.type === "income" ? "+" : p.type === "expense" ? "−" : ""}${money(p.amount)}`
  if (!rows.length) return <UpcomingEmpty s={s} />
  return (
    <View testID="upcoming-week">
      <Heading
        total={week.dueTotal ? `${money(week.dueTotal)} due` : undefined}
      />
      <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
        {shown.map(({ o, group }, i) => {
          const c = C.countdown(o.day, new Date(now)),
            paid = o.status === "paid",
            first = i === 0 || shown[i - 1].group !== group
          return (
            <View key={`${o.item.id}-${o.orig}`}>
              {first && (
                <Copy
                  size={12}
                  weight="medium"
                  style={{
                    color: group === "Overdue" ? t.bad : t.muted,
                    paddingHorizontal: 4,
                    paddingTop: i ? 12 : 8,
                  }}
                >
                  {group}
                </Copy>
              )}
              <Tap
                label={`${o.item.name}, ${signed(o.item)}, ${paid ? "paid" : c.label}`}
                onPress={() =>
                  go(
                    paid && o.recordId
                      ? `/finance/records/${o.recordId}`
                      : `/finance/planned/${o.item.id}`,
                  )
                }
              >
                <Line
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 4,
                    alignItems: "flex-start",
                    opacity: paid ? 0.6 : 1,
                  }}
                >
                  <PlannedIcon p={o.item} />
                  <View style={{ flex: 1, gap: 2 }}>
                    {/* The name wraps; it is never cut. */}
                    <Copy weight="medium">{o.item.name}</Copy>
                    <Copy size={13} muted>
                      {accountOf(s, o.item)}
                    </Copy>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Copy
                      weight="semibold"
                      style={{
                        color:
                          o.item.type === "income"
                            ? t.fin
                            : c.state === "overdue" && !paid
                              ? t.bad
                              : t.text,
                      }}
                    >
                      {signed(o.item)}
                    </Copy>
                    {paid ? (
                      <FinPill tone="good">paid</FinPill>
                    ) : (
                      <FinPill tone={TONE[c.state]}>{c.label}</FinPill>
                    )}
                  </View>
                </Line>
              </Tap>
            </View>
          )
        })}
        {rows.length > FIRST_ROWS && (
          <Tap
            onPress={() => setAll(!all)}
            label={all ? "Show fewer" : `Show ${rows.length - FIRST_ROWS} more`}
          >
            <Copy
              size={13}
              weight="medium"
              style={{
                color: t.fin,
                paddingHorizontal: 4,
                paddingVertical: 10,
                borderTopWidth: 1,
                borderColor: border(t.line, 0.6),
              }}
            >
              {all ? "Show fewer" : `Show ${rows.length - FIRST_ROWS} more`}
            </Copy>
          </Tap>
        )}
      </Frame>
      {week.incomeTotal > 0 && (
        <Copy size={12} muted style={{ paddingHorizontal: 4, marginTop: 6 }}>
          {money(week.incomeTotal)} coming in this week
        </Copy>
      )}
    </View>
  )
}

const TONE = {
  overdue: "bad",
  today: "warn",
  soon: "warn",
  later: "muted",
} as const

function accountOf(s: FinState, p: PlannedItem) {
  const name = (id?: string) =>
    s.accounts.find((a) => a.id === id && !a.archived)?.name ?? "No account"
  return p.type === "transfer"
    ? `${name(p.accountId)} → ${name(p.toAccountId)}`
    : name(p.accountId)
}

function Heading({ total }: { total?: string }) {
  const t = useTheme()
  return (
    <SectionHeading
      action={
        <Tap onPress={() => go("/finance/planned")} label="All scheduled">
          {/* The week's total is a figure, not good news: neutral ink. */}
          <Copy
            size={12}
            weight={total ? "semibold" : "body"}
            style={{ color: total ? t.text : t.fin }}
          >
            {total ?? "All scheduled"}
          </Copy>
        </Tap>
      }
    >
      Next 7 days
    </SectionHeading>
  )
}

/** Nothing due this week: the real rows, dimmed, under one line that says
 * when the next one is or how to add the first. */
function UpcomingEmpty({ s }: { s: FinState }) {
  const t = useTheme(),
    today = C.today(),
    next = C.occurrencesIn(s, today, C.addDays(today, 400)).find(
      (o) => o.status !== "paid" && o.status !== "skipped",
    )
  return (
    <View testID="upcoming-week-empty">
      <Heading />
      <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
        <Dimmed>
          {SAMPLE.map((x) => (
            <Line
              key={x.name}
              style={{ paddingVertical: 8, paddingHorizontal: 4 }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: t.soft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <CalendarClock size={18} color={t.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Copy weight="medium">{x.name}</Copy>
                <Copy size={13} muted>
                  {x.account}
                </Copy>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Copy weight="semibold">{x.amount}</Copy>
                <FinPill tone={x.tone}>{x.when}</FinPill>
              </View>
            </Line>
          ))}
        </Dimmed>
        <View style={{ paddingHorizontal: 4, paddingBottom: 12 }}>
          <EmptyFoot
            testID="upcoming-week-hint"
            hint={
              next
                ? `Nothing due this week. Next: ${next.item.name}, ${C.dayLabel(next.day)}.`
                : "Bills and income you schedule show here the week they fall due."
            }
            action={
              next
                ? undefined
                : { label: "Schedule one", href: "/finance/planned" }
            }
          />
        </View>
      </Frame>
    </View>
  )
}
const SAMPLE = [
  {
    name: "Rent",
    account: "BPI Savings",
    amount: "−₱18,000",
    when: "Due tomorrow",
    tone: "warn",
  },
  {
    name: "Internet",
    account: "GCash",
    amount: "−₱1,699",
    when: "In 4 days",
    tone: "muted",
  },
] as const

function UpcomingLoading() {
  const t = useTheme()
  return (
    <View testID="upcoming-week-loading" accessibilityLabel="Loading">
      <Heading />
      <Frame style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        {[0, 1].map((i) => (
          <Line key={i} style={{ paddingVertical: 8 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: t.soft,
              }}
            />
            <View style={{ flex: 1, gap: 6 }}>
              <View
                style={{
                  width: "55%",
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: t.soft,
                }}
              />
              <View
                style={{
                  width: "35%",
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: t.soft,
                }}
              />
            </View>
          </Line>
        ))}
      </Frame>
    </View>
  )
}

function UpcomingError() {
  const t = useTheme(),
    [trying, setTrying] = useState(false)
  const retry = () => {
    setTrying(true)
    // Lazily, like every screen: the live runtime is not loaded in demo mode.
    ;(require("@/live/runtime") as typeof import("@/live/runtime")).syncNow()
    setTimeout(() => setTrying(false), 8000)
  }
  return (
    <View testID="upcoming-week-error">
      <Heading />
      <Frame style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
        <Line style={{ gap: 10 }}>
          <CloudOff size={18} color={t.bad} />
          <Copy weight="medium" style={{ flex: 1 }}>
            Couldn’t load your scheduled payments
          </Copy>
        </Line>
        <Button small tone="quiet" disabled={trying} onPress={retry}>
          {trying ? "Trying again…" : "Try again"}
        </Button>
      </Frame>
    </View>
  )
}
