import { PLACE_MAX, setWorkoutPlace } from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type { Exercise, WorkoutSet } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { Check, Dumbbell, LocateFixed, MapPin, X } from "lucide-react-native"
import { type ReactNode, useRef, useState } from "react"
import { Text, TextInput, View } from "react-native"
import Svg, { Path } from "react-native-svg"
import { jitter, rng, smooth } from "../brand/scribble"
import {
  border,
  Copy,
  Frame,
  SectionHeading,
  Tap,
  ToolButton,
} from "../native-kit"
import { replace } from "../navigation"
import { findNearby, fmtDistance, type NearbyPlace } from "../nearby-places"
import { fmt, group } from "../share-format"
import {
  Body,
  CardFrame,
  type CardLook,
  CardSprig,
  ChartNote,
  cardInk,
  cardShadow,
  Delta,
  Dense,
  Figures,
  Hero,
  Label,
  Num,
  ShareComposer,
  Spark,
  Sub,
  Title,
  useCard,
  Win,
  Words,
  XBars,
} from "../share-kit"
import { fonts, useTheme } from "../theme"
import { Button, Empty, Screen, Toggle } from "../ui"

export type WorkoutLayout = "summary" | "sets" | "pr" | "records" | "photo"
export type WorkoutFlags = {
  /** Where it was trained, when one is set (absent: shown). */
  place?: boolean
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
  /** Where it was trained ("Anytime Fitness BGC"), or null. */
  place: string | null
  /** Every exercise with every set done, for the full summary. */
  detail: ExerciseDetail[]
  /** Every exercise that set a record, best kind first. */
  records: RecordRow[]
}
/** One run of alike sets: "60 kg" over reps 8 · 8 · 7. */
export type SetToken = { load: string; reps: string[]; warmup: boolean }
export type ExerciseDetail = {
  id: string
  name: string
  volume: number
  pr: boolean
  tokens: SetToken[]
}
export type RecordRow = {
  id: string
  name: string
  /** The record kinds it set, in order: "Est. 1-rep max", "Heaviest". */
  kinds: string[]
  /** The headline record (the first kind): now and the best before. */
  value: number
  prev: number
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

/** The sets of one exercise as runs of alike sets, in the order done:
 * "60 kg 8 · 8 · 7", then "70 kg 5". Warm-ups are their own runs. Timed
 * sets run by speed or added weight; reps-only sets have no load. */
export function setTokens(
  ex: Pick<Exercise, "loadType" | "track"> | undefined,
  sets: WorkoutSet[],
): SetToken[] {
  const out: SetToken[] = [],
    timed = C.isTimed(ex)
  for (const set of sets) {
    if (!C.isDone(set)) continue
    const warmup = !C.isWorking(set),
      load = timed
        ? set.speedKmh
          ? `${weight(set.speedKmh)} km/h`
          : set.weight > 0
            ? `${weight(set.weight)} kg`
            : ""
        : ex?.loadType === "bodyweight"
          ? set.weight > 0
            ? `BW +${weight(set.weight)} kg`
            : "BW"
          : ex?.loadType === "reps"
            ? ""
            : `${weight(set.weight)} kg`,
      rep = timed ? C.fmtSpan(C.setSeconds(set)) : fmt(set.reps),
      last = out[out.length - 1]
    if (last && last.load === load && last.warmup === warmup)
      last.reps.push(rep)
    else out.push({ load, reps: [rep], warmup })
  }
  return out
}

/** Where it was trained, under the title: a pin and the place's name. */
function PlaceLine({ name }: { name: string }) {
  const { q, c } = useCard(),
    p = (100 / 360) * q
  return (
    <View
      testID="card-place"
      style={{ flexDirection: "row", alignItems: "center", gap: 5 * p }}
    >
      <MapPin size={15 * p} color={c.mark} strokeWidth={2.2} />
      <View style={{ flexShrink: 1 }}>
        <Words size={15 * (100 / 360)} weight="medium" lines={2} muted>
          {name}
        </Words>
      </View>
    </View>
  )
}

/** A hand-drawn stem as long as ``share`` of the row: an exercise's part
 * of the session's volume. */
function Stem({
  share,
  color,
  seed,
  span,
}: {
  share: number
  color: string
  seed: number
  /** Its width in kit points: the card's 312, or a column's. */
  span: number
}) {
  const { q, c } = useCard(),
    p = (100 / 360) * q,
    w = Math.max(14, Math.min(1, share) * (span - 12)),
    d = smooth(
      jitter(
        [
          [4, 5],
          [4 + (w - 4) * 0.35, 4.4],
          [4 + (w - 4) * 0.7, 5.6],
          [w, 5],
        ],
        0.7,
        rng(seed * 7 + 3),
      ),
    )
  return (
    <Svg width={span * p} height={10 * p} viewBox={`0 0 ${span} 10`}>
      <Path
        d={`M4 5 H${span - 4}`}
        stroke={c.track}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeDasharray="1 5"
      />
      <Path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </Svg>
  )
}

/** A column's width in kit points when a list goes to two (48% of 312). */
const COL = 149
/** Every exercise and every set: the name and its volume, a stem for its
 * part of the session, then its runs of sets. Drawn as large as the room
 * allows; a long session goes to two columns rather than dropping any. */
function SetList({
  rows,
  color,
  showPr,
}: {
  rows: ExerciseDetail[]
  color: string
  showPr: boolean
}) {
  const max = Math.max(1, ...rows.map((r) => r.volume))
  return (
    <Dense min={0.62}>
      {({ over }) => (
        <View
          style={
            over
              ? { flexDirection: "row", flexWrap: "wrap", columnGap: "4%" }
              : undefined
          }
        >
          {rows.map((r, i) => (
            <View key={r.id} style={over ? { width: "48%" } : undefined}>
              <ExerciseBlock
                span={over ? COL : 312}
                row={r}
                share={r.volume / max}
                color={color}
                showPr={showPr}
                seed={i}
              />
            </View>
          ))}
        </View>
      )}
    </Dense>
  )
}
function ExerciseBlock({
  row: r,
  share,
  color,
  showPr,
  seed,
  span,
}: {
  span: number
  row: ExerciseDetail
  share: number
  color: string
  showPr: boolean
  seed: number
}) {
  const { q, c } = useCard(),
    p = (100 / 360) * q,
    shade = cardShadow(c, 13 * p)
  return (
    <View testID="card-exercise" style={{ paddingBottom: 9 * p, gap: 2 * p }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 * p }}>
        <View
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 4 * p,
          }}
        >
          <View style={{ flexShrink: 1 }}>
            <Words size={14 * (100 / 360)} weight="semibold" lines={2}>
              {r.name}
            </Words>
          </View>
          {showPr && r.pr ? <CardSprig size={15 * p} /> : null}
        </View>
        {r.volume > 0 ? <Label align="right">{kg(r.volume)}</Label> : null}
      </View>
      {r.volume > 0 ? (
        <Stem share={share} color={color} seed={seed} span={span} />
      ) : null}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          columnGap: 12 * p,
          rowGap: 1 * p,
        }}
      >
        {r.tokens.map((t, k) => (
          <Text
            key={k}
            testID="card-set-run"
            numberOfLines={3}
            allowFontScaling={false}
            style={{
              fontFamily: fonts.semibold,
              fontSize: 13 * p,
              lineHeight: 13 * p * 1.35,
              color: t.warmup ? c.muted : c.ink,
              fontVariant: ["tabular-nums"],
              ...shade,
            }}
          >
            {t.load ? (
              <Text style={{ fontFamily: fonts.medium, color: c.muted }}>
                {`${t.warmup ? "Warm-up " : ""}${t.load}  `}
              </Text>
            ) : t.warmup ? (
              <Text style={{ fontFamily: fonts.medium, color: c.muted }}>
                {"Warm-up  "}
              </Text>
            ) : null}
            {t.reps.join(" · ")}
          </Text>
        ))}
      </View>
    </View>
  )
}

