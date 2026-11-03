import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { ShieldCheck, Utensils } from "lucide-react-native"
import { useState } from "react"
import { Copy, Frame, Line } from "../native-kit"
import { fmt, pct } from "../share-format"
import {
  Body,
  CardFrame,
  type CardLook,
  Change,
  cardInk,
  Figures,
  Hero,
  Meters,
  ShareComposer,
  Stems,
  Sub,
  Title,
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
  /** The last 7 days, oldest first: hit = calories within 10% of target;
   * ``kcal`` is that day's calories as a share of its target. */
  week: {
    day: string
    verdict: "hit" | "over" | "under" | "none"
    kcal: number | null
  }[]
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
const initial = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
  })
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
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    nut = c.area("nut"),
    ratio = (k: Macro) => (d.target?.[k] ? d.totals[k] / d.target[k] : null),
    protein = ratio("protein"),
    proteinHit = (protein ?? 0) >= 0.9,
    onTarget = d.week.filter((x) => x.verdict === "hit").length
  if (kind === "day") {
    const rows = MACROS.filter((m) => m.key !== "protein")
        .slice(0, sq ? 2 : 3)
        .map((m) => {
          const r = ratio(m.key),
            over = (r ?? 0) > 1.1
          return {
            name: m.label,
            // Past the goal the line is full and the tick shows where the goal
            // sat on it.
            value: r ?? 0,
            mark: r && r > 1 ? 1 / r : undefined,
            color: over ? c.bad : nut,
            bad: over,
            label: d.amounts
              ? d.target
                ? `${fmt(Math.round(d.totals[m.key]))} / ${fmt(Math.round(d.target[m.key]))} ${m.unit}`
                : `${fmt(Math.round(d.totals[m.key]))} ${m.unit}`
              : `${pct(r)} of goal`,
          }
        }),
      kcal = ratio("kcal"),
      kcalOff =
        kcal !== null && d.meals > 0 && Math.abs(kcal - 1) > 0.1
          ? kcal > 1
            ? `Calories ${fmt(Math.round((kcal - 1) * 100), 5)}% over goal`
            : `Calories ${fmt(Math.round((1 - kcal) * 100), 5)}% short of goal`
          : null
    return (
      <CardFrame width={width} look={look} accent="nut" date={d.date}>
        <Title>
          {d.meals === 0
            ? "Nothing logged yet"
            : proteinHit
              ? "Protein goal hit"
              : `${fmt(d.meals)} ${d.meals === 1 ? "meal" : "meals"} logged`}
        </Title>
        {d.amounts && d.target ? (
          <Hero
            value={fmt(Math.round(d.totals.protein))}
            unit={`of ${fmt(Math.round(d.target.protein))} g protein`}
            small
            delta={
              proteinHit ? (
                d.proteinStreak > 1 ? (
                  <Change good>{`${fmt(d.proteinStreak)} days running`}</Change>
                ) : undefined
              ) : (
                <Change good={false}>
                  {`${fmt(Math.round(d.target.protein - d.totals.protein))} g short`}
                </Change>
              )
            }
          />
        ) : (
          <Hero
            value={protein === null ? "—" : fmt(Math.round(protein * 100), 5)}
            unit="% of protein goal"
            small
            delta={
              protein === null ? undefined : proteinHit ? (
                d.proteinStreak > 1 ? (
                  <Change good>{`${fmt(d.proteinStreak)} days running`}</Change>
                ) : undefined
              ) : (
                <Change good={false}>
                  {`${fmt(Math.round((1 - protein) * 100), 5)}% short`}
                </Change>
              )
            }
          />
        )}
        {kcalOff ? (
          <Sub bad>{kcalOff}</Sub>
        ) : (
          <Sub>{`Calories on target ${fmt(onTarget)} of 7 days`}</Sub>
        )}
        <Body end>
          <Meters rows={rows} />
        </Body>
      </CardFrame>
    )
  }
  const over = d.week.filter((x) => x.verdict === "over"),
    none = d.week.filter((x) => x.verdict === "none"),
    low = onTarget < 4,
    missLine = [
      over.length
        ? `Over on ${over.map((x) => initial(x.day)).join(", ")}`
        : "",
      none.length ? `${none.length} not logged` : "",
    ]
      .filter(Boolean)
      .join(" · ")
  return (
    <CardFrame width={width} look={look} accent="nut" date="Last 7 days">
      <Hero
        value={fmt(onTarget)}
        unit="of 7 days on target"
        small
        delta={
          low ? (
            <Change good={false}>{`${fmt(7 - onTarget)} off target`}</Change>
          ) : undefined
        }
      />
      {missLine ? <Sub bad={low}>{missLine}</Sub> : null}
      <Body end>
        <Stems
          values={d.week.map((x) =>
            x.verdict === "none" ? null : Math.round((x.kcal ?? 0) * 100),
          )}
          labels={d.week.map((x) => initial(x.day).slice(0, 1))}
          on={d.week.length - 1}
          goal={100}
          leaf={(_, i) => d.week[i]?.verdict === "hit"}
          missed={(_, i) => d.week[i]?.verdict === "over"}
          format={(v) => `${fmt(v, 5)}%`}
          height={tall ? 140 : sq ? 80 : 108}
          color={nut}
          label="Calories by day, as a share of the goal"
        />
      </Body>
      <Figures
        items={[
          {
            label: `Calorie days, of ${fmt(d.logged)} logged`,
            value: pct(d.logged ? d.calorieDays / d.logged : null),
          },
          {
            label: `Protein days, of ${fmt(d.logged)} logged`,
            value: pct(d.logged ? d.proteinDays / d.logged : null),
          },
          {
            label: "Protein streak",
            value: fmt(d.proteinStreak),
            unit: "days",
          },
        ]}
      />
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
    target = C.budgetFor(s, today),
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
    week: week.map((x) => ({
      day: x.day,
      verdict: x.verdict,
      kcal: x.target?.kcal ? x.totals.kcal / x.target.kcal : null,
    })),
    calorieDays: logged.filter((x) => x.kcalOk).length,
    proteinDays: logged.filter((x) => x.proteinHit).length,
    logged: logged.length,
    proteinStreak: runOf(streakDays.map((x) => x.proteinHit)),
    amounts,
  }
  const caption =
    layout === "day"
      ? `Food today: protein ${pct(target?.protein ? totals.protein / target.protein : null)} of goal · Unfurl`
      : `Food this week: calories on target ${data.week.filter((x) => x.verdict === "hit").length} of 7 days · Unfurl`
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
