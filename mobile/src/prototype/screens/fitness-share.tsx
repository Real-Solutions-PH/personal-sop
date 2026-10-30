import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { Trophy, X } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { View } from "react-native"
import {
  border,
  Copy,
  Frame,
  Line,
  SectionHeading,
  ToolButton,
} from "../native-kit"
import { replace } from "../navigation"
import { fmt, group } from "../share-format"
import {
  CardFrame,
  type CardLook,
  Chip,
  cardInk,
  Delta,
  Label,
  Num,
  ShareComposer,
  Spark,
  Stats,
  useCard,
  Words,
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
  sets: number
  prs: { exercise: string; label: string; value: number; volume: boolean }[]
  lines: { id: string; name: string; weight: number | null; reps: number }[]
  focus: {
    name: string
    pr: string | null
    e1rm: number
    gain: number
    series: number[]
  }
  week: number
  weeklyTarget: number
  streak: number
  bodyweight: number
  macros: { kcal: number; protein: number }
}
/** "1:05 h" past an hour, "45 min" under it. */
const duration = (sec: number) => {
  const mins = Math.round(sec / 60)
  return mins >= 60
    ? {
        value: `${group(Math.floor(mins / 60))}:${String(mins % 60).padStart(2, "0")}`,
        unit: "h",
      }
    : { value: String(mins), unit: "min" }
}
/** Volume in kg, or tonnes from 10 t: "8,450 kg", "12.3 t", "1.2k t". */
const volume = (kg: number) =>
  kg >= 10000
    ? { value: fmt(Math.round(kg / 100) / 10, 5, 1), unit: "t" }
    : { value: fmt(Math.round(kg)), unit: "kg" }
const weight = (kg: number) => fmt(Math.round(kg * 10) / 10, 6, 1)

function WeekTally({ d }: { d: WorkoutCardData }) {
  const { q, c } = useCard(),
    slots = Math.min(14, Math.max(d.week, d.weeklyTarget))
  return (
    <View style={{ gap: 1.2 * q }}>
      <Line style={{ justifyContent: "space-between" }}>
        <Label>This week</Label>
        <Num size={4.4}>{`${fmt(d.week)}/${fmt(d.weeklyTarget)}`}</Num>
      </Line>
      {slots > 0 && (
        <Line style={{ gap: 1.2 * q }}>
          {Array.from({ length: slots }, (_, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 1.8 * q,
                borderRadius: q,
                backgroundColor: i < d.week ? c.area("fit") : c.track,
              }}
            />
          ))}
        </Line>
      )}
    </View>
  )
}
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
    q = width / 100,
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    fitC = c.area("fit"),
    time = duration(d.durationSec),
    vol = volume(d.volume),
    stats = (size: number) => (
      <Stats
        items={[
          { label: "Time", ...time },
          { label: "Volume", ...vol },
          { label: "Sets", value: fmt(d.sets) },
        ]}
        size={size}
      />
    ),
    medals =
      flags.prs && d.prs.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 1.6 * q }}>
          {d.prs.slice(0, 3).map((p) => (
            <Chip key={`${p.exercise}-${p.label}`} icon={Trophy} tone={fitC}>
              {`${p.exercise} ${p.volume ? "volume" : `${weight(p.value)} kg`}`}
            </Chip>
          ))}
        </View>
      ) : null,
    shown = tall ? 5 : sq ? 2 : 3
  let body: ReactNode
  if (kind === "pr")
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 3.5 * q }}>
        <View style={{ gap: 2 * q }}>
          <Chip icon={Trophy} tone={fitC}>
            {d.focus.pr ? `${d.focus.pr} PR` : "Top lift"}
          </Chip>
          <Words size={9} weight="semibold">
            {d.focus.name}
          </Words>
        </View>
        <View>
          <Label>Est. 1-rep max</Label>
          <Num size={tall ? 26 : 20} unit="kg">
            {weight(d.focus.e1rm)}
          </Num>
          {d.focus.gain > 0 && (
            <Delta
              n={Math.round(d.focus.gain * 10) / 10}
              unit=" kg"
              suffix="vs previous best"
            />
          )}
        </View>
        {d.focus.series.length > 1 && !sq && (
          <View style={{ gap: q }}>
            <Spark
              values={d.focus.series}
              color={fitC}
              height={tall ? 24 : 14}
            />
            <Label>{`Last ${fmt(d.focus.series.length)} sessions`}</Label>
          </View>
        )}
        {tall && stats(8)}
      </View>
    )
  else if (kind === "photo")
    body = (
      <View style={{ flex: 1, justifyContent: "flex-end", gap: 3.5 * q }}>
        {look.backdrop === "photo" && !look.photo && (
          <View style={{ flex: 1, justifyContent: "center" }}>
            <Words size={3.6} align="center" muted>
              Add your gym photo
            </Words>
          </View>
        )}
        <Words size={9} weight="semibold">
          {d.name}
        </Words>
        {stats(sq ? 7 : 9)}
        {!sq && medals}
      </View>
    )
  else
    body = (
      <View style={{ flex: 1, justifyContent: "center", gap: 3.5 * q }}>
        <View style={{ gap: 2 * q }}>
          <Words size={sq ? 7 : 9} weight="semibold" lines={sq ? 1 : 2}>
            {d.name}
          </Words>
          {d.prs.length > 0 && !sq && (
            <Chip icon={Trophy} tone={fitC}>
              {`${fmt(d.prs.length)} personal ${d.prs.length === 1 ? "record" : "records"}`}
            </Chip>
          )}
        </View>
        {stats(sq ? 7 : 9)}
        {flags.exercises && d.lines.length > 0 && (
          <View
            style={{
              borderTopWidth: 1,
              borderColor: c.line,
              paddingTop: 2.5 * q,
              gap: 1.6 * q,
            }}
          >
            {d.lines.slice(0, shown).map((l) => (
              <Line key={l.id} style={{ gap: 3 * q }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Words size={3.8} lines={1}>
                    {l.name}
                  </Words>
                </View>
                {l.weight !== null && (
                  <View style={{ maxWidth: "45%" }}>
                    <Num size={4.2} align="right">
                      {`${weight(l.weight)} × ${fmt(l.reps)}`}
                    </Num>
                  </View>
                )}
              </Line>
            ))}
            {d.lines.length > shown && (
              <Label>{`+${fmt(d.lines.length - shown)} more`}</Label>
            )}
          </View>
        )}
        {tall && medals}
        {flags.week && !sq && <WeekTally d={d} />}
      </View>
    )
  const foot = [
    d.streak > 0 ? `${fmt(d.streak)}-week streak` : "",
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
    <CardFrame
      width={width}
      look={look}
      kicker="Workout"
      date={d.date}
      foot={foot}
    >
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
        weight: stats.top ? stats.top.weight : null,
        reps: stats.top?.reps ?? 0,
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
    day = dayKey(new Date(w.startedAt))
  const data: WorkoutCardData = {
    name: w.name,
    date: new Date(w.startedAt).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    durationSec: totals.durationSec,
    volume: totals.volume,
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
      series: focusId
        ? C.exerciseHistory(s, focusId)
            .filter((h) => h.workout.startedAt <= w.startedAt)
            .map((h) => h.stats.bestE1rm)
        : [],
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
        caption={`${w.name} · ${C.fmtMin(totals.durationSec)} · ${volume(totals.volume).value} ${volume(totals.volume).unit}${prs.length ? ` · ${fmt(prs.length)} PR` : ""}`}
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
