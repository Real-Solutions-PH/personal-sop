import type { Routine } from "@domain/habits/data"
import * as H from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import {
  CalendarDays,
  ChevronRight,
  Flame,
  Gauge,
  ListChecks,
  Repeat,
  Settings,
  Share2,
  TrendingDown,
  TriangleAlert,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { Sparkline } from "../chart"
import { GrowBar, SwipeSegments } from "../motion"
import {
  Bar,
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Segmented,
  SmallButton,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { fonts, radius, useTheme } from "../theme"
import { Screen } from "../ui"
import { Ring } from "../visual"

const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  })
function Stat({
  label,
  value,
  delta,
  down = false,
}: {
  label: string
  value: string | number
  delta?: number
  down?: boolean
}) {
  const t = useTheme()
  return (
    <View style={{ flex: 1 }}>
      <Copy size={30} weight="display" style={{ lineHeight: 36 }}>
        {value}
      </Copy>
      <Copy size={12} muted>
        {label}
        {delta !== undefined && delta !== 0 && (
          <Text style={{ color: delta > 0 !== down ? t.good : t.bad }}>
            　{delta > 0 ? "▲" : "▼"}
            {Math.abs(delta)}
          </Text>
        )}
      </Copy>
    </View>
  )
}
function RoutineProgress({
  routine: r,
  stats: s,
}: {
  routine: Routine
  stats: ReturnType<typeof H.routineStats>
}) {
  const t = useTheme(),
    habits = habitsStore.use((s) => s.habits),
    today = dayKey(),
    missed = Math.max(0, s.scheduledDays - s.completed - s.abandoned.length),
    total = Math.max(1, s.completed + s.abandoned.length + missed),
    segs = [
      { n: s.completed, label: "done", color: t.hab },
      { n: s.abandoned.length, label: "abandoned", color: t.warn },
      { n: missed, label: "missed", color: `${t.muted}66` },
    ],
    stops = new Map<number, number>()
  for (const run of s.abandoned) {
    const i = run.results.findIndex((x) => x.status !== "done"),
      at = i === -1 ? run.results.length : i
    stops.set(at, (stops.get(at) ?? 0) + 1)
  }
  const [dropIdx, dropN] =
      [...stops.entries()].sort((a, b) => b[1] - a[1])[0] ?? [],
    step = dropIdx !== undefined ? r.steps[dropIdx] : undefined,
    dropName = step
      ? (habits.find((h) => h.id === step.habitId)?.name ?? "a step")
      : undefined,
    pace = s.pace ? Math.round((s.pace - 1) * 100) : null
  return (
    <Frame style={{ padding: 16 }}>
      <Tap onPress={() => go(`/habits/routines/${r.id}`)}>
        <Line>
          <View
            style={{
              height: 36,
              width: 36,
              borderRadius: 12,
              backgroundColor: `${t.hab}1f`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Copy size={20}>{r.icon}</Copy>
          </View>
          <View style={{ flex: 1 }}>
            <Copy weight="semibold" lines={1}>
              {r.name}
            </Copy>
            <Copy size={12} muted>
              {r.steps.length} steps · {H.plannedMin(r)}m planned
              {r.schedule[0]?.time ? ` · ${r.schedule[0].time}` : ""}
            </Copy>
          </View>
          <Ring value={s.rate} size={52} strokeWidth={6} color={t.hab}>
            <Copy size={12} weight="semibold">
              {H.pct(s.rate)}
            </Copy>
          </Ring>
          <ChevronRight size={16} color={t.muted} />
        </Line>
        <Line
          style={{
            gap: 0,
            height: 10,
            borderRadius: 5,
            overflow: "hidden",
            backgroundColor: t.soft,
            marginTop: 12,
          }}
        >
          {segs
            .filter((g) => g.n)
            .map((g) => (
              <View
                key={g.label}
                style={{
                  height: 10,
                  width: `${(g.n / total) * 100}%`,
                  backgroundColor: g.color,
                }}
              />
            ))}
        </Line>
        <Line style={{ gap: 12, marginTop: 6 }}>
          {segs.map((g) => (
            <Line key={g.label} style={{ gap: 4 }}>
              <View
                style={{
                  height: 8,
                  width: 8,
                  borderRadius: 4,
                  backgroundColor: g.color,
                }}
              />
              <Copy size={11} muted>
                <Text style={{ color: t.text, fontFamily: fonts.medium }}>
                  {g.n}
                </Text>{" "}
                {g.label}
              </Copy>
            </Line>
          ))}
        </Line>
        <Copy
          size={10}
          muted
          style={{ marginTop: 12, marginBottom: 4, letterSpacing: 0.5 }}
        >
          LAST 2 WEEKS
        </Copy>
        <Line style={{ gap: 4 }}>
          {H.daysBetween(dayOffset(-13), today).map((day) => {
            const run = s.runs.find((x) => x.day === day),
              state = run ? H.runState(run, today) : null,
              off = day < r.createdAt || !H.slotFor(r.schedule, day)
            return (
              <View
                key={day}
                accessibilityLabel={`${day}: ${state ?? (off ? "off" : day === today ? "today" : "missed")}`}
                style={{
                  flex: 1,
                  height: 20,
                  borderRadius: 4,
                  backgroundColor:
                    state === "completed"
                      ? t.hab
                      : state === "abandoned"
                        ? `${t.warn}cc`
                        : off
                          ? border(t.soft, 0.4)
                          : "transparent",
                  borderWidth: state || off ? 0 : 1,
                  borderColor: day === today ? t.hab : `${t.muted}66`,
                  borderStyle: day === today ? "dashed" : "solid",
                }}
              />
            )
          })}
        </Line>
        <Line style={{ gap: 8, marginTop: 12, alignItems: "stretch" }}>
          <View
            style={{
              flex: 1,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 12,
              backgroundColor: border(t.soft, 0.5),
            }}
          >
            <Line style={{ gap: 8 }}>
              <Gauge size={16} color={t.hab} />
              <Copy size={12} style={{ flex: 1 }}>
                {pace === null
                  ? "No finished runs yet"
                  : pace === 0
                    ? "On plan"
                    : `${Math.abs(pace)}% ${pace < 0 ? "faster than plan" : "over plan"}`}
              </Copy>
            </Line>
          </View>
          <View
            style={{
              flex: 1,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 12,
              backgroundColor: border(t.soft, 0.5),
            }}
          >
            <Line style={{ gap: 8 }}>
              <TrendingDown size={16} color={t.warn} />
              <Copy size={12} style={{ flex: 1 }}>
                {dropName ? `Stops at ${dropName} (${dropN}×)` : "No drop-offs"}
              </Copy>
            </Line>
          </View>
        </Line>
      </Tap>
    </Frame>
  )
}
export function HabitsHome() {
  const t = useTheme(),
    state = habitsStore.use((s) => s),
    [period, setPeriod] = useState("30"),
    [sort, setSort] = useState("rate"),
    days = Number(period),
    today = dayKey(),
    idx = H.logIndex(state.logs),
    hs = H.sortedHabits(state.habits.filter((h) => h.status !== "archived")),
    from = dayOffset(-days + 1),
    cur = H.overallStats(state, days),
    prev = H.overallStats(state, days, days),
    perHabit = hs.map((h) => {
      const s = H.habitStats(h, idx, from, today, today),
        st = H.streaks(h, idx, today)
      return { h, s, st, broken: st.broken.filter((b) => b.day >= from) }
    }),
    series = H.overallDays(hs, idx, from, today, today),
    rolling = series.map((_, i) => {
      const w = series.slice(Math.max(0, i - 6), i + 1),
        due = w.reduce((a, x) => a + x.due, 0),
        done = w.reduce((a, x) => a + x.done, 0)
      return due ? Math.round((done / due) * 100) : 0
    }),
    heat = H.overallDays(
      hs,
      idx,
      H.weekStartOf(dayOffset(-90), state.settings.weekStart),
      H.addDays(H.weekStartOf(today, state.settings.weekStart), 6),
      today,
    ).map((g) => (g.day > today ? null : g.rate)),
    weeks = Array.from({ length: 8 }, (_, i) => {
      const end = dayOffset(-(7 - i) * 7)
      return hs
        .filter((h) => h.type === "duration")
        .reduce(
          (sum, h) =>
            sum + H.habitStats(h, idx, H.addDays(end, -6), end, today).minutes,
          0,
        )
    }),
    worst = H.mostMissedWeekday(hs, idx, from, today),
    mostSkipped = [...perHabit].sort((a, b) => b.s.skipped - a.s.skipped)[0],
    routines = state.routines
      .filter((r) => r.status === "active")
      .map((r) => ({ r, s: H.routineStats(r, state.runs, days, today) })),
    broken = perHabit.flatMap((x) => x.broken.map((b) => ({ ...b, h: x.h }))),
    abandoned = routines.flatMap((x) =>
      x.s.abandoned.map((run) => ({ run, r: x.r })),
    ),
    low = perHabit.filter((x) => x.s.scheduled >= 3 && x.s.rate < 0.5),
    ranked = [...perHabit].sort((a, b) =>
      sort === "rate"
        ? b.s.rate - a.s.rate
        : sort === "streak"
          ? b.st.current - a.st.current
          : sort === "skip"
            ? b.s.skipRate - a.s.skipRate
            : a.h.name.localeCompare(b.h.name),
    ),
    max = Math.max(1, ...weeks)
  return (
    <Screen
      prototypeLayout
      title="Habits"
      actions={
        <Line style={{ gap: 0 }}>
          <IconTap
            size={40}
            icon={CalendarDays}
            label="Week schedule"
            color={t.text}
            onPress={() => go("/habits/week")}
          />
          <IconTap
            size={40}
            icon={Settings}
            label="Habit settings"
            color={t.text}
            onPress={() => go("/habits/settings")}
          />
        </Line>
      }
    >
      <View style={{ paddingTop: 4 }}>
        {!hs.length ? (
          <Frame style={{ padding: 24 }}>
            <Copy size={24} weight="display">
              No habit data yet
            </Copy>
            <Copy size={14} muted>
              Check off a habit for a few days and your completion rate, streaks
              and misses show up here.
            </Copy>
            <SmallButton accent="hab" onPress={() => go("/habits/new")}>
              Add a habit
            </SmallButton>
          </Frame>
        ) : (
          <>
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { value: "7", label: "7d" },
                { value: "30", label: "30d" },
                { value: "90", label: "90d" },
                { value: "365", label: "Year" },
              ]}
            />
            <SwipeSegments
              value={period}
              options={["7", "30", "90", "365"]}
              onChange={setPeriod}
            >
              <Frame style={{ padding: 16, marginTop: 12 }}>
                <Line style={{ gap: 16 }}>
                  <Ring
                    value={cur.rate}
                    size={96}
                    strokeWidth={9}
                    color={t.hab}
                  >
                    <Copy size={24} weight="semibold">
                      {Math.round(cur.rate * 100)}%
                    </Copy>
                    <Copy size={10} muted>
                      completion
                    </Copy>
                  </Ring>
                  <View style={{ flex: 1, gap: 12 }}>
                    <Line style={{ gap: 12, alignItems: "flex-start" }}>
                      <View style={{ flex: 1 }}>
                        <Copy
                          size={24}
                          weight="semibold"
                          style={{
                            color: cur.rate >= prev.rate ? t.good : t.bad,
                            letterSpacing: -0.6,
                          }}
                        >
                          {cur.rate >= prev.rate ? "+" : "−"}
                          {Math.abs(Math.round((cur.rate - prev.rate) * 100))}pt
                        </Copy>
                        <Copy size={12} muted>
                          vs prev {period === "365" ? "year" : `${period}d`}
                        </Copy>
                      </View>
                      <Stat
                        label="Perfect days"
                        value={cur.perfect}
                        delta={cur.perfect - prev.perfect}
                      />
                    </Line>
                    <Line style={{ gap: 12, alignItems: "flex-start" }}>
                      <Stat
                        label="Invested"
                        value={
                          cur.minutes >= 600
                            ? `${Math.round(cur.minutes / 60)}h`
                            : H.fmtMinutes(cur.minutes)
                        }
                        delta={Math.round((cur.minutes - prev.minutes) / 60)}
                      />
                      <Stat
                        label="Skip rate"
                        value={H.pct(cur.skipRate)}
                        delta={Math.round((cur.skipRate - prev.skipRate) * 100)}
                        down
                      />
                    </Line>
                  </View>
                </Line>
              </Frame>
              <Frame style={{ padding: 16, marginTop: 12 }}>
                <Line
                  style={{ justifyContent: "space-between", marginBottom: 4 }}
                >
                  <Copy size={12} muted>
                    7-day rolling completion
                  </Copy>
                  <Copy size={12} muted>
                    {rolling.at(-1)}%
                  </Copy>
                </Line>
                <Sparkline
                  values={rolling}
                  color={t.hab}
                  height={56}
                  label="7-day rolling completion"
                />
              </Frame>
              <Line style={{ gap: 8, marginTop: 12 }}>
                {[
                  { label: "Habits", href: "/habits/manage", icon: ListChecks },
                  { label: "Routines", href: "/habits/routines", icon: Repeat },
                  {
                    label: "Share",
                    href: "/habits/share?t=scoreboard",
                    icon: Share2,
                  },
                ].map((a) => (
                  <Tap
                    key={a.href}
                    onPress={() => go(a.href)}
                    style={{
                      flex: 1,
                      height: 44,
                      backgroundColor: t.soft,
                      borderRadius: 16,
                      justifyContent: "center",
                    }}
                  >
                    <Line style={{ gap: 8, justifyContent: "center" }}>
                      <a.icon size={16} color={t.text} />
                      <Copy size={14} weight="semibold">
                        {a.label}
                      </Copy>
                    </Line>
                  </Tap>
                ))}
              </Line>
              <SectionHeading>Reflection</SectionHeading>
              <Frame
                style={{ padding: 16, gap: 12, borderColor: `${t.bad}33` }}
              >
                <Line style={{ gap: 8 }}>
                  <TriangleAlert size={16} color={t.bad} />
                  <Copy size={14} weight="semibold">
                    What slipped
                  </Copy>
                </Line>
                <Line style={{ gap: 12 }}>
                  <Stat label="Missed" value={cur.missed} />
                  <Stat label="Broken streaks" value={broken.length} />
                  <Stat label="Worst day" value={worst?.day ?? "—"} />
                </Line>
                {broken
                  .slice(-3)
                  .reverse()
                  .map((b) => (
                    <Tap
                      key={`${b.h.id}-${b.day}`}
                      onPress={() => go(`/habits/${b.h.id}`)}
                    >
                      <Line style={{ gap: 8 }}>
                        <Copy size={14}>{b.h.icon}</Copy>
                        <Copy size={14} style={{ flex: 1 }}>
                          Lost a{" "}
                          <Text style={{ fontFamily: fonts.bold }}>
                            {b.length}-day
                          </Text>{" "}
                          {b.h.name} streak
                        </Copy>
                        <Copy size={12} muted>
                          {fmtDay(b.day)}
                        </Copy>
                      </Line>
                    </Tap>
                  ))}
                {mostSkipped && mostSkipped.s.skipped > 0 && (
                  <Copy size={14}>
                    Most skipped:{" "}
                    <Text style={{ fontFamily: fonts.bold }}>
                      {mostSkipped.h.name}
                    </Text>
                    <Text style={{ color: t.muted }}>
                      {" "}
                      ({mostSkipped.s.skipped}× ·{" "}
                      {H.pct(mostSkipped.s.skipRate)})
                    </Text>
                  </Copy>
                )}
                {low.length > 0 && (
                  <Copy size={14}>
                    Below 50%:{" "}
                    {low
                      .map((x) => `${x.h.name} ${H.pct(x.s.rate)}`)
                      .join(", ")}
                  </Copy>
                )}
                {abandoned.slice(-2).map(({ run, r }) => (
                  <Copy key={run.id} size={14}>
                    {r.icon} {r.name} abandoned at {run.current}/
                    {run.steps.length}
                    <Text style={{ fontSize: 12, color: t.muted }}>
                      {" "}
                      · {fmtDay(run.day)}
                    </Text>
                  </Copy>
                ))}
                {!cur.missed && !broken.length && (
                  <Copy size={14} style={{ color: t.good }}>
                    Nothing slipped this period.
                  </Copy>
                )}
              </Frame>
              <SectionHeading>Last 13 weeks</SectionHeading>
              <Frame style={{ padding: 16 }}>
                <ScrollView
                  horizontal
                  contentContainerStyle={{
                    flexGrow: 1,
                    justifyContent: "center",
                  }}
                >
                  <Line style={{ gap: 3 }}>
                    {Array.from(
                      { length: Math.ceil(heat.length / 7) },
                      (_, col) => (
                        <View key={col} style={{ gap: 3 }}>
                          {heat.slice(col * 7, col * 7 + 7).map((v, row) => (
                            <View
                              key={row}
                              style={{
                                height: 14,
                                width: 14,
                                borderRadius: 3,
                                backgroundColor: v === null ? t.soft : t.hab,
                                opacity: v === null ? 1 : Math.max(0.15, v),
                              }}
                            />
                          ))}
                        </View>
                      ),
                    )}
                  </Line>
                </ScrollView>
                <Line
                  style={{
                    marginTop: 8,
                    justifyContent: "space-between",
                    gap: 4,
                  }}
                >
                  <Copy size={10} muted>
                    each column = a week, oldest left
                  </Copy>
                  <Copy size={10} muted>
                    brighter = more done
                  </Copy>
                </Line>
              </Frame>
              <SectionHeading
                action={
                  <Line style={{ gap: 4 }}>
                    {["rate", "streak", "skip", "name"].map((k) => (
                      <Tap
                        key={k}
                        onPress={() => setSort(k)}
                        style={{
                          borderRadius: 16,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          backgroundColor:
                            sort === k ? `${t.hab}26` : "transparent",
                        }}
                      >
                        <Copy
                          size={11}
                          style={{ color: sort === k ? t.hab : t.muted }}
                        >
                          {k}
                        </Copy>
                      </Tap>
                    ))}
                  </Line>
                }
              >
                Ranking
              </SectionHeading>
              <Frame style={{ padding: 4 }}>
                {ranked.map(({ h, s, st }, i) => (
                  <Tap
                    key={h.id}
                    onPress={() => go(`/habits/${h.id}`)}
                    style={{ paddingHorizontal: 8, paddingVertical: 10 }}
                  >
                    <Line>
                      <Copy
                        size={12}
                        muted
                        style={{ width: 16, textAlign: "center" }}
                      >
                        {i + 1}
                      </Copy>
                      <View
                        style={{
                          height: 36,
                          width: 36,
                          borderRadius: 12,
                          backgroundColor: `${t.hab}1f`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Copy size={20}>{h.icon}</Copy>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Line style={{ gap: 6 }}>
                          <Copy
                            size={14}
                            weight="medium"
                            lines={1}
                            style={{ flexShrink: 1 }}
                          >
                            {h.name}
                          </Copy>
                          {st.current > 0 && (
                            <Line
                              style={{
                                gap: 2,
                                backgroundColor: `${t.warn}26`,
                                borderRadius: radius.pill,
                                paddingHorizontal: 6,
                              }}
                            >
                              <Flame size={12} color={t.warn} />
                              <Copy size={11} style={{ color: t.warn }}>
                                {st.current}
                              </Copy>
                            </Line>
                          )}
                        </Line>
                        <View style={{ marginTop: 4 }}>
                          <Bar
                            value={s.rate}
                            color={s.rate < 0.5 ? t.bad : t.hab}
                          />
                        </View>
                      </View>
                      <View style={{ width: 56, alignItems: "flex-end" }}>
                        <Copy size={14} weight="semibold">
                          {H.pct(s.rate)}
                        </Copy>
                        <Copy size={10} muted>
                          {s.skipped
                            ? `${H.pct(s.skipRate)} skip`
                            : `best ${st.best}`}
                        </Copy>
                      </View>
                    </Line>
                  </Tap>
                ))}
              </Frame>
              <SectionHeading>Time invested · 8 weeks</SectionHeading>
              <Frame style={{ padding: 16 }}>
                <Line
                  style={{ marginBottom: 8, alignItems: "baseline", gap: 8 }}
                >
                  <Copy size={24} weight="semibold">
                    {H.fmtMinutes(weeks.at(-1) ?? 0)}
                  </Copy>
                  <Copy size={12} muted>
                    this week in timed habits
                  </Copy>
                </Line>
                <Line style={{ height: 64, alignItems: "flex-end", gap: 4 }}>
                  {weeks.map((v, i) => (
                    <GrowBar
                      height={`${Math.max(2, (v / max) * 100)}%`}
                      index={i}
                      key={i}
                      style={{
                        flex: 1,
                        borderTopLeftRadius: 6,
                        borderTopRightRadius: 6,
                        backgroundColor: t.hab,
                        opacity: i === 7 ? 1 : 0.45,
                      }}
                    />
                  ))}
                </Line>
              </Frame>
              {routines.length > 0 && (
                <>
                  <SectionHeading>Routines</SectionHeading>
                  <View style={{ gap: 12 }}>
                    {routines.map(({ r, s }) => (
                      <RoutineProgress key={r.id} routine={r} stats={s} />
                    ))}
                  </View>
                </>
              )}
              <Tap
                onPress={() => go("/habits/today")}
                style={{ paddingHorizontal: 4, paddingVertical: 8 }}
              >
                <Line style={{ justifyContent: "space-between" }}>
                  <Copy size={12} muted>
                    Preview the Today card
                  </Copy>
                  <ChevronRight size={14} color={t.muted} />
                </Line>
              </Tap>
            </SwipeSegments>
          </>
        )}
      </View>
    </Screen>
  )
}
