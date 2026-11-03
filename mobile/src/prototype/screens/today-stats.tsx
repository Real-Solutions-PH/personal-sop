// The key numbers of each module, at a glance on Today: three stats and a
// seven-day bar chart per module, so nobody has to open a stats page to see
// how the week is going. Each strip reads the module's own store.
import { useGoals } from "@domain/dash/hooks"
import * as N from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import * as F from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import * as FC from "@domain/focus/calc"
import { fmtHm } from "@domain/focus/logic"
import { focusStore } from "@domain/focus/store"
import * as H from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useStats } from "@domain/tasks/hooks"
import { View } from "react-native"
import { LineStem } from "../brand/line"
import { GrowBar } from "../motion"
import { Copy, Line, Part } from "../native-kit"
import { type Accent, useTheme } from "../theme"
import { useMoney } from "./finance"

type Stat = { value: string; label: string; tone?: "good" | "warn" | "bad" }

const last7 = (today?: string) =>
  Array.from({ length: 7 }, (_, i) =>
    today ? FC.addDays(today, i - 6) : dayOffset(i - 6),
  )
const weekday = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "narrow" })

/** Three numbers and a 7-day bar chart; today's bar is solid. A `goal`
 * draws a dashed line at that height across the bars. */
function StatStrip({
  accent,
  stats,
  bars,
  barsLabel,
  goal,
}: {
  accent: Accent
  stats: Stat[]
  bars: number[]
  barsLabel: string
  goal?: number
}) {
  const t = useTheme()
  const days = last7()
  const max = Math.max(1, ...bars, goal ?? 0)
  return (
    <Part style={{ gap: 12 }}>
      <Line style={{ gap: 8, alignItems: "flex-start" }}>
        {stats.map((s) => (
          <View key={s.label} style={{ flex: 1, gap: 2 }}>
            <Copy
              size={18}
              weight="semibold"
              lines={1}
              style={{ color: s.tone ? t[s.tone] : t.text }}
            >
              {s.value}
            </Copy>
            <Copy size={11} muted lines={2}>
              {s.label}
            </Copy>
          </View>
        ))}
      </Line>
      <View accessible accessibilityLabel={barsLabel} style={{ gap: 4 }}>
        <Line style={{ height: 40, alignItems: "flex-end", gap: 6 }}>
          {goal ? (
            <View
              testID="strip-goal-line"
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: `${(goal / max) * 100}%`,
                borderTopWidth: 1,
                borderStyle: "dashed",
                borderColor: t.good,
              }}
            />
          ) : null}
          {bars.map((v, i) => (
            <View
              key={days[i]}
              style={{ flex: 1, height: "100%", justifyContent: "flex-end" }}
            >
              <GrowBar
                index={i}
                height={`${Math.max(v > 0 ? 6 : 2, (v / max) * 100)}%`}
              >
                {/* Hand-drawn stems, no leaves (ADR-0032); today at full
                    strength, past days softer, empty days a faint stub. */}
                <LineStem
                  color={v > 0 ? t[accent] : t.soft}
                  width={5}
                  seed={i + 1}
                  opacity={i === 6 || v === 0 ? 1 : 0.55}
                />
              </GrowBar>
            </View>
          ))}
        </Line>
        <Line style={{ gap: 6 }}>
          {days.map((d, i) => (
            <Copy
              key={d}
              size={10}
              muted
              style={{ flex: 1, textAlign: "center" }}
              weight={i === 6 ? "semibold" : undefined}
            >
              {weekday(d)}
            </Copy>
          ))}
        </Line>
      </View>
    </Part>
  )
}

const pct = (x: number) => `${Math.round(x * 100)}%`

export function HabitsStats() {
  const s = habitsStore.use((s) => s)
  const today = dayKey()
  const idx = H.logIndex(s.logs)
  const live = s.habits.filter((h) => h.status !== "archived")
  const week = H.overallStats(s, 7)
  const days = H.overallDays(live, idx, dayOffset(-6), today, today)
  const best = live.reduce(
    (a, h) => Math.max(a, H.streaks(h, idx, today).current),
    0,
  )
  return (
    <StatStrip
      accent="hab"
      stats={[
        {
          value: week.rated ? pct(week.rate) : "—",
          label: "done this week",
          tone: week.rated && week.rate >= 0.8 ? "good" : undefined,
        },
        { value: `${best}d`, label: "best current streak" },
        { value: String(week.perfect), label: "perfect days, 7d" },
      ]}
      bars={days.map((d) => d.done)}
      barsLabel={`Habits done each day this week: ${days.map((d) => d.done).join(", ")}`}
    />
  )
}

