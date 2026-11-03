import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { X } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { View } from "react-native"
import { border, Copy, Frame, SectionHeading, ToolButton } from "../native-kit"
import { replace } from "../navigation"
import { fmt, group } from "../share-format"
import {
  Body,
  CardFrame,
  type CardLook,
  ChartNote,
  cardInk,
  Delta,
  Figures,
  Hero,
  ShareComposer,
  Spark,
  Sub,
  Title,
  Win,
  Words,
  XBars,
} from "../share-kit"
import { useTheme } from "../theme"
import { Empty, Screen, Toggle } from "../ui"

export type WorkoutLayout = "summary" | "pr" | "photo"
export type WorkoutFlags = {
  exercises: boolean
  prs: boolean
  week: boolean
  bodyweight: boolean
  macros: boolean
}
/** What a workout card shows, already counted. Weights are in kg. */
export type WorkoutCardData = {
  name: string
  date: string
  durationSec: number
  volume: number
  /** The last time this workout was done: its volume, for the change. */
  prevVolume: number | null
  sets: number
  prs: { exercise: string; label: string; value: number; volume: boolean }[]
  /** Each exercise: its volume, the sets done, and whether it set a record. */
  lines: {
    id: string
    name: string
    volume: number
    sets: number
    pr: boolean
  }[]
  focus: {
    name: string
    pr: string | null
    e1rm: number
    gain: number
    /** The best before this session, for a lift that set no record. */
    best: number
    series: number[]
  }
  week: number
  weeklyTarget: number
  streak: number
  bodyweight: number
  macros: { kcal: number; protein: number }
}
/** "1 h 12 m" past an hour, "45 min" under it. */
const duration = (sec: number) => {
  const mins = Math.round(sec / 60)
  return mins >= 60
    ? `${group(Math.floor(mins / 60))} h${mins % 60 ? ` ${mins % 60} m` : ""}`
    : `${mins} min`
}
const weight = (kg: number) => fmt(Math.round(kg * 10) / 10, 6, 1)
const kg = (n: number) => `${fmt(Math.round(n))} kg`

