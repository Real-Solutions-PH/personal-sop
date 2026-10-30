import { weekday } from "@domain/lib/day"
import { useStats } from "@domain/tasks/hooks"
import * as L from "@domain/tasks/logic"
import { useLocalSearchParams } from "expo-router"
import { Flame, ShieldCheck, Trophy } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { View } from "react-native"
import { Copy, Line, SectionHeading, Segmented } from "../native-kit"
import { fmt, group, pct } from "../share-format"
import {
  CardFrame,
  type CardLook,
  CardRing,
  Chip,
  cardInk,
  Delta,
  Label,
  Num,
  ShareComposer,
  Stats,
  useCard,
  Words,
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
function Bars({ s, tall }: { s: TaskCardData; tall: boolean }) {
  const { q, c } = useCard(),
    bars =
      s.range === "7"
        ? s.perDay.map((d) => d.done)
        : s.perDay.reduce<number[]>((a, d, i) => {
            const w = Math.floor(i / 7)
            a[w] = (a[w] ?? 0) + d.done
            return a
          }, []),
    max = Math.max(1, ...bars),
    h = (tall ? 18 : 8) * q
  return (
    <Line style={{ gap: q, alignItems: "flex-end" }}>
      {bars.map((n, i) => (
        <View key={i} style={{ flex: 1, gap: q }}>
          <View style={{ height: h, justifyContent: "flex-end" }}>
            <View
              style={{
                height: Math.max(0.6 * q, (n / max) * h),
                backgroundColor: n ? c.area("tsk") : c.track,
                borderTopLeftRadius: q,
                borderTopRightRadius: q,
              }}
            />
          </View>
          {s.range === "7" && s.perDay[i] && (
            <Label align="center">
              {L.WEEKDAYS[weekday(s.perDay[i].day)].slice(0, 1)}
            </Label>
          )}
        </View>
      ))}
    </Line>
  )
}
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
    q = width / 100,
    tall = look.format === "9:16",
    tsk = c.area("tsk"),
    ratio = Math.min(1, s.followThrough / 3),
    best = s.streak > 0 && s.streak >= s.bestStreak
  let body: ReactNode
  if (kind === "summary")
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 4.5 * q }}>
        <View style={{ gap: 2 * q }}>
          <Words size={tall ? 8 : 6} weight="semibold" lines={1}>
            {RANGE_LABEL[s.range].replace(/^./, (x) => x.toUpperCase())}
          </Words>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 1.6 * q,
              display: look.format === "1:1" ? "none" : "flex",
            }}
          >
            <Chip icon={Flame} tone={tsk}>
              {verdict(s.onTimeRate)}
            </Chip>
            {best && (
              <Chip icon={Trophy} tone={tsk}>
                Best streak
              </Chip>
            )}
          </View>
        </View>
        <Line style={{ gap: 5 * q }}>
          <View style={{ flex: 1, minWidth: 0, gap: q }}>
            <Label>Tasks done</Label>
            <Num size={tall ? 24 : 16}>{fmt(s.done)}</Num>
            {s.prevDone > 0 && (
              <Delta n={s.done - s.prevDone} suffix="vs last period" />
            )}
          </View>
          <CardRing value={s.onTimeRate ?? 0} size={tall ? 30 : 24} color={tsk}>
            <Num size={8} align="center">
              {pct(s.onTimeRate)}
            </Num>
            <Label align="center">on time</Label>
          </CardRing>
        </Line>
        {look.format !== "1:1" && <Bars s={s} tall={tall} />}
        <Stats
          items={taskMetrics(s).filter(
            (m) => m.key !== "done" && m.key !== "onTime" && s.shown[m.key],
          )}
          size={7}
        />
      </View>
    )
  else if (kind === "streak")
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
          value={s.bestStreak ? s.streak / s.bestStreak : 0}
          size={tall ? 58 : 44}
          color={tsk}
        >
          <Flame size={7 * q} color={tsk} strokeWidth={2} />
          <Num size={tall ? 18 : 14} align="center">
            {fmt(s.streak)}
          </Num>
          <Label align="center">{s.streak === 1 ? "day" : "days"}</Label>
        </CardRing>
        <Words size={5} weight="semibold" align="center">
          Getting things done, every day
        </Words>
        <Chip icon={best ? Trophy : undefined} tone={tsk}>
          {best ? "Personal best" : `Best ${fmt(s.bestStreak)} days`}
        </Chip>
      </View>
    )
  else
    body = (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 3 * q,
        }}
      >
        <Label align="center">Follow-through ratio</Label>
        <CardRing
          value={ratio}
          size={tall ? 56 : look.format === "1:1" ? 34 : 42}
          color={tsk}
        >
          <Num size={tall ? 16 : 12} align="center">
            {`${group(s.followThrough, 1)}×`}
          </Num>
          <Label align="center">per slip</Label>
        </CardRing>
        <Chip icon={Flame} tone={tsk}>
          {verdict(ratio)}
        </Chip>
        {look.format !== "1:1" && (
          <Words size={3.4} align="center" muted>
            Tasks finished for every one that slipped. Late counts half.
          </Words>
        )}
        {tall && (
          <View style={{ alignSelf: "stretch", marginTop: 2 * q }}>
            <Stats
              items={[
                { label: "Done", value: fmt(s.done) },
                { label: "On time", value: pct(s.onTimeRate) },
                { label: "Streak", value: fmt(s.streak), unit: "d" },
              ]}
              size={7}
            />
          </View>
        )}
      </View>
    )
  return (
    <CardFrame
      width={width}
      look={look}
      accent="tsk"
      kicker="Tasks"
      date={`${L.fmtDate(s.from)} – ${L.fmtDate(s.to)}`}
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
