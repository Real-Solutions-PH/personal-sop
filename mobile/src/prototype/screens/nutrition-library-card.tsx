// Log meal's Food library card: the way into the whole library (the
// household's own foods, USDA and Open Food Facts) from where a meal is
// built. Before a search it previews what this person ate or logged
// lately, foods and whole meals in one list, most recent first; a search
// reaches every food in the library. One tap adds a food at its usual
// amount to the meal being built; tapping its name opens the amount. A
// recent meal logs again whole, with Undo. The last row opens the full
// library page. Loading, empty and error are three different looks: no
// history yet is drawn as dimmed sample rows with the step that fills it.

import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type { Meal, MealItem } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import {
  Check,
  ChevronRight,
  CloudOff,
  Library,
  Plus,
  Utensils,
} from "lucide-react-native"
import { type ReactNode, useEffect, useState } from "react"
import { View } from "react-native"
import { liveMode } from "@/live/config"
import {
  type LibraryFood,
  markFoodUsed,
  useFoods,
} from "@/live/nutrition-foods"
import { mealSaved } from "../body-moments"
import { dayIntake } from "../body-rewards"
import { border, Copy, Frame, Line, Tap } from "../native-kit"
import { go, replace } from "../navigation"
import { useTheme } from "../theme"
import { Button, Field, undo } from "../ui"
import { Dimmed, EmptyFoot } from "./locked-preview"
import { FoodThumb, fmt, SAMPLE_FOODS } from "./nutrition-food-detail"
import { amountLabel, defaultAmount, libraryItem } from "./nutrition-food-pick"

/** Rows in the preview before a search. A search shows every match. */
const TOP = 6

export type RecentEntry =
  | { kind: "food"; food: LibraryFood; at: number | null }
  | { kind: "meal"; meal: Meal; at: number }

const nameKey = (s: string) => s.trim().toLowerCase()
const mealKey = (m: Meal) => m.items.map((i) => nameKey(i.name)).join("|")

/** What this person ate or logged lately, most recent first: library foods
 * and whole meals from other days in one list. A food's time is the last
 * of this person's meals that held it (matched by name, as a library item
 * is named after its food), else the household's last use of it; foods
 * with neither (saved, never eaten) follow, in the server's most-used
 * order. A meal from another day shows once per set of foods, and a
 * one-food meal whose food is already listed is left out. */
export function recentFirst(
  foods: LibraryFood[],
  meals: Meal[],
  day: string,
): RecentEntry[] {
  const mine = meals.filter((m) => m.status === "confirmed")
  const ateAt = new Map<string, number>()
  for (const m of mine) {
    const at = Date.parse(m.eatenAt)
    for (const it of m.items) {
      const k = nameKey(it.name)
      const prev = ateAt.get(k)
      if (prev === undefined || at > prev) ateAt.set(k, at)
    }
  }
  const listed = new Set(foods.map((f) => nameKey(f.name)))
  const out: RecentEntry[] = foods.map((food) => {
    const used = food.last_used_at ? Date.parse(food.last_used_at) : NaN
    const at =
      ateAt.get(nameKey(food.name)) ?? (Number.isNaN(used) ? null : used)
    return { kind: "food", food, at }
  })
  const seen = new Set<string>()
  for (const meal of [...mine].sort((a, b) =>
    b.eatenAt.localeCompare(a.eatenAt),
  )) {
    if (dayKey(new Date(meal.eatenAt)) === day || !meal.items.length) continue
    const key = mealKey(meal)
    if (seen.has(key)) continue
    seen.add(key)
    if (meal.items.length === 1 && listed.has(key)) continue
    out.push({ kind: "meal", meal, at: Date.parse(meal.eatenAt) })
  }
  // A stable sort: untimed foods keep the server's order at the end.
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (b.e.at ?? -Infinity) - (a.e.at ?? -Infinity) || a.i - b.i)
    .map(({ e }) => e)
}

