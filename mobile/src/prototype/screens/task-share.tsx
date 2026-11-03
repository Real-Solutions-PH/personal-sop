import { weekday } from "@domain/lib/day"
import { useStats } from "@domain/tasks/hooks"
import * as L from "@domain/tasks/logic"
import { useLocalSearchParams } from "expo-router"
import { ShieldCheck } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { Copy, Line, SectionHeading, Segmented } from "../native-kit"
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
} from "../share-kit"
import { useTheme } from "../theme"
import { Screen } from "../ui"
import { TaskChip } from "./task-find"
import { RANGE_LABEL } from "./task-stats"

export type TaskLayout = "summary" | "streak" | "followThrough"
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
      date={dayRange(s.from, s.to)}
      foot="Counts and rates only"
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
    [on, setOn] = useState<Record<string, boolean>>({
      done: true,
      onTime: true,
      streak: true,
      clear: false,
      followThrough: false,
    })
  const data: TaskCardData = {
    ...s,
    prevDone: prev.done,
    range,
    shown: on,
  }
  const metrics = taskMetrics(data),
    caption = `Tasks ${RANGE_LABEL[range]}: ${metrics
      .filter((m) => on[m.key])
      .map((m) => `${m.value} ${m.label.toLowerCase()}`)
      .join(" · ")} · Unfurl`
  return (
    <Screen title="Share card">
      <ShareComposer
        value={layout}
        onChange={setLayout}
        caption={caption}
        items={(["summary", "streak", "followThrough"] as const).map((key) => ({
          key,
          label: {
            summary: "Summary",
            streak: "Streak",
            followThrough: "Follow-through",
          }[key],
          render: (width, look) => (
            <TaskCard kind={key} width={width} look={look} data={data} />
          ),
        }))}
      >
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
          <Copy size={12} muted>
            Task titles never appear on a card.
          </Copy>
        </Line>
      </ShareComposer>
    </Screen>
  )
}
