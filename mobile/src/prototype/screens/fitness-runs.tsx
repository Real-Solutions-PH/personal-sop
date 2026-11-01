// Runs and walks, recorded with GPS like Strava or Apple Fitness.
//
// /fitness/run — start one, or the one in progress. Job: "I look at it
//   mid-run to see how far, how long and how fast, so I can hold my pace
//   or turn back." Distance is the hero; moving time and pace beside it;
//   the map says where; heart rate, steps and kcal are one quiet line.
// /fitness/runs/[id] — a finished one. "I open it to see how it went, so I
//   can compare it with the last." Map, distance, time and pace, then the
//   splits (one bar per km, fastest marked), then climb, kcal, steps, HR.
// /fitness/runs — history: this week's distance, then every session as a
//   row that leads with its route's shape and distance and opens it.

import { addDays, weekStart } from "@domain/fitness/calc"
import type { RunKind, RunSession } from "@domain/fitness/data"
import * as RL from "@domain/fitness/run-live"
import * as R from "@domain/fitness/runs"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import * as Haptics from "expo-haptics"
import { useLocalSearchParams } from "expo-router"
import type { LucideIcon } from "lucide-react-native"
import {
  Activity,
  ChevronRight,
  Ellipsis,
  Flag,
  Flame,
  Footprints,
  HeartPulse,
  History,
  Info,
  Mountain,
  Pause,
  Play,
  Satellite,
  Trash2,
} from "lucide-react-native"
import { useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { useCelebrate } from "../celebration"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  SmallButton,
  Tap,
} from "../native-kit"
import { go, replace } from "../navigation"
import { RouteMap, Trace } from "../route-map"
import { finishAndStop, startTracking, stopTracking } from "../run-tracker"
import { fonts, useTheme } from "../theme"
import { Button, confirm, Empty, Screen, Sheet, undo, useNow } from "../ui"
import { LockedPreview } from "./locked-preview"

export const RUN_HREF = "/fitness/run"
const KIND_ICON: Record<RunKind, LucideIcon> = {
  run: Activity,
  walk: Footprints,
}
const grouped = (n: number) => Math.round(n).toLocaleString("en-US")
/** The shortest session worth keeping (metres). */
const MIN_SAVE_M = 50

// ------------------------------------------------------------------ pieces

/** A figure with its unit and a small label under it; peers of one row. */
function Figure({
  value,
  unit,
  label,
  size = 28,
  color,
}: {
  value: string
  unit?: string
  label: string
  size?: number
  color?: string
}) {
  const t = useTheme()
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text
        style={{
          fontFamily: fonts.displayMedium,
          fontVariant: ["tabular-nums"],
          fontSize: size,
          color: color ?? t.text,
        }}
      >
        {value}
        {unit ? (
          <Text style={{ fontSize: size * 0.5, color: t.muted }}> {unit}</Text>
        ) : null}
      </Text>
      <Copy size={12} muted>
        {label}
      </Copy>
    </View>
  )
}

/** Peer figures split by hairlines. */
function Peers({ children }: { children: React.ReactNode[] }) {
  const t = useTheme()
  return (
    <Line style={{ gap: 0, alignItems: "stretch" }}>
      {children.map((c, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed order
          key={i}
          style={{
            flex: 1,
            paddingLeft: i ? 12 : 0,
            marginLeft: i ? 12 : 0,
            borderLeftWidth: i ? 1 : 0,
            borderColor: border(t.line, 0.6),
          }}
        >
          {c}
        </View>
      ))}
    </Line>
  )
}

/** "♥ 152 bpm · 4,812 steps · 312 kcal": what Health and the estimate add,
 * each with its glyph, quiet but whole. */
function Extras({
  hr,
  maxHr,
  steps,
  kcal,
  elev,
}: {
  hr?: number
  /** Shown beside the average when known: "157 avg · 176 max bpm". */
  maxHr?: number
  steps?: number
  kcal?: number
  elev?: number
}) {
  const t = useTheme()
  const items: { icon: LucideIcon; text: string; label: string }[] = []
  if (hr)
    items.push({
      icon: HeartPulse,
      text: maxHr ? `${hr} avg · ${maxHr} max bpm` : `${hr} bpm`,
      label: "Heart rate",
    })
  if (steps != null)
    items.push({
      icon: Footprints,
      text: `${grouped(steps)} steps`,
      label: "Steps",
    })
  if (kcal != null)
    items.push({
      icon: Flame,
      text: `${grouped(kcal)} kcal`,
      label: "Active calories, estimated",
    })
  if (elev != null)
    items.push({
      icon: Mountain,
      text: `${grouped(elev)} m climb`,
      label: "Climb",
    })
  if (!items.length) return null
  return (
    <Line style={{ flexWrap: "wrap", gap: 14, rowGap: 6 }}>
      {items.map((x) => (
        <Line key={x.label} style={{ gap: 5 }}>
          <x.icon size={15} color={t.muted} />
          <Copy size={14} style={{ color: t.text }}>
            {x.text}
          </Copy>
        </Line>
      ))}
    </Line>
  )
}

