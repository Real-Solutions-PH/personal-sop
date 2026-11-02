// Under the day's rings, the two answers the Nutrition page is opened for:
// which foods gave the most of a nutrient (sugar and saturated fat first,
// so the foods to swap are named), and which meals gave the most protein
// for their calories (the meals worth repeating). Both read the day on
// screen, or the 7 or 30 days ending on it. The numbers are counted from
// the logged items in `nutrient-insights`; nothing here is estimated.
import * as C from "@domain/fitness/calc"
import type { Meal } from "@domain/fitness/data"
import {
  fiberGoalFor,
  type LIMIT_LABEL,
  limitLevel,
  limitsFor,
} from "@domain/fitness/limits"
import { fitStore } from "@domain/fitness/store"
import { openCapture } from "@domain/lib/capture"
import { BarChart3, Info } from "lucide-react-native"
import { useState } from "react"
import { Text, View } from "react-native"
import { mealName } from "../meal-breakdown"
import { border, Copy, Frame, Line, Segmented, Tap } from "../native-kit"
import { go } from "../navigation"
import {
  bestMeals,
  MIN_MEAL_KCAL,
  NUTRIENTS,
  type NutrientKey,
  topFoods,
} from "../nutrient-insights"
import { useTheme } from "../theme"
import { Choices } from "../ui"
import { LockedPreview } from "./locked-preview"

type Range = "1" | "7" | "30"
const SHOWN = 5

const NUTRIENT: Record<NutrientKey, { label: string; unit: string }> = {
  sugar: { label: "Sugar", unit: "g" },
  satFat: { label: "Sat fat", unit: "g" },
  sodium: { label: "Sodium", unit: "mg" },
  protein: { label: "Protein", unit: "g" },
  fiber: { label: "Fiber", unit: "g" },
  carbs: { label: "Carbs", unit: "g" },
  fat: { label: "Fat", unit: "g" },
  kcal: { label: "Calories", unit: "kcal" },
}
const LIMITS = new Set<NutrientKey>(["sugar", "satFat", "sodium"])
const MACRO_KEYS = ["protein", "carbs", "fat", "kcal"] as const

/** Whole numbers from 10 up, one decimal under it, grouped by thousands. */
const amt = (v: number) =>
  v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 })
