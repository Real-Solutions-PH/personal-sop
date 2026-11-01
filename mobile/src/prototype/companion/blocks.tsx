import {
  answerCard,
  confirmCard,
  discardCard,
  ensureCapture,
  findCard,
  redoCard,
  undoCard,
} from "@domain/capture/engine"
import { captureStore } from "@domain/capture/store"
import { toast } from "@domain/capture/toast"
import * as D from "@domain/dash/hooks"
import { dashStore } from "@domain/dash/store"
import { catMap, flowIn, netWorthSeries, spendIn } from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import * as H from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useTodayData } from "@domain/tasks/hooks"
import { tasksStore } from "@domain/tasks/store"
import {
  ArrowRight,
  Brain,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Dumbbell,
  Flame,
  type Lightbulb,
  Radar,
  Repeat2,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react-native"
import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { Trend } from "../chart"
import { Donut, FIN_PALETTE } from "../finance-charts"
import { GrowBar } from "../motion"
import { go } from "../navigation"
import { CaptureSummary } from "../screens/capture-summary"
import { useMoney } from "../screens/finance"
import { NutritionDay } from "../screens/nutrition-day"
import { type Accent, fonts, useTheme } from "../theme"
import { ask, metricLabel } from "./brain"
import {
  addTracker,
  type Block,
  companionStore,
  forget,
  type Metric,
  removeTracker,
  type StepItem,
} from "./store"

const accentOf: Record<Metric, Accent> = {
  life: "life",
  habits: "hab",
  tasks: "tsk",
  spend: "fin",
  spendCats: "fin",
  netWorth: "fin",
  workouts: "fit",
  weight: "fit",
  nutrition: "nut",
}
const days = (n: number) =>
  Array.from({ length: n }, (_, i) => dayOffset(i - n + 1))
/** Sum a daily series into weeks when it is too long to show as bars. */
const weekly = (vals: number[]) => {
  const out: number[] = []
  for (let i = 0; i < vals.length; i += 7)
    out.push(vals.slice(i, i + 7).reduce((a, b) => a + b, 0))
  return out
}
const short = (k: string) =>
  new Date(`${k}T12:00:00`).toLocaleDateString("en-PH", { weekday: "narrow" })

type Series = {
  kind: "line" | "bars" | "donut"
  values: number[]
  labels: string[]
  slices?: { label: string; value: number }[]
  headline: string
  sub: string
}

/** Live series for a metric, computed from the user's own records. */
export function useSeries(metric: Metric, n: number): Series {
  const series = D.useDaySeries(Math.max(n, 7))
  const habits = habitsStore.use((s) => s)
  const tasks = tasksStore.use((s) => s.tasks)
  const fin = finStore.use((s) => s)
  const fit = fitStore.use((s) => s)
  const money = useMoney()
  return useMemo((): Series => {
    const keys = days(n)
    const avg = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
    const bars = (vals: number[], fmt: (v: number) => string, label: string) =>
      n > 31
        ? {
            kind: "line" as const,
            values: weekly(vals),
            labels: [],
            headline: fmt(avg(vals)),
            sub: `${label} · daily average`,
          }
        : {
            kind: "bars" as const,
            values: vals,
            labels: keys.map(short),
            headline: fmt(avg(vals)),
            sub: `${label} · daily average`,
          }
    switch (metric) {
      case "life": {
        const vals = series
          .slice(-n)
          .map((d) => (d.due ? Math.round((d.done / d.due) * 100) : 0))
        return {
          kind: "line",
          values: vals,
          labels: [],
          headline: `${Math.round(avg(vals))}%`,
          sub: "Of each day's plan done, on average",
        }
      }
      case "habits": {
        const idx = H.logIndex(habits.logs)
        const hs = habits.habits.filter((h) => h.status !== "archived")
        const vals = H.overallDays(hs, idx, keys[0], dayKey()).map((d) =>
          Math.round((d.rate ?? 0) * 100),
        )
        return {
          kind: "line",
          values: vals,
          labels: [],
          headline: `${Math.round(avg(vals))}%`,
          sub: "Habits completed per day",
        }
      }
      case "tasks": {
        const vals = keys.map(
          (k) =>
            tasks.filter(
              (t) => t.completedAt && dayKey(new Date(t.completedAt)) === k,
            ).length,
        )
        return bars(vals, (v) => v.toFixed(1), "Tasks done")
      }
      case "spend": {
        const vals = keys.map((k) => Math.max(0, spendIn(fin, k, k, null)))
        return bars(vals, money, "Spending")
      }
      case "spendCats": {
        const f = flowIn(fin, keys[0], dayKey())
        const cats = catMap(fin)
        const slices = [...f.byCat.entries()]
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([id, value]) => ({
            label: cats.get(id)?.name ?? "Other",
            value,
          }))
        return {
          kind: "donut",
          values: slices.map((s) => s.value),
          labels: [],
          slices,
          headline: money(f.spend),
          sub: `Spent in the last ${n} days`,
        }
      }
      case "netWorth": {
        const vals = netWorthSeries(fin, n)
        const change = vals.length ? vals[vals.length - 1] - vals[0] : 0
        return {
          kind: "line",
          values: vals,
          labels: [],
          headline: `${change >= 0 ? "+" : "−"}${money(Math.abs(change))}`,
          sub: `Net worth change over ${n} days`,
        }
      }
      case "workouts": {
        const weeks = C.sessionsByWeek(fit, Math.max(2, Math.ceil(n / 7)))
        return {
          kind: "bars",
          values: weeks.map((w) => w.count),
          labels: weeks.map((w) =>
            new Date(`${w.start}T12:00:00`).toLocaleDateString("en-PH", {
              month: "numeric",
              day: "numeric",
            }),
          ),
          headline: avg(weeks.map((w) => w.count)).toFixed(1),
          sub: "Sessions per week",
        }
      }
      case "weight": {
        const pts = C.weightTrend(fit, n).filter((p) => p.avg !== undefined)
        const vals = pts.map((p) => p.avg as number)
        const change = vals.length > 1 ? vals[vals.length - 1] - vals[0] : 0
        return {
          kind: "line",
          values: vals,
          labels: [],
          headline: vals.length
            ? `${vals[vals.length - 1].toFixed(1)} kg`
            : "—",
          sub: `${change <= 0 ? "▼" : "▲"} ${Math.abs(change).toFixed(1)} kg over ${n} days (7-day average)`,
        }
      }
      case "nutrition": {
        const vals = C.nutritionDays(fit, n).map((d) =>
          Math.round(d.totals.kcal),
        )
        return bars(vals, (v) => `${Math.round(v)} kcal`, "Calories")
      }
    }
  }, [metric, n, series, habits, tasks, fin, fit, money])
}