function KindChoice({
  value,
  onChange,
}: {
  value: RunKind
  onChange: (k: RunKind) => void
}) {
  const t = useTheme()
  return (
    <Line style={{ gap: 10 }}>
      {(["run", "walk"] as const).map((k) => {
        const on = value === k,
          Icon = KIND_ICON[k]
        return (
          <Pressable
            key={k}
            cssInterop={false}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={R.kindLabel(k)}
            onPress={() => onChange(k)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 64,
              borderRadius: 16,
              borderWidth: on ? 2 : 1,
              borderColor: on ? t.fit : border(t.line, 0.8),
              backgroundColor: on ? `${t.fit}14` : t.card,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 8,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Icon size={20} color={on ? t.fit : t.muted} />
            <Copy
              size={16}
              weight="semibold"
              style={{ color: on ? t.fit : t.text }}
            >
              {R.kindLabel(k)}
            </Copy>
          </Pressable>
        )
      })}
    </Line>
  )
}

/** The GPS chip: how sure the last fix was. */
function Signal({
  accuracy,
  waiting,
  lost,
}: {
  accuracy?: number
  waiting: boolean
  /** No fix for 15 s while moving. */
  lost: boolean
}) {
  const t = useTheme()
  const good = accuracy !== undefined && accuracy <= 15
  const fair = accuracy !== undefined && !good && accuracy <= R.MAX_ACCURACY_M
  const color = lost
    ? t.bad
    : waiting || accuracy === undefined
      ? t.warn
      : good
        ? t.good
        : fair
          ? t.warn
          : t.bad
  const text = lost
    ? "GPS signal lost"
    : waiting || accuracy === undefined
      ? "Finding GPS"
      : good
        ? "GPS strong"
        : fair
          ? "GPS fair"
          : "GPS weak"
  return (
    <Line
      style={{
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: border(color, 0.14),
        alignSelf: "flex-start",
      }}
    >
      <Satellite size={14} color={color} />
      <Copy size={12} weight="medium" style={{ color }}>
        {text}
      </Copy>
    </Line>
  )
}

// ------------------------------------------------------------------ start / live

export function RunScreen() {
  const active = RL.runLiveStore.use((s) => s.active)
  return active ? <LiveRun run={active} /> : <StartRun />
}

function StartRun() {
  const params = useLocalSearchParams<{ kind?: string }>()
  const [kind, setKind] = useState<RunKind>(
    params.kind === "walk" ? "walk" : "run",
  )
  const [busy, setBusy] = useState(false)
  const runs = R.runsOf(fitStore.use((s) => s))
  const start = async () => {
    setBusy(true)
    const res = await startTracking(kind)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.reason)
      return
    }
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => {})
    RL.startRun(kind)
    RL.setRunTracking(res.background)
  }
  return (
    <Screen
      title="Run or walk"
      actions={
        <IconTap
          size={40}
          icon={History}
          label="History"
          onPress={() => go("/fitness/runs")}
        />
      }
      footer={
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Button icon={Play} onPress={() => void start()} disabled={busy}>
            {busy ? "Starting…" : `Start ${kind}`}
          </Button>
        </View>
      }
    >
      <KindChoice value={kind} onChange={setKind} />
      <Copy size={14} muted style={{ marginTop: 10 }}>
        Records your route, distance, pace and splits with GPS, plus steps and
        heart rate from Apple Health. It runs beside a workout or focus session.
      </Copy>
      <WeekSummary runs={runs} />
      <RecentRuns runs={runs} />
    </Screen>
  )
}