export function FoodLibraryCard({
  day,
  onAdd,
  onPick,
}: {
  day: string
  /** One tap: the food at its usual amount joins the meal. */
  onAdd: (item: MealItem, food: LibraryFood) => void
  /** The food's name: choose the amount first. */
  onPick: (food: LibraryFood) => void
}) {
  const t = useTheme(),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [added, setAdded] = useState<Record<string, number>>({}),
    foods = useFoods(search, liveMode),
    meals = fitStore.use((s) => s.meals)
  // Typing waits for a pause before it searches; clearing is immediate.
  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), q.trim() ? 300 : 0)
    return () => clearTimeout(id)
  }, [q])
  const needle = q.trim().toLowerCase()
  const all = !liveMode
    ? SAMPLE_FOODS.filter(
        (f) => !needle || f.name.toLowerCase().includes(needle),
      )
    : foods.data?.data
  const add = (food: LibraryFood) => {
    const { qty, unit } = defaultAmount(food)
    const item = libraryItem(food, qty, unit)
    if (!item) return
    if (liveMode) markFoodUsed(food.id)
    setAdded((now) => ({ ...now, [food.id]: (now[food.id] ?? 0) + 1 }))
    onAdd(item, food)
  }
  const foodRow = (f: LibraryFood) => (
    <FoodRow
      key={f.id}
      food={f}
      added={added[f.id] ?? 0}
      onAdd={() => add(f)}
      onPick={() => onPick(f)}
    />
  )
  let body: ReactNode
  if (all === undefined && foods.isError)
    body = (
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
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
      </View>
    )
  else if (all === undefined)
    body = [0, 1, 2].map((i) => (
      <View
        key={i}
        accessibilityLabel="Loading foods"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 16,
          paddingVertical: 10,
          opacity: 0.5,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: t.soft,
          }}
        />
        <View
          style={{
            height: 14,
            width: "50%",
            borderRadius: 4,
            backgroundColor: t.soft,
          }}
        />
      </View>
    ))
  else if (needle)
    body = all.length ? (
      all.map(foodRow)
    ) : (
      <Copy
        size={14}
        muted
        style={{ paddingHorizontal: 16, paddingVertical: 10 }}
      >
        {`No food in the library matches “${q.trim()}”.`}
      </Copy>
    )
  else {
    const recent = recentFirst(all, meals, day).slice(0, TOP)
    body = recent.length ? (
      recent.map((e) =>
        e.kind === "food" ? (
          foodRow(e.food)
        ) : (
          <MealRow key={e.meal.id} meal={e.meal} day={day} />
        ),
      )
    ) : (
      <View style={{ paddingBottom: 8 }} testID="foods-empty">
        <Dimmed>
          {SAMPLE_FOODS.slice(0, 2).map((f) => (
            <FoodRow key={f.id} food={f} added={0} />
          ))}
        </Dimmed>
        <View style={{ paddingHorizontal: 16 }}>
          <EmptyFoot hint="No foods eaten yet. Search the library above, or snap a nutrition label for Fern to save: what you log shows here for one-tap adds." />
        </View>
      </View>
    )
  }
  return (
    <Frame style={{ paddingVertical: 8 }} testID="food-library">
      <Line style={{ gap: 8, paddingHorizontal: 16, paddingVertical: 6 }}>
        <Library size={16} color={t.nut} />
        <Copy size={14} weight="medium" style={{ flex: 1 }}>
          Food library
        </Copy>
      </Line>
      <View style={{ gap: 4 }}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
          <Field
            label="Search the food library"
            hideLabel
            placeholder="Search every food (adobo, rice, egg…)"
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
          />
        </View>
        {!liveMode && (
          <Copy size={12} muted style={{ paddingHorizontal: 16 }}>
            Sample foods. Sign in to add from the shared food library.
          </Copy>
        )}
        {!needle && all !== undefined && (
          <Copy
            size={12}
            weight="medium"
            muted
            style={{ paddingHorizontal: 16, paddingVertical: 4 }}
          >
            Recently eaten
          </Copy>
        )}
        {body}
      </View>
      <Tap
        label="Browse the full food library"
        onPress={() => go("/nutrition/foods")}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          marginTop: 4,
          borderTopWidth: 1,
          borderColor: border(t.line, 0.5),
        }}
      >
        <Line style={{ gap: 10 }}>
          <Library size={16} color={t.nut} />
          <View style={{ flex: 1 }}>
            <Copy size={14} weight="medium" style={{ color: t.nut }}>
              Browse the full library
            </Copy>
            <Copy size={12} muted>
              Your household’s foods, USDA and Open Food Facts
            </Copy>
          </View>
          <ChevronRight size={16} color={t.muted} />
        </Line>
      </Tap>
    </Frame>
  )
}