function Panel({
  children,
  accent,
  index = 0,
}: {
  children: React.ReactNode
  accent?: string
  index?: number
}) {
  const t = useTheme()
  return (
    <Animated.View
      entering={FadeInDown.delay(index * 90)
        .springify()
        .damping(18)}
      style={{
        borderRadius: 18,
        padding: 14,
        gap: 10,
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: accent ? `${accent}40` : t.line,
      }}
    >
      {children}
    </Animated.View>
  )
}

/** The day's food as Fern pulled it up: the same rings and limit bars as the
 * Today card, for the day of the reply (an old reply keeps its own day). */
function NutritionBlock({ day }: { day: string }) {
  const t = useTheme()
  const today = dayKey()
  return (
    <Panel accent={t.nut}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open nutrition"
        onPress={() => go(`/nutrition${day === today ? "" : `?day=${day}`}`)}
        style={{ gap: 12 }}
      >
        <Text
          style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 12 }}
        >
          NUTRITION · {day === today ? "TODAY" : C.fmtDay(day).toUpperCase()}
        </Text>
        <NutritionDay day={day} />
      </Pressable>
    </Panel>
  )
}

function ChartBlock({ metric, n }: { metric: Metric; n: number }) {
  const t = useTheme()
  const s = useSeries(metric, n)
  const color = t[accentOf[metric]]
  const max = Math.max(1, ...s.values)
  return (
    <Panel accent={color}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 12 }}
          >
            {metricLabel(metric).toUpperCase()} · {n === 365 ? "1Y" : `${n}D`}
          </Text>
          <Text
            style={{ color: t.text, fontFamily: fonts.display, fontSize: 28 }}
          >
            {s.headline}
          </Text>
          <Text
            style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}
          >
            {s.sub}
          </Text>
        </View>
      </View>
      {s.kind === "donut" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Donut values={s.values} size={120} />
          <View style={{ flex: 1, gap: 6 }}>
            {s.slices?.map((x, i) => (
              <View
                key={x.label}
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: t[FIN_PALETTE[i % FIN_PALETTE.length]],
                  }}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    color: t.text,
                    fontFamily: fonts.body,
                    fontSize: 12,
                  }}
                >
                  {x.label}
                </Text>
                <Text
                  style={{
                    color: t.muted,
                    fontFamily: fonts.medium,
                    fontSize: 12,
                  }}
                >
                  {Math.round(
                    (x.value /
                      Math.max(
                        1,
                        s.values.reduce((a, b) => a + b, 0),
                      )) *
                      100,
                  )}
                  %
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : s.kind === "bars" ? (
        <View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 3,
              height: 96,
            }}
          >
            {s.values.map((v, i) => (
              <GrowBar
                key={i}
                index={i}
                height={Math.max(2, (v / max) * 96)}
                style={{
                  flex: 1,
                  borderTopLeftRadius: 4,
                  borderTopRightRadius: 4,
                  backgroundColor: color,
                  opacity: i === s.values.length - 1 ? 1 : 0.55,
                }}
              />
            ))}
          </View>
          {s.labels.length <= 14 && (
            <View style={{ flexDirection: "row", gap: 3, marginTop: 4 }}>
              {s.labels.map((l, i) => (
                <Text
                  key={i}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    color: t.muted,
                    fontSize: 10,
                    fontFamily: fonts.body,
                  }}
                >
                  {l}
                </Text>
              ))}
            </View>
          )}
        </View>
      ) : (
        <Trend
          values={s.values}
          label={`${metricLabel(metric)} trend`}
          color={color}
          filled
          height={110}
          includeZero={metric !== "weight" && metric !== "netWorth"}
        />
      )}
    </Panel>
  )
}

