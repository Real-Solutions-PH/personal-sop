import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { Check, Flame, Medal, Trophy } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { ScrollView, View } from "react-native"
import { Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { clock, fmt, pct, signed } from "../share-format"
import {
  CardFrame,
  type CardLook,
  CardRing,
  Chip,
  cardInk,
  Delta,
  type Dot,
  Dots,
  Label,
  Meter,
  Num,
  ShareComposer,
  Stats,
  Words,
} from "../share-kit"
import { useTheme } from "../theme"
import { Screen, Toggle } from "../ui"

export type HabitLayout =
  | "streak"
  | "milestone"
  | "month"
  | "routine"
  | "scoreboard"
/** Everything a habit card shows, already counted: cards only lay it out. */
export type HabitCardData = {
  showRate: boolean
  habit: {
    name: string
    current: number
    best: number
    rate30: number
    last14: Dot[]
    last35: Dot[]
  } | null
  routine: {
    name: string
    day: string
    durationSec: number
    done: number
    total: number
  } | null
  board: {
    rate: number
    prevRate: number
    top: { name: string; streak: number }[]
    perfect: number
    checkins: number
  }
}
/** Streak milestones worth a card of their own. */
export const MILESTONES = [
  7, 14, 21, 30, 50, 66, 100, 150, 200, 250, 365, 500, 730, 1000, 1500, 2000,
  2500, 3000, 3650,
]
export function milestoneOf(current: number) {
  const reached = [...MILESTONES].reverse().find((m) => m <= current) ?? null
  const next =
    MILESTONES.find((m) => m > current) ??
    (Math.floor(current / 1000) + 1) * 1000
  return { reached, next }
}
const dotOf = (c: L.Cell): Dot =>
  c === "done"
    ? "on"
    : c === "partial"
      ? "part"
      : c === "missed"
        ? "off"
        : "none"
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
const shortDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })

export function HabitCard({
  kind,
  width,
  look,
  data,
}: {
  kind: HabitLayout
  width: number
  look: CardLook
  data: HabitCardData
}) {
  const c = cardInk(look),
    q = width / 100,
    tall = look.format === "9:16",
    hab = c.area("hab"),
    h = data.habit
  let body: ReactNode = null
  if ((kind === "streak" || kind === "milestone" || kind === "month") && !h)
    body = (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Words size={4} muted align="center">
          Add a habit to share its streak.
        </Words>
      </View>
    )
  else if (kind === "streak" && h) {
    const best = h.current > 0 && h.current >= h.best
    body = (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 3 * q,
        }}
      >
        <CardRing
          value={h.best ? h.current / h.best : 0}
          size={tall ? 58 : 44}
          color={hab}
        >
          <Flame size={7 * q} color={hab} strokeWidth={2} />
          <Num size={tall ? 18 : 14} align="center">
            {fmt(h.current)}
          </Num>
          <Label align="center">{h.current === 1 ? "day" : "days"}</Label>
        </CardRing>
        <Words size={6} weight="semibold" align="center">
          {h.name}
        </Words>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 1.6 * q,
          }}
        >
          <Chip icon={best ? Trophy : undefined} tone={hab}>
            {best ? "Personal best" : `Best ${fmt(h.best)} days`}
          </Chip>
          {data.showRate && (
            <Chip icon={Check} tone={c.good}>
              {`${pct(h.rate30)} · 30 days`}
            </Chip>
          )}
        </View>
        {tall && (
          <View
            style={{ alignSelf: "stretch", gap: 1.5 * q, marginTop: 2 * q }}
          >
            <Label>Last 14 days</Label>
            <Dots cells={h.last14} cols={14} color={hab} />
          </View>
        )}
      </View>
    )
  } else if (kind === "milestone" && h) {
    const { reached, next } = milestoneOf(h.current)
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
        <Chip icon={Medal} tone={hab}>
          {reached ? "Milestone" : "On the way"}
        </Chip>
        <View>
          <Num size={tall ? 34 : 26}>{fmt(reached ?? h.current)}</Num>
          <Words size={6} weight="semibold">
            {reached
              ? `${reached === 1 ? "day" : "days"} of ${h.name}`
              : `${h.current === 1 ? "day" : "days"} of ${h.name}`}
          </Words>
        </View>
        <View style={{ gap: 1.5 * q }}>
          <Line style={{ justifyContent: "space-between", gap: 2 * q }}>
            <View style={{ flexShrink: 1 }}>
              <Label>{`Next: ${fmt(next)} days`}</Label>
            </View>
            <Num size={4}>{`${fmt(h.current)} / ${fmt(next)}`}</Num>
          </Line>
          <Meter value={h.current / next} color={hab} height={2} />
        </View>
        {look.format !== "1:1" && (
          <Stats
            items={[
              { label: "Current streak", value: fmt(h.current), unit: "d" },
              { label: "Best streak", value: fmt(h.best), unit: "d" },
            ]}
            size={8}
          />
        )}
      </View>
    )
  } else if (kind === "month" && h) {
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
        <View style={{ gap: q }}>
          <Words
            size={tall ? 8 : 6}
            weight="semibold"
            lines={look.format === "1:1" ? 1 : 2}
          >
            {h.name}
          </Words>
          <Label>Last 5 weeks</Label>
        </View>
        <Dots
          cells={h.last35}
          cols={7}
          color={hab}
          width={tall ? "100%" : look.format === "4:5" ? "62%" : "44%"}
        />
        <Line
          style={{
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 3 * q,
          }}
        >
          {data.showRate ? (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Label>Completion</Label>
              <Num size={tall ? 18 : 14}>{pct(h.rate30)}</Num>
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Chip icon={Flame} tone={hab}>
            {verdict(h.rate30)}
          </Chip>
        </Line>
      </View>
    )
  } else if (kind === "routine") {
    const r = data.routine
    body = r ? (
      <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
        <Chip icon={Check} tone={c.good}>
          {`Complete · ${shortDay(r.day)}`}
        </Chip>
        <Words size={9} weight="semibold">
          {r.name}
        </Words>
        <View>
          <Label>Time</Label>
          <Num size={tall ? 22 : 18}>{clock(r.durationSec)}</Num>
        </View>
        <View style={{ gap: 1.6 * q }}>
          <Line style={{ justifyContent: "space-between" }}>
            <Label>Steps done</Label>
            <Num size={4.4}>{`${fmt(r.done)}/${fmt(r.total)}`}</Num>
          </Line>
          <Meter value={r.done / Math.max(1, r.total)} color={hab} height={2} />
        </View>
      </View>
    ) : (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Words size={4} muted align="center">
          No completed run yet.
        </Words>
      </View>
    )
  } else {
    const b = data.board,
      top = b.top.slice(0, tall ? 5 : look.format === "1:1" ? 2 : 3),
      max = Math.max(1, ...top.map((x) => x.streak)),
      delta = Math.round((b.rate - b.prevRate) * 100)
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
        <Line style={{ gap: 4 * q }}>
          <CardRing value={b.rate} size={tall ? 32 : 26} color={hab}>
            <Num size={8} align="center">
              {pct(b.rate)}
            </Num>
            <Label align="center">done</Label>
          </CardRing>
          <View style={{ flex: 1, gap: q }}>
            <Words size={7} weight="semibold">
              {verdict(b.rate)}
            </Words>
            <Label>Habits · 30 days</Label>
            <Delta n={delta} unit=" pts" suffix="vs prior 30 days" />
          </View>
        </Line>
        <View style={{ gap: 2.4 * q }}>
          <Label>Top streaks</Label>
          {top.map((x, i) => (
            <Line key={`${x.name}-${i}`} style={{ gap: 2.4 * q }}>
              <View style={{ flex: 1, minWidth: 0, gap: 0.8 * q }}>
                <Words size={3.8} weight="medium" lines={1}>
                  {x.name}
                </Words>
                <Meter value={x.streak / max} color={hab} height={1.4} />
              </View>
              <View style={{ width: 18 * q }}>
                <Num size={4.6} unit="d" align="right">
                  {fmt(x.streak)}
                </Num>
              </View>
            </Line>
          ))}
        </View>
        <Stats
          items={[
            { label: "Perfect days", value: fmt(b.perfect) },
            { label: "Check-ins", value: fmt(b.checkins) },
          ]}
          size={8}
        />
      </View>
    )
  }
  return (
    <CardFrame
      width={width}
      look={look}
      accent="hab"
      kicker={kind === "milestone" ? "Habit milestone" : "Habits"}
    >
      {body}
    </CardFrame>
  )
}