export function TasksStats() {
  const st = useStats(7)
  return (
    <StatStrip
      accent="tsk"
      stats={[
        { value: String(st.done), label: "done this week" },
        {
          value: st.onTimeRate === null ? "—" : pct(st.onTimeRate),
          label: "on time",
          tone:
            st.onTimeRate !== null && st.onTimeRate < 0.6 ? "warn" : undefined,
        },
        {
          value: String(st.overdueNow),
          label: "overdue now",
          tone: st.overdueNow > 0 ? "bad" : "good",
        },
      ]}
      bars={st.perDay.map((d) => d.done)}
      barsLabel={`Tasks done each day this week: ${st.perDay.map((d) => d.done).join(", ")}`}
    />
  )
}

export function FitnessStats() {
  const s = fitStore.use((s) => s)
  const week = F.periodSummary(s, 7)
  const thisWeek = F.sessionsByWeek(s, 1)[0]?.count ?? 0
  const goal = s.settings.weeklyTarget
  const done = F.finished(s)
  const bars = last7().map(
    (d) => done.filter((w) => dayKey(new Date(w.startedAt)) === d).length,
  )
  const tonnes = week.volume / 1000
  return (
    <StatStrip
      accent="fit"
      stats={[
        {
          value: `${thisWeek}/${goal}`,
          label: "workouts this week",
          tone: thisWeek >= goal ? "good" : undefined,
        },
        {
          value:
            tonnes >= 1
              ? `${tonnes.toFixed(1)} t`
              : `${Math.round(week.volume).toLocaleString("en-US")} kg`,
          label: "volume, 7d",
        },
        {
          value: String(week.prs),
          label: "PRs, 7d",
          tone: week.prs ? "good" : undefined,
        },
      ]}
      bars={bars}
      barsLabel={`Workouts each day this week: ${bars.join(", ")}`}
    />
  )
}

export function FinanceStats() {
  const s = finStore.use((s) => s)
  const money = useMoney()
  const today = dayKey()
  const mk = N.monthOf(today, s.settings.monthStartDay)
  const overall = s.budgets.find((b) => !b.archived && b.categoryIds === null)
  const view = overall ? N.budgetView(s, overall) : null
  const cats = N.catMap(s)
  const bars = last7().map((d) => Math.max(0, N.spendIn(s, d, d, null, cats)))
  const month = N.flowIn(s, ...N.monthRange(mk, s.settings.monthStartDay))
  return (
    <StatStrip
      accent="fin"
      stats={[
        {
          value: money(bars.reduce((a, b) => a + b, 0)),
          label: "spent, 7 days",
        },
        view
          ? {
              value: pct(view.pct),
              label: "of budget used",
              tone:
                view.pct > 1 ? "bad" : view.pct > view.pace ? "warn" : "good",
            }
          : { value: money(month.spend), label: "spent this month" },
        {
          value: `${month.income - month.spend >= 0 ? "+" : "−"}${money(Math.abs(month.income - month.spend))}`,
          label: "net this month",
          tone: month.income - month.spend >= 0 ? "good" : "bad",
        },
      ]}
      bars={bars}
      barsLabel={`Spent each day this week: ${bars.map((b) => money(b)).join(", ")}`}
    />
  )
}

export function FocusStats() {
  const f = focusStore.use((x) => x)
  const goals = useGoals()
  const today = dayKey()
  const figures = focusWeek(
    f,
    today,
    goals.find((g) => g.goal.metric === "focus:goalDays")?.goal.target,
  )
  return (
    <StatStrip
      accent="foc"
      goal={figures.goal || undefined}
      stats={[
        {
          value: `${figures.onGoal}/${figures.target}`,
          label: "days on goal",
          tone:
            figures.onGoal >= figures.target
              ? "good"
              : figures.avg > 0
                ? "warn"
                : undefined,
        },
        {
          value: `${figures.streak.toLocaleString("en-US")}d`,
          label: "goal streak",
          tone: figures.streak > 0 ? "good" : undefined,
        },
        { value: fmtHm(figures.avg), label: "avg a day" },
      ]}
      bars={figures.bars}
      barsLabel={`Focus each day this week: ${figures.bars.map((b) => fmtHm(b)).join(", ")}${figures.goal ? `; goal ${fmtHm(figures.goal)} a day` : ""}`}
    />
  )
}

/** The Focus strip's figures over the seven days ending `today`: days on
 * the daily goal against the weekly target (the "Days on focus goal" goal
 * when set, else every day), the current goal streak, and the average a
 * day over the days since the first session. */
export function focusWeek(
  f: ReturnType<typeof focusStore.get>,
  today: string,
  weeklyTarget?: number,
  now = Date.now(),
) {
  const days = last7(today),
    goal = FC.goalSec(f),
    r = FC.rangeStats(f, days[0], today, now),
    bars = days.map((d) => r.byDay[d] ?? 0),
    onGoal = goal > 0 ? bars.filter((v) => v >= goal).length : 0,
    target = Math.min(7, weeklyTarget ?? 7),
    due = FC.dueDays(f, days[0], today, today).length,
    total = bars.reduce((a, b) => a + b, 0)
  return {
    goal,
    bars,
    onGoal,
    target,
    streak: FC.streaks(f, 400, now).current,
    avg: due ? Math.round(total / due) : 0,
  }
}
