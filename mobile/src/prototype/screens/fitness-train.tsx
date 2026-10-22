import * as F from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import {
  ChevronRight,
  Dumbbell,
  LayoutList,
  Play,
  Settings,
  Trophy,
} from "lucide-react-native"
import { useState } from "react"
import { Text, View } from "react-native"
import { Sparkline } from "../chart"
import { GrowBar } from "../motion"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  LinkRow,
  SectionHeading,
  SmallButton,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { fonts, radius, useTheme } from "../theme"
import { Screen } from "../ui"
import { Body } from "./fitness-body"
import { Nutrition } from "./fitness-nutrition"
import { StartWorkoutSheet } from "./fitness-start"
import { FitnessStats } from "./fitness-stats"
/** The Fitness page: training, then nutrition, body and stats as sections
 * of one scroll, so nothing hides behind a tab. */
export function FitnessTrain({ day }: { day?: string } = {}) {
  const t = useTheme(),
    s = fitStore.use((s) => s),
    next = F.nextTemplate(s),
    last = next ? F.lastOfTemplate(s, next.id) : undefined,
    week = F.sessionsByWeek(s, 1)[0],
    active = s.workouts.find(
      (w) => w.id === s.activeId && w.status === "in_progress",
    ),
    today = F.finished(s).filter(
      (w) => dayKey(new Date(w.startedAt)) === dayKey(),
    ),
    prMap = F.prsByWorkout(F.allPrs(s))
  const params = useLocalSearchParams<{ start?: string }>()
  const [startOpen, setStartOpen] = useState(params.start === "1")
  const start = () => setStartOpen(true)
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
        ...l,
        last,
        change: last - first,
        pct: first ? (last - first) / first : 0,
        stalled: F.isStalled(l.all),
      }
    })
  const weeks = Array.from({ length: 8 }, (_, i) => ({
    start: F.addDays(F.weekStart(dayKey()), -7 * (7 - i)),
    volume: 0,
  }))
  for (const w of F.finished(s)) {
    const slot = weeks.find(
      (x) => x.start === F.weekStart(dayKey(new Date(w.startedAt))),
    )
    if (slot) slot.volume += F.workoutTotals(s, w).volume
  }
  const prev = weeks.at(-3)!.volume,
    lastFull = weeks.at(-2)!.volume,
    delta = prev ? (lastFull - prev) / prev : null,
    max = Math.max(1, ...weeks.map((w) => w.volume))
  return (
    <Screen
      prototypeLayout
      title="Fitness"
      actions={
        <Line style={{ gap: 0 }}>
          <IconTap
            size={40}
            icon={Settings}
            label="Fitness settings"
            color={t.text}
            onPress={() => go("/fitness/settings")}
          />
        </Line>
      }
    >
      <View>
        <Frame
          style={{
            padding: 16,
            marginTop: 16,
            backgroundColor: active ? `${t.fit}1a` : t.card,
          }}
        >
          {active ? (
            <LinkRow
              title={`${active.name} in progress`}
              detail={`Started ${new Date(active.startedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`}
              icon={Dumbbell}
              accent="fit"
              href="/fitness/workout"
            />
          ) : today.length ? (
            <>
              <Copy weight="semibold">{today.at(-1)!.name} done</Copy>
              <Copy size={14} muted>
                {F.fmtMin(F.workoutTotals(s, today.at(-1)!).durationSec)} ·{" "}
                {prMap.get(today.at(-1)!.id)?.length ?? 0} PRs
              </Copy>
              <SmallButton accent="fit" onPress={start}>
                Start another workout
              </SmallButton>
            </>
          ) : next ? (
            <>
              <Line style={{ justifyContent: "space-between" }}>
                <View>
                  <Copy size={12} muted style={{ letterSpacing: 0.6 }}>
                    UP NEXT
                  </Copy>
                  <Copy size={20} weight="semibold">
                    {next.name}
                  </Copy>
                  <Copy size={14} muted>
                    {last
                      ? `Last done ${F.relDay(last.startedAt)}`
                      : "Never done"}{" "}
                    · {next.items.length} exercises
                  </Copy>
                </View>
                <Tap
                  onPress={start}
                  style={{
                    height: 44,
                    borderRadius: 16,
                    paddingHorizontal: 16,
                    backgroundColor: t.fit,
                    justifyContent: "center",
                  }}
                >
                  <Line style={{ gap: 8 }}>
                    <Play size={16} color={t.onPrimary} />
                    <Copy
                      size={14}
                      weight="semibold"
                      style={{ color: t.onPrimary }}
                    >
                      Start
                    </Copy>
                  </Line>
                </Tap>
              </Line>
              <View style={{ gap: 6, marginTop: 12 }}>
                {next.items.slice(0, 3).map((item) => {
                  const sug = F.suggestion(s, item.exerciseId),
                    ex = s.exercises.find((e) => e.id === item.exerciseId)
                  return (
                    <Line
                      key={item.exerciseId}
                      style={{ justifyContent: "space-between", gap: 8 }}
                    >
                      <Copy size={14} lines={1} style={{ flex: 1 }}>
                        {ex?.name}
                      </Copy>
                      <Copy size={14} muted>
                        {sug.weight} kg × {sug.reps}
                      </Copy>
                      <View
                        style={{
                          borderRadius: 16,
                          backgroundColor:
                            sug.kind === "weight" ? `${t.fit}26` : t.soft,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                        }}
                      >
                        <Copy
                          size={11}
                          weight="medium"
                          style={{
                            color: sug.kind === "weight" ? t.fit : t.muted,
                          }}
                        >
                          {sug.badge}
                        </Copy>
                      </View>
                    </Line>
                  )
                })}
              </View>
            </>
          ) : (
            <>
              <Copy weight="semibold">No workouts yet — start one</Copy>
              <SmallButton accent="fit" onPress={start}>
                Start workout
              </SmallButton>
            </>
          )}
        </Frame>
        <Frame style={{ padding: 16, marginTop: 12 }}>
          <Line style={{ justifyContent: "space-between" }}>
            <View>
              <Copy size={12} muted>
                This week
              </Copy>
              <Copy size={24} weight="semibold">
                {week?.count ?? 0}
                <Text style={{ fontSize: 16, color: t.muted }}>
                  /{s.settings.weeklyTarget} sessions
                </Text>
              </Copy>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Copy size={24} weight="semibold">
                {F.consistencyStreak(s)}
              </Copy>
              <Copy size={12} muted>
                week streak
              </Copy>
            </View>
          </Line>
          <Line style={{ gap: 6, marginTop: 12 }}>
            {Array.from({ length: s.settings.weeklyTarget }, (_, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: i < (week?.count ?? 0) ? t.fit : t.soft,
                }}
              />
            ))}
          </Line>
        </Frame>
        <Line style={{ gap: 8, marginTop: 12 }}>
          {[
            {
              label: "Templates",
              href: "/fitness/templates",
              icon: LayoutList,
            },
            { label: "Exercises", href: "/fitness/exercises", icon: Dumbbell },
          ].map((a) => (
            <Tap
              key={a.href}
              onPress={() => go(a.href)}
              style={{
                flex: 1,
                height: 44,
                backgroundColor: t.soft,
                borderRadius: 16,
                justifyContent: "center",
              }}
            >
              <Line style={{ gap: 8, justifyContent: "center" }}>
                <a.icon size={16} color={t.text} />
                <Copy size={14} weight="semibold">
                  {a.label}
                </Copy>
              </Line>
            </Tap>
          ))}
        </Line>
        {lifts.length > 0 && (
          <>
            <SectionHeading>Progress · 8 weeks</SectionHeading>
            <Line style={{ gap: 8, alignItems: "stretch" }}>
              {[
                {
                  value: String(
                    F.allPrs(s).filter(
                      (p) => dayKey(new Date(p.at)) >= dayOffset(-30),
                    ).length,
                  ),
                  label: "PRs · 30 days",
                },
                {
                  value: `${Math.round(F.overloadRate(s, 56) * 100)}%`,
                  label: "Lifts going up",
                },
                { value: F.fmtVolume(lastFull), label: "Volume last wk" },
              ].map((m, i) => (
                <Frame key={m.label} style={{ flex: 1, padding: 12 }}>
                  <Line style={{ gap: 4 }}>
                    {i === 0 && <Trophy size={16} color={t.warn} />}
                    <Copy
                      size={24}
                      weight="display"
                      style={{ fontFamily: fonts.displayMedium }}
                    >
                      {m.value}
                    </Copy>
                  </Line>
                  <Copy size={12} muted>
                    {m.label}
                    {i === 2 && delta !== null && (
                      <Text style={{ color: delta >= 0 ? t.good : t.bad }}>
                        {" "}
                        {delta >= 0 ? "▲" : "▼"}
                        {Math.abs(Math.round(delta * 100))}%
                      </Text>
                    )}
                  </Copy>
                </Frame>
              ))}
            </Line>
            <Frame style={{ marginTop: 12 }}>
              <Copy
                size={12}
                muted
                style={{ paddingHorizontal: 16, paddingTop: 12 }}
              >
                Key lifts · estimated 1-rep max
              </Copy>
              {lifts.map((l, i) => (
                <Tap
                  key={l.ex.id}
                  onPress={() => go(`/fitness/exercises/${l.ex.id}`)}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    minHeight: 64,
                    borderTopWidth: i ? 1 : 0,
                    borderColor: border(t.line, 0.6),
                  }}
                >
                  <Line>
                    <View style={{ flex: 1 }}>
                      <Line style={{ gap: 6 }}>
                        <Copy size={14} weight="medium" lines={1}>
                          {l.ex.name}
                        </Copy>
                        {l.stalled && (
                          <View
                            style={{
                              borderRadius: 12,
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              backgroundColor: `${t.warn}26`,
                            }}
                          >
                            <Copy size={11} style={{ color: t.warn }}>
                              Stalled
                            </Copy>
                          </View>
                        )}
                      </Line>
                      <Copy size={12} muted>
                        {Math.round(l.last)} kg
                        <Text
                          style={{
                            color:
                              l.change > 0.01
                                ? t.good
                                : l.change < -0.01
                                  ? t.bad
                                  : t.muted,
                          }}
                        >
                          　
                          {l.change > 0.01 ? "+" : l.change < -0.01 ? "−" : "±"}
                          {Math.abs(l.change).toFixed(1)} kg (
                          {Math.round(l.pct * 100)}%)
                        </Text>
                      </Copy>
                    </View>
                    <View style={{ width: 96 }}>
                      <Sparkline
                        values={l.hist.map((h) => h.stats.bestE1rm)}
                        height={32}
                        color={t.fit}
                        area={false}
                        label={`${l.ex.name} estimated max trend`}
                      />
                    </View>
                    <ChevronRight size={16} color={t.muted} />
                  </Line>
                </Tap>
              ))}
            </Frame>
            <Frame style={{ marginTop: 12, padding: 16 }}>
              <Line
                style={{ justifyContent: "space-between", marginBottom: 8 }}
              >
                <Copy size={12} muted>
                  Weekly volume
                </Copy>
                <Copy size={12} muted>
                  {F.fmtVolume(weeks.at(-1)!.volume)} this week
                </Copy>
              </Line>
              <Line style={{ height: 72, alignItems: "flex-end", gap: 4 }}>
                {weeks.map((w, i) => (
                  <GrowBar
                    height={`${Math.max(2, (w.volume / max) * 100)}%`}
                    index={i}
                    key={w.start}
                    style={{
                      flex: 1,
                      borderTopLeftRadius: 6,
                      borderTopRightRadius: 6,
                      backgroundColor: t.fit,
                      opacity: i === 7 ? 1 : 0.45,
                    }}
                  />
                ))}
              </Line>
              <Line style={{ gap: 4, marginTop: 4 }}>
                {weeks.map((w, i) => (
                  <Copy
                    key={w.start}
                    size={10}
                    muted
                    style={{ flex: 1, textAlign: "center" }}
                  >
                    {i === 7 ? "Now" : Number(w.start.slice(8))}
                  </Copy>
                ))}
              </Line>
            </Frame>
          </>
        )}
        {F.finished(s).length > 0 && (
          <>
            <SectionHeading
              action={
                <Tap onPress={() => go("/fitness/workouts")}>
                  <Copy size={12} style={{ color: t.fit }}>
                    All
                  </Copy>
                </Tap>
              }
            >
              Recent
            </SectionHeading>
            <Frame style={{ padding: 4 }}>
              {F.finished(s)
                .slice(-3)
                .reverse()
                .map((w) => (
                  <LinkRow
                    key={w.id}
                    title={w.name}
                    detail={`${F.relDay(w.startedAt)} · ${F.fmtMin(F.workoutTotals(s, w).durationSec)} · ${F.fmtVolume(F.workoutTotals(s, w).volume)}`}
                    icon={Dumbbell}
                    accent="fit"
                    href={`/fitness/workouts/${w.id}`}
                    right={
                      prMap.get(w.id)?.length ? (
                        <Line
                          style={{
                            gap: 4,
                            backgroundColor: `${t.warn}26`,
                            borderRadius: radius.pill,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                          }}
                        >
                          <Trophy size={12} color={t.warn} />
                          <Copy
                            size={11}
                            weight="medium"
                            style={{ color: t.warn }}
                          >
                            {prMap.get(w.id)?.length}
                          </Copy>
                        </Line>
                      ) : undefined
                    }
                  />
                ))}
            </Frame>
          </>
        )}
        <Nutrition embedded day={day} />
        <Body hub embedded />
        <FitnessStats embedded />
      </View>
      {startOpen && <StartWorkoutSheet onClose={() => setStartOpen(false)} />}
    </Screen>
  )
}
