// Focus over a period (ADR-0025): hours per day against the daily goal, the
// goal streak, and where the time went by task and habit.

import * as C from "@domain/focus/calc"
import * as L from "@domain/focus/logic"
import * as P from "@domain/focus/past"
import { useFocusState } from "@domain/focus/store"
import { dayKey } from "@domain/lib/day"
import { Flame, Play } from "lucide-react-native"
import { useMemo, useState } from "react"
import { View } from "react-native"
import { Copy, Frame, Line, Segmented, Tap } from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Screen, useNow } from "../ui"
import { LockedPreview } from "./locked-preview"

type Period = "7" | "30"

export function FocusStats() {
  const t = useTheme(),
    s = useFocusState(),
    now = useNow(),
    [period, setPeriod] = useState<Period>("7"),
    days = Number(period),
    today = dayKey(new Date(now)),
    first = C.addDays(today, -(days - 1)),
    r = useMemo(
      () => C.rangeStats(s, first, today, now),
      [s, first, today, now],
    ),
    prev = useMemo(
      () => C.rangeStats(s, C.addDays(first, -days), C.addDays(first, -1), now),
      [s, first, days, now],
    ),
    goal = C.goalSec(s),
    streak = useMemo(() => C.streaks(s, 400, now), [s, now]),
    items = useMemo(() => C.itemTotals(P.withLabels(s, r.spans)), [s, r]),
    total = Object.values(r.byDay).reduce((a, b) => a + b, 0),
    prevTotal = Object.values(prev.byDay).reduce((a, b) => a + b, 0),
    due = C.dueDays(s, first, today, today),
    onGoal = due.filter((d) => goal > 0 && (r.byDay[d] ?? 0) >= goal).length,
    rate = C.areaRate(s, first, today, now)
  const delta = Math.round((total - prevTotal) / 60)
  return (
    <Screen title="Focus stats">
      <Segmented
        value={period}
        onChange={setPeriod}
        options={[
          { value: "7", label: "7 days" },
          { value: "30", label: "30 days" },
        ]}
      />
      <LockedPreview
        locked={!total && !prevTotal}
        title="No focus time yet"
        detail="Start a Pomodoro or the stopwatch and your hours, goal streak and time by item fill in here."
        action={{ label: "Start focusing", onPress: () => go("/focus") }}
        color={t.foc}
        icon={Play}
        gap={12}
      >
        <Frame style={{ padding: 16, gap: 12, marginTop: 12 }}>
          <Line style={{ alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Copy
                size={36}
                style={{ fontFamily: fonts.mono, lineHeight: 44 }}
              >
                {L.fmtHm(total)}
              </Copy>
              <Copy size={12} muted>
                focused · {delta >= 0 ? "+" : "−"}
                {L.fmtHm(Math.abs(delta) * 60)} vs the {days} days before
              </Copy>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Line style={{ gap: 4 }}>
                <Flame size={16} color={t.foc} />
                <Copy size={20} style={{ fontFamily: fonts.mono }}>
                  {streak.current.toLocaleString("en-US")}
                </Copy>
              </Line>
              <Copy size={12} muted>
                day streak · best {streak.best.toLocaleString("en-US")}
              </Copy>
            </View>
          </Line>
          <GoalBars
            byDay={r.byDay}
            goal={goal}
            days={L.daysBetween(first, today)}
          />
          <Line style={{ gap: 16 }}>
            <Mini
              value={due.length ? L.fmtHm(total / due.length) : "—"}
              label="a day"
            />
            <Mini
              value={`${onGoal.toLocaleString("en-US")}/${due.length.toLocaleString("en-US")}`}
              label="days on goal"
            />
            <Mini
              value={rate === null ? "—" : `${Math.round(rate * 100)}%`}
              label="of goal, average"
            />
          </Line>
        </Frame>
        <Frame style={{ padding: 16, gap: 10 }}>
          <Copy weight="semibold">Where the time went</Copy>
          {items.slice(0, 8).map((x) => (
            <Tap
              key={x.item ? L.itemKey(x.item) : "none"}
              label={x.item?.title ?? "Nothing in particular"}
              onPress={() =>
                x.item &&
                // A logged session's label is not a task or habit to open.
                !x.item.id.startsWith("label:") &&
                go(
                  x.item.kind === "task"
                    ? `/tasks/task/${x.item.id}`
                    : `/habits/${x.item.id}`,
                )
              }
            >
              <View style={{ gap: 4 }}>
                <Line>
                  <Copy lines={1} style={{ flex: 1 }}>
                    {x.item?.title ?? "Nothing in particular"}
                  </Copy>
                  <Copy style={{ fontFamily: fonts.mono }}>
                    {L.fmtHm(x.sec)}
                  </Copy>
                </Line>
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: t.soft,
                  }}
                >
                  <View
                    style={{
                      height: 6,
                      borderRadius: 3,
                      width: `${(x.sec / Math.max(1, items[0].sec)) * 100}%`,
                      backgroundColor:
                        x.item?.kind === "habit"
                          ? t.hab
                          : x.item
                            ? t.tsk
                            : t.muted,
                    }}
                  />
                </View>
              </View>
            </Tap>
          ))}
          {!items.length && (
            <Copy size={14} muted>
              Pick a task or habit on the timer to see time by item.
            </Copy>
          )}
        </Frame>
      </LockedPreview>
    </Screen>
  )
}

function Mini({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Copy size={18} style={{ fontFamily: fonts.mono }}>
        {value}
      </Copy>
      <Copy size={12} muted lines={1}>
        {label}
      </Copy>
    </View>
  )
}

/** Hours per day, with the goal as a line across. */
function GoalBars({
  byDay,
  goal,
  days,
}: {
  byDay: Record<string, number>
  goal: number
  days: string[]
}) {
  const t = useTheme()
  const max = Math.max(goal, ...days.map((d) => byDay[d] ?? 0), 1)
  const H = 120
  const short = days.length > 10
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Focus per day: ${days
        .map((d) => `${d} ${L.fmtHm(byDay[d] ?? 0)}`)
        .join(", ")}`}
    >
      <View
        style={{
          height: H,
          flexDirection: "row",
          alignItems: "flex-end",
          gap: short ? 2 : 6,
        }}
      >
        {days.map((d) => {
          const v = byDay[d] ?? 0
          return (
            <View
              key={d}
              style={{
                flex: 1,
                height: Math.max(2, (v / max) * H),
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                backgroundColor: goal && v >= goal ? t.foc : `${t.foc}66`,
              }}
            />
          )
        })}
        {goal > 0 && (
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: (goal / max) * H,
              borderTopWidth: 1,
              borderStyle: "dashed",
              borderColor: t.muted,
            }}
          />
        )}
      </View>
      <Line style={{ gap: short ? 2 : 6, marginTop: 4 }}>
        {days.map((d, i) => (
          <Copy
            key={d}
            size={10}
            muted
            style={{ flex: 1, textAlign: "center" }}
          >
            {short
              ? i % 5 === 0
                ? d.slice(8)
                : ""
              : new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
                  weekday: "narrow",
                })}
          </Copy>
        ))}
      </Line>
    </View>
  )
}
