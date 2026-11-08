import { useFocusState } from "@domain/focus/store"
import { fmtHm } from "@domain/focus/logic"
import { dayKey, weekday } from "@domain/lib/day"
import { useStats } from "@domain/tasks/hooks"
import * as L from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import { useLocalSearchParams } from "expo-router"
import { ShieldCheck } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { Copy, Frame, Line, SectionHeading, Segmented } from "../native-kit"
import {
  type TaskTime,
  type TodayCompletion,
  taskFocusToday,
  todayCompletion,
} from "../productivity-share-calc"
import { fmt, group, pct } from "../share-format"
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
  Hero,
  LeafCal,
  ShareComposer,
  Stems,
  Sub,
  Title,
  Win,
  XBars,
} from "../share-kit"
import { PartLine } from "../share-viz"
import { useTheme } from "../theme"
import { Screen, Toggle } from "../ui"
import { TaskChip } from "./task-find"
import { RANGE_LABEL } from "./task-stats"

export type TaskLayout =
  | "summary"
  | "streak"
  | "followThrough"
  | "today"
  | "timeOnTask"
type Stats7 = ReturnType<typeof useStats>
/** What a task card shows: counts only, never a task title. */
export type TaskCardData = Pick<
  Stats7,
  | "done"
  | "onTimeRate"
  | "streak"
  | "bestStreak"
  | "clearDays"
  | "dueDays"
  | "followThrough"
  | "from"
  | "to"
> & {
  perDay: { day: string; done: number }[]
  prevDone: number
  range: "7" | "30" | "90"
  shown: Record<string, boolean>
  /** Today's tasks as a whole (the Today card). */
  today?: TodayCompletion & { day: string }
  /** Focus time per task today (the Time per task card). Titles are the
   * person's choice: hidden, they read "Task 1", "Task 2". */
  focus?: { rows: TaskTime[]; avgSec: number; totalSec: number; day: string }
}
const verdict = (v: number | null) =>
  v === null
    ? "Building momentum"
    : v >= 0.85
      ? "On fire"
      : v >= 0.65
        ? "Solid work"
        : v >= 0.4
          ? "Keep going"
          : "Fresh start"
export const taskMetrics = (s: TaskCardData) => [
  { key: "done", label: "Done", value: fmt(s.done) },
  { key: "onTime", label: "On time", value: pct(s.onTimeRate) },
  { key: "streak", label: "Day streak", value: fmt(s.streak) },
  {
    key: "clear",
    label: "Clear days",
    value: `${fmt(s.clearDays)}/${fmt(s.dueDays)}`,
  },
  {
    key: "followThrough",
    label: "Follow-through",
    value: `${group(s.followThrough, 1)}×`,
  },
]
/** Tasks done per day for a week, per week for a month or more. */
function bars(s: TaskCardData) {
  if (s.range === "7")
    return {
      values: s.perDay.map((d) => d.done),
      labels: s.perDay.map((d) => L.WEEKDAYS[weekday(d.day)].slice(0, 1)),
    }
  const values = s.perDay.reduce<number[]>((a, d, i) => {
    const w = Math.floor(i / 7)
    a[w] = (a[w] ?? 0) + d.done
    return a
  }, [])
  return { values, labels: values.map(() => "") }
}
const plural = (n: number, one: string, many = `${one}s`) =>
  `${fmt(n)} ${n === 1 ? one : many}`