function LiveRun({ run }: { run: RL.ActiveRun }) {
  const t = useTheme()
  const now = useNow()
  const paused = RL.isPaused(run)
  const moving = RL.movingSec(run, now)
  const snap = R.summarize(run.points, run.pauses)
  const pace = paused
    ? null
    : R.currentPace(run.points, run.pauses, 30, RL.sessionSec(run, now))
  const avg = R.paceSecPerKm(moving, snap.distanceM)
  const kcal = R.runKcal(
    run.points,
    run.pauses,
    R.weightAt(fitStore.get(), run.startedAt).kg,
  )
  const lastSplit = snap.splits.at(-1)
  const [menu, setMenu] = useState(false)
  const finish = () => {
    if (snap.distanceM < MIN_SAVE_M)
      return confirm(
        `Discard this ${run.kind}?`,
        `It covered under ${MIN_SAVE_M} m, too short to save.`,
        () => {
          RL.discardRun()
          void stopTracking()
          replace("/fitness")
        },
      )
    const done = finishAndStop()
    if (done) replace(`/fitness/runs/${done.id}?summary=1`)
  }
  const toggle = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    if (paused) RL.resumeRun()
    else RL.pauseRun()
  }
  return (
    <Screen
      title={R.kindLabel(run.kind)}
      actions={
        <IconTap
          size={40}
          icon={Ellipsis}
          label="Session options"
          onPress={() => setMenu(true)}
        />
      }
      footer={
        <Line style={{ gap: 10, paddingHorizontal: 16, paddingBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              icon={paused ? Play : Pause}
              tone={paused ? "primary" : "quiet"}
              onPress={toggle}
            >
              {paused ? "Resume" : "Pause"}
            </Button>
          </View>
          {paused && (
            <View style={{ flex: 1 }}>
              <Button icon={Flag} tone="quiet" onPress={finish}>
                Finish
              </Button>
            </View>
          )}
        </Line>
      }
    >
      <RouteMap points={run.points} height={210} live />
      <Line style={{ justifyContent: "space-between", marginTop: 12 }}>
        <Signal
          accuracy={run.accuracy}
          waiting={!run.points.length}
          lost={
            !paused &&
            run.points.length > 0 &&
            RL.sessionSec(run, now) - (run.points.at(-1)?.[3] ?? 0) > 15
          }
        />
        {paused ? (
          <Line style={{ gap: 6 }}>
            <Pause size={14} color={t.warn} />
            <Copy size={12} weight="medium" style={{ color: t.warn }}>
              Paused
            </Copy>
          </Line>
        ) : null}
      </Line>
      {run.background === false && (
        <Line style={{ gap: 6, marginTop: 8 }}>
          <Info size={14} color={t["chart-1"]} />
          <Copy size={12} style={{ color: t["chart-1"], flex: 1 }}>
            Keep Unfurl open: this phone records the route only while the screen
            is on.
          </Copy>
        </Line>
      )}
      <View
        style={{ marginTop: 8 }}
        accessible
        accessibilityLabel={`${R.fmtKm(snap.distanceM)} kilometres`}
      >
        <Text
          style={{
            fontFamily: fonts.displayMedium,
            fontVariant: ["tabular-nums"],
            fontSize: 64,
            lineHeight: 72,
            color: paused ? t.muted : t.text,
          }}
        >
          {R.fmtKm(snap.distanceM)}
          <Text style={{ fontSize: 24, color: t.muted }}> km</Text>
        </Text>
      </View>
      <Peers>
        {[
          <Figure key="t" value={R.fmtClock(moving)} label="Moving time" />,
          <Figure
            key="p"
            value={R.fmtPace(pace)}
            unit="/km"
            label="Pace now"
          />,
          <Figure key="a" value={R.fmtPace(avg)} unit="/km" label="Average" />,
        ]}
      </Peers>
      <View style={{ marginTop: 14 }}>
        <Extras
          hr={run.hr?.last}
          steps={run.steps}
          kcal={kcal}
          elev={snap.elevationGainM ?? undefined}
        />
      </View>
      {lastSplit ? (
        <>
          <SectionHeading>Splits</SectionHeading>
          <Splits splits={snap.splits} />
        </>
      ) : null}
      <Sheet open={menu} onClose={() => setMenu(false)} title="Session options">
        <View style={{ gap: 8 }}>
          <Button
            icon={Flag}
            tone="quiet"
            onPress={() => {
              setMenu(false)
              finish()
            }}
          >
            {`Finish ${run.kind}`}
          </Button>
          <Button
            icon={Trash2}
            tone="danger"
            onPress={() => {
              setMenu(false)
              confirm(
                `Discard this ${run.kind}?`,
                "Its route and time are deleted. This can't be undone.",
                () => {
                  RL.discardRun()
                  void stopTracking()
                  replace("/fitness")
                },
              )
            }}
          >
            Discard
          </Button>
        </View>
      </Sheet>
    </Screen>
  )
}

// ------------------------------------------------------------------ splits

/** One row per km: its number, its pace, a bar as long as it was fast
 * (the fastest drawn in green) and its climb. */
export function Splits({ splits }: { splits: RunSession["splits"] }) {
  const t = useTheme()
  if (!splits.length) return null
  const fastest = Math.min(...splits.map((s) => s.sec))
  const slowest = Math.max(...splits.map((s) => s.sec))
  return (
    <View style={{ gap: 4 }} accessibilityRole="list">
      {splits.map((s) => {
        const best = s.sec === fastest && splits.length > 1
        // Laid between the slowest km (a third of the track) and the
        // fastest (full): kms a few seconds apart still read apart, and
        // the pace beside each bar says how far.
        const share =
          slowest > fastest
            ? 0.35 + (0.65 * (slowest - s.sec)) / (slowest - fastest)
            : 1
        return (
          <View
            key={s.km}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              minHeight: 28,
            }}
            accessible
            accessibilityLabel={`Kilometre ${s.km}, ${R.fmtPace(s.sec)} per kilometre${best ? ", fastest" : ""}${s.elevM !== null ? `, ${s.elevM} metres climb` : ""}`}
          >
            <Copy size={14} muted style={{ width: 22, textAlign: "right" }}>
              {s.km}
            </Copy>
            <Copy size={14} weight="medium" style={{ width: 44 }}>
              {R.fmtPace(s.sec)}
            </Copy>
            <View
              style={{
                flex: 1,
                height: 10,
                borderRadius: 5,
                backgroundColor: t.soft,
              }}
            >
              <View
                style={{
                  width: `${share * 100}%`,
                  height: "100%",
                  borderRadius: 5,
                  backgroundColor: best
                    ? t.good
                    : s.sec === slowest && splits.length > 2
                      ? border(t.fit, 0.5)
                      : t.fit,
                }}
              />
            </View>
            <Copy size={12} muted style={{ width: 44, textAlign: "right" }}>
              {s.elevM === null ? "" : `${s.elevM > 0 ? "+" : ""}${s.elevM} m`}
            </Copy>
          </View>
        )
      })}
    </View>
  )
}

