import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { Text, View } from "react-native"
import { Sparkline } from "../chart"
import { border, Copy, Frame, Line, SectionHeading } from "../native-kit"
import { CardFrame, type CardLook, ShareComposer } from "../share-kit"
import { fonts, useTheme } from "../theme"
import { Empty, Screen, Toggle } from "../ui"

type Layout = "summary" | "pr" | "photo"
export function FitnessShare({ id }: { id: string }) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    p = useLocalSearchParams<{ template?: Layout; exercise?: string }>(),
    w = s.workouts.find((w) => w.id === id),
    [layout, setLayout] = useState<Layout>(p.template ?? "summary"),
    [flags, setFlags] = useState({
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
    lines = w.exercises.map((we) => {
      const ex = s.exercises.find((e) => e.id === we.exerciseId),
        stats = C.exStats(we, ex, bw)
      return {
        name: ex?.name ?? "",
        top: stats.top,
        e1rm: stats.bestE1rm,
        id: we.exerciseId,
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
    series = focusId
      ? C.exerciseHistory(s, focusId)
          .filter((h) => h.workout.startedAt <= w.startedAt)
          .map((h) => h.stats.bestE1rm)
      : [],
    week =
      C.sessionsByWeek(s, 20).find(
        (x) => x.start === C.weekStart(dayKey(new Date(w.startedAt))),
      )?.count ?? 1,
    streak = C.consistencyStreak(s),
    macros = C.dayTotals(s, dayKey(new Date(w.startedAt))).totals,
    mins = Math.round(totals.durationSec / 60),
    items = [
      {
        label: "Time",
        value:
          mins >= 60
            ? `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`
            : String(mins),
        unit: mins >= 60 ? "h" : "min",
      },
      {
        label: "Volume",
        value:
          totals.volume >= 10000
            ? (totals.volume / 1000).toFixed(1)
            : Math.round(totals.volume).toLocaleString("en-US"),
        unit: totals.volume >= 10000 ? "t" : "kg",
      },
      { label: "Sets", value: String(totals.done), unit: "" },
    ]
  function render(kind: Layout, width: number, look: CardLook) {
    const q = width / 100,
      ink = look.backdrop === "paper" ? t["share-paper-ink"] : "#ffffff",
      tall = look.format === "9:16",
      text = (s: string, size: number, display = false, color = ink) => (
        <Text
          style={{
            fontFamily: display ? fonts.displayHeavy : fonts.body,
            fontSize: size * q,
            lineHeight: size * q * (display ? 1 : 1.3),
            color,
          }}
        >
          {s}
        </Text>
      ),
      label = (s: string) => text(s.toUpperCase(), 3.2, false, `${ink}aa`),
      title = (s: string) => (
        <Text
          numberOfLines={2}
          style={{
            fontFamily: fonts.displayHeavy,
            fontSize: 11 * q,
            lineHeight: 10.12 * q,
            letterSpacing: -0.25 * q,
            color: ink,
          }}
        >
          {s.toUpperCase()}
        </Text>
      ),
      medal = (s: string) => (
        <View
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 2.4 * q,
            paddingVertical: 1.4 * q,
            borderRadius: 10 * q,
            backgroundColor: "#f4c76b",
          }}
        >
          {text(`🏆 ${s}`, 3.3, false, "#32230c")}
        </View>
      ),
      stats = (size = 12) => (
        <Line style={{ gap: 3 * q }}>
          {items.map((item) => (
            <View key={item.label} style={{ flex: 1, gap: q }}>
              {label(item.label)}
              <Line style={{ gap: q, alignItems: "baseline" }}>
                {text(item.value, size, true)}
                {text(item.unit, 3.4)}
              </Line>
            </View>
          ))}
        </Line>
      ),
      medals =
        flags.prs && prs.length > 0 ? (
          <Line style={{ gap: 1.6 * q, flexWrap: "wrap" }}>
            {prs.slice(0, 3).map((p) => (
              <View key={`${p.exerciseId}-${p.kind}`}>
                {medal(
                  `${
                    s.exercises
                      .find((e) => e.id === p.exerciseId)
                      ?.name.split(" ")
                      .slice(-1)[0]
                  } ${p.kind === "volume" ? "volume" : C.kg(Math.round(p.value * 10) / 10)}`,
                )}
              </View>
            ))}
          </Line>
        ) : null
    const body =
      kind === "pr" ? (
        <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
          <View style={{ gap: 2.5 * q }}>
            {medal(focusPr ? `${C.prLabel[focusPr.kind]} PR` : "Top lift")}
            {title(focus?.name ?? w!.name)}
          </View>
          <View>
            {label("Est. 1-rep max")}
            <Line style={{ gap: 2 * q, alignItems: "baseline" }}>
              {text(
                C.kgShort(
                  Math.round((focusPr?.value ?? focus?.e1rm ?? 0) * 10) / 10,
                ),
                34,
                true,
                t.fit,
              )}
              {text("kg", 5)}
            </Line>
            {focusPr && focusPr.value > focusPr.prev && (
              <View style={{ marginTop: 2 * q }}>
                {text(
                  `↗ ${Math.round((focusPr.value - focusPr.prev) * 10) / 10} kg vs previous best`,
                  3.4,
                  false,
                  t.good,
                )}
              </View>
            )}
          </View>
          {series.length > 1 && (
            <View>
              <Sparkline
                values={series}
                color={t.fit}
                height={(tall ? 26 : 16) * q}
                label="Strength progression"
              />
              {label(`Last ${series.length} sessions`)}
            </View>
          )}
          {tall && stats(10)}
        </View>
      ) : kind === "photo" ? (
        <View style={{ flex: 1, justifyContent: "flex-end", gap: 4 * q }}>
          {look.backdrop === "photo" && !look.photo && (
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              {text("Add your gym photo", 3.6)}
            </View>
          )}
          {title(w!.name)}
          {stats(11)}
          {medals}
        </View>
      ) : (
        <View style={{ flex: 1, justifyContent: "center", gap: 4.5 * q }}>
          <View style={{ gap: 2 * q }}>
            {title(w!.name)}
            {prs.length > 0 &&
              medal(
                `${prs.length} personal record${prs.length > 1 ? "s" : ""}`,
              )}
          </View>
          {stats()}
          {flags.exercises && (
            <View
              style={{
                borderTopWidth: 1,
                borderColor: `${ink}26`,
                paddingTop: 3 * q,
                gap: 1.8 * q,
              }}
            >
              {lines.slice(0, tall ? 5 : 3).map((l) => (
                <Line key={l.id} style={{ gap: 3 * q, alignItems: "baseline" }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      fontFamily: fonts.body,
                      fontSize: 3.8 * q,
                      color: ink,
                    }}
                  >
                    {l.name}
                  </Text>
                  {text(
                    l.top ? `${C.kgShort(l.top.weight)} × ${l.top.reps}` : "",
                    4.4,
                    true,
                  )}
                </Line>
              ))}
              {lines.length > (tall ? 5 : 3) &&
                text(`+${lines.length - (tall ? 5 : 3)} more`, 3.2)}
            </View>
          )}
          {tall && medals}
          {flags.week && (
            <View>
              <Line
                style={{
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                {label("This week")}
                {text(`${week}/${s.settings.weeklyTarget}`, 4.4, true)}
              </Line>
              <Line style={{ marginTop: 1.2 * q, gap: 1.2 * q }}>
                {Array.from(
                  { length: Math.max(week, s.settings.weeklyTarget) },
                  (_, i) => (
                    <View
                      key={`week-${i}`}
                      style={{
                        flex: 1,
                        height: 1.8 * q,
                        borderRadius: q,
                        backgroundColor: i < week ? t.fit : "#ffffff24",
                      }}
                    />
                  ),
                )}
              </Line>
            </View>
          )}
        </View>
      )
    return (
      <CardFrame
        width={width}
        look={look}
        accent="fit"
        kicker="Workout"
        date={new Date(w!.startedAt).toLocaleDateString("en-PH", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })}
        foot={
          <>
            {streak > 0 && text(`${streak}-week streak`, 3.2)}
            {flags.bodyweight && bw > 0 && text(`Bodyweight ${C.kg(bw)}`, 3.2)}
            {flags.macros &&
              text(
                `${Math.round(macros.kcal)} kcal · P${Math.round(macros.protein)}g today`,
                3.2,
              )}
          </>
        }
      >
        {body}
      </CardFrame>
    )
  }
  return (
    <Screen title="Share workout">
      <ShareComposer
        value={layout}
        onChange={setLayout}
        accent="fit"
        caption={`${w.name} · ${C.fmtMin(totals.durationSec)} · ${C.fmtVolume(totals.volume)}${prs.length ? ` · ${prs.length} PR` : ""}`}
        items={(
          [
            { key: "summary", label: "Summary" },
            { key: "pr", label: "PR highlight" },
            { key: "photo", label: "Overlay" },
          ] as const
        ).map((item) => ({
          ...item,
          render: (width: number, look: CardLook) =>
            render(item.key, width, look),
        }))}
      >
        <View style={{ marginTop: -12 }}>
          <SectionHeading>Show on card</SectionHeading>
          <Frame style={{ paddingHorizontal: 16 }}>
            {(
              [
                { key: "exercises", label: "Exercise list" },
                { key: "prs", label: "PR badges" },
                { key: "week", label: "Week tally & streak" },
                { key: "bodyweight", label: "Bodyweight" },
                { key: "macros", label: "Today’s macros" },
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
          Money never appears on share cards.
        </Copy>
      </ShareComposer>
    </Screen>
  )
}