export function TaskCard({
  kind,
  width,
  look,
  data: s,
}: {
  kind: TaskLayout
  width: number
  look: CardLook
  data: TaskCardData
}) {
  const c = cardInk(look),
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    tsk = c.area("tsk"),
    best = s.streak > 0 && s.streak >= s.bestStreak,
    { values, labels } = bars(s),
    top = Math.max(...values),
    stems = (
      <Stems
        values={values}
        labels={labels}
        on={values.length - 1}
        leaf={(v) => v > 0 && v === top}
        height={tall ? 130 : sq ? 76 : 100}
        color={tsk}
        label={s.range === "7" ? "Tasks done by day" : "Tasks done by week"}
      />
    )
  let body: ReactNode
  if (kind === "summary") {
    const change = s.prevDone > 0 ? s.done - s.prevDone : 0,
      down = change < 0
    body = (
      <>
        <Hero
          value={fmt(s.done)}
          unit="done"
          delta={
            <Delta
              n={change}
              suffix={down ? "fewer than last time" : "more than last time"}
            />
          }
        />
        {down ? (
          <Sub
            bad
          >{`${pct(s.onTimeRate)} on time · ${verdict(s.onTimeRate)}`}</Sub>
        ) : (
          <Sub>{`${pct(s.onTimeRate)} on time`}</Sub>
        )}
        {best && <Win>Best streak yet</Win>}
        <Body end>{stems}</Body>
        <Figures
          items={[
            ...(s.shown.streak
              ? [{ label: "Day streak", value: fmt(s.streak), unit: "days" }]
              : []),
            ...(s.shown.clear
              ? [
                  {
                    label: "Clear days",
                    value: `${fmt(s.clearDays)}/${fmt(s.dueDays)}`,
                  },
                ]
              : []),
            ...(s.shown.followThrough
              ? [
                  {
                    label: "Done per slip",
                    value: group(s.followThrough, 1),
                    unit: "×",
                  },
                ]
              : []),
          ]}
        />
      </>
    )
  } else if (kind === "streak") {
    const cells: Dot[] = s.perDay.map((d) => (d.done > 0 ? "on" : "off")),
      first = s.perDay[0]?.day,
      ended = endedRun(cells, ["off"])
    body = (
      <>
        <Title>Getting things done, every day</Title>
        <Hero
          value={fmt(s.streak)}
          unit={s.streak === 1 ? "day" : "days"}
          delta={
            ended ? (
              <Change
                good={false}
              >{`${plural(ended.lost, "day")} lost`}</Change>
            ) : undefined
          }
        />
        {ended && first ? (
          <Sub bad>
            {`Nothing done on ${dayName(s.perDay[ended.at].day)} ended the ${fmt(ended.lost)}-day run.`}
          </Sub>
        ) : best ? (
          <Win>Personal best</Win>
        ) : (
          <Sub>{`Best ${plural(s.bestStreak, "day")}`}</Sub>
        )}
        <Body end>
          {cells.length >= 7 ? (
            <LeafCal
              cells={cells}
              start={first}
              weeks={sq ? 3 : 4}
              rowH={tall ? 25 : sq ? 19 : 24}
              color={tsk}
            />
          ) : (
            stems
          )}
          <ChartNote
            left={
              ended
                ? `Best ${plural(s.bestStreak, "day")}`
                : "A leaf for each day with a task done"
            }
          />
        </Body>
      </>
    )
  } else if (kind === "today") {
    const d = s.today ?? {
        planned: 0,
        done: 0,
        moved: 0,
        open: 0,
        catchUp: 0,
        day: s.to,
      },
      all = d.planned > 0 && d.done === d.planned
    body = (
      <>
        <Title>Today's tasks</Title>
        <Hero
          value={fmt(d.done)}
          unit={`of ${plural(d.planned, "task")} done`}
          small
          delta={
            d.moved > 0 ? (
              <Change good={false}>{`${fmt(d.moved)} moved to later`}</Change>
            ) : undefined
          }
        />
        {d.planned === 0 ? (
          <Sub>Nothing was planned for today.</Sub>
        ) : all ? (
          <Win>Every task planned for today is done</Win>
        ) : d.open > 0 ? (
          <Sub bad>{`${plural(d.open, "task")} still open today`}</Sub>
        ) : (
          <Sub bad>{`${plural(d.moved, "task")} pushed to another day`}</Sub>
        )}
        <Body end>
          <PartLine
            label={`${d.done} done, ${d.moved} moved, ${d.open} open of ${d.planned} planned`}
            parts={[
              { key: "done", label: "Done", value: d.done, color: tsk },
              {
                key: "moved",
                label: "Moved to later",
                value: d.moved,
                color: c.bad,
                open: true,
              },
              {
                key: "open",
                label: "Still open",
                value: d.open,
                color: c.ink,
                open: true,
              },
            ]}
          />
          <ChartNote
            left={
              d.planned
                ? `${pct(d.done / d.planned)} of today's plan done`
                : undefined
            }
            right={
              d.catchUp
                ? `+${fmt(d.catchUp)} overdue cleared`
                : undefined
            }
          />
        </Body>
      </>
    )
  } else if (kind === "timeOnTask") {
    const f = s.focus ?? { rows: [], avgSec: 0, totalSec: 0, day: s.to },
      done = f.rows.filter((r) => r.done).length
    body = (
      <>
        <Title>Time per task</Title>
        <Hero value={fmtHm(f.avgSec)} unit="focused per task" small />
        {f.rows.length ? (
          <Sub>{`${plural(f.rows.length, "task")} · ${fmtHm(f.totalSec)} of Focus today`}</Sub>
        ) : (
          <Sub bad>No Focus session was linked to a task today.</Sub>
        )}
        {f.rows.length > 0 && done === f.rows.length && (
          <Win>Every task worked on is done</Win>
        )}
        <Body>
          <XBars
            color={tsk}
            rows={f.rows.map((r) => ({
              key: r.id,
              name: r.title,
              value: r.sec,
              label: fmtHm(r.sec),
              pr: r.done,
            }))}
          />
          {f.rows.length > 0 && (
            <ChartNote
              left="Focus sessions linked to each task"
              right={`${fmt(done)} of ${fmt(f.rows.length)} done`}
            />
          )}
        </Body>
      </>
    )
  } else {
    const low = s.followThrough < 1
    body = (
      <>
        <Title>Follow-through ratio</Title>
        <Hero value={group(s.followThrough, 1)} unit="× per slip" />
        {low ? (
          <Sub
            bad
          >{`More slipped than got done. ${verdict(Math.min(1, s.followThrough / 3))}.`}</Sub>
        ) : (
          <Win>{verdict(Math.min(1, s.followThrough / 3))}</Win>
        )}
        <Sub>Tasks finished for every one that slipped. Late counts half.</Sub>
        <Body end>{stems}</Body>
      </>
    )
  }
  return (
    <CardFrame
      width={width}
      look={look}
      accent="tsk"
      date={
        kind === "today" && s.today
          ? dayName(s.today.day)
          : kind === "timeOnTask" && s.focus
            ? dayName(s.focus.day)
            : dayRange(s.from, s.to)
      }
      foot={kind === "timeOnTask" ? "Focus time only" : "Counts and rates only"}
    >
      {body}
    </CardFrame>
  )
}
export function TaskShare() {
  const p = useLocalSearchParams<{ range?: string }>(),
    [range, setRange] = useState<"7" | "30" | "90">(
      p.range === "30" || p.range === "90" ? p.range : "7",
    ),
    [layout, setLayout] = useState<TaskLayout>("summary"),
    s = useStats(Number(range)),
    prev = useStats(Number(range), Number(range)),
    t = useTheme(),
    focusState = useFocusState(),
    tasksState = tasksStore.use((x) => x),
    [titles, setTitles] = useState(true),
    [on, setOn] = useState<Record<string, boolean>>({
      done: true,
      onTime: true,
      streak: true,
      clear: false,
      followThrough: false,
    })
  const today = dayKey(),
    done = todayCompletion(tasksState, today),
    time = taskFocusToday(focusState, tasksState, today)
  const data: TaskCardData = {
    ...s,
    prevDone: prev.done,
    range,
    shown: on,
    today: { ...done, day: today },
    focus: {
      ...time,
      day: today,
      rows: titles
        ? time.rows
        : time.rows.map((r, i) => ({ ...r, title: `Task ${i + 1}` })),
    },
  }
  const metrics = taskMetrics(data),
    caption =
      layout === "today"
        ? `${fmt(done.done)} of ${fmt(done.planned)} tasks done today${done.moved ? `, ${fmt(done.moved)} moved to later` : ""} · Unfurl`
        : layout === "timeOnTask"
          ? `${fmtHm(time.avgSec)} of focus per task today · Unfurl`
          : `Tasks ${RANGE_LABEL[range]}: ${metrics
              .filter((m) => on[m.key])
              .map((m) => `${m.value} ${m.label.toLowerCase()}`)
              .join(" · ")} · Unfurl`,
    ranged = layout !== "today" && layout !== "timeOnTask"
  return (
    <Screen title="Share card">
      <ShareComposer
        value={layout}
        onChange={setLayout}
        caption={caption}
        items={(
          [
            "summary",
            "today",
            "timeOnTask",
            "streak",
            "followThrough",
          ] as const
        ).map((key) => ({
          key,
          label: {
            summary: "Summary",
            today: "Today",
            timeOnTask: "Time per task",
            streak: "Streak",
            followThrough: "Follow-through",
          }[key],
          render: (width, look) => (
            <TaskCard kind={key} width={width} look={look} data={data} />
          ),
        }))}
      >
        {ranged && (
          <>
            <SectionHeading>Range</SectionHeading>
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { value: "7", label: "Week" },
                { value: "30", label: "Month" },
                { value: "90", label: "90 days" },
              ]}
            />
          </>
        )}
        {layout === "timeOnTask" && (
          <Frame style={{ padding: 16 }}>
            <Toggle
              label="Show task titles"
              value={titles}
              onChange={setTitles}
            />
          </Frame>
        )}
        {layout === "summary" && (
          <>
            <SectionHeading>Show</SectionHeading>
            <Line style={{ flexWrap: "wrap", gap: 8 }}>
              {metrics
                .filter((m) => m.key !== "done" && m.key !== "onTime")
                .map((m) => (
                  <TaskChip
                    key={m.key}
                    label={m.label}
                    active={on[m.key]}
                    onPress={() => setOn({ ...on, [m.key]: !on[m.key] })}
                  />
                ))}
            </Line>
          </>
        )}
        <Line style={{ marginTop: 16, gap: 6 }}>
          <ShieldCheck size={14} color={t.muted} />
          <Copy size={12} muted style={{ flex: 1 }}>
            {layout === "timeOnTask"
              ? titles
                ? "Task titles show on this card only. Turn them off above."
                : "Tasks read Task 1, Task 2: titles stay off this card."
              : "Task titles never appear on this card."}
          </Copy>
        </Line>
      </ShareComposer>
    </Screen>
  )
}
