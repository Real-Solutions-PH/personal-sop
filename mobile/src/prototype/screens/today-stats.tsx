// The key numbers of each module, at a glance on Today: three stats and a
// seven-day bar chart per module, so nobody has to open a stats page to see
// how the week is going. Each strip reads the module's own store.
import * as N from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import * as F from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import * as H from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useStats } from "@domain/tasks/hooks"
import { View } from "react-native"
import { GrowBar } from "../motion"
import { Copy, Line, Part } from "../native-kit"
import { type Accent, useTheme } from "../theme"
import { useMoney } from "./finance"

type Stat = { value: string; label: string; tone?: "good" | "warn" | "bad" }

const last7 = () => Array.from({ length: 7 }, (_, i) => dayOffset(i - 6))
const weekday = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "narrow" })

/** Three numbers and a 7-day bar chart; today's bar is solid. */
function StatStrip({
  accent,
  stats,
  bars,
  barsLabel,
}: {
  accent: Accent
  stats: Stat[]
  bars: number[]
  barsLabel: string
}) {
  const t = useTheme()
  const days = last7()
  const max = Math.max(1, ...bars)
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
          {bars.map((v, i) => (
            <View
              key={days[i]}
              style={{ flex: 1, height: "100%", justifyContent: "flex-end" }}
            >
              <GrowBar
                index={i}
                height={`${Math.max(v > 0 ? 6 : 2, (v / max) * 100)}%`}
                style={{
                  borderRadius: 3,
                  backgroundColor:
                    i === 6 ? t[accent] : v > 0 ? `${t[accent]}80` : t.soft,
                }}
              />
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