export function WorkoutCard({
  kind,
  width,
  look,
  data: d,
  flags,
}: {
  kind: WorkoutLayout
  width: number
  look: CardLook
  data: WorkoutCardData
  flags: WorkoutFlags
}) {
  const c = cardInk(look),
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    fitC = c.area("fit"),
    change =
      d.prevVolume && d.prevVolume > 0
        ? Math.round(((d.volume - d.prevVolume) / d.prevVolume) * 100)
        : 0,
    delta = <Delta n={change} unit="%" suffix="vs last time" />,
    figures = (
      <Figures
        items={[
          { label: "Time", value: duration(d.durationSec) },
          { label: "Sets", value: fmt(d.sets) },
          ...(flags.prs
            ? [
                {
                  label: d.prs.length === 1 ? "Record" : "Records",
                  value: fmt(d.prs.length),
                },
              ]
            : []),
        ]}
      />
    )
  let body: ReactNode
  if (kind === "pr") {
    const record = !!d.focus.pr,
      below = Math.round((d.focus.best - d.focus.e1rm) * 10) / 10
    body = (
      <>
        <Title>{d.focus.name}</Title>
        <Hero
          value={weight(d.focus.e1rm)}
          unit="kg"
          delta={
            record ? (
              <Delta
                n={Math.round(d.focus.gain * 10) / 10}
                unit=" kg"
                suffix="vs best"
              />
            ) : below > 0 ? (
              <Delta n={-below} unit=" kg" suffix="vs best" />
            ) : undefined
          }
        />
        {record ? (
          <Win>{`${d.focus.pr} record`}</Win>
        ) : (
          <Sub bad={below > 0}>
            {below > 0
              ? "Top lift, estimated 1-rep max. No record today."
              : "Top lift, estimated 1-rep max"}
          </Sub>
        )}
        <Body end>
          {d.focus.series.length > 1 && (
            <Spark
              values={d.focus.series}
              color={fitC}
              height={tall ? 120 : sq ? 64 : 92}
              best={d.focus.best > 0 ? d.focus.best : undefined}
              bestLabel={
                d.focus.best > 0
                  ? `${record ? "Best before" : "Best"}, ${weight(d.focus.best)} kg`
                  : undefined
              }
              label="Best estimated 1-rep max by session"
            />
          )}
          <ChartNote
            left={`Last ${fmt(d.focus.series.length)} sessions`}
            right={d.date}
          />
        </Body>
      </>
    )
  } else if (kind === "photo")
    body = (
      <>
        <View style={{ flex: 1, justifyContent: "center" }}>
          {look.backdrop === "photo" && !look.photo && (
            <Words size={3.6} align="center" muted>
              Add your gym photo
            </Words>
          )}
        </View>
        <Title>{d.name}</Title>
        <Hero
          value={fmt(Math.round(d.volume))}
          unit="kg"
          delta={delta}
          small={sq}
        />
        {figures}
      </>
    )
  else {
    const rows = d.lines.map((l) => ({
      key: l.id,
      name: l.name,
      value: l.volume,
      label: kg(l.volume),
      sets: l.sets,
      pr: flags.prs && l.pr,
    }))
    body = (
      <>
        <Title>{d.name}</Title>
        <Hero value={fmt(Math.round(d.volume))} unit="kg" delta={delta} />
        {flags.prs && d.prs.length > 0 && (
          <Win>{`${fmt(d.prs.length)} personal ${d.prs.length === 1 ? "record" : "records"}`}</Win>
        )}
        {figures}
        {flags.exercises && rows.length > 0 && (
          <Body>
            <XBars rows={rows} color={fitC} />
          </Body>
        )}
      </>
    )
  }
  const foot = [
    flags.week ? `${fmt(d.week)} of ${fmt(d.weeklyTarget)} this week` : "",
    flags.week && d.streak > 0 ? `${fmt(d.streak)}-week streak` : "",
    flags.bodyweight && d.bodyweight > 0
      ? `Bodyweight ${weight(d.bodyweight)} kg`
      : "",
    flags.macros
      ? `${fmt(Math.round(d.macros.kcal))} kcal · ${fmt(Math.round(d.macros.protein))} g protein today`
      : "",
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <CardFrame width={width} look={look} accent="fit" date={d.date} foot={foot}>
      {body}
    </CardFrame>
  )
}