type Insight = {
  icon: typeof Lightbulb
  accent: Accent | "good" | "warn"
  title: string
  body: string
  track?: Metric
  href?: string
}

/** Patterns pulled from the last 30 days of records. */
function useInsights(): Insight[] {
  const life = D.useLifeScore(30)
  const target = D.useOnTarget(30)
  const habits = habitsStore.use((s) => s)
  const fin = finStore.use((s) => s)
  const fit = fitStore.use((s) => s)
  const money = useMoney()
  const today = useTodayData()
  return useMemo(() => {
    const out: Insight[] = []
    if (life.score !== null && life.delta !== null)
      out.push({
        icon: life.delta >= 0 ? TrendingUp : TrendingDown,
        accent: life.delta >= 0 ? "good" : "warn",
        title: `Life score ${life.score} · ${life.delta >= 0 ? "up" : "down"} ${Math.abs(life.delta)}`,
        body:
          life.delta >= 0
            ? "You're trending up versus the previous 30 days. Momentum is real — protect it."
            : "A dip versus the previous 30 days. Usually that's one area slipping, not everything.",
        track: "life",
      })
    const areas = Object.entries(life.rates) as [string, number][]
    if (areas.length) {
      const sorted = [...areas].sort((a, b) => b[1] - a[1])
      const [bestK, bestV] = sorted[0]
      const [worstK, worstV] = sorted[sorted.length - 1]
      out.push({
        icon: Radar,
        accent: "hab",
        title: `${cap(bestK)} is carrying you (${Math.round(bestV * 100)}%)`,
        body: `${cap(worstK)} is your softest area at ${Math.round(worstV * 100)}%. A small, daily win there moves your score the most.`,
        track: worstK === "finance" ? "spend" : (worstK as Metric),
      })
    }
    const idx = H.logIndex(habits.logs)
    const hs = habits.habits.filter((h) => h.status !== "archived")
    const missed = H.mostMissedWeekday(hs, idx, dayOffset(-29))
    const FULL: Record<string, string> = {
      Sun: "Sunday",
      Mon: "Monday",
      Tue: "Tuesday",
      Wed: "Wednesday",
      Thu: "Thursday",
      Fri: "Friday",
      Sat: "Saturday",
    }
    const dayName = missed ? (FULL[missed.day] ?? missed.day) : ""
    if (missed)
      out.push({
        icon: Repeat2,
        accent: "hab",
        title: `${dayName}s are your hardest day`,
        body: `${missed.count} missed habit check-ins on ${dayName}s this month. Try lighter versions that day instead of skipping.`,
        track: "habits",
      })
    const now = flowIn(fin, dayOffset(-29), dayKey())
    const prev = flowIn(fin, dayOffset(-59), dayOffset(-30))
    const cats = catMap(fin)
    const top = [...now.byCat.entries()].sort((a, b) => b[1] - a[1])[0]
    if (top) {
      const before = prev.byCat.get(top[0]) ?? 0
      const change = before ? Math.round(((top[1] - before) / before) * 100) : 0
      out.push({
        icon: Wallet,
        accent: "fin",
        title: `${cats.get(top[0])?.name ?? "Top category"}: ${money(top[1])} in 30 days`,
        body: before
          ? `${change >= 0 ? "Up" : "Down"} ${Math.abs(change)}% from the month before. ${change > 15 ? "Worth a budget?" : "Holding steady."}`
          : "Your biggest category this month.",
        track: "spend",
        href: "/finance/reports",
      })
    }
    const weeks = C.sessionsByWeek(fit, 5)
    const thisWeek = weeks[weeks.length - 1]?.count ?? 0
    const avg =
      weeks.slice(0, -1).reduce((a, w) => a + w.count, 0) /
      Math.max(1, weeks.length - 1)
    out.push({
      icon: Dumbbell,
      accent: "fit",
      title: `${thisWeek} workout${thisWeek === 1 ? "" : "s"} this week`,
      body:
        thisWeek >= avg
          ? `At or above your ${avg.toFixed(1)}/week average. Keep the rhythm.`
          : `Below your ${avg.toFixed(1)}/week average — one short session keeps the streak alive.`,
      track: "workouts",
    })
    if (today.overdue.length)
      out.push({
        icon: CalendarClock,
        accent: "warn",
        title: `${today.overdue.length} overdue task${today.overdue.length === 1 ? "" : "s"}`,
        body: "Old tasks drain focus. Do one, reschedule one, delete one.",
        href: "/tasks?filter=overdue",
      })
    out.push({
      icon: Flame,
      accent: "life",
      title: `${target.current}-day on-target streak`,
      body: `Your best is ${target.best}. ${target.current >= target.best && target.best > 0 ? "You're at your record — today extends it." : `${Math.max(0, target.best - target.current)} more days to match it.`}`,
      track: "life",
    })
    return out
  }, [life, target, habits, fin, fit, money, today.overdue.length])
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

function InsightsBlock() {
  const t = useTheme()
  const items = useInsights()
  return (
    <View style={{ gap: 8 }}>
      {items.map((x, i) => (
        <Panel key={x.title} accent={t[x.accent]} index={i}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                backgroundColor: `${t[x.accent]}26`,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <x.icon size={16} color={t[x.accent]} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={{
                  color: t.text,
                  fontFamily: fonts.semibold,
                  fontSize: 14,
                }}
              >
                {x.title}
              </Text>
              <Text
                style={{
                  color: t.muted,
                  fontFamily: fonts.body,
                  fontSize: 13,
                  lineHeight: 18,
                }}
              >
                {x.body}
              </Text>
              <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
                {x.track && (
                  <Text
                    onPress={() =>
                      ask(
                        `Track ${metricLabel(x.track as Metric).toLowerCase()}`,
                      )
                    }
                    style={{
                      color: t[x.accent],
                      fontFamily: fonts.semibold,
                      fontSize: 12,
                    }}
                  >
                    Track this
                  </Text>
                )}
                {x.track && (
                  <Text
                    onPress={() =>
                      ask(
                        `Chart my ${metricLabel(x.track as Metric).toLowerCase()} this month`,
                      )
                    }
                    style={{
                      color: t[x.accent],
                      fontFamily: fonts.semibold,
                      fontSize: 12,
                    }}
                  >
                    See chart
                  </Text>
                )}
                {x.href && (
                  <Text
                    onPress={() => go(x.href as string)}
                    style={{
                      color: t[x.accent],
                      fontFamily: fonts.semibold,
                      fontSize: 12,
                    }}
                  >
                    Open →
                  </Text>
                )}
              </View>
            </View>
          </View>
        </Panel>
      ))}
    </View>
  )
}

/** Life-coach evaluation: what's working, what to focus on, one next step. */
function CoachBlock({ mood }: { mood?: string }) {
  const t = useTheme()
  const life = D.useLifeScore(30)
  const target = D.useOnTarget(30)
  const today = useTodayData()
  const habits = habitsStore.use((s) => s)
  const goals = dashStore.use((s) => s.profile.identities)
  const low = mood === "low"
  const { best, worst, next } = useMemo(() => {
    const areas = (Object.entries(life.rates) as [string, number][]).sort(
      (a, b) => b[1] - a[1],
    )
    const idx = H.logIndex(habits.logs)
    const k = dayKey()
    const dueHabit = habits.habits.find(
      (h) =>
        h.status !== "archived" &&
        H.isDue(h, k) &&
        idx.get(H.lk(h.id, k))?.status !== "done",
    )
    const task = today.overdue[0] ?? today.due[0]
    return {
      best: areas[0],
      worst: areas[areas.length - 1],
      next: low
        ? dueHabit
          ? `${dueHabit.icon} ${dueHabit.name} — the smallest version counts`
          : "Drink a glass of water and take a 10-minute walk"
        : task
          ? `☑︎ ${task.title}`
          : dueHabit
            ? `${dueHabit.icon} ${dueHabit.name}`
            : "Plan tomorrow's top three before bed",
    }
  }, [life.rates, habits, today, low])
  const rows = [
    {
      label: "WORKING",
      accent: "good" as const,
      text: best
        ? `${cap(best[0])} at ${Math.round(best[1] * 100)}% — that consistency is who you're becoming.`
        : "You keep showing up.",
    },
    {
      label: low ? "GO EASY ON" : "FOCUS",
      accent: "warn" as const,
      text: worst
        ? low
          ? `Skip perfect. ${cap(worst[0])} can wait until you've rested.`
          : `${cap(worst[0])} at ${Math.round(worst[1] * 100)}%. One small daily rep here beats a big weekend push.`
        : "Pick one area for this week.",
    },
    { label: "NEXT STEP", accent: "primary" as const, text: next },
  ]
  return (
    <Panel accent={t.hab}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Brain size={16} color={t.hab} />
        <Text style={{ flex: 1, color: t.text, fontFamily: fonts.semibold }}>
          {low
            ? "Gentle check-in"
            : `Coach's read · score ${life.score ?? "—"}`}
        </Text>
        <Text
          style={{ color: t.life, fontFamily: fonts.semibold, fontSize: 12 }}
        >
          🔥 {target.current}d
        </Text>
      </View>
      {rows.map((r) => (
        <View key={r.label} style={{ gap: 2 }}>
          <Text
            style={{
              color: t[r.accent],
              fontFamily: fonts.bold,
              fontSize: 11,
              letterSpacing: 0.8,
            }}
          >
            {r.label}
          </Text>
          <Text
            style={{
              color: t.text,
              fontFamily: fonts.body,
              fontSize: 14,
              lineHeight: 20,
            }}
          >
            {r.text}
          </Text>
        </View>
      ))}
      {goals.length > 0 && !low && (
        <Text
          style={{
            color: t.muted,
            fontFamily: fonts.body,
            fontSize: 12,
            fontStyle: "italic",
          }}
        >
          Remember: “{goals[0].text}”
        </Text>
      )}
    </Panel>
  )
}

function PlanBlock() {
  const t = useTheme()
  const today = useTodayData()
  const habits = habitsStore.use((s) => s)
  const items = useMemo(() => {
    const k = dayKey()
    const idx = H.logIndex(habits.logs)
    const hs = habits.habits
      .filter(
        (h) =>
          h.status !== "archived" &&
          H.isDue(h, k) &&
          idx.get(H.lk(h.id, k))?.status !== "done",
      )
      .map((h) => ({
        id: h.id,
        time: H.slotFor(h.schedule, k)?.time ?? "",
        title: `${h.icon} ${h.name}`,
        href: `/habits/${h.id}`,
        accent: "hab" as const,
      }))
    const ts = [...today.overdue.slice(0, 2), ...today.due]
      .slice(0, 5)
      .map((x) => ({
        id: x.id,
        time: x.dueTime ?? "",
        title: x.title,
        href: `/tasks/task/${x.id}`,
        accent: "tsk" as const,
      }))
    return [...hs, ...ts]
      .sort((a, b) => (a.time || "99").localeCompare(b.time || "99"))
      .slice(0, 7)
  }, [today, habits])
  if (!items.length)
    return (
      <Panel>
        <Text style={{ color: t.text, fontFamily: fonts.body }}>
          Nothing pending — today's yours. Rest counts as progress.
        </Text>
      </Panel>
    )
  return (
    <Panel accent={t.tsk}>
      {items.map((x, i) => (
        <Pressable
          cssInterop={false}
          key={x.id}
          accessibilityRole="button"
          onPress={() => go(x.href)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text
            style={{
              width: 22,
              color: t.muted,
              fontFamily: fonts.display,
              fontSize: 16,
            }}
          >
            {i + 1}
          </Text>
          <View
            style={{
              width: 4,
              height: 28,
              borderRadius: 2,
              backgroundColor: t[x.accent],
            }}
          />
          <Text
            numberOfLines={1}
            style={{ flex: 1, color: t.text, fontFamily: fonts.medium }}
          >
            {x.title}
          </Text>
          <Text
            style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}
          >
            {x.time || "any time"}
          </Text>
        </Pressable>
      ))}
      <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}>
        Hardest first, while your energy is high. I'll check in tonight.
      </Text>
    </Panel>
  )
}

