import * as F from "@domain/fitness/calc"
import type { FitnessState, RunSession, Workout } from "@domain/fitness/data"
import * as RL from "@domain/fitness/run-live"
import * as R from "@domain/fitness/runs"
import { fitStore } from "@domain/fitness/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import type { LucideIcon } from "lucide-react-native"
import {
  Activity,
  Check,
  ChevronRight,
  Dumbbell,
  Footprints,
  History,
  LayoutList,
  ListChecks,
  Moon,
  Pencil,
  Play,
  Plus,
  Settings,
  TrendingUp,
  TriangleAlert,
  Trophy,
} from "lucide-react-native"
import { useState } from "react"
import { Text, useWindowDimensions, View } from "react-native"
import { lastWeekShort } from "../body-rewards"
import { Sparkline } from "../chart"
import { GrowBar } from "../motion"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  Part,
  SmallButton,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { radius, useTheme } from "../theme"
import { Screen, useNow } from "../ui"
import { Body } from "./fitness-body"
import { RUN_HREF, weekRuns } from "./fitness-runs"
import { StartWorkoutSheet } from "./fitness-start"
import { LockedPreview } from "./locked-preview"
import { SleepCard } from "./sleep-card"
import { StepsCard } from "./steps-card"

// The Fitness page, sized by why it is opened: "I open Fitness to start
// (or get back to) today's training, a workout or a run, and to see whether
// this week is on track, so that I can train without planning and keep my
// weekly target." Required: today's training with its one-tap start, the
// run/walk start and the week against its target, as one card. Supporting:
// progress (PRs, lifts, volume), recent sessions and body weight. Guiding:
// steps, sleep and the links to templates and exercises.

/** Large accessibility text: side-by-side rows stack so nothing breaks
 * mid-word. */
const useBigText = () => useWindowDimensions().fontScale >= 1.3

const n = (v: number) => Math.round(v).toLocaleString("en-US")
/** One decimal at most, grouped: 1,234.5 */
const n1 = (v: number) =>
  v.toLocaleString("en-US", { maximumFractionDigits: 1 })

export function FitnessTrain() {
  const t = useTheme(),
    s = fitStore.use((s) => s)
  const params = useLocalSearchParams<{ start?: string }>()
  const [startOpen, setStartOpen] = useState(params.start === "1")
  const start = () => setStartOpen(true)
  return (
    <Screen
      prototypeLayout
      title="Fitness"
      actions={
        <IconTap
          size={40}
          icon={Settings}
          label="Fitness settings"
          color={t.text}
          onPress={() => go("/fitness/settings")}
        />
      }
    >
      <View>
        <TodayCard s={s} onStart={start} />
        <Progress s={s} />
        <Recent s={s} />
        <Body hub embedded />
        <StepsCard />
        <SleepCard />
        <PlanLinks s={s} />
      </View>
      {startOpen && <StartWorkoutSheet onClose={() => setStartOpen(false)} />}
    </Screen>
  )
}

/** A heading with its icon, and an optional link at the right. */
function Heading({
  icon: Icon,
  title,
  link,
}: {
  icon: LucideIcon
  title: string
  link?: { label: string; href: string }
}) {
  const t = useTheme()
  return (
    <Line
      style={{
        justifyContent: "space-between",
        flexWrap: "wrap",
        marginTop: 24,
        marginBottom: 8,
        paddingHorizontal: 4,
      }}
    >
      <Line style={{ gap: 6 }}>
        <Icon size={14} color={t.muted} />
        <Copy size={13} weight="semibold" muted>
          {title}
        </Copy>
      </Line>
      {link && (
        <Tap label={link.label} onPress={() => go(link.href)}>
          <Line style={{ gap: 2, minHeight: 44 }}>
            <Copy size={13} weight="medium" style={{ color: t.primary }}>
              {link.label}
            </Copy>
            <ChevronRight size={16} color={t.fit} />
          </Line>
        </Tap>
      )}
    </Line>
  )
}

