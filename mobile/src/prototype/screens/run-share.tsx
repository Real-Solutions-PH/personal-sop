// The share card for a run or a walk: distance as the hero, its pace and
// time, the change against the last like session, and the route it drew
// (or the treadmill it was on). Built on the share kit, like the workout
// and habit cards; on the person's own photo it sits as a compact block.
import type { RunKind, RunPoint, RunSession } from "@domain/fitness/data"
import * as R from "@domain/fitness/runs"
import { fitStore } from "@domain/fitness/store"
import { type ReactNode, useMemo, useState } from "react"
import { View } from "react-native"
import Svg, { Circle, Path } from "react-native-svg"
import { runRecord } from "../body-rewards"
import { jitter, type Point, rng, smooth } from "../brand/scribble"
import { fmt } from "../share-format"
import {
  Body,
  CardFrame,
  type CardLook,
  Change,
  ChartNote,
  cardInk,
  Figures,
  Hero,
  P,
  ShareComposer,
  Stems,
  Sub,
  Title,
  useCard,
  Win,
} from "../share-kit"
import { TreadmillArt } from "../treadmill-visual"
import { Empty, Screen } from "../ui"

export type RunLayout = "route" | "splits" | "overlay"

/** What a run card shows, already counted. */
export type RunCardData = {
  name: string
  kind: RunKind
  indoor: boolean
  inclinePct?: number
  date: string
  distanceM: number
  movingSec: number
  /** Average pace, seconds per km; null with no distance. */
  pace: number | null
  /** This pace minus the last like session's (negative is faster). */
  paceDelta: number | null
  /** A record said plainly ("Best pace yet"), or null. */
  record: string | null
  route: RunPoint[]
  /** Seconds each whole kilometre took. */
  splits: number[]
  climbM: number | null
  kcal: number | null
}

/** "12:14 faster than last" or "8 s slower than last". */
export function paceChange(delta: number) {
  const a = Math.abs(Math.round(delta))
  return `${a < 60 ? `${a} s` : R.fmtPace(a)} ${delta < 0 ? "faster" : "slower"} than last`
}

/** The route as one hand-drawn stroke in the card's ink, the start a ring
 * and the finish a dot, fitted into a ``h``-point-tall band. */
export function RouteLine({
  points,
  h,
  color,
}: {
  points: RunPoint[]
  h: number
  color: string
}) {
  const { q, c } = useCard(),
    p = P * q,
    W = 312,
    pad = 10
  const d = useMemo(() => {
    if (points.length < 2) return null
    let n = -90,
      s = 90,
      e = -180,
      w = 180
    for (const pt of points) {
      n = Math.max(n, pt[0])
      s = Math.min(s, pt[0])
      e = Math.max(e, pt[1])
      w = Math.min(w, pt[1])
    }
    const k = Math.cos((((n + s) / 2) * Math.PI) / 180),
      spanX = Math.max((e - w) * k, 1e-6),
      spanY = Math.max(n - s, 1e-6),
      scale = Math.min((W - pad * 2) / spanX, (h - pad * 2) / spanY),
      ox = (W - spanX * scale) / 2,
      oy = (h - spanY * scale) / 2
    // A few hundred points are plenty for a card-sized line.
    const step = Math.max(1, Math.floor(points.length / 240)),
      pts: Point[] = points
        .filter((_, i) => i % step === 0 || i === points.length - 1)
        .map((pt) => [ox + (pt[1] - w) * k * scale, oy + (n - pt[0]) * scale])
    return {
      line: smooth(jitter(pts, 0.6, rng(points.length))),
      start: pts[0],
      end: pts[pts.length - 1],
    }
  }, [points, h])
  if (!d) return null
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Route">
      <Svg width={W * p} height={h * p} viewBox={`0 0 ${W} ${h}`}>
        <Path
          d={d.line}
          fill="none"
          stroke={color}
          strokeWidth={3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle
          cx={d.start[0]}
          cy={d.start[1]}
          r={4.5}
          fill="none"
          stroke={c.ink}
          strokeWidth={2}
        />
        <Circle cx={d.end[0]} cy={d.end[1]} r={4.5} fill={c.ink} />
      </Svg>
    </View>
  )
}

