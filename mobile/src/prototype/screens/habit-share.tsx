import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset, fmtDuration } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { type ReactNode, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { CardFrame, type CardLook, ShareComposer } from "../share-kit"
import { fonts, useTheme } from "../theme"
import { Screen, Toggle } from "../ui"
import { Ring } from "../visual"

type Layout = "streak" | "month" | "routine" | "scoreboard"
export function HabitShare() {
  const p = useLocalSearchParams<{
      t?: Layout
      habit?: string
      routine?: string
      run?: string
    }>(),
    state = habitsStore.use((s) => s),
    t = useTheme()
  const habits = L.sortedHabits(
      state.habits.filter((h) => h.status !== "archived"),
    ),
    [layout, setLayout] = useState<Layout>(p.t ?? "streak"),
    [habitId, setHabitId] = useState(p.habit ?? habits[0]?.id),
    [routineId, setRoutineId] = useState(p.routine ?? state.routines[0]?.id),
    [hide, setHide] = useState(false),
    [showRate, setShowRate] = useState(true)
  const habit = habits.find((h) => h.id === habitId) ?? habits[0],
    routine = state.routines.find((r) => r.id === routineId),
    idx = L.logIndex(state.logs),
    today = dayKey(),
    overall = L.overallStats(state, 30),
    prior = L.overallStats(state, 30, 30)
  const name = (s: string, i = 0) =>
    hide ? `Habit ${String.fromCharCode(65 + i)}` : s
  const run =
    state.runs.find((r) => r.id === p.run) ??
    [...state.runs]
      .reverse()
      .find((r) => r.routineId === routineId && r.state === "completed")
  const caption =
    layout === "routine"
      ? `${hide ? "Routine" : (routine?.name ?? "Routine")} done`
      : layout === "scoreboard"
        ? `Habits: ${L.pct(overall.rate)} completion over 30 days`
        : habit
          ? layout === "streak"
            ? `${L.streaks(habit, idx).current}-day streak on ${hide ? "a habit" : habit.name}`
            : `${hide ? "A habit" : habit.name} — ${L.pct(L.habitStats(habit, idx, dayOffset(-29), today).rate)} over the last 5 weeks`
          : "My habits"
  function render(kind: Layout, width: number, look: CardLook) {
    const q = width / 100,
      tall = look.format === "9:16",
      ink = look.backdrop === "paper" ? t["share-paper-ink"] : "#fff",
      panel = look.backdrop === "paper" ? "#0000000d" : "#ffffff17"
    const text = (
      value: string,
      size: number,
      display = false,
      color = ink,
    ) => (
      <Text
        numberOfLines={2}
        style={{
          fontFamily: display ? fonts.displayHeavy : fonts.semibold,
          fontSize: size * q,
          lineHeight: size * q * (display ? 1 : 1.3),
          color,
          textAlign: "center",
        }}
      >
        {value}
      </Text>
    )
    const label = (value: string) => (
      <Text
        style={{
          fontFamily: fonts.semibold,
          fontSize: 3.2 * q,
          letterSpacing: 0.3 * q,
          color: ink,
          opacity: 0.65,
        }}
      >
        {value.toUpperCase()}
      </Text>
    )
    const medal = (value: string) => (
      <View
        style={{
          backgroundColor: panel,
          borderRadius: 10 * q,
          paddingHorizontal: 2.4 * q,
          paddingVertical: 1.4 * q,
        }}
      >
        {text(value, 3.3)}
      </View>
    )
    const dots = (days: number, cols: number) => {
      const cells = habit
        ? L.daysBetween(dayOffset(1 - days), today).map((d) =>
            L.cellFor(habit, d, idx, today),
          )
        : []
      const size = ((87 - (cols - 1) * 1.4) / cols) * q
      return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 1.4 * q }}>
          {cells.map((c, i) => (
            <View
              key={`${today}-${i}`}
              style={{
                width: size,
                height: size,
                borderRadius: size * 0.2,
                backgroundColor:
                  c === "done"
                    ? t.hab
                    : c === "partial"
                      ? `${t.hab}66`
                      : c === "missed"
                        ? "#ffffff0a"
                        : panel,
                borderWidth: c === "missed" ? 1 : 0,
                borderColor: "#ffffff1a",
              }}
            />
          ))}
        </View>
      )
    }
    let body: ReactNode
    if (kind === "streak" && habit) {
      const st = L.streaks(habit, idx),
        stats = L.habitStats(habit, idx, dayOffset(-29), today)
      body = (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Ring
            size={(tall ? 60 : 46) * q}
            strokeWidth={0.06 * (tall ? 60 : 46) * q}
            gradientColors={[t.tsk, t.hab]}
            value={st.best ? st.current / st.best : 0}
            hero
          >
            {text(hide ? "🔥" : habit.icon, 9)}
            {text(String(st.current), tall ? 24 : 18, true)}
          </Ring>
          <View style={{ marginTop: 4 * q }}>
            {text("DAY STREAK", 7, true)}
          </View>
          <View style={{ marginTop: 1.5 * q }}>
            {text(name(habit.name).toUpperCase(), 6, true)}
          </View>
          <Line
            style={{
              marginTop: 3 * q,
              gap: 1.6 * q,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {medal(
              st.current > 0 && st.current >= st.best
                ? "🏆 Personal best"
                : `Best ${st.best} days`,
            )}
            {showRate && medal(`✓ ${L.pct(stats.rate)} · 30 days`)}
          </Line>
          {tall && (
            <View style={{ marginTop: 6 * q, width: "100%", gap: 1.5 * q }}>
              {label("Last 14 days")}
              {dots(14, 14)}
            </View>
          )}
        </View>
      )
    } else if (kind === "month" && habit) {
      const stats = L.habitStats(habit, idx, dayOffset(-29), today)
      body = (
        <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
          <Line style={{ gap: 3 * q }}>
            {!hide && text(habit.icon, 10)}
            <View style={{ flex: 1, gap: q }}>
              {text(name(habit.name).toUpperCase(), 9, true)}
              {label("Last 5 weeks")}
            </View>
          </Line>
          {dots(35, 7)}
          <Line
            style={{
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 3 * q,
            }}
          >
            {showRate ? (
              <View>
                {label("Completion")}
                {text(L.pct(stats.rate), 22, true, t.hab)}
              </View>
            ) : (
              <View />
            )}
            {medal(verdict(stats.rate))}
          </Line>
        </View>
      )
    } else if (kind === "routine") {
      const done = run?.results.filter((r) => r.status === "done").length ?? 0
      body =
        run && routine ? (
          <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
            <View style={{ alignItems: "flex-start" }}>
              {text(routine.icon, 16)}
            </View>
            {medal(
              `✓ Complete · ${new Date(`${run.day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
            )}
            {text((hide ? "Routine" : routine.name).toUpperCase(), 11, true)}
            <View style={{ alignItems: "flex-start" }}>
              {label("Time")}
              {text(fmtDuration(L.runActualSec(run)), 26, true, t.hab)}
            </View>
            <Line style={{ justifyContent: "space-between" }}>
              {label("Steps done")}
              {text(`${done}/${run.steps.length}`, 5, true)}
            </Line>
            <View
              style={{ height: 2 * q, backgroundColor: panel, borderRadius: q }}
            >
              <View
                style={{
                  width: `${(done / Math.max(1, run.steps.length)) * 100}%`,
                  height: "100%",
                  backgroundColor: t.hab,
                  borderRadius: q,
                }}
              />
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, justifyContent: "center" }}>
            {text("No completed run yet.", 4)}
          </View>
        )
    } else {
      const top = habits
          .map((h) => ({ h, s: L.streaks(h, idx).current }))
          .sort((a, b) => b.s - a.s)
          .slice(0, tall ? 5 : 3),
        max = Math.max(1, ...top.map((x) => x.s)),
        delta = Math.round((overall.rate - prior.rate) * 100)
      body = (
        <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
          <Line style={{ gap: 4 * q }}>
            <Ring size={36 * q} value={overall.rate} hero>
              {text(L.pct(overall.rate), 10, true)}
              {label("done")}
            </Ring>
            <View style={{ flex: 1, gap: q }}>
              {text(verdict(overall.rate).toUpperCase(), 10, true)}
              {label("Habits · 30 days")}
              {delta !== 0 &&
                text(
                  `${delta > 0 ? "↗" : "↘"} ${Math.abs(delta)}% vs prior`,
                  3.5,
                )}
            </View>
          </Line>
          <View style={{ gap: 2.6 * q }}>
            {label("Top streaks")}
            {top.map(({ h, s }, i) => (
              <Line key={h.id} style={{ gap: 2.4 * q }}>
                {text(hide ? String(i + 1) : h.icon, 5)}
                <View style={{ flex: 1, gap: 0.8 * q }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: fonts.semibold,
                      fontSize: 3.8 * q,
                      color: ink,
                    }}
                  >
                    {name(h.name, i)}
                  </Text>
                  <View
                    style={{
                      height: 1.4 * q,
                      borderRadius: q,
                      backgroundColor: panel,
                    }}
                  >
                    <View
                      style={{
                        height: "100%",
                        width: `${(s / max) * 100}%`,
                        backgroundColor: t.hab,
                        borderRadius: q,
                      }}
                    />
                  </View>
                </View>
                {text(`🔥 ${s}`, 5, true)}
              </Line>
            ))}
          </View>
          <Line
            style={{
              backgroundColor: panel,
              padding: 3 * q,
              borderRadius: 3 * q,
              gap: 3 * q,
            }}
          >
            {[
              { label: "Perfect days", value: overall.perfect },
              { label: "Check-ins", value: overall.done },
            ].map((x) => (
              <View key={x.label} style={{ flex: 1, gap: q }}>
                {label(x.label)}
                {text(String(x.value), 10, true)}
              </View>
            ))}
          </Line>
        </View>
      )
    }
    return (
      <CardFrame width={width} look={look} accent="hab" kicker="Habits">
        {body}
      </CardFrame>
    )
  }
  return (
    <Screen title="Share card">
      <ShareComposer
        value={layout}
        onChange={setLayout}
        accent="hab"
        caption={`${caption} · Personal SOP`}
        items={(
          [
            { key: "streak", label: "Streak" },
            { key: "month", label: "Month heatmap" },
            { key: "routine", label: "Routine run" },
            { key: "scoreboard", label: "Scoreboard" },
          ] as const
        ).map((item) => ({
          ...item,
          render: (width: number, look: CardLook) =>
            render(item.key, width, look),
        }))}
      >
        {(layout === "streak" || layout === "month") && (
          <>
            <SectionHeading>Habit</SectionHeading>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -16 }}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            >
              {habits.map((h) => (
                <Tap
                  key={h.id}
                  onPress={() => setHabitId(h.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 20,
                    backgroundColor: habit?.id === h.id ? t.hab : t.card,
                  }}
                >
                  <Copy
                    size={14}
                    style={{ color: habit?.id === h.id ? t.bg : t.text }}
                  >
                    {h.icon} {h.name}
                  </Copy>
                </Tap>
              ))}
            </ScrollView>
          </>
        )}
        {layout === "routine" && (
          <>
            <SectionHeading>Routine</SectionHeading>
            <Line style={{ flexWrap: "wrap", gap: 8 }}>
              {state.routines.map((r) => (
                <Tap
                  key={r.id}
                  onPress={() => setRoutineId(r.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 20,
                    backgroundColor: r.id === routineId ? `${t.hab}26` : t.soft,
                  }}
                >
                  <Copy size={14}>
                    {r.icon} {r.name}
                  </Copy>
                </Tap>
              ))}
            </Line>
          </>
        )}
        <Frame style={{ gap: 12, padding: 16 }}>
          <Toggle label="Hide habit names" value={hide} onChange={setHide} />
          {layout !== "routine" && layout !== "scoreboard" && (
            <Toggle
              label="Show completion rate"
              value={showRate}
              onChange={setShowRate}
            />
          )}
        </Frame>
        <Copy size={11} muted style={{ textAlign: "center" }}>
          Share cards never include money amounts.
        </Copy>
      </ShareComposer>
    </Screen>
  )
}
function verdict(rate: number) {
  return rate >= 0.9
    ? "Elite form"
    : rate >= 0.75
      ? "On fire"
      : rate >= 0.6
        ? "Locked in"
        : rate >= 0.4
          ? "Building"
          : "Showing up"
}
