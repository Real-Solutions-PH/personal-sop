import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { ChevronRight, Share2, TriangleAlert } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { Sparkline } from "../chart"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Empty, Screen } from "../ui"
export function FitnessStats() {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    [range, setRange] = useState("28"),
    days = Number(range),
    weeks = C.sessionsByWeek(s, days / 7),
    finished = C.finished(s),
    volume = weeks.map((w) =>
      finished
        .filter((x) => C.weekStart(dayKey(new Date(x.startedAt))) === w.start)
        .reduce((a, x) => a + C.workoutTotals(s, x).volume, 0),
    ),
    cur = C.periodSummary(s, days),
    prev = C.periodSummary(s, days, -days),
    latest = finished.at(-1),
    stalls = s.exercises.filter(
      (e) => !e.archived && C.isStalled(C.exerciseHistory(s, e.id)),
    ),
    rate = C.weeklyRate(s),
    weight = C.weightTrend(s, days),
    adherence = C.adherence(s, Math.min(days, 14)),
    lifts = ["bench", "squat", "row", "ohp", "rdl"]
      .map((id) => {
        const h = C.exerciseHistory(s, id),
          inRange = h.filter(
            (x) => dayKey(new Date(x.workout.startedAt)) >= weeks[0].start,
          ),
          last = h.at(-1)?.stats.bestE1rm ?? 0,
          first = inRange[0]?.stats.bestE1rm ?? last
        return {
          id,
          name: s.exercises.find((e) => e.id === id)?.name ?? id,
          last,
          delta: last - first,
          series: inRange.map((x) => x.stats.bestE1rm),
          stalled: C.isStalled(h),
        }
      })
      .filter((l) => l.last > 0)
  const grid = (
    items: {
      label: string
      value: string | number
      delta?: number
      color?: string
    }[],
  ) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
      {items.map((x) => (
        <View key={x.label} style={{ width: "47.5%" }}>
          <Copy
            size={30}
            weight="displayMedium"
            style={{ color: x.color ?? t.text }}
          >
            {x.value}
          </Copy>
          <Copy size={12} muted>
            {x.label}
            {x.delta !== undefined && x.delta !== 0 && (
              <Copy size={12} style={{ color: x.delta > 0 ? t.good : t.bad }}>
                {" "}
                {x.delta > 0 ? "▲" : "▼"} {Math.abs(x.delta)}
              </Copy>
            )}
          </Copy>
        </View>
      ))}
    </View>
  )
  const heading = (title: string) => (
    <View style={{ marginTop: -12, marginBottom: -12 }}>
      <SectionHeading>{title}</SectionHeading>
    </View>
  )
  return (
    <Screen
      title="Fitness stats"
      actions={
        latest ? (
          <IconTap
            size={40}
            icon={Share2}
            label="Share"
            onPress={() => go(`/fitness/share/${latest.id}`)}
          />
        ) : undefined
      }
    >
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: "28", label: "4 weeks" },
          { value: "84", label: "12 weeks" },
        ]}
      />
      {!latest ? (
        <Empty
          title="No training data yet"
          detail="Finish a workout and your sessions, PRs and lifts show up here."
        />
      ) : (
        <>
          <Frame style={{ padding: 16 }}>
            {grid([
              {
                label: `Sessions (target ${Math.round(cur.target)})`,
                value: cur.sessions,
                delta: cur.sessions - prev.sessions,
                color: t.fit,
              },
              { label: "PRs", value: cur.prs, delta: cur.prs - prev.prs },
              {
                label: "Progress rate (4 wks)",
                value: `${Math.round(C.overloadRate(s, 28) * 100)}%`,
              },
              { label: "Weekly streak", value: `${C.consistencyStreak(s)} wk` },
            ])}
          </Frame>
          {heading("Sessions per week")}
          <Frame style={{ padding: 16 }}>
            <Line style={{ height: 90, alignItems: "flex-end", gap: 4 }}>
              {weeks.map((w) => (
                <View
                  key={w.start}
                  style={{
                    flex: 1,
                    height: "100%",
                    justifyContent: "flex-end",
                  }}
                >
                  <View
                    style={{
                      height: Math.max(
                        2,
                        (w.count / Math.max(1, ...weeks.map((x) => x.count))) *
                          90,
                      ),
                      backgroundColor:
                        w.start === weeks.at(-1)?.start
                          ? t.fit
                          : border(t.fit, 0.45),
                      borderTopLeftRadius: 8,
                      borderTopRightRadius: 8,
                    }}
                  />
                </View>
              ))}
            </Line>
            <Line style={{ gap: 8, marginTop: 4 }}>
              {weeks.map((w) => (
                <Copy
                  key={w.start}
                  size={10}
                  muted
                  style={{ flex: 1, textAlign: "center" }}
                >
                  {weeks.length > 6
                    ? ""
                    : new Date(`${w.start}T12:00:00`).toLocaleDateString(
                        "en-PH",
                        { month: "short", day: "numeric" },
                      )}
                </Copy>
              ))}
            </Line>
            <Line style={{ justifyContent: "space-between", marginTop: 8 }}>
              <Copy size={12} muted>
                Target {s.settings.weeklyTarget}/week
              </Copy>
              <Copy size={12} style={{ color: cur.missed ? t.bad : t.good }}>
                {cur.missed ? `${cur.missed} missed` : "No misses"}
              </Copy>
            </Line>
          </Frame>
          {heading("Weekly volume")}
          <Frame style={{ padding: 16 }}>
            <Copy size={20} weight="semibold">
              {C.fmtVolume(cur.volume)}
            </Copy>
            <Copy size={12} muted>
              in range · prev {C.fmtVolume(prev.volume)}
            </Copy>
            <View style={{ marginTop: 8 }}>
              <Sparkline
                values={volume}
                color={t.fit}
                height={56}
                label="Weekly volume"
              />
            </View>
          </Frame>
          {heading("Top lifts · e1RM")}
          <Frame>
            {lifts.map((l, i) => (
              <Tap
                key={l.id}
                onPress={() => go(`/fitness/exercises/${l.id}`)}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: border(t.line, 0.6),
                }}
              >
                <Line>
                  <View style={{ flex: 1 }}>
                    <Line style={{ gap: 6 }}>
                      <Copy
                        size={14}
                        weight="medium"
                        lines={1}
                        style={{ flexShrink: 1 }}
                      >
                        {l.name}
                      </Copy>
                      {l.stalled && <TriangleAlert size={14} color={t.warn} />}
                    </Line>
                    <Copy
                      size={12}
                      style={{ color: l.delta > 0 ? t.good : t.muted }}
                    >
                      {l.delta > 0 ? "▲" : l.delta < 0 ? "▼" : "•"}{" "}
                      {C.kgShort(Math.round(Math.abs(l.delta) * 10) / 10)} kg
                    </Copy>
                  </View>
                  <View style={{ width: 80 }}>
                    <Sparkline
                      values={l.series}
                      color={t.fit}
                      height={28}
                      area={false}
                      label={`${l.name} strength`}
                    />
                  </View>
                  <Copy
                    weight="semibold"
                    style={{ width: 56, textAlign: "right" }}
                  >
                    {C.kgShort(Math.round(l.last))}
                  </Copy>
                  <ChevronRight size={16} color={t.muted} />
                </Line>
              </Tap>
            ))}
          </Frame>
          {!!stalls.length && (
            <>
              {heading("Stalled lifts")}
              <Frame style={{ padding: 16, gap: 4 }}>
                {stalls.map((e) => (
                  <Tap
                    key={e.id}
                    onPress={() => go(`/fitness/exercises/${e.id}`)}
                  >
                    <Line style={{ justifyContent: "space-between" }}>
                      <Copy size={14}>{e.name}</Copy>
                      <Copy size={12} muted>
                        no strength gain · 3 wks
                      </Copy>
                    </Line>
                  </Tap>
                ))}
              </Frame>
            </>
          )}
          {heading("Body weight")}
          <Tap onPress={() => go("/fitness/body")}>
            <Frame style={{ padding: 16 }}>
              <Line style={{ justifyContent: "space-between" }}>
                <Copy size={20} weight="semibold">
                  {rate?.avg.toFixed(1) ?? "—"} kg
                </Copy>
                {rate && (
                  <Copy
                    size={14}
                    style={{
                      color: (
                        s.settings.goalDirection === "cut"
                          ? rate.kg <= 0
                          : rate.kg >= 0
                      )
                        ? t.good
                        : t.bad,
                    }}
                  >
                    {rate.kg > 0 ? "▲" : "▼"} {Math.abs(rate.kg).toFixed(2)}{" "}
                    kg/wk
                  </Copy>
                )}
              </Line>
              <View style={{ marginTop: 8 }}>
                <Sparkline
                  values={weight
                    .map((p) => p.avg)
                    .filter((v): v is number => v !== undefined)}
                  color={t.fit}
                  height={48}
                  label="Body weight"
                />
              </View>
            </Frame>
          </Tap>
          {heading("Nutrition · last 14 days")}
          <Tap onPress={() => go("/fitness/nutrition/history")}>
            <Frame style={{ padding: 16 }}>
              {grid([
                {
                  label: "Calories on target",
                  value: `${Math.round(adherence.calorie * 100)}%`,
                },
                {
                  label: "Protein hit rate",
                  value: `${Math.round(adherence.protein * 100)}%`,
                },
                { label: "Over-target days", value: adherence.overDays },
                {
                  label: "Logging coverage",
                  value: `${Math.round(adherence.coverage * 100)}%`,
                },
              ])}
            </Frame>
          </Tap>
        </>
      )}
    </Screen>
  )
}
