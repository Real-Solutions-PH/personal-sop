import { weekday } from "@domain/lib/day"
import { useStats } from "@domain/tasks/hooks"
import * as L from "@domain/tasks/logic"
import {
  CalendarClock,
  ChevronRight,
  Flame,
  Share2,
  TriangleAlert,
} from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { GrowBar } from "../motion"
import {
  Bar,
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
import { Button } from "../ui"
import { Ring } from "../visual"
import { StatsShell } from "./stats-shell"
export const RANGE_LABEL: Record<string, string> = {
  "7": "this week",
  "30": "this month",
  "90": "last 90 days",
}
export function TaskBars({
  data,
  labels,
  height = 96,
  color,
}: {
  data: number[]
  labels?: string[]
  height?: number
  color: string
}) {
  const max = Math.max(1, ...data)
  return (
    <Line style={{ gap: data.length > 20 ? 2 : 4, alignItems: "flex-end" }}>
      {data.map((v, i) => (
        <View key={`${i}-${v}`} style={{ flex: 1, gap: 4 }}>
          <View style={{ height, justifyContent: "flex-end" }}>
            <GrowBar
              height={Math.max(2, (v / max) * height)}
              index={i}
              style={{
                backgroundColor:
                  i === data.length - 1 ? color : border(color, 0.4),
                borderTopLeftRadius: 6,
                borderTopRightRadius: 6,
              }}
            />
          </View>
          {labels && (
            <Copy size={10} muted style={{ textAlign: "center" }}>
              {labels[i]}
            </Copy>
          )}
        </View>
      ))}
    </Line>
  )
}
export function TaskStats({ embedded = false }: { embedded?: boolean }) {
  const t = useTheme(),
    [range, setRange] = useState("7"),
    s = useStats(Number(range)),
    prev = useStats(Number(range), Number(range)),
    heat = useStats(84),
    max = Math.max(1, ...heat.perDay.map((d) => d.done)),
    lead = weekday(heat.perDay[0]?.day ?? L.today()),
    heatValues = [
      ...Array.from({ length: lead }, () => null),
      ...heat.perDay.map((d) => d.done / max),
    ],
    trend =
      range === "90"
        ? s.perDay.reduce<number[]>((a, d, i) => {
            const w = Math.floor(i / 7)
            a[w] = (a[w] ?? 0) + d.done
            return a
          }, [])
        : s.perDay.map((d) => d.done)
  const stat = (
    label: string,
    value: string | number,
    color: string = t.text,
    delta?: number,
  ) => (
    <View>
      <Copy size={30} weight="displayMedium" style={{ color }}>
        {label.startsWith("Done streak") && <Flame size={20} color={t.warn} />}{" "}
        {value}
      </Copy>
      <Copy size={12} muted>
        {label}
        {delta !== undefined && delta !== 0 && (
          <Copy size={12} style={{ color: delta > 0 ? t.good : t.bad }}>
            {" "}
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </Copy>
        )}
      </Copy>
    </View>
  )
  return (
    <StatsShell
      embedded={embedded}
      title="Task stats"
      actions={
        <IconTap
          icon={Share2}
          label="Share"
          size={40}
          color={t.text}
          onPress={() => go(`/tasks/share?range=${range}`)}
        />
      }
    >
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: "7", label: "Week" },
          { value: "30", label: "Month" },
          { value: "90", label: "90 days" },
        ]}
      />
      <Frame style={{ padding: 16 }}>
        <Line style={{ gap: 16 }}>
          <View style={{ flex: 1 }}>
            <Copy size={12} muted style={{ letterSpacing: 1 }}>
              FOLLOW-THROUGH RATIO
            </Copy>
            <Copy size={48} weight="display" style={{ color: t.tsk }}>
              {s.followThrough.toFixed(1)}
            </Copy>
            <Copy size={12} muted style={{ marginTop: 4 }}>
              Tasks finished per task that slipped (late counts half)
            </Copy>
            <Copy size={11} muted style={{ marginTop: 2 }}>
              ({s.onTime} on-time + ½×{s.late} late) ÷ ({s.overdueNow} overdue +{" "}
              {s.reschedules} pushed)
            </Copy>
          </View>
          <Ring
            value={s.onTimeRate ?? 0}
            size={84}
            strokeWidth={8}
            color={t.tsk}
          >
            <Copy
              size={18}
              weight="displayMedium"
              style={{ color: (s.onTimeRate ?? 1) < 0.6 ? t.warn : t.text }}
            >
              {L.pct(s.onTimeRate)}
            </Copy>
            <Copy size={10} muted>
              on time
            </Copy>
          </Ring>
        </Line>
      </Frame>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {[
          {
            label: "Tasks done",
            value: s.done,
            color: t.tsk,
            delta: s.done - prev.done,
          },
          {
            label: "On-time rate",
            value: L.pct(s.onTimeRate),
            delta:
              Math.round((s.onTimeRate ?? 0) * 100) -
              Math.round((prev.onTimeRate ?? 0) * 100),
          },
          {
            label: `Done streak · best ${s.bestStreak}`,
            value: `${s.streak}-day`,
          },
          { label: "Clear days", value: `${s.clearDays}/${s.dueDays}` },
        ].map((x) => (
          <Frame key={x.label} style={{ width: "48%", padding: 12 }}>
            {stat(x.label, x.value, x.color ?? t.text, x.delta)}
            {x.label === "Clear days" && (
              <View style={{ marginTop: 8 }}>
                <Bar
                  value={s.dueDays ? s.clearDays / s.dueDays : 0}
                  color={t.tsk}
                />
              </View>
            )}
          </Frame>
        ))}
      </View>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Trend · {RANGE_LABEL[range]}</SectionHeading>
        <Frame style={{ padding: 16 }}>
          <TaskBars
            data={trend}
            labels={
              range === "7"
                ? s.perDay.map((d) => L.WEEKDAYS[weekday(d.day)].slice(0, 1))
                : range === "90"
                  ? trend.map((_, i) => (i % 3 === 0 ? `W${i + 1}` : ""))
                  : undefined
            }
            color={t.tsk}
          />
        </Frame>
        <SectionHeading>Honest reflection</SectionHeading>
        <Frame style={{ padding: 16, borderColor: `${t.warn}40` }}>
          <Tap onPress={() => go("/tasks?filter=overdue")}>
            <Line>
              <TriangleAlert size={20} color={t.warn} />
              <View style={{ flex: 1 }}>
                <Copy weight="medium">{s.overdueNow} overdue now</Copy>
                <Copy size={12} muted>
                  Always visible, never hidden. Tap to sort them out.
                </Copy>
              </View>
              <ChevronRight size={16} color={t.muted} />
            </Line>
          </Tap>
          <Line
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTopWidth: 1,
              borderColor: border(t.line, 0.5),
            }}
          >
            <View style={{ flex: 1 }}>
              {stat("Reschedules", s.reschedules)}
            </View>
            <View style={{ flex: 1 }}>
              {stat(
                "Avg lateness",
                s.avgLateness === null ? "—" : `${s.avgLateness.toFixed(1)}d`,
              )}
            </View>
          </Line>
          <Copy size={12} muted style={{ marginTop: 8 }}>
            {s.reschedules > 0
              ? `Pushed ${s.reschedules}× ${RANGE_LABEL[range]}. `
              : ""}
            Avg {s.avgReschedules.toFixed(2)} pushes per finished task. Lateness
            uses the original due date.
          </Copy>
          {s.topPushed.length > 0 && (
            <View style={{ marginTop: 12, gap: 6 }}>
              <Copy
                size={12}
                weight="medium"
                muted
                style={{ letterSpacing: 1 }}
              >
                MOST PUSHED
              </Copy>
              {s.topPushed.map((task) => (
                <Tap key={task.id} onPress={() => go(`/tasks/task/${task.id}`)}>
                  <Line style={{ gap: 8 }}>
                    <CalendarClock size={14} color={t.warn} />
                    <Copy size={14} lines={1} style={{ flex: 1 }}>
                      {task.title}
                    </Copy>
                    <Copy size={14} style={{ color: t.warn }}>
                      {task.rescheduleCount}×
                    </Copy>
                  </Line>
                </Tap>
              ))}
            </View>
          )}
        </Frame>
        <SectionHeading>Last 12 weeks</SectionHeading>
        <Frame style={{ padding: 16 }}>
          <Line style={{ gap: 4, alignItems: "stretch" }}>
            <View style={{ justifyContent: "space-around", width: 10 }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((v, i) => (
                <Copy key={`${v}-${i}`} size={10} muted>
                  {v}
                </Copy>
              ))}
            </View>
            {Array.from(
              { length: Math.ceil(heatValues.length / 7) },
              (_, col) => (
                <View key={`week-${col}`} style={{ flex: 1, gap: 3 }}>
                  {Array.from({ length: 7 }, (_, row) => {
                    const v = heatValues[col * 7 + row]
                    return (
                      <View
                        key={`day-${row}`}
                        style={{
                          aspectRatio: 1,
                          borderRadius: 3,
                          backgroundColor:
                            v == null
                              ? "transparent"
                              : v > 0
                                ? border(t.tsk, 0.2 + 0.8 * v)
                                : t.soft,
                        }}
                      />
                    )
                  })}
                </View>
              ),
            )}
          </Line>
          <Line style={{ marginTop: 8, justifyContent: "space-between" }}>
            <Copy size={10} muted>
              {L.fmtDate(L.addDays(L.today(), -83))}
            </Copy>
            <Copy size={10} muted>
              Today
            </Copy>
          </Line>
        </Frame>
        <SectionHeading>By list</SectionHeading>
        <Frame style={{ padding: 16, gap: 12 }}>
          {s.byList.length === 0 && (
            <Copy size={14} muted>
              Nothing done in this range.
            </Copy>
          )}
          {s.byList.map((b) => (
            <View key={b.id ?? "inbox"}>
              <Line
                style={{ justifyContent: "space-between", marginBottom: 4 }}
              >
                <Copy size={14}>{b.name}</Copy>
                <Copy size={14} muted>
                  {b.done}
                </Copy>
              </Line>
              <Bar
                value={b.done / Math.max(1, ...s.byList.map((x) => x.done))}
                color={t.tsk}
              />
            </View>
          ))}
        </Frame>
      </View>
      <Line style={{ justifyContent: "space-between", gap: 4 }}>
        <Copy size={12} muted>
          Captured by AI: {L.pct(s.captureShare)} of {s.created} new tasks
        </Copy>
        <Tap onPress={() => go("/tasks/settings")}>
          <Copy size={12} style={{ color: t.tsk }}>
            Groceries in stats?
          </Copy>
        </Tap>
      </Line>
      <Button icon={Share2} href={`/tasks/share?range=${range}`}>
        {`Share ${RANGE_LABEL[range]}`}
      </Button>
    </StatsShell>
  )
}
