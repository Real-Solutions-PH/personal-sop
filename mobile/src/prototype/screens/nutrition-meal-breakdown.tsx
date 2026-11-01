// The day's meals by macro, under the rings: one row per meal with its
// calories, protein, carbs and fat and each one's share of the day, the
// meal that gave the most of each macro tinted in that macro's colour, and
// the same answer said in words above the table ("Protein: Dinner 50%").
// The day's totals against the targets are the rings above, not repeated.
import * as C from "@domain/fitness/calc"
import type { Meal } from "@domain/fitness/data"
import { View } from "react-native"
import {
  BREAKDOWN_KEYS,
  type BreakdownKey,
  mealBreakdown,
  mealName,
} from "../meal-breakdown"
import { border, Copy, Frame, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { type Accent, useTheme } from "../theme"

const COLUMNS: Record<
  BreakdownKey,
  { label: string; accent: Accent; unit: string }
> = {
  // The rings' colours, so a macro is the same colour on the whole page.
  kcal: { label: "kcal", accent: "nut", unit: "" },
  protein: { label: "Protein", accent: "fit", unit: " g" },
  carbs: { label: "Carbs", accent: "tsk", unit: " g" },
  fat: { label: "Fat", accent: "life", unit: " g" },
}
/** Wide enough for "1,240" and "Protein" at the largest capped text size. */
const CELL = 56
const CELL_SCALE = 1.3
const num = (v: number) => Math.round(v).toLocaleString("en-US")
const pct = (v: number) => `${Math.round(v * 100)}%`

export function MealBreakdown({ meals }: { meals: Meal[] }) {
  const t = useTheme()
  const b = mealBreakdown(meals)
  if (!b.rows.length) return null
  const name = (m: Meal) => mealName(m, meals, C.fmtTime)
  const byId = new Map(b.rows.map((r) => [r.meal.id, r.meal]))
  const one = b.rows.filter((r) => r.totals).length === 1
  return (
    <Frame style={{ paddingVertical: 12 }}>
      <View style={{ paddingHorizontal: 12, gap: 6 }}>
        <Copy size={14} weight="semibold">
          By meal
        </Copy>
        {/* Which meal gave the most of each macro, in words. */}
        {one ? (
          <Copy size={12} muted>
            All from {name(b.rows.find((r) => r.totals)?.meal as Meal)} so far
          </Copy>
        ) : (
          <Line style={{ flexWrap: "wrap", gap: 6 }}>
            {BREAKDOWN_KEYS.map((k) => {
              const top = b.top[k],
                col = COLUMNS[k]
              if (!top) return null
              const meal = byId.get(top.mealId) as Meal
              return (
                <View
                  key={k}
                  accessible
                  accessibilityLabel={`Most ${col.label === "kcal" ? "calories" : col.label.toLowerCase()} from ${name(meal)}, ${pct(top.share)} of the day`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    borderRadius: 12,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    backgroundColor: `${t[col.accent]}1f`,
                  }}
                >
                  <Copy
                    size={12}
                    weight="semibold"
                    maxScale={CELL_SCALE}
                    style={{ color: t[col.accent] }}
                  >
                    {col.label === "kcal" ? "Calories" : col.label}
                  </Copy>
                  <Copy size={12} maxScale={CELL_SCALE}>
                    {name(meal)} {pct(top.share)}
                  </Copy>
                </View>
              )
            })}
          </Line>
        )}
      </View>
      <Line
        style={{
          paddingHorizontal: 12,
          paddingTop: 10,
          paddingBottom: 4,
          gap: 0,
        }}
      >
        <View style={{ flex: 1 }} />
        {BREAKDOWN_KEYS.map((k) => (
          <Copy
            key={k}
            size={11}
            weight="medium"
            maxScale={CELL_SCALE}
            style={{
              width: CELL,
              textAlign: "right",
              color: t[COLUMNS[k].accent],
            }}
          >
            {COLUMNS[k].label}
          </Copy>
        ))}
      </Line>
      {b.rows.map((r) => {
        const what = r.meal.items.length
          ? r.meal.items.map((i) => i.name.replace(/\s*\(.*\)/, "")).join(", ")
          : r.meal.rawInput
        return (
          <Tap
            key={r.meal.id}
            label={`${name(r.meal)}: ${
              r.totals
                ? BREAKDOWN_KEYS.map(
                    (k) =>
                      `${num(r.totals?.[k] ?? 0)}${COLUMNS[k].unit} ${k === "kcal" ? "calories" : k}, ${pct(r.share[k])}`,
                  ).join("; ")
                : "waiting for its estimate"
            }. Open meal`}
            onPress={() => go(`/nutrition/meals/${r.meal.id}`)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderTopWidth: 1,
              borderColor: border(t.line, 0.5),
            }}
          >
            <Line style={{ gap: 0, alignItems: "flex-start" }}>
              <View style={{ flex: 1, paddingRight: 6 }}>
                <Copy size={14} weight="medium" maxScale={CELL_SCALE}>
                  {name(r.meal)}
                </Copy>
                <Copy size={12} muted lines={1}>
                  {what}
                </Copy>
              </View>
              {BREAKDOWN_KEYS.map((k) => {
                const col = COLUMNS[k],
                  top = b.top[k]?.mealId === r.meal.id && !one
                return (
                  <View
                    key={k}
                    style={{
                      width: CELL,
                      alignItems: "flex-end",
                      paddingVertical: 2,
                      paddingRight: 4,
                      marginLeft: 2,
                      marginRight: -4,
                      borderRadius: 8,
                      backgroundColor: top
                        ? `${t[col.accent]}26`
                        : "transparent",
                    }}
                  >
                    <Copy
                      size={14}
                      weight="semibold"
                      maxScale={CELL_SCALE}
                      style={{
                        color: top ? t[col.accent] : t.text,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {r.totals ? num(r.totals[k]) : "…"}
                    </Copy>
                    <Copy size={11} muted maxScale={CELL_SCALE}>
                      {r.totals
                        ? pct(r.share[k])
                        : k === "kcal"
                          ? "pending"
                          : ""}
                    </Copy>
                  </View>
                )
              })}
            </Line>
          </Tap>
        )
      })}
    </Frame>
  )
}