export function HabitShare() {
  const p = useLocalSearchParams<{
      t?: HabitLayout
      habit?: string
      routine?: string
      run?: string
      post?: string
    }>(),
    state = habitsStore.use((s) => s),
    t = useTheme()
  const habits = L.sortedHabits(
      state.habits.filter((h) => h.status !== "archived"),
    ),
    [layout, setLayout] = useState<HabitLayout>(p.t ?? "streak"),
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
  const cells = (days: number) =>
    habit
      ? L.daysBetween(dayOffset(1 - days), today).map((d) =>
          dotOf(L.cellFor(habit, d, idx, today)),
        )
      : []
  const st = habit ? L.streaks(habit, idx) : null
  const data: HabitCardData = {
    showRate,
    habit:
      habit && st
        ? {
            name: name(habit.name),
            current: st.current,
            best: st.best,
            rate30: L.habitStats(habit, idx, dayOffset(-29), today).rate,
            last14: cells(14),
            last35: cells(35),
          }
        : null,
    routine:
      run && routine
        ? {
            name: hide ? "Routine" : routine.name,
            day: run.day,
            durationSec: L.runActualSec(run),
            done: run.results.filter((r) => r.status === "done").length,
            total: run.steps.length,
          }
        : null,
    board: {
      rate: overall.rate,
      prevRate: prior.rate,
      top: habits
        .map((h) => ({ name: h.name, streak: L.streaks(h, idx).current }))
        .sort((a, b) => b.streak - a.streak)
        .map((x, i) => ({ ...x, name: name(x.name, i) })),
      perfect: overall.perfect,
      checkins: overall.done,
    },
  }
  const h = data.habit
  const caption =
    layout === "routine"
      ? `${data.routine?.name ?? "Routine"} done`
      : layout === "scoreboard"
        ? `Habits: ${pct(overall.rate)} completion over 30 days (${signed(Math.round((overall.rate - prior.rate) * 100))} pts)`
        : h
          ? layout === "streak"
            ? `${fmt(h.current)}-day streak on ${hide ? "a habit" : h.name}`
            : layout === "milestone"
              ? `${fmt(milestoneOf(h.current).reached ?? h.current)} days of ${hide ? "a habit" : h.name}`
              : `${hide ? "A habit" : h.name}: ${pct(h.rate30)} over the last 5 weeks`
          : "My habits"
  return (
    <Screen title="Share card">
      <ShareComposer
        value={layout}
        onChange={setLayout}
        autoPost={p.post === "1"}
        caption={`${caption} · Unfurl`}
        items={(
          [
            { key: "streak", label: "Streak" },
            { key: "milestone", label: "Milestone" },
            { key: "month", label: "Month heatmap" },
            { key: "routine", label: "Routine run" },
            { key: "scoreboard", label: "Scoreboard" },
          ] as const
        ).map((item) => ({
          ...item,
          render: (width: number, look: CardLook) => (
            <HabitCard kind={item.key} width={width} look={look} data={data} />
          ),
        }))}
      >
        {(layout === "streak" ||
          layout === "milestone" ||
          layout === "month") && (
          <>
            <SectionHeading>Habit</SectionHeading>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -16 }}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            >
              {habits.map((x) => (
                <Tap
                  key={x.id}
                  onPress={() => setHabitId(x.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 20,
                    borderWidth: habit?.id === x.id ? 2 : 1,
                    borderColor: habit?.id === x.id ? t.text : t.line,
                    backgroundColor: t.card,
                  }}
                >
                  <Copy size={14}>
                    {x.icon} {x.name}
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
                    borderWidth: r.id === routineId ? 2 : 1,
                    borderColor: r.id === routineId ? t.text : t.line,
                    backgroundColor: t.card,
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
          {(layout === "streak" || layout === "month") && (
            <Toggle
              label="Show completion rate"
              value={showRate}
              onChange={setShowRate}
            />
          )}
        </Frame>
        <Copy size={12} muted style={{ textAlign: "center" }}>
          Share cards never include money amounts.
        </Copy>
      </ShareComposer>
    </Screen>
  )
}
