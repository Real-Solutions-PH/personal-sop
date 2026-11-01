// The day's meals by macro, under the rings: one row per meal with its
// calories, protein, carbs and fat and each one's share of the day, the
// meal that gave the most of each macro tinted in that macro's colour, and
// the same answer said in words above the table ("Protein: Dinner 50%").
// The day's totals against the targets are the rings above, not repeated.
import * as C from "@domain/fitness/calc"
import type { Meal } from "@domain/fitness/data"
import { Text, View } from "react-native"
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
          // One line per meal that tops something: "Lunch  Calories 54%
          // Protein 55%", so a meal that leads every macro is named once.
          <View style={{ gap: 4 }}>
            {[...new Set(BREAKDOWN_KEYS.map((k) => b.top[k]?.mealId))]
              .filter((id): id is string => !!id)
              .map((id) => {
                const meal = byId.get(id) as Meal,
                  keys = BREAKDOWN_KEYS.filter((k) => b.top[k]?.mealId === id)
                return (
                  <View
                    key={id}
                    accessible
                    accessibilityLabel={`Most ${keys.map((k) => `${k === "kcal" ? "calories" : k} (${pct(b.top[k]?.share ?? 0)})`).join(", ")} from ${name(meal)}`}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <Copy size={13} weight="medium" maxScale={CELL_SCALE}>
                      {name(meal)}
                    </Copy>
                    {keys.map((k) => (
                      <Copy key={k} size={12} maxScale={CELL_SCALE}>
                        <Text
                          style={{
                            color: t[COLUMNS[k].accent],
                            fontWeight: "600",
                          }}
                        >
                          {k === "kcal" ? "Calories" : COLUMNS[k].label}
                        </Text>{" "}
                        {pct(b.top[k]?.share ?? 0)}
                      </Copy>
                    ))}
                  </View>
                )
              })}
          </View>
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
              paddingRight: 6,
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
              {/* Waiting for its estimate: one note across the columns. */}
              {!r.totals && (
                <Copy
                  size={12}
                  muted
                  maxScale={CELL_SCALE}
                  style={{
                    width: CELL * 4,
                    textAlign: "right",
                    paddingRight: 6,
                  }}
                >
                  Estimating…
                </Copy>
              )}
              {BREAKDOWN_KEYS.map((k) => {
                if (!r.totals) return null
                const col = COLUMNS[k],
                  top = b.top[k]?.mealId === r.meal.id && !one
                return (
                  <View
                    key={k}
                    style={{
                      width: CELL - 4,
                      alignItems: "flex-end",
                      paddingVertical: 2,
                      paddingRight: 6,
                      marginLeft: 4,
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
                      {num(r.totals[k])}
                    </Copy>
                    <Copy size={11} muted maxScale={CELL_SCALE}>
                      {pct(r.share[k])}
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