// ------------------------------------------------------------------ detail

export function RunDetail({
  id,
  summary = false,
}: {
  id: string
  summary?: boolean
}) {
  const t = useTheme()
  const s = fitStore.use((s) => s)
  const r = R.runsOf(s).find((x) => x.id === id)
  const [name, setName] = useState(r?.name ?? "")
  const [method, setMethod] = useState(false)
  useCelebrate(id, summary)
  if (!r)
    return (
      <Screen title={summary ? "Summary" : "Session"}>
        <Empty title="Session not found" detail="It may have been deleted." />
      </Screen>
    )
  const avg = R.paceSecPerKm(r.movingSec, r.distanceM)
  const prev = R.runsOf(s)
    .filter((x) => x.kind === r.kind && x.startedAt < r.startedAt)
    .at(-1)
  const prevPace = prev ? R.paceSecPerKm(prev.movingSec, prev.distanceM) : null
  const delta =
    avg !== null && prevPace !== null ? Math.round(avg - prevPace) : null
  const weight = R.weightAt(s, r.startedAt)
  const remove = () =>
    confirm(`Delete this ${r.kind}?`, "You can undo right after.", () => {
      const del = RL.deleteRun(id)
      replace("/fitness/runs")
      if (del) undo(`${del.name} deleted`, () => RL.restoreRun(del))
    })
  const save = () =>
    RL.patchRun(id, (x) => ({ ...x, name: name.trim() || x.name }))
  const when = new Date(r.startedAt)
  return (
    <Screen
      title={summary ? `${R.kindLabel(r.kind)} complete` : r.name}
      actions={
        <IconTap
          size={40}
          icon={Trash2}
          label={`Delete ${r.kind}`}
          onPress={remove}
        />
      }
    >
      <RouteMap points={r.route} height={240} />
      <Copy size={14} muted style={{ marginTop: 10 }}>
        {when.toLocaleDateString("en-PH", {
          weekday: "long",
          month: "short",
          day: "numeric",
        })}
        {" · "}
        {when.toLocaleTimeString("en-PH", {
          hour: "numeric",
          minute: "2-digit",
        })}
      </Copy>
      <Text
        accessibilityLabel={`${R.fmtKm(r.distanceM)} kilometres`}
        style={{
          fontFamily: fonts.displayMedium,
          fontVariant: ["tabular-nums"],
          fontSize: 56,
          lineHeight: 64,
          color: t.text,
        }}
      >
        {R.fmtKm(r.distanceM)}
        <Text style={{ fontSize: 22, color: t.muted }}> km</Text>
      </Text>
      <Peers>
        {[
          <Figure
            key="t"
            value={R.fmtClock(r.movingSec)}
            label="Moving time"
          />,
          <View key="p">
            <Figure value={R.fmtPace(avg)} unit="/km" label="Average pace" />
            {delta !== null && delta !== 0 && (
              <Copy size={12} style={{ color: delta < 0 ? t.good : t.warn }}>
                {delta < 0 ? "▲" : "▼"}{" "}
                {R.fmtPace(Math.abs(delta)).replace(/^0:/, "")}
                {Math.abs(delta) < 60 ? " s" : ""}{" "}
                {delta < 0 ? "faster" : "slower"} than last
              </Copy>
            )}
          </View>,
        ]}
      </Peers>
      <View style={{ marginTop: 14 }}>
        <Extras
          hr={r.avgHr}
          maxHr={r.maxHr}
          steps={r.steps}
          kcal={r.kcal}
          elev={r.elevationGainM}
        />
      </View>
      <Tap
        onPress={() => setMethod((v) => !v)}
        style={{ marginTop: 8, alignSelf: "flex-start" }}
      >
        <Line style={{ gap: 6, minHeight: 32 }}>
          <Info size={14} color={t["chart-1"]} />
          <Copy size={12} style={{ color: t["chart-1"] }}>
            How calories are estimated
          </Copy>
        </Line>
      </Tap>
      {method && (
        <Copy size={12} muted>
          Active calories from your speed and the climb on each stretch (ACSM
          walking and running equations), at {weight.kg} kg
          {weight.assumed
            ? " (no weigh-in yet, so 70 kg is assumed)"
            : " from your latest weigh-in"}
          . Resting calories are left out, as in Apple Health's Active Energy.
        </Copy>
      )}
      {r.splits.length > 0 && (
        <>
          <SectionHeading>Splits</SectionHeading>
          <Splits splits={r.splits} />
        </>
      )}
      <SectionHeading>Name</SectionHeading>
      <TextInput
        accessibilityLabel={`${R.kindLabel(r.kind)} name`}
        value={name}
        placeholder="e.g. Sunday long run"
        placeholderTextColor={t.muted}
        onChangeText={setName}
        onBlur={save}
        style={{
          minHeight: 44,
          paddingHorizontal: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.line,
          backgroundColor: t.card,
          fontFamily: fonts.medium,
          fontSize: 16,
          color: t.text,
        }}
      />
      {summary && (
        <View style={{ marginTop: 16 }}>
          <Button
            onPress={() => {
              save()
              replace("/fitness")
            }}
          >
            Done
          </Button>
        </View>
      )}
    </Screen>
  )
}