/** A tracked metric with today's value against its goal and a mini trend. */
export function TrackerCard({
  id,
  compact = false,
}: {
  id: string
  compact?: boolean
}) {
  const t = useTheme()
  const tracker = companionStore.use((s) => s.trackers.find((x) => x.id === id))
  const s = useSeries(tracker?.metric ?? "life", 14)
  if (!tracker) return null
  const color = t[accentOf[tracker.metric]]
  const latest = s.values[s.values.length - 1] ?? 0
  const ok =
    tracker.goal === undefined
      ? null
      : tracker.direction === "above"
        ? latest >= tracker.goal
        : latest <= tracker.goal
  return (
    <Panel accent={color}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Target size={16} color={color} />
        <Text style={{ flex: 1, color: t.text, fontFamily: fonts.semibold }}>
          {tracker.label}
        </Text>
        {ok !== null && (
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 10,
              backgroundColor: ok ? `${t.good}26` : `${t.warn}26`,
            }}
          >
            <Text
              style={{
                color: ok ? t.good : t.warn,
                fontFamily: fonts.semibold,
                fontSize: 11,
              }}
            >
              {ok ? "On track" : "Drifting"}
            </Text>
          </View>
        )}
        {!compact && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Stop tracking ${tracker.label}`}
            onPress={() => removeTracker(id)}
            hitSlop={8}
          >
            <X size={14} color={t.muted} />
          </Pressable>
        )}
      </View>
      <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}>
        {s.headline} · {s.sub.toLowerCase()}
        {tracker.goal !== undefined
          ? ` · goal ${tracker.direction === "above" ? "≥" : "≤"} ${tracker.goal.toLocaleString()}`
          : ""}
      </Text>
      {!compact && (
        <Trend
          values={s.values}
          label={`${tracker.label} trend`}
          color={color}
          filled
          height={60}
        />
      )}
    </Panel>
  )
}

function MemoryBlock() {
  const t = useTheme()
  const memories = companionStore.use((s) => s.memories)
  const identities = dashStore.use((s) => s.profile.identities)
  return (
    <Panel accent={t.hab}>
      {identities.map((i) => (
        <Text key={i.id} style={{ color: t.text, fontFamily: fonts.body }}>
          ✦ {i.text}
        </Text>
      ))}
      {memories.map((m) => (
        <Pressable
          key={m.id}
          accessibilityRole="button"
          accessibilityHint="Forget this"
          onPress={() => forget(m.id)}
          style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
        >
          <Sparkles size={14} color={t.hab} />
          <Text style={{ flex: 1, color: t.text, fontFamily: fonts.body }}>
            {m.text}
          </Text>
          <X size={12} color={t.muted} />
        </Pressable>
      ))}
      <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts.body }}>
        Say “remember that …” to teach me something new.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => go("/me/memories")}
        style={{
          flexDirection: "row",
          gap: 6,
          alignItems: "center",
          minHeight: 44,
        }}
      >
        <Text style={{ color: t.hab, fontFamily: fonts.medium, fontSize: 14 }}>
          See and edit everything I remember
        </Text>
        <ChevronRight size={14} color={t.hab} />
      </Pressable>
    </Panel>
  )
}

export function Chips({ prompts }: { prompts: string[] }) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {prompts.map((p, i) => (
        <Animated.View key={p} entering={FadeInDown.delay(150 + i * 60)}>
          <Pressable
            cssInterop={false}
            accessibilityRole="button"
            onPress={() => ask(p)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 12,
              minHeight: 34,
              borderRadius: 17,
              borderWidth: 1,
              borderColor: `${t.primary}66`,
              backgroundColor: pressed ? `${t.primary}26` : "transparent",
            })}
          >
            <Text
              style={{
                color: t.primary,
                fontFamily: fonts.medium,
                fontSize: 13,
              }}
            >
              {p}
            </Text>
            <ArrowRight size={12} color={t.primary} />
          </Pressable>
        </Animated.View>
      ))}
    </View>
  )
}

/** A meal Fern logged: each item's calories, macros and its share of the
 * day's limits, so it can be checked before Confirm (and after). */
function StepMeal({ id }: { id: string }) {
  const t = useTheme()
  const card = captureStore.use(() => findCard(id)?.card)
  if (
    card?.payload?.kind !== "meal" ||
    card.state === "undone" ||
    card.state === "discarded"
  )
    return null
  return (
    <View
      style={{
        marginHorizontal: 12,
        marginBottom: 8,
        marginTop: 2,
        padding: 12,
        borderRadius: 10,
        backgroundColor: t.soft,
      }}
    >
      <CaptureSummary card={card} />
    </View>
  )
}

/** A card waiting on an answer (an expense with no category, say): its
 * question and options under the step, since it can't be confirmed until
 * answered. Answering turns it into a proposal, and Confirm appears. */
function StepAsk({ id }: { id: string }) {
  const t = useTheme()
  const card = captureStore.use(() => findCard(id)?.card)
  if (card?.state !== "needs_input" || !card.ask) return null
  return (
    <View
      style={{
        marginHorizontal: 12,
        marginBottom: 8,
        marginTop: 2,
        padding: 12,
        gap: 8,
        borderRadius: 10,
        backgroundColor: t.soft,
      }}
    >
      <Text style={{ color: t.text, fontFamily: fonts.medium, fontSize: 13 }}>
        {card.ask.question}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {card.ask.options.map((o) => (
          <Pressable
            key={o.value}
            cssInterop={false}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            onPress={() => answerCard(id, o.value)}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              minHeight: 32,
              borderRadius: 16,
              justifyContent: "center",
              borderWidth: 1,
              borderColor: `${t.primary}66`,
              backgroundColor: pressed ? `${t.primary}26` : "transparent",
            })}
          >
            <Text
              style={{
                color: t.primary,
                fontFamily: fonts.medium,
                fontSize: 12,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

/** One of a step's card actions; a muted one is the secondary choice, and
 * a disabled one is the real button dimmed while its card loads. */
function StepButton({
  label,
  onPress,
  muted,
  disabled,
}: {
  label: string
  onPress?: () => void
  muted?: boolean
  disabled?: boolean
}) {
  const t = useTheme()
  const color = muted ? t.muted : t.primary
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        paddingHorizontal: 10,
        minHeight: 28,
        borderRadius: 14,
        justifyContent: "center",
        borderWidth: 1,
        borderColor: `${color}66`,
        backgroundColor: pressed ? `${color}26` : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Text style={{ color, fontFamily: fonts.medium, fontSize: 12 }}>
        {label}
      </Text>
    </Pressable>
  )
}

/** The card behind a step's write, live from the capture store once the
 * reply's capture has arrived. A card still waiting whose capture never
 * reached this device (the app was in the background when the reply
 * finished, or it came by push) is fetched, its Confirm dimmed meanwhile.
 * A step from before steps named their capture keeps the reported state. */
function StepCard({
  id,
  state,
  captureId,
}: {
  id: string
  state?: string
  captureId?: string
}) {
  const t = useTheme()
  const live = captureStore.use(() => findCard(id)?.card.state)
  const now = live ?? state
  const loading =
    !live && !!captureId && (now === "proposed" || now === "needs_input")
  useEffect(() => {
    if (loading && captureId) ensureCapture(captureId)
  }, [loading, captureId])
  if (loading) return <StepButton label="Confirm" disabled />
  if (live === "proposed")
    return (
      <View style={{ flexDirection: "row", gap: 6 }}>
        <StepButton
          label="Discard"
          muted
          onPress={() => {
            discardCard(id)
            toast("Discarded")
          }}
        />
        <StepButton
          label="Confirm"
          onPress={() => {
            confirmCard(id)
            toast.success("Saved")
          }}
        />
      </View>
    )
  if (live === "saved" || live === "edited")
    return <StepButton label="Undo" onPress={() => undoCard(id)} />
  if (live === "undone")
    // An entry undone by mistake can be saved again from where it was undone.
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}>
          Undone
        </Text>
        {/* No toast: only a toast with Undo is shown, and the row turning
            back to Undo is the feedback. */}
        <StepButton label="Redo" onPress={() => redoCard(id)} />
      </View>
    )
  if (now === "undone" || now === "discarded")
    return (
      <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}>
        {now === "undone" ? "Undone" : "Discarded"}
      </Text>
    )
  return null
}

/** What Fern did during a reply, one row per tool call (ADR-0015). */
function StepsBlock({ items }: { items: StepItem[] }) {
  const t = useTheme()
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: t.line,
        borderRadius: 12,
        paddingVertical: 4,
        backgroundColor: t.card,
      }}
    >
      {items.map((s) => (
        <View key={s.id}>
          <View
            accessibilityLabel={
              s.running ? `${s.label}…` : s.summary || s.label
            }
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 7,
            }}
          >
            <View style={{ width: 16, alignItems: "center" }}>
              {s.running ? (
                <ActivityIndicator size="small" color={t.muted} />
              ) : s.ok === false ? (
                <CircleAlert size={15} color={t.bad} />
              ) : (
                <Check size={15} color={t.good} />
              )}
            </View>
            <Text
              numberOfLines={2}
              style={{
                flex: 1,
                color: s.running ? t.muted : t.text,
                fontFamily: fonts.body,
                fontSize: 13,
                lineHeight: 18,
              }}
            >
              {s.running ? `${s.label}…` : s.summary || s.label}
            </Text>
            {s.card_id && !s.running ? (
              <StepCard
                id={s.card_id}
                state={s.state}
                captureId={s.capture_id}
              />
            ) : null}
          </View>
          {s.card_id && !s.running ? <StepMeal id={s.card_id} /> : null}
          {s.card_id && !s.running ? <StepAsk id={s.card_id} /> : null}
          {s.running
            ? null
            : (s.cards ?? []).map((c) => (
                <View
                  key={c.card_id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingLeft: 36,
                    paddingRight: 12,
                    paddingVertical: 5,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      color: t.muted,
                      fontFamily: fonts.body,
                      fontSize: 12,
                    }}
                  >
                    {c.label}
                  </Text>
                  <StepCard
                    id={c.card_id}
                    state={c.state}
                    captureId={s.capture_id}
                  />
                </View>
              ))}
        </View>
      ))}
    </View>
  )
}

/** The model's thinking, as it writes it: one line with the latest of it
 * while it runs, all of it on a tap. Muted and apart from the answer, so it
 * never reads as the reply. */
function ThinkingBlock({ text, done }: { text: string; done?: boolean }) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  const latest =
    text
      .trim()
      .split(/\n+/)
      .filter((l) => l.trim())
      .at(-1)
      ?.replace(/[*#`_]/g, "")
      .trim() ?? ""
  const label = done ? "Thought it through" : "Thinking"
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={
        open ? `${label}. Hide thinking` : `${label}. Show thinking`
      }
      onPress={() => setOpen((o) => !o)}
      style={{
        borderLeftWidth: 2,
        borderLeftColor: t.line,
        paddingLeft: 10,
        paddingVertical: 2,
        gap: 4,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Brain size={14} color={t.muted} />
        <Text
          style={{ color: t.muted, fontFamily: fonts.semibold, fontSize: 12 }}
        >
          {done ? label : `${label}…`}
        </Text>
        {open ? (
          <ChevronDown size={14} color={t.muted} />
        ) : (
          <ChevronRight size={14} color={t.muted} />
        )}
      </View>
      {open ? (
        <Text
          style={{
            color: t.muted,
            fontFamily: fonts.body,
            fontSize: 13,
            lineHeight: 19,
          }}
        >
          {text.trim()}
        </Text>
      ) : (
        !done &&
        !!latest && (
          <Text
            numberOfLines={2}
            style={{
              color: t.muted,
              fontFamily: fonts.body,
              fontSize: 13,
              lineHeight: 18,
            }}
          >
            {latest}
          </Text>
        )
      )}
    </Pressable>
  )
}
/** A table Fern sent (portions per food, a breakdown). Up to three columns
 * read as one line per row. Wider tables keep one shape on every row at
 * any width: the first column (what the row is, never cut) with the second
 * (the figure acted on, e.g. grams) on line one, the rest in equal columns
 * under it, headed once. Total rows follow a hairline; a negative total
 * ("left today after" past the target) is red. */
