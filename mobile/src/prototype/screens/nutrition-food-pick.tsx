// "Pick from library" while logging a meal by hand: search the shared food
// library, pick a food, say how much, and it joins the meal as one item
// with the food's own numbers scaled to that amount (the same sum the
// server does). Logging it counts one use of the food.
import type { MealItem } from "@domain/fitness/data"
import { uid } from "@domain/lib/store"
import { CloudOff, Plus } from "lucide-react-native"
import { useEffect, useState } from "react"
import { View } from "react-native"
import { liveMode } from "@/live/config"
import { scaleFood } from "@/live/food-scale"
import {
  type LibraryFood,
  markFoodUsed,
  useFoods,
} from "@/live/nutrition-foods"
import { Copy, Frame, Line, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { Button, Field, Sheet } from "../ui"
import {
  BASIS_LABEL,
  FoodThumb,
  fmt,
  SAMPLE_FOODS,
} from "./nutrition-food-detail"

/** The units a food can be logged in: grams, and its piece or serving. */
export function unitsFor(food: LibraryFood): string[] {
  const own = food.basis === "100g" ? "piece" : food.basis
  return food.basis === "100g"
    ? ["g", ...(food.unit_grams ? [own] : [])]
    : [own, ...(food.unit_grams ? ["g"] : [])]
}

/** The meal item for ``qty`` ``unit`` of ``food``; null when it cannot be
 * scaled (grams of a food with no unit weight). */
export function libraryItem(
  food: LibraryFood,
  qty: number,
  unit: string,
): MealItem | null {
  const s = scaleFood(food, qty, unit)
  if (!s) return null
  return {
    id: uid(),
    name: food.name,
    qty,
    unit,
    kcal: s.kcal,
    protein: s.protein,
    carbs: s.carbs,
    fat: s.fat,
    ...(s.fiber !== null ? { fiber: s.fiber } : {}),
    ...(s.sat_fat !== null ? { satFat: s.sat_fat } : {}),
    ...(s.sugar !== null ? { sugar: s.sugar } : {}),
    ...(s.sodium !== null ? { sodium: s.sodium } : {}),
    assumption: `From your food library: ${food.name}`,
  }
}

export function LibraryPickSheet({
  onAdd,
  onClose,
}: {
  onAdd: (item: MealItem, food: LibraryFood) => void
  onClose: () => void
}) {
  const [food, setFood] = useState<LibraryFood | null>(null)
  return (
    <Sheet
      title={food ? food.name : "Pick from library"}
      open
      onClose={onClose}
      onBack={food ? () => setFood(null) : undefined}
      backLabel="Back to foods"
    >
      {food ? (
        <Amount
          key={food.id}
          food={food}
          onAdd={(item) => {
            if (liveMode) markFoodUsed(food.id)
            onAdd(item, food)
          }}
        />
      ) : (
        <FoodList onPick={setFood} />
      )}
    </Sheet>
  )
}

function FoodList({ onPick }: { onPick: (f: LibraryFood) => void }) {
  const t = useTheme(),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    foods = useFoods(search, liveMode)
  // Typing waits for a pause before it searches; clearing is immediate.
  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), q.trim() ? 300 : 0)
    return () => clearTimeout(id)
  }, [q])
  const needle = q.trim().toLowerCase()
  const list = !liveMode
    ? SAMPLE_FOODS.filter(
        (f) => !needle || f.name.toLowerCase().includes(needle),
      )
    : foods.data?.data
  return (
    <>
      <Field
        label="Search your foods"
        hideLabel
        placeholder="Search your foods"
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
      />
      {!liveMode && (
        <Copy size={12} muted>
          Sample foods. Sign in to pick from the shared food library.
        </Copy>
      )}
      {list ? (
        list.length ? (
          <Frame style={{ padding: 4 }}>
            {list.map((f, i) => (
              <Tap
                key={f.id}
                label={`Pick ${f.name}`}
                onPress={() => onPick(f)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: t.line,
                }}
              >
                <Line style={{ gap: 10 }}>
                  <FoodThumb food={f} />
                  <View style={{ flex: 1 }}>
                    <Copy size={14} weight="medium" lines={1}>
                      {f.name}
                    </Copy>
                    <Copy size={12} muted lines={1}>
                      {fmt(f.kcal)} kcal {BASIS_LABEL[f.basis] ?? f.basis} · P{" "}
                      {fmt(f.protein)} g · C {fmt(f.carbs)} g · F {fmt(f.fat)} g
                    </Copy>
                  </View>
                </Line>
              </Tap>
            ))}
          </Frame>
        ) : (
          <Copy size={14} muted style={{ paddingVertical: 12 }}>
            {needle
              ? `No saved food matches “${q.trim()}”.`
              : "No saved foods yet. Snap a nutrition label and tell Fern to save it."}
          </Copy>
        )
      ) : foods.isError ? (
        <Frame style={{ padding: 16, gap: 8 }}>
          <Line style={{ gap: 10 }}>
            <CloudOff size={18} color={t.bad} />
            <Copy weight="medium" style={{ flex: 1 }}>
              Couldn’t load your foods
            </Copy>
          </Line>
          <Button
            small
            tone="quiet"
            disabled={foods.isFetching}
            onPress={() => foods.refetch()}
          >
            {foods.isFetching ? "Trying again…" : "Try again"}
          </Button>
        </Frame>
      ) : (
        <Frame style={{ padding: 4 }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{ padding: 12, gap: 8, opacity: 0.5 }}
              accessibilityLabel="Loading foods"
            >
              <View
                style={{
                  height: 14,
                  width: "55%",
                  borderRadius: 4,
                  backgroundColor: t.soft,
                }}
              />
            </View>
          ))}
        </Frame>
      )}
    </>
  )
}