/** A share that rounds to nothing still says it is there. */
const pct = (v: number) =>
  v > 0 && v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`
const withUnit = (v: number, unit: string) =>
  `${amt(v)}${unit === "kcal" ? " kcal" : ` ${unit}`}`

/** Days ending on ``day``, newest last. */
const daysEnding = (day: string, n: number) =>
  Array.from({ length: n }, (_, i) => C.addDays(day, i - n + 1))

// Shown dimmed, never as numbers, while the range has no meals yet.
const sampleItem = (name: string, m: Partial<Meal["items"][number]>) => ({
  id: name,
  name,
  qty: 1,
  unit: "serving",
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  ...m,
})
const SAMPLE: Meal[] = [
  [
    "breakfast",
    "07:30",
    [
      sampleItem("Iced coffee", {
        kcal: 180,
        protein: 4,
        carbs: 32,
        fat: 4,
        sugar: 28,
      }),
      sampleItem("Pandesal", {
        kcal: 240,
        protein: 7,
        carbs: 46,
        fat: 3,
        sugar: 6,
      }),
    ],
  ],
  [
    "lunch",
    "12:30",
    [
      sampleItem("Grilled chicken", {
        kcal: 420,
        protein: 48,
        carbs: 2,
        fat: 24,
        sugar: 0,
      }),
      sampleItem("Rice", {
        kcal: 240,
        protein: 4,
        carbs: 53,
        fat: 0,
        sugar: 0,
      }),
    ],
  ],
  [
    "dinner",
    "19:00",
    [
      sampleItem("Leche flan", {
        kcal: 300,
        protein: 8,
        carbs: 45,
        fat: 9,
        sugar: 41,
      }),
    ],
  ],
].map(([label, at, items], i) => ({
  id: `sample-${i}`,
  label: label as Meal["label"],
  eatenAt: `2026-01-01T${at}:00`,
  source: "text",
  rawInput: "",
  status: "confirmed",
  items: items as Meal["items"],
}))

export function NutritionInsights({ day }: { day: string }) {
  const t = useTheme(),
    s = fitStore.use((s) => s),
    [range, setRange] = useState<Range>("7"),
    [key, setKey] = useState<NutrientKey>("sugar"),
    days = daysEnding(day, Number(range)),
    real = days.flatMap((d) => C.mealsOn(s, d)),
    locked = !real.some((m) => m.status !== "pending_estimate"),
    meals = locked ? SAMPLE : real,
    target = C.budgetFor(s, day)
  return (
    <View style={{ gap: 12, marginTop: 8 }}>
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: "1", label: "Day" },
          { value: "7", label: "7 days" },
          { value: "30", label: "30 days" },
        ]}
      />
      <LockedPreview
        locked={locked}
        title="Your top foods and best meals start here"
        detail="Log a meal and this ranks the foods that gave you the most sugar, saturated fat, sodium or protein, and the meals that gave the most protein for their calories."
        action={{
          label: "Snap a meal",
          onPress: () => openCapture({ mode: "photo", hint: "meal" }),
        }}
        color={t.nut}
        icon={BarChart3}
        gap={12}
      >
        <TopFoods
          meals={meals}
          nutrient={key}
          onNutrient={setKey}
          days={Number(range)}
          target={target}
        />
        <BestMeals meals={meals} days={Number(range)} />
      </LockedPreview>
    </View>
  )
}

function TopFoods({
  meals,
  nutrient,
  onNutrient,
  days,
  target,
}: {
  meals: Meal[]
  nutrient: NutrientKey
  onNutrient: (k: NutrientKey) => void
  days: number
  target: ReturnType<typeof C.budgetFor>
}) {
  const t = useTheme(),
    [all, setAll] = useState(false),
    { label, unit } = NUTRIENT[nutrient],
    r = topFoods(meals, nutrient),
    rows = all ? r.rows : r.rows.slice(0, SHOWN),
    // The amount a day: the day's total, or the average over the days
    // that carry the value (a day with none of it recorded is not a zero).
    perDay = days === 1 ? r.total : r.days ? r.total / r.days : 0,
    // What a day is held against: a limit to stay under, or a goal.
    against = LIMITS.has(nutrient)
      ? limitsFor(target)[nutrient as keyof typeof LIMIT_LABEL]
      : nutrient === "fiber"
        ? fiberGoalFor(target)
        : target?.[nutrient as (typeof MACRO_KEYS)[number]],
    // Nothing logged carries this value: say so, never "0 g".
    untracked = !r.known && r.unknown > 0,
    level =
      !untracked && LIMITS.has(nutrient) && against
        ? limitLevel(perDay, against).level
        : null,
    stateColor =
      level === "over"
        ? t.bad
        : level === "near"
          ? t.warn
          : level
            ? t.good
            : t.text,
    bar =
      nutrient === "protein"
        ? t.fit
        : nutrient === "carbs"
          ? t.tsk
          : nutrient === "fat"
            ? t.life
            : nutrient === "kcal"
              ? t.nut
              : nutrient === "fiber"
                ? t.good
                : level === "under"
                  ? t.muted
                  : stateColor
  return (
    <Frame style={{ paddingVertical: 12 }}>
      <View style={{ paddingHorizontal: 12, gap: 4 }}>
        <Copy size={16} weight="semibold">
          Top foods
        </Copy>
        <Choices
          value={nutrient}
          onChange={(k) => {
            onNutrient(k)
            setAll(false)
          }}
          options={NUTRIENTS.map((k) => ({
            value: k,
            label: NUTRIENT[k].label,
          }))}
        />
        {/* The total the foods add up to, held against its limit or goal. */}
        <Line style={{ gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
          <Copy
            size={22}
            weight="semibold"
            style={{ color: untracked ? t.muted : stateColor }}
          >
            {untracked ? "Not tracked" : withUnit(perDay, unit)}
          </Copy>
          <Copy size={12} muted>
            {(untracked
              ? [
                  `None of the ${r.unknown.toLocaleString("en-US")} foods logged carry a ${label.toLowerCase()} value yet`,
                ]
              : [
                  days === 1
                    ? "this day"
                    : r.days === 1
                      ? `on the one day of ${days} it was tracked`
                      : `a day on average, over ${r.days.toLocaleString("en-US")} tracked days`,
                  against
                    ? `${LIMITS.has(nutrient) ? "limit" : "goal"} ${withUnit(against, unit)}`
                    : null,
                  level === "over"
                    ? `${withUnit(perDay - (against ?? 0), unit)} past it`
                    : null,
                ]
            )
              .filter(Boolean)
              .join(" · ")}
          </Copy>
        </Line>
      </View>
      {!r.rows.length && !untracked && (
        <Copy size={13} muted style={{ paddingHorizontal: 12, paddingTop: 8 }}>
          No {label.toLowerCase()} in the foods logged.
        </Copy>
      )}
      <View style={{ marginTop: 8 }}>
        {rows.map((f) => (
          <Tap
            key={f.name.toLowerCase()}
            label={`${f.name}: ${withUnit(f.amount, unit)} ${label.toLowerCase()}, ${pct(f.share)} of the total${f.count > 1 ? `, eaten ${f.count} times` : ""}. Open the meal`}
            onPress={() => go(`/nutrition/meals/${f.mealId}`)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderTopWidth: 1,
              borderColor: border(t.line, 0.5),
            }}
          >
            <Line style={{ alignItems: "flex-start", gap: 12 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Copy size={14} weight="medium">
                  {f.name}
                  {f.count > 1 && (
                    <Text style={{ color: t.muted, fontWeight: "400" }}>
                      {`  ×${f.count.toLocaleString("en-US")}`}
                    </Text>
                  )}
                </Copy>
                <View
                  style={{
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: border(t.line, 0.5),
                  }}
                >
                  <View
                    style={{
                      width: `${Math.max(2, Math.round(f.share * 100))}%`,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: bar,
                    }}
                  />
                </View>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Copy
                  size={14}
                  weight="semibold"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {withUnit(f.amount, unit)}
                </Copy>
                <Copy size={11} muted>
                  {pct(f.share)}
                </Copy>
              </View>
            </Line>
          </Tap>
        ))}
      </View>
      {r.rows.length > SHOWN && (
        <Tap
          label={
            all ? "Show the top 5 only" : `Show all ${r.rows.length} foods`
          }
          onPress={() => setAll(!all)}
          style={{
            paddingHorizontal: 12,
            paddingTop: 10,
            borderTopWidth: 1,
            borderColor: border(t.line, 0.5),
          }}
        >
          <Copy size={13} weight="medium" style={{ color: t.nut }}>
            {all
              ? "Show top 5"
              : `Show all ${r.rows.length.toLocaleString("en-US")} foods`}
          </Copy>
        </Tap>
      )}
      {!!r.unknown && !untracked && (
        <Line style={{ paddingHorizontal: 12, paddingTop: 10, gap: 6 }}>
          <Info size={14} color={t.muted} />
          <Copy size={12} muted style={{ flex: 1 }}>
            {r.unknown.toLocaleString("en-US")} food
            {r.unknown === 1 ? " has" : "s have"} no {label.toLowerCase()} value
            and {r.unknown === 1 ? "is" : "are"} not counted.
          </Copy>
        </Line>
      )}
    </Frame>
  )
}

const SPLIT = [
  { key: "protein", short: "P", accent: "fit" },
  { key: "carbs", short: "C", accent: "tsk" },
  { key: "fat", short: "F", accent: "life" },
] as const

function BestMeals({ meals, days }: { meals: Meal[]; days: number }) {
  const t = useTheme(),
    [all, setAll] = useState(false),
    r = bestMeals(meals),
    rows = all ? r.rows : r.rows.slice(0, SHOWN),
    name = (m: Meal) => {
      if (days === 1) return mealName(m, meals, C.fmtTime)
      const kind = m.label[0].toUpperCase() + m.label.slice(1)
      return `${kind} · ${C.fmtDay(C.mealDay(m))}`
    }
  return (
    <Frame style={{ paddingVertical: 12 }}>
      <View style={{ paddingHorizontal: 12, gap: 2 }}>
        <Copy size={16} weight="semibold">
          Most protein per calorie
        </Copy>
        <Copy size={12} muted>
          Protein grams in every 100 kcal, and how each meal's calories split
        </Copy>
      </View>
      {!r.rows.length && (
        <Copy size={13} muted style={{ paddingHorizontal: 12, paddingTop: 8 }}>
          No meal of {MIN_MEAL_KCAL} kcal or more yet.
        </Copy>
      )}
      <View style={{ marginTop: 8 }}>
        {rows.map((m, i) => {
          const what = m.meal.items.length
            ? m.meal.items
                .map((x) => x.name.replace(/\s*\(.*\)/, ""))
                .join(", ")
            : m.meal.rawInput
          return (
            <Tap
              key={m.meal.id}
              label={`${name(m.meal)}, ${what}: ${amt(m.per100)} grams of protein per 100 kcal, ${amt(m.protein / m.count)} grams in ${amt(m.kcal / m.count)} kcal${m.count > 1 ? ` each time, eaten ${m.count} times` : ""}. Protein ${pct(m.split.protein)}, carbs ${pct(m.split.carbs)}, fat ${pct(m.split.fat)} of its calories. Open meal`}
              onPress={() => go(`/nutrition/meals/${m.meal.id}`)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 10,
                gap: 6,
                borderTopWidth: 1,
                borderColor: border(t.line, 0.5),
              }}
            >
              <Line style={{ alignItems: "flex-start", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Copy size={14} weight="medium">
                    {name(m.meal)}
                    {m.count > 1 && (
                      <Text style={{ color: t.muted, fontWeight: "400" }}>
                        {`  ×${m.count.toLocaleString("en-US")}`}
                      </Text>
                    )}
                  </Copy>
                  {/* Secondary: the meal opens with every item. */}
                  <Copy size={12} muted lines={2}>
                    {what}
                  </Copy>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Copy
                    size={i === 0 && !all ? 18 : 15}
                    weight="semibold"
                    style={{ color: t.fit, fontVariant: ["tabular-nums"] }}
                  >
                    {amt(m.per100)} g
                  </Copy>
                  <Copy size={11} muted>
                    per 100 kcal
                  </Copy>
                </View>
              </Line>
              {/* The meal's calories split by macro: the whole bar is the meal. */}
              <View
                style={{
                  flexDirection: "row",
                  height: 6,
                  borderRadius: 3,
                  overflow: "hidden",
                  gap: 2,
                }}
              >
                {SPLIT.map((x) =>
                  m.split[x.key] > 0 ? (
                    <View
                      key={x.key}
                      style={{
                        flex: m.split[x.key],
                        backgroundColor: t[x.accent],
                      }}
                    />
                  ) : null,
                )}
              </View>
              <Line style={{ gap: 10, flexWrap: "wrap" }}>
                {SPLIT.map((x) => (
                  <Copy key={x.key} size={12} muted>
                    <Text style={{ color: t[x.accent], fontWeight: "600" }}>
                      {x.short}
                    </Text>{" "}
                    {pct(m.split[x.key])}
                  </Copy>
                ))}
                <Copy size={12} muted>
                  {amt(m.protein / m.count)} g in {amt(m.kcal / m.count)} kcal
                  {m.count > 1 ? " each" : ""}
                </Copy>
              </Line>
            </Tap>
          )
        })}
      </View>
      {r.rows.length > SHOWN && (
        <Tap
          label={
            all ? "Show the top 5 only" : `Show all ${r.rows.length} meals`
          }
          onPress={() => setAll(!all)}
          style={{
            paddingHorizontal: 12,
            paddingTop: 10,
            borderTopWidth: 1,
            borderColor: border(t.line, 0.5),
          }}
        >
          <Copy size={13} weight="medium" style={{ color: t.nut }}>
            {all
              ? "Show top 5"
              : `Show all ${r.rows.length.toLocaleString("en-US")} meals`}
          </Copy>
        </Tap>
      )}
      {!!r.skipped && (
        <Line style={{ paddingHorizontal: 12, paddingTop: 10, gap: 6 }}>
          <Info size={14} color={t.muted} />
          <Copy size={12} muted style={{ flex: 1 }}>
            {r.skipped.toLocaleString("en-US")} drink
            {r.skipped === 1 ? " or bite" : "s or bites"} under {MIN_MEAL_KCAL}{" "}
            kcal left out.
          </Copy>
        </Line>
      )}
    </Frame>
  )
}