/** The treadmill as line art in the card's colours. */
function Treadmill({ h, incline }: { h: number; incline?: number }) {
  const { q, c } = useCard(),
    p = P * q
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Treadmill${incline ? ` at ${incline}% incline` : ""}`}
    >
      <TreadmillArt
        width={312 * p}
        height={h * p}
        inclinePct={incline}
        stroke={c.area("fit")}
        hub={c.bg}
        screen={c.bg}
      />
    </View>
  )
}

export function RunCard({
  kind,
  width,
  look,
  data: d,
}: {
  kind: RunLayout
  width: number
  look: CardLook
  data: RunCardData
}) {
  const c = cardInk(look),
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    fitC = c.area("fit"),
    noun = R.sessionLabel(d),
    hero = (
      <Hero
        value={R.fmtKm(d.distanceM)}
        unit="km"
        // With a chart under it the hero takes the smaller tier, so pace
        // and time keep their place; the overlay keeps the big one.
        small={kind !== "overlay"}
        delta={
          d.paceDelta !== null && d.paceDelta !== 0 ? (
            <Change good={d.paceDelta < 0}>{paceChange(d.paceDelta)}</Change>
          ) : undefined
        }
      />
    ),
    figures = (
      <Figures
        items={[
          { label: "Pace", value: R.fmtPace(d.pace), unit: "/km" },
          { label: "Time", value: R.fmtClock(d.movingSec) },
          ...(d.climbM && d.climbM > 0
            ? [{ label: "Climb", value: fmt(Math.round(d.climbM)), unit: "m" }]
            : d.indoor && d.inclinePct
              ? [{ label: "Incline", value: fmt(d.inclinePct), unit: "%" }]
              : []),
        ]}
      />
    ),
    win = d.record ? <Win>{d.record}</Win> : null,
    // On a photo the block is compact: the route stays, smaller.
    visualH =
      look.backdrop === "photo"
        ? tall
          ? 120
          : sq
            ? 60
            : 84
        : tall
          ? 100
          : sq
            ? 64
            : 84
  let body: ReactNode
  if (kind === "splits" && d.splits.length > 1) {
    const speeds = d.splits.map((sec) => 3600 / Math.max(1, sec)),
      fastest = Math.max(...speeds)
    body = (
      <>
        <Title>{d.name}</Title>
        {hero}
        {win}
        {figures}
        <Body end>
          <Stems
            values={speeds}
            labels={d.splits.map((_, i) => `${i + 1}`)}
            leaf={(v) => v === fastest}
            format={(v) => R.fmtPace(3600 / v)}
            height={
              look.backdrop === "photo"
                ? tall
                  ? 96
                  : sq
                    ? 56
                    : 72
                : tall
                  ? 92
                  : sq
                    ? 64
                    : 76
            }
            color={fitC}
            label="Pace for each kilometre, taller is faster"
          />
          <ChartNote left="Pace per km" right={`${fmt(d.splits.length)} km`} />
        </Body>
      </>
    )
  } else if (kind === "overlay")
    body = (
      <>
        <Title>{d.name}</Title>
        {hero}
        {win}
        {figures}
      </>
    )
  else
    body = (
      <>
        <Title>{d.name}</Title>
        {hero}
        {win ?? (d.indoor ? null : <Sub>{noun}</Sub>)}
        {figures}
        {(d.indoor || d.route.length > 1) && (
          <Body end>
            {d.indoor ? (
              <Treadmill h={visualH} incline={d.inclinePct} />
            ) : (
              <RouteLine points={d.route} h={visualH} color={fitC} />
            )}
            <ChartNote
              left={
                d.indoor
                  ? `${noun}${d.inclinePct ? ` · ${fmt(d.inclinePct)}% incline` : ""}`
                  : "Route"
              }
              right={d.kcal ? `${fmt(Math.round(d.kcal))} kcal` : undefined}
            />
          </Body>
        )}
      </>
    )
  return (
    <CardFrame width={width} look={look} accent="fit" date={d.date}>
      {body}
    </CardFrame>
  )
}

/** The card's data for one session, against the others in ``runs``. */
export function runCardData(runs: RunSession[], r: RunSession): RunCardData {
  const pace = R.paceSecPerKm(r.movingSec, r.distanceM),
    prev = R.previousLike(runs, r),
    prevPace = prev ? R.paceSecPerKm(prev.movingSec, prev.distanceM) : null,
    rec = runRecord(runs, r)
  return {
    name: r.name,
    kind: r.kind,
    indoor: !!r.indoor,
    inclinePct: r.inclinePct,
    date: new Date(r.startedAt).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    distanceM: r.distanceM,
    movingSec: r.movingSec,
    pace,
    paceDelta:
      pace !== null && prevPace !== null ? Math.round(pace - prevPace) : null,
    record: rec?.pace
      ? "Best pace yet"
      : rec?.split
        ? `Fastest km yet, km ${fmt(rec.split.split.km)}`
        : null,
    route: r.route,
    splits: r.splits.map((s) => s.sec),
    climbM: r.elevationGainM ?? null,
    kcal: r.kcal ?? null,
  }
}

export function RunShare({ id }: { id: string }) {
  const s = fitStore.use((s) => s),
    runs = R.runsOf(s),
    r = runs.find((x) => x.id === id),
    [layout, setLayout] = useState<RunLayout>("route")
  if (!r)
    return (
      <Screen title="Share">
        <Empty
          title="Nothing to share yet"
          detail="Finish a run or walk to make a card."
        />
      </Screen>
    )
  const data = runCardData(runs, r),
    items = (
      [
        { key: "route", label: r.indoor ? "Treadmill" : "Route" },
        ...(data.splits.length > 1
          ? [{ key: "splits", label: "Splits" } as const]
          : []),
        { key: "overlay", label: "Overlay" },
      ] as const
    ).map((item) => ({
      ...item,
      render: (width: number, look: CardLook) => (
        <RunCard kind={item.key} width={width} look={look} data={data} />
      ),
    }))
  return (
    <Screen title={`Share ${r.kind}`}>
      <ShareComposer
        value={layout}
        onChange={setLayout}
        caption={`${r.name} · ${R.fmtKm(r.distanceM)} km · ${R.fmtPace(data.pace)} /km · ${R.fmtClock(r.movingSec)}`}
        items={items}
      >
        {null}
      </ShareComposer>
    </Screen>
  )
}
