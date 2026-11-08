import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { type ReactNode, useState } from "react"
import { ScrollView, View } from "react-native"
import { Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { clock, fmt, pct, signed } from "../share-format"
import {
  Body,
  CardFrame,
  type CardLook,
  Change,
  ChartNote,
  cardInk,
  Delta,
  type Dot,
  dayName,
  dayRange,
  endedRun,
  Figures,
  Growth,
  Hero,
  LeafCal,
  ShareComposer,
  Sub,
  shiftDay,
  Title,
  Win,
  Words,
  weekCells,
  XBars,
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
    /** The last 42 days, oldest first, ending today. */
    days: Dot[]
    /** The day of the first cell (YYYY-MM-DD). */
    start: string
  } | null
  routine: {
    name: string
    day: string
    durationSec: number
    done: number
    total: number
    /** Each step of the run, in order: its time and whether it was done. */
    steps: { name: string; sec: number; done: boolean }[]
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
/** A habit's day as a calendar leaf: a scheduled day gone by undone is a
 * miss; a day it was not due, or today still open, is not done. */
const dotOf = (c: L.Cell, before: boolean): Dot =>
  before
    ? "none"
    : c === "done" || c === "bonus"
      ? "on"
      : c === "partial"
        ? "part"
        : c === "missed"
          ? "miss"
          : "off"
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
const plural = (n: number, one: string, many = `${one}s`) =>
  `${fmt(n)} ${n === 1 ? one : many}`
/** How many weeks the streak calendar shows, by card shape. */
const span = (look: CardLook) => (look.format === "1:1" ? 3 : 4)
const rowH = (look: CardLook) =>
  look.format === "9:16" ? 25 : look.format === "1:1" ? 19 : 24

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
    hab = c.area("hab"),
    h = data.habit,
    today = new Date().toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
  let body: ReactNode = null,
    date = today
  if ((kind === "streak" || kind === "milestone" || kind === "month") && !h)
    body = (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Words size={4} muted align="center">
          Add a habit to share its streak.
        </Words>
      </View>
    )
  else if (kind === "streak" && h) {
    const { cells } = weekCells(h.days, h.start, span(look)),
      ended = endedRun(h.days),
      record = h.current > 0 && h.current >= h.best,
      done = cells.filter((d) => d === "on" || d === "part").length
    body = ended ? (
      <>
        <Title>{h.name}</Title>
        <Hero
          value={fmt(h.current)}
          unit={h.current === 1 ? "day" : "days"}
          delta={
            <Change good={false}>{`${fmt(ended.lost)}-day run ended`}</Change>
          }
        />
        <Sub bad>
          {`Missed ${dayName(shiftDay(h.start, ended.at))}. The ${fmt(ended.lost)}-day run ended there.`}
        </Sub>
        <Body end>
          <LeafCal
            cells={h.days}
            start={h.start}
            weeks={span(look)}
            rowH={rowH(look)}
            color={hab}
          />
          <ChartNote
            left={`Best ${plural(h.best, "day")}`}
            right={`New count since ${dayName(shiftDay(h.start, ended.at + 1))}`}
          />
        </Body>
      </>
    ) : (
      <>
        <Title>{h.name}</Title>
        <Hero value={fmt(h.current)} unit={h.current === 1 ? "day" : "days"} />
        {record ? (
          <Win>Longest streak yet</Win>
        ) : (
          <Sub>{`Best ${plural(h.best, "day")}`}</Sub>
        )}
        <Body end>
          <LeafCal
            cells={h.days}
            start={h.start}
            weeks={span(look)}
            rowH={rowH(look)}
            color={hab}
          />
          <ChartNote
            left={
              done === cells.length
                ? `Last ${fmt(span(look))} weeks, every day done`
                : `${fmt(done)} of the last ${fmt(cells.length)} days done`
            }
            right={data.showRate ? `${pct(h.rate30)} over 30 days` : undefined}
          />
        </Body>
      </>
    )
  } else if (kind === "milestone" && h) {
    const { reached, next } = milestoneOf(h.current),
      stops = MILESTONES.filter((m) => m <= next).slice(-5)
    body = (
      <>
        <Hero
          value={fmt(reached ?? h.current)}
          unit={(reached ?? h.current) === 1 ? "day" : "days"}
        />
        <Title>{h.name}</Title>
        {reached ? (
          <Win>Milestone reached</Win>
        ) : (
          <Sub>{`On the way: ${plural(next - h.current, "day")} to ${fmt(next)}.`}</Sub>
        )}
        <Body end>
          <Growth
            stops={stops.includes(next) ? stops : [...stops, next]}
            now={h.current}
            end={next}
            unit="days"
            height={look.format === "9:16" ? 84 : 72}
            color={hab}
          />
          <ChartNote
            left={`Next: ${fmt(next)} days`}
            right={`Best ${fmt(h.best)}`}
          />
        </Body>
      </>
    )
  } else if (kind === "month" && h) {
    const { cells, start = h.start } = weekCells(h.days, h.start, 5),
      done = cells.filter((d) => d === "on" || d === "part").length,
      missed = cells.filter((d) => d === "miss").length,
      due = done + missed,
      low = due > 0 && done / due < 0.5
    date = dayRange(start, shiftDay(start, cells.length - 1))
    body = (
      <>
        <Title>{h.name}</Title>
        <Hero
          value={fmt(done)}
          unit={`of ${plural(due, "day")}`}
          small
          delta={
            low ? (
              <Change good={false}>{`${plural(missed, "day")} missed`}</Change>
            ) : undefined
          }
        />
        <Body end>
          <LeafCal
            cells={h.days}
            start={h.start}
            weeks={5}
            rowH={rowH(look) - 4}
            color={hab}
          />
          <ChartNote
            left={
              low
                ? `${pct(done / due)} of due days done`
                : missed
                  ? `${plural(missed, "day")} missed`
                  : "No day missed"
            }
            bad={!low && missed > 0}
            right="Last 5 weeks"
          />
        </Body>
      </>
    )
  } else if (kind === "routine") {
    const r = data.routine
    body = r ? (
      <>
        <Title>{r.name}</Title>
        {r.done >= r.total ? (
          <>
            <Hero value={clock(r.durationSec)} />
            <Win>{`All ${plural(r.total, "step")} done`}</Win>
          </>
        ) : (
          <>
            <Hero
              value={fmt(r.done)}
              unit={`of ${plural(r.total, "step")}`}
              small
              delta={
                <Change
                  good={false}
                >{`${fmt(r.total - r.done)} skipped`}</Change>
              }
            />
            <Sub bad>
              {`Skipped: ${r.steps
                .filter((x) => !x.done)
                .map((x) => x.name)
                .join(", ")}.`}
            </Sub>
          </>
        )}
        <Body>
          <XBars
            color={hab}
            rows={r.steps
              .filter((x) => x.done)
              .map((x, i) => ({
                key: `${x.name}-${i}`,
                name: x.name,
                value: x.sec,
                label: clock(x.sec),
              }))}
          />
        </Body>
      </>
    ) : (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Words size={4} muted align="center">
          No completed run yet.
        </Words>
      </View>
    )
    if (r) date = dayName(r.day)
  } else {
    const b = data.board,
      delta = Math.round((b.rate - b.prevRate) * 100),
      fell = b.top.filter((x) => x.streak === 0).length
    date = "Last 30 days"
    body = (
      <>
        <Hero
          value={fmt(Math.round(b.rate * 100), 5)}
          unit="% done"
          delta={<Delta n={delta} unit=" pts" suffix="vs prior 30" />}
        />
        {delta < 0 && (
          <Sub bad>
            {fell
              ? `${verdict(b.rate)}. ${plural(fell, "run")} ended.`
              : `${verdict(b.rate)}.`}
          </Sub>
        )}
        <Figures
          items={[
            { label: "Perfect days", value: fmt(b.perfect) },
            { label: "Check-ins", value: fmt(b.checkins) },
          ]}
        />
        <Body>
          <XBars
            color={hab}
            rows={b.top.map((x, i) => ({
              key: `${x.name}-${i}`,
              name: x.name,
              value: x.streak,
              label: plural(x.streak, "day"),
            }))}
          />
        </Body>
      </>
    )
  }
  return (
    <CardFrame width={width} look={look} accent="hab" date={date}>
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
  const start = dayOffset(-41),
    cells = habit
      ? L.daysBetween(start, today).map((d) =>
          dotOf(L.cellFor(habit, d, idx, today), d < habit.createdAt),
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
            days: cells,
            start,
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
            steps: run.steps.map((st, i) => ({
              name: hide
                ? `Step ${i + 1}`
                : (state.habits.find((x) => x.id === st.habitId)?.name ?? ""),
              sec: run.results[i]?.actualSec ?? 0,
              done: run.results[i]?.status === "done",
            })),
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