/** Every exercise that set a record: its name and sprig, the record now,
 * one bar from the best before (the mark) to now (the gain in green), and
 * the record kinds it set with the gain. */
function RecordList({ rows, color }: { rows: RecordRow[]; color: string }) {
  return (
    <Dense min={0.62}>
      {({ over }) => (
        <View
          style={
            over
              ? { flexDirection: "row", flexWrap: "wrap", columnGap: "4%" }
              : undefined
          }
        >
          {rows.map((r, i) => (
            <View key={r.id} style={over ? { width: "48%" } : undefined}>
              <RecordBlock
                row={r}
                color={color}
                seed={i}
                span={over ? COL : 312}
              />
            </View>
          ))}
        </View>
      )}
    </Dense>
  )
}
function RecordBlock({
  row: r,
  color,
  seed,
  span,
}: {
  span: number
  row: RecordRow
  color: string
  seed: number
}) {
  const { q, c } = useCard(),
    p = (100 / 360) * q,
    gain = Math.round((r.value - r.prev) * 10) / 10,
    // The bar starts at four fifths of the best before, so a small gain
    // still shows as a visible tip past the mark.
    lo = r.prev > 0 ? r.prev * 0.8 : 0,
    at = r.prev > 0 ? (r.prev - lo) / Math.max(0.001, r.value - lo) : 0,
    X = (f: number) => 4 + f * (span - 12),
    stem = smooth(
      jitter(
        [
          [4, 6],
          [X(at * 0.5), 5.4],
          [X(at), 6],
        ],
        0.6,
        rng(seed * 5 + 1),
      ),
    )
  return (
    <View testID="card-record" style={{ paddingBottom: 10 * p, gap: 3 * p }}>
      <View
        style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 * p }}
      >
        <View
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 4 * p,
          }}
        >
          <View style={{ flexShrink: 1 }}>
            <Words size={15 * (100 / 360)} weight="semibold" lines={2}>
              {r.name}
            </Words>
          </View>
          <CardSprig size={16 * p} />
        </View>
        <Num size={20 * (100 / 360)} unit="kg" unitSize={12 * (100 / 360)}>
          {weight(r.value)}
        </Num>
      </View>
      <Svg width={span * p} height={12 * p} viewBox={`0 0 ${span} 12`}>
        <Path
          d={`M4 6 H${span - 4}`}
          stroke={c.track}
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeDasharray="1 5"
        />
        {r.prev > 0 ? (
          <>
            <Path
              d={stem}
              fill="none"
              stroke={color}
              strokeWidth={3.5}
              strokeLinecap="round"
            />
            <Path
              d={`M${X(at)} 6 H${X(1)}`}
              stroke={c.good}
              strokeWidth={3.5}
              strokeLinecap="round"
            />
            <Path
              d={`M${X(at)} 1 V11`}
              stroke={c.ink}
              strokeWidth={1.4}
              strokeLinecap="round"
            />
          </>
        ) : (
          <Path
            d={`M4 6 H${X(1)}`}
            stroke={c.good}
            strokeWidth={3.5}
            strokeLinecap="round"
          />
        )}
      </Svg>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8 * p,
        }}
      >
        <View style={{ flexShrink: 1 }}>
          <Label>{r.kinds.join(" · ")}</Label>
        </View>
        {r.prev > 0 && gain > 0 ? (
          <Delta n={gain} unit=" kg" suffix="vs best" />
        ) : (
          <Label align="right">First time logged</Label>
        )}
      </View>
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
  const place =
    flags.place !== false && d.place ? <PlaceLine name={d.place} /> : null
  let body: ReactNode
  if (kind === "sets")
    body = (
      <>
        <Title>{d.name}</Title>
        {place}
        <Figures
          items={[
            { label: "Volume", value: fmt(Math.round(d.volume)), unit: "kg" },
            { label: "Time", value: duration(d.durationSec) },
            { label: "Sets", value: fmt(d.sets) },
            ...(flags.prs && d.records.length
              ? [
                  {
                    label: d.records.length === 1 ? "Record" : "Records",
                    value: fmt(d.records.length),
                  },
                ]
              : []),
          ]}
        />
        <SetList rows={d.detail} color={fitC} showPr={flags.prs} />
      </>
    )
  else if (kind === "records") {
    const n = d.records.length
    body = (
      <>
        <Title>{d.name}</Title>
        {place}
        <Hero value={fmt(n)} unit={n === 1 ? "PR" : "PRs"} small />
        {n ? (
          <RecordList rows={d.records} color={fitC} />
        ) : (
          <Sub bad>No records this session. Every set still counted.</Sub>
        )}
      </>
    )
  } else if (kind === "pr") {
    const record = !!d.focus.pr,
      below = Math.round((d.focus.best - d.focus.e1rm) * 10) / 10
    body = (
      <>
        <Title>{d.focus.name}</Title>
        {place}
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
        {/* Room for the picture; on a Photo ground the card keeps it. */}
        {look.backdrop !== "photo" && <View style={{ flex: 1 }} />}
        <Title>{d.name}</Title>
        {place}
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
        {place}
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
      place: true,
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
    exById = new Map(s.exercises.map((e) => [e.id, e])),
    detail: ExerciseDetail[] = w.exercises
      .map((we) => {
        const ex = exById.get(we.exerciseId)
        return {
          id: we.id,
          name: ex?.name ?? "",
          volume: C.exStats(we, ex, bw).volume,
          pr: prs.some((p) => p.exerciseId === we.exerciseId),
          tokens: setTokens(ex, we.sets),
        }
      })
      .filter((x) => x.tokens.length > 0),
    records: RecordRow[] = [...new Set(prs.map((p) => p.exerciseId))].flatMap(
      (exerciseId) => {
        const mine = (["e1rm", "weight", "volume"] as const).flatMap((k) =>
          prs.filter((p) => p.exerciseId === exerciseId && p.kind === k),
        )
        const head = mine[0]
        return head
          ? [
              {
                id: exerciseId,
                name: exName(exerciseId),
                kinds: mine.map((p) => C.prLabel[p.kind]),
                value: head.value,
                prev: head.prev,
              },
            ]
          : []
      },
    ),
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
    place: w.place?.name ?? null,
    detail,
    records,
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
            { key: "sets", label: "Every set" },
            { key: "pr", label: "PR highlight" },
            ...(records.length
              ? [{ key: "records", label: "All PRs" } as const]
              : []),
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
          <SectionHeading>Where you trained</SectionHeading>
          <PlacePicker
            id={w.id}
            place={w.place ?? null}
            shown={flags.place !== false}
            onShow={() => setFlags({ ...flags, place: true })}
          />
        </View>
        <View>
          <SectionHeading>Show on card</SectionHeading>
          <Frame style={{ paddingHorizontal: 16 }}>
            {(
              [
                ...(w.place
                  ? [{ key: "place", label: "Where you trained" } as const]
                  : []),
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
                  value={flags[f.key] !== false}
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

/** Where the workout happened: typed, or picked from the places near the
 * phone (location is asked for only when the person taps for it). Saved
 * with the workout, so the next card has it too. */
function PlacePicker({
  id,
  place,
  shown,
  onShow,
}: {
  id: string
  place: { name: string; lat?: number; lon?: number } | null
  shown: boolean
  onShow: () => void
}) {
  const t = useTheme(),
    [draft, setDraft] = useState(place?.name ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [places, setPlaces] = useState<NearbyPlace[] | null>(null),
    asked = useRef(0)
  const save = (name: string, at?: { lat: number; lon: number }) => {
    setDraft(name)
    setWorkoutPlace(id, {
      name,
      ...(at ??
        (place?.lat != null && place?.lon != null
          ? { lat: place.lat, lon: place.lon }
          : {})),
    })
    if (name.trim() && !shown) onShow()
  }
  const find = async () => {
    const ask = ++asked.current
    setBusy(true)
    setError(null)
    const r = await findNearby()
    if (ask !== asked.current) return
    setBusy(false)
    if (!r.ok) {
      setError(r.reason)
      return
    }
    setPlaces(r.places)
    if (!r.places.length)
      setError("No named places close by. Type where you trained.")
  }
  const picked = place?.name.trim().toLowerCase()
  return (
    <Frame style={{ padding: 12, gap: 10 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: 12,
          paddingLeft: 12,
          backgroundColor: t.card,
        }}
      >
        <MapPin size={16} color={t.muted} />
        <TextInput
          testID="place-input"
          accessibilityLabel="Where you trained"
          value={draft}
          onChangeText={save}
          placeholder="Gym or place, e.g. Anytime Fitness BGC"
          placeholderTextColor={t.muted}
          maxLength={PLACE_MAX}
          returnKeyType="done"
          autoCorrect={false}
          style={{
            flex: 1,
            minHeight: 44,
            paddingVertical: 10,
            fontSize: 14,
            fontFamily: fonts.body,
            color: t.text,
          }}
        />
        {draft ? (
          <Tap
            label="Clear the place"
            onPress={() => save("")}
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={16} color={t.muted} />
          </Tap>
        ) : null}
      </View>
      <Button
        small
        tone="quiet"
        icon={LocateFixed}
        onPress={find}
        disabled={busy}
      >
        {busy ? "Finding places near you…" : "Find places near me"}
      </Button>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: t.bad, fontSize: 13, fontFamily: fonts.body }}
        >
          {error}
        </Text>
      ) : null}
      {places?.length ? (
        <View testID="nearby-places">
          {places.map((pl, i) => {
            const on = picked === pl.name.toLowerCase(),
              Icon = pl.fitness ? Dumbbell : MapPin
            return (
              <Tap
                key={pl.id}
                role="radio"
                selected={on}
                label={`${pl.name}, ${pl.kind}, ${fmtDistance(pl.distanceM)} away`}
                onPress={() => save(pl.name, { lat: pl.lat, lon: pl.lon })}
                style={{
                  minHeight: 48,
                  paddingVertical: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: border(t.line, 0.6),
                }}
              >
                <Icon size={18} color={pl.fitness ? t.fit : t.muted} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Copy size={14} weight="medium">
                    {pl.name}
                  </Copy>
                  <Copy size={12} muted>
                    {[pl.kind, fmtDistance(pl.distanceM), pl.area]
                      .filter(Boolean)
                      .join(" · ")}
                  </Copy>
                </View>
                {on ? <Check size={18} color={t.primary} /> : null}
              </Tap>
            )
          })}
          <Copy size={11} muted style={{ paddingTop: 6 }}>
            Places © OpenStreetMap contributors
          </Copy>
        </View>
      ) : null}
    </Frame>
  )
}
