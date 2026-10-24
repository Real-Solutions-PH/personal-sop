import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { Check, ShieldCheck, Utensils } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { Copy, Frame, Line } from "../native-kit"
import { fmt, pct } from "../share-format"
import {
  CardFrame,
  type CardLook,
  Chip,
  cardInk,
  type Dot,
  Dots,
  Label,
  Meter,
  Num,
  ShareComposer,
  Stats,
  Words,
} from "../share-kit"
import { useTheme } from "../theme"
import { Screen, Toggle } from "../ui"

export type FoodLayout = "day" | "week"
type Macro = "kcal" | "protein" | "carbs" | "fat"
/** One day of food against its targets, plus the week around it. */
export type FoodCardData = {
  date: string
  meals: number
  totals: Record<Macro, number>
  target: Record<Macro, number> | null
  /** The last 7 days, oldest first: on = calories within 10% of target. */
  week: Dot[]
  calorieDays: number
  proteinDays: number
  logged: number
  proteinStreak: number
  /** Grams and calories are body data: off unless the person turns it on. */
  amounts: boolean
}
const MACROS: { key: Macro; label: string; unit: string }[] = [
  { key: "kcal", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
]
export function FoodCard({
  kind,
  width,
  look,
  data: d,
}: {
  kind: FoodLayout
  width: number
  look: CardLook
  data: FoodCardData
}) {
  const c = cardInk(look),
    q = width / 100,
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    nut = c.area("nut"),
    ratio = (k: Macro) => (d.target?.[k] ? d.totals[k] / d.target[k] : null),
    proteinHit = (ratio("protein") ?? 0) >= 0.9,
    onTarget = d.week.filter((x) => x === "on").length
  const body =
    kind === "day" ? (
      <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
        <View style={{ gap: 2 * q }}>
          <Words size={9} weight="semibold">
            {d.meals === 0
              ? "Nothing logged yet"
              : proteinHit
                ? "Protein goal hit"
                : `${fmt(d.meals)} ${d.meals === 1 ? "meal" : "meals"} logged`}
          </Words>
          {d.proteinStreak > 1 && (
            <Chip icon={Check} tone={c.good}>
              {`${fmt(d.proteinStreak)} days of protein in a row`}
            </Chip>
          )}
        </View>
        <View style={{ gap: (tall ? 3.4 : 2.4) * q }}>
          {MACROS.slice(0, sq ? 2 : 4).map((m) => (
            <View key={m.key} style={{ gap: q }}>
              <Line style={{ justifyContent: "space-between", gap: 2 * q }}>
                <Label>{m.label}</Label>
                <View style={{ flexShrink: 1, maxWidth: "70%" }}>
                  <Num
                    size={4.4}
                    align="right"
                    unit={d.amounts ? m.unit : undefined}
                  >
                    {d.amounts
                      ? d.target
                        ? `${fmt(Math.round(d.totals[m.key]))} / ${fmt(Math.round(d.target[m.key]))}`
                        : fmt(Math.round(d.totals[m.key]))
                      : `${pct(ratio(m.key))} of goal`}
                  </Num>
                </View>
              </Line>
              <Meter value={ratio(m.key) ?? 0} color={nut} height={2} />
            </View>
          ))}
        </View>
        {!sq && (
          <View style={{ gap: 1.4 * q }}>
            <Label>{`Calories on target ${fmt(onTarget)} of 7 days`}</Label>
            <Dots cells={d.week} cols={7} color={nut} />
          </View>
        )}
      </View>
    ) : (
      <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
        <Words size={9} weight="semibold">
          {`${fmt(onTarget)} of 7 days on target`}
        </Words>
        <Dots cells={d.week} cols={7} color={nut} />
        <Stats
          items={[
            {
              label: "Calorie days",
              value: pct(d.logged ? d.calorieDays / d.logged : null),
            },
            {
              label: "Protein days",
              value: pct(d.logged ? d.proteinDays / d.logged : null),
            },
            ...(tall
              ? [
                  {
                    label: "Protein streak",
                    value: fmt(d.proteinStreak),
                    unit: "d",
                  },
                ]
              : []),
          ]}
          cols={tall ? 3 : 2}
          size={tall ? 7 : 8}
        />
        <Words size={3.4} muted>
          {`Rates over the ${fmt(d.logged)} logged ${d.logged === 1 ? "day" : "days"} this week.`}
        </Words>
      </View>
    )
  return (
    <CardFrame
      width={width}
      look={look}
      kicker={kind === "day" ? "Food day" : "Food week"}
      date={kind === "day" ? d.date : "Last 7 days"}
    >
      {body}
    </CardFrame>
  )
}
/** Consecutive days, ending today or yesterday, where ``hit`` holds. */
export function runOf(hits: boolean[]) {
  let i = hits.length - 1
  if (i >= 0 && !hits[i]) i -= 1
  let n = 0
  while (i >= 0 && hits[i]) {
    n += 1
    i -= 1
  }
  return n
}
export function NutritionShare() {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    [layout, setLayout] = useState<FoodLayout>("day"),
    [amounts, setAmounts] = useState(false)
  const today = dayKey(),
    week = C.nutritionDays(s, 7),
    streakDays = C.nutritionDays(s, 120),
    { totals, count } = C.dayTotals(s, today),
    target = C.targetFor(s, today),
    logged = week.filter((x) => x.meals > 0 && x.target)
  const data: FoodCardData = {
    date: new Date().toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    meals: count,
    totals,
    target: target
      ? {
          kcal: target.kcal,
          protein: target.protein,
          carbs: target.carbs,
          fat: target.fat,
        }
      : null,
    week: week.map((x) =>
      x.verdict === "hit" ? "on" : x.verdict === "none" ? "none" : "off",
    ),
    calorieDays: logged.filter((x) => x.kcalOk).length,
    proteinDays: logged.filter((x) => x.proteinHit).length,
    logged: logged.length,
    proteinStreak: runOf(streakDays.map((x) => x.proteinHit)),
    amounts,
  }
  const caption =
    layout === "day"
      ? `Food today: protein ${pct(target?.protein ? totals.protein / target.protein : null)} of goal · Unfurl`
      : `Food this week: calories on target ${data.week.filter((x) => x === "on").length} of 7 days · Unfurl`
  return (
    <Screen title="Share card">
      <ShareComposer
        value={layout}
        onChange={setLayout}
        caption={caption}
        items={(
          [
            { key: "day", label: "Food day" },
            { key: "week", label: "Food week" },
          ] as const
        ).map((item) => ({
          ...item,
          render: (width: number, look: CardLook) => (
            <FoodCard kind={item.key} width={width} look={look} data={data} />
          ),
        }))}
      >
        <Frame style={{ gap: 6, padding: 16 }}>
          <Toggle
            label="Show grams and calories"
            value={amounts}
            onChange={setAmounts}
          />
          <Copy size={12} style={{ color: t.warn }}>
            Shows what you ate in numbers. Off, the card shows percent of goal.
          </Copy>
        </Frame>
        <Line style={{ gap: 6, paddingHorizontal: 4 }}>
          <ShieldCheck size={14} color={t.muted} />
          <Copy size={12} muted style={{ flex: 1 }}>
            Meal names, photos and body weight never appear on a card.
          </Copy>
        </Line>
        <Line style={{ gap: 6, paddingHorizontal: 4 }}>
          <Utensils size={14} color={t.muted} />
          <Copy size={12} muted style={{ flex: 1 }}>
            Targets come from your nutrition settings.
          </Copy>
        </Line>
      </ShareComposer>
    </Screen>
  )
}