function FoodRow({
  food,
  added,
  onAdd,
  onPick,
}: {
  food: LibraryFood
  added: number
  onAdd?: () => void
  onPick?: () => void
}) {
  const t = useTheme(),
    { qty, unit } = defaultAmount(food),
    item = libraryItem(food, qty, unit),
    amount = amountLabel(qty, unit),
    kcal = Math.round(item?.kcal ?? food.kcal).toLocaleString("en-US")
  return (
    <Line
      style={{
        gap: 10,
        paddingLeft: 16,
        paddingRight: 8,
        borderTopWidth: 1,
        borderColor: border(t.line, 0.5),
      }}
    >
      <Tap
        label={`Pick ${food.name}`}
        hint="Choose how much"
        onPress={onPick ?? (() => {})}
        style={{ flex: 1, paddingVertical: 10 }}
      >
        <Line style={{ gap: 10 }}>
          <FoodThumb food={food} />
          <View style={{ flex: 1 }}>
            <Copy size={14} weight="medium">
              {food.name}
            </Copy>
            <Copy size={12} muted>
              {`${amount} · ${kcal} kcal · P ${fmt(item?.protein ?? food.protein)} g`}
            </Copy>
          </View>
        </Line>
      </Tap>
      <AddButton
        label={`Add ${amount} of ${food.name}`}
        added={added}
        onPress={onAdd}
      />
    </Line>
  )
}

function AddButton({
  label,
  added = 0,
  onPress,
}: {
  label: string
  added?: number
  onPress?: () => void
}) {
  const t = useTheme()
  return (
    <Tap
      label={label}
      hint={added ? `Added ${added} so far` : undefined}
      onPress={onPress ?? (() => {})}
      style={{
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          minWidth: 28,
          height: 28,
          paddingHorizontal: added ? 6 : 0,
          borderRadius: 14,
          flexDirection: "row",
          gap: 2,
          backgroundColor: added ? t.nut : `${t.nut}26`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {added ? (
          <>
            <Check size={14} color={t.bg} />
            {added > 1 && (
              <Copy size={11} weight="semibold" style={{ color: t.bg }}>
                {added}
              </Copy>
            )}
          </>
        ) : (
          <Plus size={16} color={t.nut} />
        )}
      </View>
    </Tap>
  )
}

/** A meal from another day: one tap logs the same foods again on this
 * day, with Undo, and goes back to the day. */
function MealRow({ meal: m, day }: { meal: Meal; day: string }) {
  const t = useTheme()
  const what = m.items.map((i) => i.name.replace(/\s*\(.*\)/, "")).join(", ")
  const kcal = Math.round(C.mealTotals(m).kcal).toLocaleString("en-US")
  return (
    <Tap
      label={`Log ${what} again, ${kcal} kcal`}
      onPress={() => {
        const before = dayIntake(fitStore.get(), day)
        const c = A.duplicateMeal(m.id, day)
        if (!c) return
        mealSaved(before, day)
        undo(`Logged ${c.label} · ${kcal} kcal`, () => A.deleteMeal(c.id))
        replace(`/nutrition?day=${day}`)
      }}
      style={{
        paddingLeft: 16,
        paddingRight: 8,
        borderTopWidth: 1,
        borderColor: border(t.line, 0.5),
      }}
    >
      <Line style={{ gap: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: border(t.soft, 0.8),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Utensils size={16} color={t.muted} />
        </View>
        <View style={{ flex: 1, paddingVertical: 10 }}>
          <Copy size={14} weight="medium">
            {what}
          </Copy>
          <Copy size={12} muted>
            {`${m.label[0].toUpperCase()}${m.label.slice(1)} · ${C.fmtDay(C.mealDay(m))} · ${kcal} kcal`}
          </Copy>
        </View>
        <View
          style={{
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: `${t.nut}26`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Plus size={16} color={t.nut} />
          </View>
        </View>
      </Line>
    </Tap>
  )
}
