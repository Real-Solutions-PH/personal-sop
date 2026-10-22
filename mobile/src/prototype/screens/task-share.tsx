import { weekday } from "@domain/lib/day"
import { useStats } from "@domain/tasks/hooks"
import * as L from "@domain/tasks/logic"
import { useLocalSearchParams } from "expo-router"
import { Flame, ShieldCheck } from "lucide-react-native"
import { useState } from "react"
import { Text, View } from "react-native"
import { Copy, Line, SectionHeading, Segmented } from "../native-kit"
import { CardFrame, type CardLook, ShareComposer } from "../share-kit"
import { fonts, useTheme } from "../theme"
import { Screen } from "../ui"
import { Ring } from "../visual"
import { TaskChip } from "./task-find"
import { RANGE_LABEL } from "./task-stats"

type Layout = "summary" | "streak" | "followThrough"
export function TaskShare() {
  const p = useLocalSearchParams<{ range?: string }>(),
    [range, setRange] = useState(
      ["7", "30", "90"].includes(p.range ?? "") ? p.range! : "7",
    ),
    [layout, setLayout] = useState<Layout>("summary"),
    s = useStats(Number(range)),
    prev = useStats(Number(range), Number(range)),
    t = useTheme(),
    [on, setOn] = useState<Record<string, boolean>>({
      done: true,
      onTime: true,
      streak: true,
      clear: false,
      followThrough: false,
    }),
    metrics = [
      { key: "done", label: "Done", value: String(s.done) },
      { key: "onTime", label: "On time", value: L.pct(s.onTimeRate) },
      { key: "streak", label: "Day streak", value: String(s.streak) },
      {
        key: "clear",
        label: "Clear days",
        value: `${s.clearDays}/${s.dueDays}`,
      },
      {
        key: "followThrough",
        label: "Follow-through",
        value: s.followThrough.toFixed(1),
      },
    ],
    shown = metrics.filter((m) => on[m.key]),
    caption = `Tasks ${RANGE_LABEL[range]}: ${shown.map((m) => `${m.value} ${m.label.toLowerCase()}`).join(" · ")} · Unfurl`
  const render = (kind: Layout, width: number, look: CardLook) => {
    const q = width / 100,
      tall = look.format === "9:16",
      ink = look.backdrop === "paper" ? t["share-paper-ink"] : "#fff",
      panel = look.backdrop === "paper" ? "#0000000d" : "#ffffff17",
      text = (value: string, size: number, display = false, color = ink) => (
        <Text
          style={{
            fontFamily: display ? fonts.displayHeavy : fonts.semibold,
            fontSize: size * q,
            lineHeight: size * q * (display ? 1 : 1.3),
            color,
          }}
        >
          {value}
        </Text>
      ),
      label = (value: string) =>
        text(value.toUpperCase(), 3, false, `${ink}a6`),
      medal = (value: string) => (
        <View
          style={{
            paddingHorizontal: 2.5 * q,
            paddingVertical: 1.5 * q,
            borderRadius: 10 * q,
            backgroundColor: panel,
          }}
        >
          {text(value, 3)}
        </View>
      ),
      grid = (items: { label: string; value: string }[]) => (
        <Line
          style={{
            backgroundColor: panel,
            padding: 3 * q,
            borderRadius: 3 * q,
            gap: 3 * q,
          }}
        >
          {items.map((m) => (
            <View key={m.label} style={{ flex: 1, gap: q }}>
              {text(m.value, 7, true)}
              {label(m.label)}
            </View>
          ))}
        </Line>
      ),
      bars =
        range === "7"
          ? s.perDay.map((d) => d.done)
          : s.perDay.reduce<number[]>((a, d, i) => {
              const w = Math.floor(i / 7)
              a[w] = (a[w] ?? 0) + d.done
              return a
            }, []),
      ratio = Math.min(1, s.followThrough / 3),
      verdict = (v: number | null) =>
        v === null
          ? "Building momentum"
          : v >= 0.85
            ? "On fire"
            : v >= 0.65
              ? "Solid work"
              : v >= 0.4
                ? "Keep going"
                : "Fresh start"
    let body: React.ReactNode
    if (kind === "summary")
      body = (
        <View style={{ flex: 1, justifyContent: "center", gap: 5 * q }}>
          <View style={{ gap: 2 * q }}>
            {text(RANGE_LABEL[range].toUpperCase(), 9, true)}
            <Line style={{ gap: 1.6 * q, flexWrap: "wrap" }}>
              {medal(`🔥 ${verdict(s.onTimeRate)}`)}
              {s.streak > 0 &&
                s.streak >= s.bestStreak &&
                medal("🏆 Best streak")}
            </Line>
          </View>
          <Line style={{ gap: 5 * q }}>
            <View style={{ flex: 1, gap: 1.5 * q }}>
              {label("Tasks done")}
              {text(String(s.done), 30, true, t.tsk)}
              {prev.done > 0 &&
                s.done !== prev.done &&
                text(
                  `${s.done > prev.done ? "▲" : "▼"} ${Math.abs(s.done - prev.done)} vs last`,
                  3,
                  false,
                  s.done > prev.done ? t.good : t.bad,
                )}
            </View>
            <Ring
              value={s.onTimeRate ?? 0}
              size={34 * q}
              gradientColors={[t.hab, t.tsk]}
              hero
            >
              {text(L.pct(s.onTimeRate), 9, true)}
              {label("on time")}
            </Ring>
          </Line>
          {look.format !== "1:1" && (
            <Line style={{ gap: q, alignItems: "flex-end" }}>
              {bars.map((n, i) => (
                <View key={`bar-${i}`} style={{ flex: 1, gap: q }}>
                  <View
                    style={{
                      height: (tall ? 18 : 12) * q,
                      justifyContent: "flex-end",
                    }}
                  >
                    <View
                      style={{
                        height: Math.max(
                          q,
                          (n / Math.max(1, ...bars)) * (tall ? 18 : 12) * q,
                        ),
                        backgroundColor: t.tsk,
                        borderTopLeftRadius: q,
                        borderTopRightRadius: q,
                      }}
                    />
                  </View>
                  {range === "7" &&
                    text(L.WEEKDAYS[weekday(s.perDay[i].day)].slice(0, 1), 2.4)}
                </View>
              ))}
            </Line>
          )}
          {grid(shown.filter((m) => m.key !== "done"))}
        </View>
      )
    else if (kind === "streak")
      body = (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Ring
            value={s.bestStreak ? s.streak / s.bestStreak : 0}
            size={(tall ? 62 : 46) * q}
            gradientColors={[t.hab, t.tsk]}
            hero
          >
            <Flame size={9 * q} color={t.tsk} fill={t.tsk} />
            {text(String(s.streak), tall ? 26 : 20, true)}
          </Ring>
          <View style={{ marginTop: 4 * q }}>
            {text("DAY STREAK", 7, true)}
          </View>
          <View style={{ marginTop: 1.5 * q }}>
            {label("Getting things done, every day")}
          </View>
          <View style={{ marginTop: 4 * q }}>
            {medal(
              s.streak >= s.bestStreak && s.streak > 0
                ? "🏆 Personal best"
                : `Best ${s.bestStreak} days`,
            )}
          </View>
        </View>
      )
    else
      body = (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 3 * q,
          }}
        >
          {label("Follow-through ratio")}
          <Ring
            value={ratio}
            size={(tall ? 60 : 44) * q}
            gradientColors={[t.hab, t.tsk]}
            hero
          >
            {text(s.followThrough.toFixed(1), tall ? 24 : 18, true)}
            {label("× per slip")}
          </Ring>
          {medal(`🔥 ${verdict(ratio)}`)}
          <Text
            style={{
              color: ink,
              opacity: 0.8,
              fontFamily: fonts.body,
              fontSize: 3.4 * q,
              textAlign: "center",
              maxWidth: "80%",
            }}
          >
            Tasks finished for every one that slipped (late counts half).
          </Text>
          {tall && (
            <View style={{ marginTop: 2 * q, width: "100%" }}>
              {grid([
                { label: "Done", value: String(s.done) },
                { label: "On time", value: L.pct(s.onTimeRate) },
                { label: "Streak", value: `${s.streak}d` },
              ])}
            </View>
          )}
        </View>
      )
    return (
      <CardFrame
        width={width}
        look={look}
        accent="tsk"
        kicker="Tasks"
        date={`${L.fmtDate(s.from)} – ${L.fmtDate(s.to)}`}
        foot="Percentages & streaks only"
      >
        {body}
      </CardFrame>
    )
  }
  return (
    <Screen title="Share card">
      <ShareComposer
        value={layout}
        onChange={setLayout}
        accent="tsk"
        caption={caption}
        items={(["summary", "streak", "followThrough"] as const).map((key) => ({
          key,
          label: {
            summary: "Summary",
            streak: "Streak",
            followThrough: "Follow-through",
          }[key],
          render: (width, look) => render(key, width, look),
        }))}
      >
        <SectionHeading>Range</SectionHeading>
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: "7", label: "Week" },
            { value: "30", label: "Month" },
            { value: "90", label: "90 days" },
          ]}
        />
        {layout === "summary" && (
          <>
            <SectionHeading>Show</SectionHeading>
            <Line style={{ flexWrap: "wrap", gap: 8 }}>
              {metrics.map((m) => (
                <TaskChip
                  key={m.key}
                  label={m.label}
                  active={on[m.key]}
                  onPress={() => setOn({ ...on, [m.key]: !on[m.key] })}
                />
              ))}
            </Line>
          </>
        )}
        <Line style={{ marginTop: 16, gap: 6 }}>
          <ShieldCheck size={14} color={t.muted} />
          <Copy size={12} muted>
            Task titles never appear on a card.
          </Copy>
        </Line>
      </ShareComposer>
    </Screen>
  )
}