function Amount({
  food,
  onAdd,
}: {
  food: LibraryFood
  onAdd: (item: MealItem) => void
}) {
  const t = useTheme(),
    units = unitsFor(food),
    [unit, setUnit] = useState(units[0]),
    [qty, setQty] = useState(unit === "g" ? "100" : "1")
  const amount = Number(qty.replace(/,/g, "")),
    item = libraryItem(food, amount, unit)
  return (
    <>
      <Copy size={12} muted>
        {fmt(food.kcal)} kcal {BASIS_LABEL[food.basis] ?? food.basis}
        {food.unit_grams ? ` · ${fmt(food.unit_grams)} g each` : ""}
      </Copy>
      <Line style={{ gap: 8, alignItems: "flex-end" }}>
        <View style={{ width: 96 }}>
          <Field
            label="Amount"
            value={qty}
            onChangeText={setQty}
            keyboardType="decimal-pad"
          />
        </View>
        <Line style={{ gap: 6, flexWrap: "wrap", flex: 1, marginBottom: 6 }}>
          {units.map((u) => (
            <Tap
              key={u}
              label={`In ${u === "g" ? "grams" : `${u}s`}`}
              role="radio"
              selected={u === unit}
              onPress={() => {
                if (u === unit) return
                setUnit(u)
                setQty(u === "g" ? "100" : "1")
              }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 99,
                borderWidth: 1,
                borderColor: u === unit ? t.nut : t.line,
                backgroundColor: u === unit ? t.nut : t.card,
              }}
            >
              <Copy
                size={14}
                weight="medium"
                style={{ color: u === unit ? t.bg : t.text }}
              >
                {u}
              </Copy>
            </Tap>
          ))}
        </Line>
      </Line>
      {item ? (
        <Copy size={14}>
          {fmt(item.kcal)} kcal · P {fmt(item.protein)} g · C {fmt(item.carbs)}{" "}
          g · F {fmt(item.fat)} g
        </Copy>
      ) : (
        <Copy size={12} style={{ color: t.bad }}>
          Enter an amount above 0.
        </Copy>
      )}
      <Button
        icon={Plus}
        disabled={!item}
        onPress={() => {
          if (item) onAdd(item)
        }}
      >
        Add to meal
      </Button>
    </>
  )
}