/** "12:04" or "1:02:09" since `from`, ticking. */
function Elapsed({ from }: { from: string }) {
  const now = useNow()
  const sec = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000))
  const h = Math.floor(sec / 3600),
    m = Math.floor((sec % 3600) / 60),
    ss = String(sec % 60).padStart(2, "0")
  return (
    <Text style={{ fontVariant: ["tabular-nums"] }}>
      {h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`}
    </Text>
  )
}

/** Today's training, the run/walk start and the week, as one card: the
 * thing to do now at the top, then what it counts toward. */
function TodayCard({ s, onStart }: { s: FitnessState; onStart: () => void }) {
  return (
    <Frame style={{ marginTop: 16 }}>
      <View style={{ padding: 16, gap: 10 }}>
        <Training s={s} onStart={onStart} />
      </View>
      <RunPart s={s} />
      <WeekPart s={s} />
    </Frame>
  )
}

function Training({ s, onStart }: { s: FitnessState; onStart: () => void }) {
  const t = useTheme()
  const active = s.workouts.find(
      (w) => w.id === s.activeId && w.status === "in_progress",
    ),
    todayTemplate = F.scheduledTemplate(s),
    doneToday = F.finished(s).filter(
      (w) => dayKey(new Date(w.startedAt)) === dayKey(),
    ),
    todayName = new Date(`${dayKey()}T12:00:00`).toLocaleDateString("en-PH", {
      weekday: "long",
    })
  const eyebrow = (
    <Copy size={12} weight="medium" muted>
      {`Today · ${todayName}`}
    </Copy>
  )
  if (active) {
    const sets = active.exercises.reduce(
      (a, e) => a + e.sets.filter((x) => x.completedAt).length,
      0,
    )
    return (
      <Hero
        eyebrow={
          <Copy size={12} weight="medium" style={{ color: t.fit }}>
            In progress · <Elapsed from={active.startedAt} />
          </Copy>
        }
        title={active.name}
        detail={`${active.exercises.length} ${active.exercises.length === 1 ? "exercise" : "exercises"} · ${sets} ${sets === 1 ? "set" : "sets"} done`}
        action={
          <SmallButton
            accent="fit"
            icon={Play}
            onPress={() => go("/fitness/workout")}
          >
            Resume
          </SmallButton>
        }
      />
    )
  }
  if (doneToday.length) {
    const w = doneToday.at(-1)!,
      tot = F.workoutTotals(s, w),
      prs = F.prsByWorkout(F.allPrs(s)).get(w.id)?.length ?? 0
    return (
      <Hero
        eyebrow={eyebrow}
        title={`${w.name} done`}
        icon={Check}
        detail={`${F.fmtMin(tot.durationSec)} · ${volume(tot.volume)}`}
        chip={prs ? <PrChip count={prs} /> : undefined}
        onOpen={() => go(`/fitness/workouts/${w.id}`)}
        action={
          <SmallButton accent="fit" quiet icon={Plus} onPress={onStart}>
            Another
          </SmallButton>
        }
      />
    )
  }
  if (F.isRestDay(s) && s.schedule.some((d) => d !== null))
    return (
      <Hero
        eyebrow={eyebrow}
        title="Rest day"
        icon={Moon}
        detail="Nothing planned today. Recover."
        action={
          <SmallButton accent="fit" quiet icon={Plus} onPress={onStart}>
            Train anyway
          </SmallButton>
        }
      />
    )
  if (todayTemplate) {
    const last = F.lastOfTemplate(s, todayTemplate.id),
      items = todayTemplate.items
    return (
      <>
        <Hero
          eyebrow={eyebrow}
          title={todayTemplate.name}
          detail={`${items.length} exercises · ${last ? `last done ${F.relDay(last.startedAt)}` : "first time"}`}
          action={
            <SmallButton accent="fit" icon={Play} onPress={onStart}>
              Start
            </SmallButton>
          }
        />
        <View style={{ gap: 6 }}>
          {items.slice(0, 3).map((item) => {
            const sug = F.suggestion(s, item.exerciseId),
              ex = s.exercises.find((e) => e.id === item.exerciseId),
              up = sug.kind === "weight" || sug.kind === "reps"
            return (
              <Line key={item.exerciseId} style={{ gap: 8 }}>
                <Copy size={14} style={{ flex: 1 }}>
                  {ex?.name}
                </Copy>
                {sug.kind !== "new" && (
                  <Copy
                    size={14}
                    muted
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {`${n1(sug.weight)} kg × ${sug.reps}`}
                  </Copy>
                )}
                <View
                  style={{
                    borderRadius: radius.pill,
                    backgroundColor: up ? border(t.good, 0.14) : t.soft,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <Copy
                    size={12}
                    weight="medium"
                    style={{ color: up ? t.good : t.muted }}
                  >
                    {sug.badge}
                  </Copy>
                </View>
              </Line>
            )
          })}
          {items.length > 3 && (
            <Copy size={12} muted>
              {`+${items.length - 3} more`}
            </Copy>
          )}
        </View>
      </>
    )
  }
  return (
    <Hero
      eyebrow={eyebrow}
      title="Nothing planned today"
      icon={Dumbbell}
      detail="Pick a template or start empty."
      action={
        <SmallButton accent="fit" icon={Play} onPress={onStart}>
          Start
        </SmallButton>
      }
    />
  )
}

/** The block's title line: what to do, why, and its one button. */
function Hero({
  eyebrow,
  title,
  icon: Icon,
  detail,
  chip,
  action,
  onOpen,
}: {
  eyebrow: React.ReactNode
  title: string
  icon?: LucideIcon
  detail: string
  chip?: React.ReactNode
  action: React.ReactNode
  onOpen?: () => void
}) {
  const t = useTheme(),
    big = useBigText()
  const body = (
    <View style={{ flex: big ? undefined : 1, minWidth: 0 }}>
      {eyebrow}
      <Line style={{ gap: 8 }}>
        {Icon && <Icon size={20} color={t.fit} />}
        <Copy size={20} weight="semibold" style={{ flexShrink: 1 }}>
          {title}
        </Copy>
      </Line>
      <Line style={{ gap: 8, flexWrap: "wrap" }}>
        <Copy size={14} muted>
          {detail}
        </Copy>
        {chip}
      </Line>
    </View>
  )
  return (
    <View
      style={{
        flexDirection: big ? "column" : "row",
        alignItems: big ? "flex-start" : "center",
        gap: 12,
      }}
    >
      {onOpen ? (
        <Tap
          onPress={onOpen}
          style={{
            flex: big ? undefined : 1,
            minWidth: 0,
            alignSelf: "stretch",
          }}
        >
          {body}
        </Tap>
      ) : (
        body
      )}
      {action}
    </View>
  )
}

function PrChip({ count }: { count: number }) {
  const t = useTheme()
  return (
    <Line
      style={{
        gap: 4,
        backgroundColor: border(t.warn, 0.15),
        borderRadius: radius.pill,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Trophy size={12} color={t.warn} />
      <Copy size={12} weight="medium" style={{ color: t.warn }}>
        {count === 1 ? "1 PR" : `${count} PRs`}
      </Copy>
    </Line>
  )
}

/** Run or walk: one tap to start either, this week's distance beside it;
 * the row opens the history. While one is live it says so and resumes. */
function RunPart({ s }: { s: FitnessState }) {
  const t = useTheme()
  const active = RL.runLiveStore.use((x) => x.active)
  const week = R.runTotals(weekRuns(R.runsOf(s))),
    big = useBigText()
  return (
    <Part>
      <View
        style={{
          flexDirection: big ? "column" : "row",
          alignItems: big ? "flex-start" : "center",
          gap: 12,
        }}
      >
        <Tap
          label={active ? "Open the live session" : "Runs and walks"}
          onPress={() => go(active ? RUN_HREF : "/fitness/runs")}
          style={{
            flex: big ? undefined : 1,
            minWidth: 0,
            alignSelf: "stretch",
          }}
        >
          <Line style={{ gap: 10 }}>
            <Activity size={18} color={t.fit} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Copy weight="medium">
                {active
                  ? `${R.kindLabel(active.kind)} in progress`
                  : "Run or walk"}
              </Copy>
              <Copy size={12} muted>
                {active ? (
                  <Elapsed from={active.startedAt} />
                ) : week.count ? (
                  `${n1(week.distanceM / 1000)} km this week · ${week.count} ${week.count === 1 ? "session" : "sessions"}`
                ) : (
                  "None this week"
                )}
              </Copy>
            </View>
          </Line>
        </Tap>
        {active ? (
          <SmallButton
            accent="fit"
            small
            icon={Play}
            onPress={() => go(RUN_HREF)}
          >
            Resume
          </SmallButton>
        ) : (
          <Line style={{ gap: 6 }}>
            <SmallButton
              accent="fit"
              quiet
              small
              icon={Activity}
              onPress={() => go(`${RUN_HREF}?kind=run`)}
            >
              Run
            </SmallButton>
            <SmallButton
              accent="fit"
              quiet
              small
              icon={Footprints}
              onPress={() => go(`${RUN_HREF}?kind=walk`)}
            >
              Walk
            </SmallButton>
          </Line>
        )}
      </View>
    </Part>
  )
}

/** The week against its target: a day per cell (done, planned, rest), the
 * count and streak, and last week's shortfall on a Monday. The strip is the
 * routine's editor: tapping it opens the plan. */
function WeekPart({ s }: { s: FitnessState }) {
  const t = useTheme()
  const wkStart = F.weekStart(dayKey()),
    finished = F.finished(s),
    days = Array.from({ length: 7 }, (_, i) => {
      const key = F.addDays(wkStart, i)
      return {
        key,
        letter: "MTWTFSS"[i],
        planned: s.schedule[i] !== null,
        done: finished.some((w) => dayKey(new Date(w.startedAt)) === key),
        isToday: key === dayKey(),
        past: key < dayKey(),
      }
    }),
    done = days.filter((d) => d.done).length,
    goal = F.weeklyGoal(s),
    streak = F.consistencyStreak(s),
    // A new account has no week to fall short of.
    short = finished.length ? lastWeekShort(s) : undefined,
    hasPlan = s.schedule.some((d) => d !== null),
    // Planned days already gone by with nothing logged.
    missed = days.filter((d) => d.past && d.planned && !d.done).length
  return (
    <Part style={{ gap: 10 }}>
      <Tap label="Edit your weekly plan" onPress={() => go("/fitness/routine")}>
        <Line style={{ gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Line style={{ gap: 8, flexWrap: "wrap" }}>
              <Copy weight="semibold" style={{ fontVariant: ["tabular-nums"] }}>
                {`${done} of ${goal} this week`}
              </Copy>
              {done >= goal && goal > 0 ? (
                <Copy size={12} weight="medium" style={{ color: t.good }}>
                  Target hit
                </Copy>
              ) : missed > 0 ? (
                <Copy size={12} weight="medium" style={{ color: t.bad }}>
                  {`${missed} missed`}
                </Copy>
              ) : null}
            </Line>
            <Copy size={12} muted>
              {streak
                ? `${streak} ${streak === 1 ? "week" : "weeks"} on target in a row`
                : hasPlan
                  ? "Hit the target to start a streak"
                  : "No plan yet: tap to set your training days"}
            </Copy>
          </View>
          <Pencil size={16} color={t.muted} />
        </Line>
        <Line style={{ gap: 6, marginTop: 10 }}>
          {days.map((d) => {
            const miss = d.past && d.planned && !d.done
            return (
              <View
                key={d.key}
                style={{
                  flex: 1,
                  height: 32,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: d.done
                    ? t.fit
                    : d.planned
                      ? border(t.fit, 0.12)
                      : "transparent",
                  borderWidth: d.isToday && !d.done ? 1.5 : 0,
                  borderColor: t.fit,
                }}
              >
                {d.done ? (
                  <Check size={14} color={t.onPrimary} />
                ) : (
                  <Copy
                    size={12}
                    weight="semibold"
                    style={{
                      color: miss
                        ? t.bad
                        : d.isToday || d.planned
                          ? t.fit
                          : t.muted,
                      textDecorationLine: miss ? "line-through" : "none",
                    }}
                  >
                    {d.letter}
                  </Copy>
                )}
              </View>
            )
          })}
        </Line>
      </Tap>
      {short && (
        <View
          testID="fitness-last-week-short"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 8,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: border(t.bad, 0.12),
          }}
        >
          <TriangleAlert size={14} color={t.bad} />
          <Copy size={12} weight="medium" style={{ color: t.bad, flex: 1 }}>
            {`Last week ${short.count} of ${short.target}, ${short.target - short.count} short of your target`}
          </Copy>
        </View>
      )}
    </Part>
  )
}

/** Am I getting stronger: PRs, the share of lifts going up and last week's
 * volume as peers, the key lifts with their trend, and the weekly volume. */
function Progress({ s }: { s: FitnessState }) {
  const t = useTheme()
  const finished = F.finished(s)
  const lifts = s.exercises
    .filter((e) => !e.archived)
    .map((ex) => {
      const all = F.exerciseHistory(s, ex.id),
        hist = all.filter(
          (h) =>
            dayKey(new Date(h.workout.startedAt)) >= dayOffset(-56) &&
            h.stats.bestE1rm > 0,
        )
      return { ex, all, hist }
    })
    .filter((l) => l.hist.length >= 2)
    .sort(
      (a, b) =>
        Number(b.ex.equipment === "barbell") -
          Number(a.ex.equipment === "barbell") || b.hist.length - a.hist.length,
    )
    .slice(0, 4)
    .map((l) => {
      const first = l.hist[0].stats.bestE1rm,
        last = l.hist.at(-1)!.stats.bestE1rm
      return {
        id: l.ex.id,
        name: l.ex.name,
        series: l.hist.map((h) => h.stats.bestE1rm),
        last,
        change: last - first,
        stalled: F.isStalled(l.all),
      }
    })
  const weeks = Array.from({ length: 8 }, (_, i) => ({
    start: F.addDays(F.weekStart(dayKey()), -7 * (7 - i)),
    volume: 0,
  }))
  for (const w of finished) {
    const slot = weeks.find(
      (x) => x.start === F.weekStart(dayKey(new Date(w.startedAt))),
    )
    if (slot) slot.volume += F.workoutTotals(s, w).volume
  }
  const prev = weeks.at(-3)!.volume,
    lastFull = weeks.at(-2)!.volume,
    delta = prev ? (lastFull - prev) / prev : null,
    max = Math.max(1, ...weeks.map((w) => w.volume)),
    prs = F.allPrs(s).filter(
      (p) => dayKey(new Date(p.at)) >= dayOffset(-30),
    ).length,
    rate = F.overloadRate(s, 56)
  const locked = finished.length === 0,
    big = useBigText()
  // An empty account still sees the shape: its plan's lifts, at zero.
  const rows = locked
    ? ((F.scheduledTemplate(s) ?? s.templates[0])?.items
        .slice(0, 3)
        .map((i) => ({
          id: i.exerciseId,
          name:
            s.exercises.find((e) => e.id === i.exerciseId)?.name ??
            i.exerciseId,
          series: [] as number[],
          last: 0,
          change: 0,
          stalled: false,
        })) ?? [])
    : lifts
  return (
    <>
      <Heading
        icon={TrendingUp}
        title="Progress · 8 weeks"
        link={
          locked ? undefined : { label: "All stats", href: "/fitness/stats" }
        }
      />
      <LockedPreview
        locked={locked}
        color={t.fit}
        title="Your progress starts with one workout"
        detail="PRs, your lifts' strength and weekly volume fill in here as you train."
        action={{ label: "Browse templates", href: "/fitness/templates" }}
      >
        <Frame>
          <View
            style={{
              flexDirection: big ? "column" : "row",
              paddingVertical: 12,
              gap: big ? 12 : 0,
            }}
          >
            <Peer
              value={n(prs)}
              label="PRs · 30 days"
              icon={Trophy}
              color={prs ? t.warn : t.text}
            />
            {!big && <Divider />}
            <Peer
              value={`${Math.round(rate * 100)}%`}
              label="Lifts going up"
              color={rate >= 0.5 ? t.good : rate > 0 ? t.warn : t.text}
            />
            {!big && <Divider />}
            <Peer
              value={volume(lastFull)}
              label="Volume last week"
              delta={
                delta === null
                  ? undefined
                  : {
                      text: `${delta >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta * 100))}%`,
                      color: delta >= 0 ? t.good : t.bad,
                    }
              }
            />
          </View>
          {rows.map((l) => (
            <Tap
              key={l.id}
              label={`${l.name}, estimated max ${n1(l.last)} kg`}
              onPress={() => go(`/fitness/exercises/${l.id}`)}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderTopWidth: 1,
                borderColor: border(t.line, 0.6),
              }}
            >
              <Line style={{ gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Line style={{ gap: 6, flexWrap: "wrap" }}>
                    <Copy size={14} weight="medium" style={{ flexShrink: 1 }}>
                      {l.name}
                    </Copy>
                    {l.stalled && (
                      <Line
                        style={{
                          gap: 4,
                          borderRadius: radius.pill,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          backgroundColor: border(t.warn, 0.15),
                        }}
                      >
                        <TriangleAlert size={11} color={t.warn} />
                        <Copy size={12} style={{ color: t.warn }}>
                          Stalled
                        </Copy>
                      </Line>
                    )}
                  </Line>
                  <Copy size={12} style={{ fontVariant: ["tabular-nums"] }}>
                    <Text style={{ color: t.text }}>{`${n1(l.last)} kg`}</Text>
                    <Text
                      style={{
                        color:
                          l.change > 0.05
                            ? t.good
                            : l.change < -0.05
                              ? t.bad
                              : t.muted,
                      }}
                    >
                      {`  ${l.change > 0.05 ? "▲" : l.change < -0.05 ? "▼" : "±"} ${n1(Math.abs(l.change))} kg`}
                    </Text>
                  </Copy>
                </View>
                <View style={{ width: 80 }}>
                  <Sparkline
                    values={l.series}
                    height={28}
                    color={t.fit}
                    area={false}
                    label={`${l.name} estimated max trend`}
                  />
                </View>
                <ChevronRight size={16} color={t.muted} />
              </Line>
            </Tap>
          ))}
          <View
            style={{
              padding: 16,
              borderTopWidth: 1,
              borderColor: border(t.line, 0.6),
            }}
          >
            <Line
              style={{
                justifyContent: "space-between",
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              <Copy size={12} muted>
                Weekly volume
              </Copy>
              <Copy size={12} muted style={{ fontVariant: ["tabular-nums"] }}>
                {`${volume(weeks.at(-1)!.volume)} so far this week`}
              </Copy>
            </Line>
            <Line style={{ height: 56, alignItems: "flex-end", gap: 4 }}>
              {weeks.map((w, i) => (
                <GrowBar
                  height={`${Math.max(3, (w.volume / max) * 100)}%`}
                  index={i}
                  key={w.start}
                  style={{
                    flex: 1,
                    borderTopLeftRadius: 6,
                    borderTopRightRadius: 6,
                    backgroundColor: i === 7 ? t.fit : border(t.fit, 0.45),
                  }}
                />
              ))}
            </Line>
            {big ? (
              <Line style={{ justifyContent: "space-between", marginTop: 4 }}>
                <Copy size={12} muted>
                  8 weeks ago
                </Copy>
                <Copy size={12} muted>
                  Now
                </Copy>
              </Line>
            ) : (
              <Line style={{ gap: 4, marginTop: 4 }}>
                {weeks.map((w, i) => (
                  <Copy
                    key={w.start}
                    size={12}
                    muted
                    style={{ flex: 1, textAlign: "center" }}
                  >
                    {i === 7 ? "Now" : Number(w.start.slice(8))}
                  </Copy>
                ))}
              </Line>
            )}
          </View>
        </Frame>
      </LockedPreview>
    </>
  )
}

const volume = (kg: number) =>
  kg >= 10_000 ? `${n1(kg / 1000)} t` : `${n(kg)} kg`

function Peer({
  value,
  label,
  icon: Icon,
  color,
  delta,
}: {
  value: string
  label: string
  icon?: LucideIcon
  color?: string
  delta?: { text: string; color: string }
}) {
  const t = useTheme(),
    big = useBigText()
  return (
    <View style={{ flex: big ? undefined : 1, paddingHorizontal: 12 }}>
      <Line style={{ gap: 4, flexWrap: "wrap" }}>
        {Icon && <Icon size={14} color={color ?? t.text} />}
        <Copy
          size={20}
          weight="semibold"
          style={{ color: color ?? t.text, fontVariant: ["tabular-nums"] }}
        >
          {value}
        </Copy>
      </Line>
      {delta && (
        <Copy size={12} weight="medium" style={{ color: delta.color }}>
          {delta.text}
        </Copy>
      )}
      <Copy size={12} muted>
        {label}
      </Copy>
    </View>
  )
}

function Divider() {
  const t = useTheme()
  return <View style={{ width: 1, backgroundColor: border(t.line, 0.6) }} />
}

type Session =
  | { kind: "workout"; at: string; w: Workout }
  | { kind: "run"; at: string; r: RunSession }

/** Workouts and runs together, newest first: what was done lately, each
 * opening its record, PRs on the workouts that set them. */
function Recent({ s }: { s: FitnessState }) {
  const t = useTheme()
  const prMap = F.prsByWorkout(F.allPrs(s))
  const all: Session[] = [
    ...F.finished(s).map((w) => ({
      kind: "workout" as const,
      at: w.startedAt,
      w,
    })),
    ...R.runsOf(s).map((r) => ({ kind: "run" as const, at: r.startedAt, r })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  if (!all.length) return null
  return (
    <>
      <Heading
        icon={History}
        title="Recent"
        link={{ label: "All workouts", href: "/fitness/workouts" }}
      />
      <Frame>
        {all.slice(0, 4).map((x, i) => {
          const divided = {
            borderTopWidth: i ? 1 : 0,
            borderColor: border(t.line, 0.6),
          }
          if (x.kind === "run") {
            const r = x.r,
              Icon = r.kind === "run" ? Activity : Footprints
            return (
              <Row
                key={r.id}
                style={divided}
                icon={Icon}
                title={r.name}
                detail={`${F.relDay(r.startedAt)} · ${R.fmtClock(r.movingSec)} · ${R.fmtPace(R.paceSecPerKm(r.movingSec, r.distanceM))} /km`}
                figure={`${n1(r.distanceM / 1000)} km`}
                href={`/fitness/runs/${r.id}`}
              />
            )
          }
          const w = x.w,
            tot = F.workoutTotals(s, w),
            prs = prMap.get(w.id)?.length ?? 0
          return (
            <Row
              key={w.id}
              style={divided}
              icon={Dumbbell}
              title={w.name}
              detail={`${F.relDay(w.startedAt)} · ${F.fmtMin(tot.durationSec)}`}
              chip={prs ? <PrChip count={prs} /> : undefined}
              figure={volume(tot.volume)}
              href={`/fitness/workouts/${w.id}`}
            />
          )
        })}
      </Frame>
    </>
  )
}

function Row({
  icon: Icon,
  title,
  detail,
  chip,
  figure,
  href,
  style,
}: {
  icon: LucideIcon
  title: string
  detail: string
  chip?: React.ReactNode
  figure: string
  href: string
  style: object
}) {
  const t = useTheme()
  return (
    <Tap
      onPress={() => go(href)}
      style={{ paddingHorizontal: 16, paddingVertical: 10, ...style }}
    >
      <Line style={{ gap: 12 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: border(t.fit, 0.14),
          }}
        >
          <Icon size={16} color={t.fit} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Line style={{ gap: 6, flexWrap: "wrap" }}>
            <Copy size={14} weight="medium" style={{ flexShrink: 1 }}>
              {title}
            </Copy>
            {chip}
          </Line>
          <Copy size={12} muted>
            {detail}
          </Copy>
        </View>
        <Copy
          size={14}
          weight="semibold"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {figure}
        </Copy>
        <ChevronRight size={16} color={t.muted} />
      </Line>
    </Tap>
  )
}

/** Where the plan is kept: templates and the exercise library. */
function PlanLinks({ s }: { s: FitnessState }) {
  const t = useTheme()
  const links = [
    {
      icon: LayoutList,
      label: "Templates",
      detail: `${n(s.templates.length)} saved`,
      href: "/fitness/templates",
    },
    {
      icon: ListChecks,
      label: "Exercises",
      detail: `${n(s.exercises.filter((e) => !e.archived).length)} in your library`,
      href: "/fitness/exercises",
    },
  ]
  return (
    <Frame style={{ marginTop: 24 }}>
      {links.map((l, i) => (
        <Tap
          key={l.href}
          label={l.label}
          onPress={() => go(l.href)}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderTopWidth: i ? 1 : 0,
            borderColor: border(t.line, 0.6),
          }}
        >
          <Line style={{ gap: 12 }}>
            <l.icon size={16} color={t.muted} />
            <View style={{ flex: 1 }}>
              <Copy size={14} weight="medium">
                {l.label}
              </Copy>
              <Copy size={12} muted>
                {l.detail}
              </Copy>
            </View>
            <ChevronRight size={16} color={t.muted} />
          </Line>
        </Tap>
      ))}
    </Frame>
  )
}
