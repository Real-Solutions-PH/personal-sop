// The Nutrition page's statistics: how the last 7, 14 or 30 closed days
// went (calories and protein against target, average intake, days logged),
// where the calories came from day by day, the average split against the
// split the targets ask for, each macro's grams a day against its target
// (its line on the same chart), and the nutrient limits on average. Today
// is still open, so it is left out, as the Life Score leaves it out.
import * as C from "@domain/fitness/calc"
import {
  dayDetail,
  fiberGoalFor,
  limitAverages,
  limitsFor,
} from "@domain/fitness/limits"
import { fitStore } from "@domain/fitness/store"
import { openCapture } from "@domain/lib/capture"
import { dayKey } from "@domain/lib/day"
import { BookOpen, Camera, History, Target } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { Copy, Frame, Line, LinkRow, Segmented } from "../native-kit"
import { useTheme } from "../theme"
import { LockedPreview } from "./locked-preview"
import { LimitList } from "./nutrient-limits"
import { StatsShell } from "./stats-shell"

type Range = "7" | "14" | "30"
const CHART = 120
const MACROS = [
  // Energy per gram, and the colours the macro rings use.
  { key: "protein", label: "Protein", kcal: 4, accent: "fit" },
  { key: "carbs", label: "Carbs", kcal: 4, accent: "tsk" },
  { key: "fat", label: "Fat", kcal: 9, accent: "life" },
] as const
const n = (v: number) => Math.round(v).toLocaleString("en-US")
const pct = (v: number) => `${Math.round(v * 100)}%`
const signed = (v: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : "±"}${n(Math.abs(v))}`

export function NutritionStats() {
  const t = useTheme(),
    s = fitStore.use((s) => s),
    [range, setRange] = useState<Range>("14"),
    days = Number(range),
    cur = C.adherence(s, days),
    prev = C.adherence(s, days, days),
    eaten = (a: typeof cur) => a.days.filter((d) => d.meals > 0),
    avg = (a: typeof cur, pick: (d: (typeof a.days)[number]) => number) => {
      const list = eaten(a)
      return list.length
        ? list.reduce((sum, d) => sum + pick(d), 0) / list.length
        : null
    },
    kcal = avg(cur, (d) => d.totals.kcal),
    kcalPrev = avg(prev, (d) => d.totals.kcal),
    logged = eaten(cur).length,
    target = C.budgetFor(s, dayKey()),
    // Averages are held against the limits in force today.
    dayLimits = limitsFor(target),
    limits = limitAverages(
      cur.days.map((d) => C.mealsOn(s, d.day)).filter((m) => m.length),
      dayLimits,
    ),
    fiberDays = cur.days
      .map((d) => dayDetail(C.mealsOn(s, d.day)).fiber)
      .filter((v): v is number => v !== undefined),
    fiber = fiberDays.length
      ? fiberDays.reduce((a, v) => a + v, 0) / fiberDays.length
      : null,
    split = MACROS.map((m) => ({
      ...m,
      kcal: (avg(cur, (d) => d.totals[m.key]) ?? 0) * m.kcal,
    })),
    splitTotal = split.reduce((a, m) => a + m.kcal, 0),
    top = Math.max(
      1,
      target?.kcal ?? 0,
      target ? MACROS.reduce((a, m) => a + target[m.key] * m.kcal, 0) : 0,
      ...cur.days.map((d) =>
        MACROS.reduce((a, m) => a + d.totals[m.key] * m.kcal, 0),
      ),
    ),
    every = range === "7" ? 1 : range === "14" ? 2 : 5,
    fiberGoal = target ? fiberGoalFor(target) : 0,
    targetTotal = target
      ? MACROS.reduce((a, m) => a + target[m.key] * m.kcal, 0)
      : 0,
    // Where each macro's target ends on the stacked bars, in kcal. Drawn
    // only when the macro targets roughly make the calorie target (within
    // 5%), so the top line is the calorie target as well.
    stacked =
      target &&
      targetTotal > 0 &&
      Math.abs(targetTotal - target.kcal) <= target.kcal * 0.05
        ? MACROS.map((m, i) => ({
            ...m,
            at: MACROS.slice(0, i + 1).reduce(
              (a, x) => a + target[x.key] * x.kcal,
              0,
            ),
          }))
        : [],
    ate = eaten(cur),
    // "avg 105 / 140 g · hit on 1 of 2 days": protein counts as hit at 90%
    // or more, as the hit-rate tile does; carbs and fat count when within
    // 10% either way.
    gramsLine = (key: Macro["key"]) => {
      const goal = target?.[key] ?? 0
      const a = avg(cur, (d) => d.totals[key])
      const hit = ate.filter((d) =>
        key === "protein"
          ? d.totals[key] >= goal * 0.9
          : Math.abs(d.totals[key] - goal) <= goal * 0.1,
      ).length
      return `avg ${a === null ? "—" : n(a)}${goal ? ` / ${n(goal)}` : ""} g${
        goal && ate.length
          ? ` · ${key === "protein" ? "hit" : "within 10%"} on ${n(hit)} of ${n(ate.length)} days`
          : ""
      }`
    }
  const tiles = [
    {
      label: "Calories on target",
      value: pct(cur.calorie),
      detail: cur.logged
        ? `${Math.round(cur.calorie * cur.logged)} of ${cur.logged} days`
        : "No target days",
    },
    {
      label: "Protein hit rate",
      value: pct(cur.protein),
      detail: target ? `Target ${n(target.protein)} g a day` : "No target set",
    },
    {
      label: "Average calories",
      value: kcal === null ? "—" : n(kcal),
      unit: "kcal",
      detail:
        kcal !== null && kcalPrev !== null
          ? `${signed(kcal - kcalPrev)} vs previous ${range} days`
          : `Days with meals, last ${range}`,
    },
    {
      label: "Days logged",
      value: String(logged),
      unit: `/ ${days}`,
      detail:
        fiber === null
          ? "Meals on the day"
          : fiberGoal
            ? `Fibre ${n(fiber)} of ${n(fiberGoal)} g a day`
            : `Fibre ${n(fiber)} g a day`,
    },
  ]
  return (
    <StatsShell
      embedded
      title="Nutrition stats"
      heading="Stats"
      actions={
        <View style={{ width: 150 }}>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "7d" },
              { value: "14", label: "14d" },
              { value: "30", label: "30d" },
            ]}
          />
        </View>
      }
    >
      <LockedPreview
        locked={!logged}
        title="Your nutrition stats start here"
        detail="Log meals for a few days and this shows calories and protein against your targets, where your calories come from, and your sodium and sugar on average."
        action={{
          label: "Snap a meal",
          onPress: () => openCapture({ mode: "photo", hint: "meal" }),
        }}
        color={t.nut}
        icon={Camera}
        gap={16}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {tiles.map((x) => (
            <Frame
              key={x.label}
              style={{ padding: 16, width: "48.5%", flexGrow: 1, gap: 2 }}
            >
              <Copy size={12} muted>
                {x.label}
              </Copy>
              <Line style={{ gap: 4, alignItems: "baseline" }}>
                <Copy size={26} weight="displayMedium">
                  {x.value}
                </Copy>
                {x.unit && (
                  <Copy size={12} muted>
                    {x.unit}
                  </Copy>
                )}
              </Line>
              <Copy size={11} muted lines={2}>
                {x.detail}
              </Copy>
            </Frame>
          ))}
        </View>
        <Frame style={{ padding: 16, gap: 12 }}>
          <View style={{ gap: 2 }}>
            <Copy size={12} muted style={{ letterSpacing: 1 }}>
              CALORIES BY MACRO
            </Copy>
            <Copy size={12} muted>
              {target
                ? `Each bar is a day. The coloured lines are each macro's target, stacked to ${n(target.kcal)} kcal`
                : "Each bar is a day, split by where the calories came from"}
            </Copy>
          </View>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Calories by macro, last ${range} days: average ${kcal === null ? "not logged" : `${n(kcal)} kcal`}${target ? `; targets ${MACROS.map((m) => `${m.label.toLowerCase()} ${n(target[m.key])} g`).join(", ")}` : ""}`}
            style={{ height: CHART, justifyContent: "flex-end" }}
          >
            <Line
              style={{ alignItems: "flex-end", gap: range === "30" ? 2 : 4 }}
            >
              {cur.days.map((d, i) => {
                const parts = MACROS.map((m) => ({
                  ...m,
                  kcal: d.totals[m.key] * m.kcal,
                }))
                const total = parts.reduce((a, p) => a + p.kcal, 0)
                return (
                  <View
                    key={d.day}
                    style={{
                      flex: 1,
                      height: CHART,
                      justifyContent: "flex-end",
                    }}
                  >
                    {total ? (
                      <View
                        style={{
                          // A fixed height split by flex: each segment's
                          // share of the day's calories.
                          height: Math.max(3, (total / top) * CHART),
                          borderTopLeftRadius: 4,
                          borderTopRightRadius: 4,
                          overflow: "hidden",
                          flexDirection: "column-reverse",
                          // The latest closed day at full strength.
                          opacity: i === cur.days.length - 1 ? 1 : 0.7,
                        }}
                      >
                        {parts.map((p) => (
                          <View
                            key={p.key}
                            style={{
                              flex: p.kcal,
                              backgroundColor: t[p.accent],
                            }}
                          />
                        ))}
                      </View>
                    ) : (
                      <View
                        style={{
                          height: 3,
                          borderRadius: 2,
                          backgroundColor: t.line,
                        }}
                      />
                    )}
                  </View>
                )
              })}
            </Line>
            {/* The targets stacked as the bars are: protein's line where
                its target calories end, carbs' above it, fat's at the top.
                A segment reaching its own line is that macro on target.
                Each line sits on a sliver of card colour, so it stays
                visible where it crosses a bar of its own colour. */}
            {stacked.map((m) => (
              <View
                key={m.key}
                testID={`macro-target-${m.key}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: (m.at / top) * CHART - 2,
                  height: 4,
                  justifyContent: "center",
                  backgroundColor: t.card,
                }}
              >
                <View style={{ height: 2, backgroundColor: t[m.accent] }} />
              </View>
            ))}
            {/* A calorie target the macro targets don't add up to keeps
                its own dashed line. */}
            {target && !stacked.length && (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: (target.kcal / top) * CHART,
                  borderTopWidth: 1,
                  borderStyle: "dashed",
                  borderColor: t.good,
                }}
              />
            )}
          </View>
          <Line style={{ gap: range === "30" ? 2 : 4, marginTop: -4 }}>
            {cur.days.map((d, i) => (
              <Copy
                key={d.day}
                size={10}
                muted
                style={{ flex: 1, textAlign: "center" }}
              >
                {(cur.days.length - 1 - i) % every
                  ? ""
                  : Number(d.day.slice(8))}
              </Copy>
            ))}
          </Line>
          {/* One row per macro: its share of the calories, then its grams a
              day against its target, so the lines above read as numbers. */}
          <View style={{ gap: 6 }}>
            {split.map((m) => (
              <Line key={m.key} style={{ gap: 8 }}>
                <View
                  style={{
                    width: 12,
                    height: 2,
                    borderRadius: 1,
                    backgroundColor: t[m.accent],
                  }}
                />
                <Copy size={12} style={{ width: 52 }}>
                  {m.label}
                </Copy>
                <Copy size={12} muted style={{ width: 34 }}>
                  {splitTotal ? pct(m.kcal / splitTotal) : "—"}
                </Copy>
                <Copy size={12} muted style={{ flex: 1, textAlign: "right" }}>
                  {gramsLine(m.key)}
                </Copy>
              </Line>
            ))}
          </View>
          {/* What was eaten over the range, over the split the targets ask
              for: two full-width bars, so each share reads against its own
              target without adding segments up. */}
          <SplitBar
            label="Eaten"
            parts={split.map((m) => ({
              ...m,
              share: splitTotal ? m.kcal / splitTotal : 0,
            }))}
          />
          {target && targetTotal > 0 && (
            <SplitBar
              label="Target"
              parts={MACROS.map((m) => ({
                ...m,
                share: (target[m.key] * m.kcal) / targetTotal,
              }))}
            />
          )}
        </Frame>
        {/* The daily average over the range picked above. */}
        <Frame style={{ padding: 16 }}>
          <LimitList
            scope="average"
            detail={limits.avg}
            limits={dayLimits}
            overDays={limits.over}
          />
        </Frame>
      </LockedPreview>
      <Frame style={{ padding: 4 }}>
        <LinkRow
          title="Meal history"
          detail="Every day against your targets"
          icon={History}
          accent="nut"
          href="/nutrition/history"
        />
        <LinkRow
          title="Food library"
          detail="Foods Fern has saved from labels and what you said"
          icon={BookOpen}
          accent="nut"
          href="/nutrition/foods"
        />
        <LinkRow
          title="Targets"
          detail={
            target
              ? `${n(target.kcal)} kcal · ${n(target.protein)} g protein`
              : "Set calories, protein and limits"
          }
          icon={Target}
          accent="nut"
          href="/nutrition/targets"
        />
      </Frame>
    </StatsShell>
  )
}

type Macro = (typeof MACROS)[number]

function SplitBar({
  label,
  parts,
}: {
  label: string
  parts: (Pick<Macro, "key" | "label" | "accent"> & { share: number })[]
}) {
  const t = useTheme()
  const any = parts.some((p) => p.share > 0)
  return (
    <Line style={{ gap: 8 }}>
      <Copy size={11} muted style={{ width: 44 }}>
        {label}
      </Copy>
      <View
        accessible
        accessibilityLabel={`${label} split: ${parts.map((p) => `${p.label} ${any ? pct(p.share) : "none"}`).join(", ")}`}
        style={{
          flex: 1,
          flexDirection: "row",
          height: 10,
          borderRadius: 5,
          overflow: "hidden",
          backgroundColor: t.soft,
        }}
      >
        {parts.map((p) => (
          <View
            key={p.key}
            style={{ flex: p.share, backgroundColor: t[p.accent] }}
          />
        ))}
      </View>
    </Line>
  )
}