export function FitnessShare({ id }: { id: string }) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    p = useLocalSearchParams<{
      template?: WorkoutLayout
      exercise?: string
      // Just finished: the card is offered before going back to Fitness.
      done?: string
    }>(),
    w = s.workouts.find((w) => w.id === id),
    [layout, setLayout] = useState<WorkoutLayout>(p.template ?? "summary"),
    [flags, setFlags] = useState<WorkoutFlags>({
      exercises: true,
      prs: true,
      week: true,
      bodyweight: false,
      macros: false,
    })
  if (!w)
    return (
      <Screen title="Share">
        <Empty
          title="Nothing to share yet"
          detail="Finish a workout to make a card."
        />
      </Screen>
    )
  const totals = C.workoutTotals(s, w),
    prs = C.allPrs(s).filter((p) => p.workoutId === id),
    bw = C.latestBodyweight(s) ?? 0,
    exName = (exerciseId: string) =>
      s.exercises.find((e) => e.id === exerciseId)?.name ?? "",
    lines = w.exercises.map((we) => {
      const ex = s.exercises.find((e) => e.id === we.exerciseId),
        stats = C.exStats(we, ex, bw)
      return {
        id: we.exerciseId,
        name: ex?.name ?? "",
        volume: stats.volume,
        sets: stats.doneSets,
        pr: prs.some((p) => p.exerciseId === we.exerciseId),
        e1rm: stats.bestE1rm,
      }
    }),
    focusId =
      p.exercise ??
      prs.find((p) => p.kind === "e1rm")?.exerciseId ??
      [...lines].sort((a, b) => b.e1rm - a.e1rm)[0]?.id,
    focusPr =
      prs.find((p) => p.exerciseId === focusId && p.kind === "e1rm") ??
      prs.find((p) => p.exerciseId === focusId),
    focus = lines.find((l) => l.id === focusId),
    day = dayKey(new Date(w.startedAt)),
    series = focusId
      ? C.exerciseHistory(s, focusId)
          .filter((h) => h.workout.startedAt <= w.startedAt)
          .map((h) => h.stats.bestE1rm)
      : [],
    last = s.workouts
      .filter(
        (x) =>
          x.id !== w.id &&
          !!x.endedAt &&
          x.name === w.name &&
          x.startedAt < w.startedAt,
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  const data: WorkoutCardData = {
    name: w.name,
    date: new Date(w.startedAt).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    durationSec: totals.durationSec,
    volume: totals.volume,
    prevVolume: last ? C.workoutTotals(s, last).volume : null,
    sets: totals.done,
    prs: prs.map((p) => ({
      exercise: exName(p.exerciseId).split(" ").slice(-1)[0] ?? "",
      label: C.prLabel[p.kind],
      value: p.value,
      volume: p.kind === "volume",
    })),
    lines,
    focus: {
      name: focus?.name ?? w.name,
      pr: focusPr ? C.prLabel[focusPr.kind] : null,
      e1rm: focusPr?.value ?? focus?.e1rm ?? 0,
      gain: focusPr ? Math.max(0, focusPr.value - focusPr.prev) : 0,
      best: focusPr ? focusPr.prev : Math.max(0, ...series.slice(0, -1)),
      series,
    },
    week:
      C.sessionsByWeek(s, 20).find((x) => x.start === C.weekStart(day))
        ?.count ?? 1,
    weeklyTarget: s.settings.weeklyTarget,
    streak: C.consistencyStreak(s),
    bodyweight: bw,
    macros: C.dayTotals(s, day).totals,
  }
  return (
    <Screen
      title={p.done ? "Post your workout?" : "Share workout"}
      actions={
        p.done ? (
          <ToolButton
            icon={X}
            label="Not now"
            onPress={() => replace("/fitness")}
          />
        ) : undefined
      }
    >
      <ShareComposer
        value={layout}
        onChange={setLayout}
        caption={`${w.name} · ${C.fmtMin(totals.durationSec)} · ${kg(totals.volume)}${prs.length ? ` · ${fmt(prs.length)} PR` : ""}`}
        items={(
          [
            { key: "summary", label: "Summary" },
            { key: "pr", label: "PR highlight" },
            { key: "photo", label: "Overlay" },
          ] as const
        ).map((item) => ({
          ...item,
          render: (width: number, look: CardLook) => (
            <WorkoutCard
              kind={item.key}
              width={width}
              look={look}
              data={data}
              flags={flags}
            />
          ),
        }))}
      >
        <View style={{ marginTop: -12 }}>
          <SectionHeading>Show on card</SectionHeading>
          <Frame style={{ paddingHorizontal: 16 }}>
            {(
              [
                { key: "exercises", label: "Exercise list" },
                { key: "prs", label: "PR badges" },
                { key: "week", label: "Week tally and streak" },
                { key: "bodyweight", label: "Bodyweight" },
                { key: "macros", label: "Today’s calories and protein" },
              ] as const
            ).map((f, i) => (
              <View
                key={f.key}
                style={{
                  minHeight: 44,
                  paddingVertical: 8,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: border(t.line, 0.6),
                }}
              >
                <Toggle
                  label={f.label}
                  value={flags[f.key]}
                  onChange={(v) => setFlags({ ...flags, [f.key]: v })}
                />
              </View>
            ))}
          </Frame>
        </View>
        <Copy size={12} muted style={{ paddingHorizontal: 4 }}>
          Money never appears on share cards. Bodyweight and food stay off
          unless you turn them on.
        </Copy>
      </ShareComposer>
    </Screen>
  )
}