// ------------------------------------------------------------------ history

function weekRuns(runs: RunSession[]) {
  const start = weekStart(dayKey())
  const end = addDays(start, 7)
  return runs.filter((r) => {
    const d = dayKey(new Date(r.startedAt))
    return d >= start && d < end
  })
}

/** This week: distance as the hero, sessions and time beside it. */
function WeekSummary({ runs }: { runs: RunSession[] }) {
  const tot = R.runTotals(weekRuns(runs))
  return (
    <LockedPreview
      locked={runs.length === 0}
      title="Your first run or walk shows here"
      detail="Distance, time and every session of the week, with its route."
      action={{ label: "Choose run or walk above" }}
    >
      <Frame style={{ padding: 16, marginTop: 16 }}>
        <Copy size={12} muted>
          This week
        </Copy>
        <Peers>
          {[
            <Figure
              key="d"
              size={24}
              value={R.fmtKm(tot.distanceM)}
              unit="km"
              label="Distance"
            />,
            <Figure
              key="n"
              size={24}
              value={String(tot.count)}
              label={tot.count === 1 ? "Session" : "Sessions"}
            />,
            <Figure
              key="t"
              size={24}
              value={R.hoursFigure(tot.movingSec)[0]}
              unit={R.hoursFigure(tot.movingSec)[1]}
              label="Moving time"
            />,
          ]}
        </Peers>
      </Frame>
    </LockedPreview>
  )
}

