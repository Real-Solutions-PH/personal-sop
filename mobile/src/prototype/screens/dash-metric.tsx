import type { ModuleKey } from "@domain/contract"
import { AREA } from "@domain/dash/data"
import { fmtGoal, moduleByKey, parseMetric, useGoals } from "@domain/dash/hooks"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { Target } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import {
  Bar,
  border,
  Copy,
  Frame,
  Line,
  SectionHeading,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { AccentContext, fonts, useTheme } from "../theme"
import { Button, Screen } from "../ui"
import { GoalEditor } from "./dash-goals"

const colors = {
  habits: "hab",
  tasks: "tsk",
  fitness: "fit",
  nutrition: "nut",
  focus: "foc",
  finance: "fin",
} as const
const hrefs = {
  habits: "/habits/stats",
  tasks: "/tasks/stats",
  fitness: "/fitness/stats",
  nutrition: "/nutrition",
  focus: "/focus/stats",
  finance: "/finance/reports",
}
export function MetricDetail({ metric }: { metric: string }) {
  const [mod, key] = decodeURIComponent(metric).split(":")
  return mod in moduleByKey && key ? (
    <Detail moduleKey={mod as ModuleKey} metricKey={key} />
  ) : (
    <Screen title="Metric">
      <Copy>Unknown metric</Copy>
      <Copy muted>This stat no longer exists.</Copy>
      <Button href="/stats">Back to Stats</Button>
    </Screen>
  )
}
function Detail({
  moduleKey: k,
  metricKey,
}: {
  moduleKey: ModuleKey
  metricKey: string
}) {
  const mod = moduleByKey[k],
    params = useLocalSearchParams<{ range?: string }>(),
    [days, setDays] = useState(
      [7, 30, 90, 365].includes(Number(params.range))
        ? Number(params.range)
        : 7,
    ),
    w = mod.useMetrics(7),
    m = mod.useMetrics(30),
    q = mod.useMetrics(90),
    y = mod.useMetrics(365),
    cur = mod.useMetrics(days),
    misses = mod.useMisses(dayOffset(-(days - 1)), dayKey()),
    ref = `${k}:${metricKey}`,
    goals = useGoals().filter(
      (g) => g.goal.metric === ref && g.goal.status === "active",
    ),
    [editor, setEditor] = useState(false),
    metric = cur.find((x) => x.key === metricKey),
    t = useTheme(),
    across = [w, m, q, y].map((l) => {
      const x = l.find((v) => v.key === metricKey)
      return x ? parseMetric(x.value) : null
    }),
    max = Math.max(1, ...across.map((v) => v ?? 0)),
    color = t[colors[k]]
  return (
    <Screen title={metric?.label ?? "Metric"}>
      {metric ? (
        <View>
          <Line style={{ gap: 8 }}>
            {[7, 30, 90, 365].map((d, i) => (
              <Tap
                key={d}
                onPress={() => setDays(d)}
                style={{
                  height: 44,
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  backgroundColor: days === d ? t.text : t.soft,
                }}
              >
                <Copy
                  size={14}
                  weight="medium"
                  style={{ color: days === d ? t.bg : t.text }}
                >
                  {["7d", "30d", "90d", "1y"][i]}
                </Copy>
              </Tap>
            ))}
          </Line>
          <Frame style={{ marginTop: 12, padding: 16 }}>
            <Line style={{ gap: 6 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: color,
                }}
              />
              <Copy size={12} muted>
                {AREA[k].label} · last {days} days
              </Copy>
            </Line>
            <Copy
              size={48}
              style={{
                fontFamily: fonts.displayBlack,
                color,
                marginTop: 4,
                letterSpacing: -1.2,
              }}
            >
              {metric.value}
            </Copy>
            <Line style={{ marginTop: 4, gap: 8 }}>
              <Copy
                size={14}
                style={{
                  color:
                    metric.delta == null || metric.delta === 0
                      ? t.muted
                      : (
                            metric.goodWhen === "down"
                              ? metric.delta < 0
                              : metric.delta > 0
                          )
                        ? t.good
                        : t.bad,
                }}
              >
                {metric.delta
                  ? `${metric.delta > 0 ? "↑" : "↓"} ${Math.abs(metric.delta)}`
                  : "—"}
              </Copy>
              <Copy size={14} muted>
                vs previous {days} days
              </Copy>
            </Line>
            {across.some((v) => v !== null) && (
              <Line style={{ marginTop: 16, gap: 8, alignItems: "flex-end" }}>
                {across.map((v, i) => (
                  <View
                    key={["7d", "30d", "90d", "1y"][i]}
                    style={{ flex: 1, gap: 4, alignItems: "center" }}
                  >
                    <View
                      style={{
                        height: 64,
                        width: "100%",
                        justifyContent: "flex-end",
                      }}
                    >
                      <View
                        style={{
                          height: Math.max(2, ((v ?? 0) / max) * 64),
                          backgroundColor: color,
                          borderRadius: 4,
                        }}
                      />
                    </View>
                    <Copy size={10} muted>
                      {["7d", "30d", "90d", "1y"][i]}
                    </Copy>
                  </View>
                ))}
              </Line>
            )}
          </Frame>
          <SectionHeading>Goal</SectionHeading>
          <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            {goals.map((g) => (
              <Tap
                key={g.goal.id}
                onPress={() => setEditor(true)}
                style={{ paddingVertical: 10 }}
              >
                <Line style={{ gap: 8, marginBottom: 6 }}>
                  <Copy size={14} weight="medium" style={{ flex: 1 }}>
                    {g.goal.label}{" "}
                    <Copy size={12} muted>
                      {fmtGoal(g.goal)}
                    </Copy>
                  </Copy>
                  <Copy
                    size={14}
                    weight="semibold"
                    style={{ color: g.hit ? t.good : t.text }}
                  >
                    {g.entry?.value ?? "—"}
                    {g.hit ? " ✓" : ""}
                  </Copy>
                </Line>
                <Bar
                  value={Math.min(1, g.pct)}
                  color={g.hit ? t.life : t.primary}
                />
              </Tap>
            ))}
            {parseMetric(metric.value) !== null ? (
              <Tap
                onPress={() => setEditor(true)}
                style={{ paddingVertical: 10 }}
              >
                <Line style={{ justifyContent: "center", gap: 6 }}>
                  <Target size={16} color={t.primary} />
                  <Copy size={14} weight="medium" style={{ color: t.primary }}>
                    {goals.length ? "Edit goal" : "Set goal"}
                  </Copy>
                </Line>
              </Tap>
            ) : (
              <Copy size={14} muted style={{ paddingVertical: 12 }}>
                This one's a ratio — set goals on the numbers it's made of.
              </Copy>
            )}
          </Frame>
          <SectionHeading>What moved it · {misses.length}</SectionHeading>
          <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            {!misses.length ? (
              <Copy
                size={14}
                muted
                style={{ padding: 12, textAlign: "center" }}
              >
                No misses in this range. Clean.
              </Copy>
            ) : (
              misses.slice(0, 6).map((x) => (
                <Tap key={x.id} onPress={() => go(x.href)}>
                  <Line
                    style={{
                      gap: 8,
                      paddingVertical: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: border(t.line, 0.5),
                    }}
                  >
                    <Copy size={14} lines={1} style={{ flex: 1 }}>
                      {x.title}
                    </Copy>
                    <Copy size={12} muted>
                      {new Date(`${x.day}T12:00:00`).toLocaleDateString(
                        "en-PH",
                        { month: "short", day: "numeric" },
                      )}
                    </Copy>
                  </Line>
                </Tap>
              ))
            )}
          </Frame>
          <Line style={{ gap: 8, marginTop: 20 }}>
            <View style={{ flex: 1 }}>
              <Button tone="quiet" href={hrefs[k]}>
                {`Open ${AREA[k].label}`}
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <AccentContext.Provider value="primary">
                <Button
                  disabled={!metric.shareable}
                  href={`/stats/share?t=${k === "finance" ? "finance" : "weekly"}`}
                >
                  {metric.shareable ? "Share" : "Private metric"}
                </Button>
              </AccentContext.Provider>
            </View>
          </Line>
        </View>
      ) : (
        <Copy muted>This metric is unavailable.</Copy>
      )}
      {editor && (
        <GoalEditor
          metric={ref}
          goal={goals[0]?.goal}
          onClose={() => setEditor(false)}
        />
      )}
    </Screen>
  )
}