function TableBlock({ block }: { block: Extract<Block, { t: "table" }> }) {
  const t = useTheme()
  const cols = block.columns
  const wide = cols.length > 3
  const rest = wide ? cols.slice(2) : cols.slice(1)
  const num = {
    fontFamily: fonts.medium,
    fontSize: 13,
    fontVariant: ["tabular-nums" as const],
  }
  const row = (cells: string[], total: boolean, key: string) => {
    const over = (v: string) => total && /^[-−]/.test(v.trim())
    const label = cols.map((c, i) => `${c} ${cells[i] ?? ""}`).join(", ")
    const lead = (
      <Text
        style={{
          flex: 1,
          color: t.text,
          fontFamily: total ? fonts.semibold : fonts.medium,
          fontSize: 14,
          lineHeight: 19,
        }}
      >
        {cells[0]}
      </Text>
    )
    const cell = (v: string, i: number) => (
      <Text
        key={i}
        style={{
          ...num,
          flex: wide ? 1 : undefined,
          minWidth: wide ? undefined : 44,
          textAlign: "right",
          color: over(v) ? t.bad : total ? t.text : t.muted,
        }}
      >
        {v}
      </Text>
    )
    return (
      <View
        key={key}
        accessible
        accessibilityLabel={label}
        style={{ gap: 2, paddingVertical: 4 }}
      >
        {wide ? (
          <>
            <View
              style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}
            >
              {lead}
              {!!cells[1] && (
                <Text style={{ ...num, fontSize: 14, color: t.text }}>
                  {cells[1]}
                </Text>
              )}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {rest.map((_, i) => cell(cells[i + 2] ?? "", i))}
            </View>
          </>
        ) : (
          <View
            style={{ flexDirection: "row", alignItems: "flex-start", gap: 16 }}
          >
            {lead}
            {rest.map((_, i) => cell(cells[i + 1] ?? "", i))}
          </View>
        )}
      </View>
    )
  }
  return (
    <Panel accent={block.title === "Portions" ? t.nut : undefined}>
      {!!block.title && (
        <Text
          style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 12 }}
        >
          {block.title.toUpperCase()}
        </Text>
      )}
      <View>
        <View
          style={{
            flexDirection: "row",
            gap: wide ? 8 : 16,
            paddingBottom: 4,
            borderBottomWidth: 1,
            borderBottomColor: t.line,
          }}
        >
          {!wide && <View style={{ flex: 1 }} />}
          {rest.map((c) => (
            <Text
              key={c}
              style={{
                flex: wide ? 1 : undefined,
                minWidth: wide ? undefined : 44,
                textAlign: "right",
                color: t.muted,
                fontFamily: fonts.body,
                fontSize: 11,
              }}
            >
              {c}
            </Text>
          ))}
        </View>
        {block.rows.map((r, i) => row(r, false, `r${i}`))}
        {!!block.foot?.length && (
          <View
            style={{ borderTopWidth: 1, borderTopColor: t.line, marginTop: 2 }}
          >
            {block.foot.map((r, i) => row(r, true, `f${i}`))}
          </View>
        )}
      </View>
      {!!block.note && (
        <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 11 }}>
          {block.note}
        </Text>
      )}
    </Panel>
  )
}

export function BlockView({ block }: { block: Block }) {
  const t = useTheme()
  switch (block.t) {
    case "text":
      return (
        <Text
          style={{
            color: t.text,
            fontFamily: fonts.body,
            fontSize: 15,
            lineHeight: 21,
          }}
        >
          {block.text}
        </Text>
      )
    case "chart":
      return <ChartBlock metric={block.metric} n={block.days} />
    case "insights":
      return <InsightsBlock />
    case "coach":
      return <CoachBlock mood={block.mood} />
    case "plan":
      return <PlanBlock />
    case "tracker":
      return <TrackerCard id={block.id} />
    case "memory":
      return <MemoryBlock />
    case "chips":
      return <Chips prompts={block.prompts} />
    case "steps":
      return <StepsBlock items={block.items} />
    case "thinking":
      return <ThinkingBlock text={block.text} done={block.done} />
    case "nutrition":
      return <NutritionBlock day={block.day} />
    case "table":
      return <TableBlock block={block} />
    case "photos":
      // Drawn with the person's own message (chat.tsx MyMessage).
      return null
  }
}
export { addTracker }