function RecentRuns({ runs }: { runs: RunSession[] }) {
  const recent = [...runs].reverse().slice(0, 3)
  if (!recent.length) return null
  return (
    <>
      <SectionHeading
        action={
          <Tap onPress={() => go("/fitness/runs")}>
            <Copy size={14} weight="medium">
              All
            </Copy>
          </Tap>
        }
      >
        Recent
      </SectionHeading>
      <Frame>
        {recent.map((r, i) => (
          <RunRow key={r.id} run={r} divided={i > 0} />
        ))}
      </Frame>
    </>
  )
}

/** A session: its route's shape, name and day, then distance and pace. */
export function RunRow({
  run: r,
  divided,
}: {
  run: RunSession
  divided: boolean
}) {
  const t = useTheme()
  const Icon = KIND_ICON[r.kind]
  return (
    <Tap
      onPress={() => go(`/fitness/runs/${r.id}`)}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: divided ? 1 : 0,
        borderColor: border(t.line, 0.6),
      }}
    >
      <Line style={{ gap: 12 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            backgroundColor: t.soft,
            overflow: "hidden",
          }}
        >
          {r.route.length > 1 ? (
            <Trace points={r.route} height={48} aspect={1} stroke={9} />
          ) : (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={20} color={t.fit} />
            </View>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Line style={{ gap: 6 }}>
            <Icon size={14} color={t.fit} />
            <Copy size={16} weight="medium" style={{ flexShrink: 1 }}>
              {r.name}
            </Copy>
          </Line>
          <Copy size={12} muted>
            {new Date(r.startedAt).toLocaleDateString("en-PH", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
            {" · "}
            {R.fmtClock(r.movingSec)}
          </Copy>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Copy size={18} weight="semibold">
            {R.fmtKm(r.distanceM)}
            <Text style={{ fontSize: 12, color: t.muted }}> km</Text>
          </Copy>
          <Copy size={12} muted>
            {R.fmtPace(R.paceSecPerKm(r.movingSec, r.distanceM))} /km
          </Copy>
        </View>
        <ChevronRight size={16} color={t.muted} />
      </Line>
    </Tap>
  )
}

export function RunHistory() {
  const s = fitStore.use((s) => s)
  const runs = R.runsOf(s)
  const all = R.runTotals(runs)
  return (
    <Screen
      title="Runs and walks"
      actions={
        <IconTap
          size={40}
          icon={Play}
          label="Start a run or walk"
          onPress={() => go(RUN_HREF)}
        />
      }
    >
      <WeekSummary runs={runs} />
      {runs.length > 0 && (
        <>
          <SectionHeading>
            {`All sessions · ${R.fmtKm(all.distanceM)} km`}
          </SectionHeading>
          <Frame>
            {[...runs].reverse().map((r, i) => (
              <RunRow key={r.id} run={r} divided={i > 0} />
            ))}
          </Frame>
        </>
      )}
    </Screen>
  )
}

/** Fitness page: start a run or walk, with this week's distance; the
 * whole card opens the history. While one runs, it says so and opens it. */
export function RunCard() {
  const t = useTheme()
  const runs = R.runsOf(fitStore.use((s) => s))
  const active = RL.runLiveStore.use((s) => s.active)
  const week = R.runTotals(weekRuns(runs))
  const start = (kind: RunKind) => go(`${RUN_HREF}?kind=${kind}`)
  return (
    <Frame style={{ padding: 16, gap: 10, marginTop: 12 }}>
      <Tap onPress={() => go(active ? RUN_HREF : "/fitness/runs")}>
        <Line style={{ gap: 10 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: border(t.fit, 0.14),
            }}
          >
            <Activity size={18} color={t.fit} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Copy weight="semibold">Run or walk</Copy>
            <Copy size={12} muted>
              {active
                ? `${R.kindLabel(active.kind)} in progress`
                : week.count
                  ? `${R.fmtKm(week.distanceM)} km this week · ${week.count} ${week.count === 1 ? "session" : "sessions"}`
                  : "GPS route, pace and splits"}
            </Copy>
          </View>
          <ChevronRight size={16} color={t.muted} />
        </Line>
      </Tap>
      {!active && (
        <Line style={{ gap: 8 }}>
          <SmallButton
            accent="fit"
            icon={Activity}
            onPress={() => start("run")}
          >
            Start run
          </SmallButton>
          <SmallButton
            accent="fit"
            quiet
            icon={Footprints}
            onPress={() => start("walk")}
          >
            Start walk
          </SmallButton>
        </Line>
      )}
    </Frame>
  )
}
