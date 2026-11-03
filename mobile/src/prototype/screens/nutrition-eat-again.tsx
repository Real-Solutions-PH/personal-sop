// Log meal's Eat again card: the person's saved foods (the shared library,
// most used first) and the meals they ate on other days, in one place. One
// tap adds a food at its usual amount to the meal being built; tapping its
// name opens the amount; search narrows the foods. A recent meal logs again
// whole, with Undo. Loading, empty and error are three different looks: an
// empty library is drawn as dimmed sample rows with the step that fills it.

import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type { MealItem } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { Check, CloudOff, History, Plus } from "lucide-react-native"
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
import { replace } from "../navigation"
import { useTheme } from "../theme"
import { Button, Field, undo } from "../ui"
import { Dimmed, EmptyFoot } from "./locked-preview"
import { FoodThumb, fmt, SAMPLE_FOODS } from "./nutrition-food-detail"
import { amountLabel, defaultAmount, libraryItem } from "./nutrition-food-pick"

/** Foods shown before a search: the most used. A search shows every match. */
const TOP = 6

export function EatAgain({
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
  const t = useTheme()
  return (
    <Frame style={{ paddingVertical: 8 }} testID="eat-again">
      <Line style={{ gap: 8, paddingHorizontal: 16, paddingVertical: 6 }}>
        <History size={16} color={t.nut} />
        <Copy size={14} weight="medium" style={{ flex: 1 }}>
          Eat again
        </Copy>
      </Line>
      <Foods onAdd={onAdd} onPick={onPick} />
      <RecentMeals day={day} />
    </Frame>
  )
}

function Foods({
  onAdd,
  onPick,
}: {
  onAdd: (item: MealItem, food: LibraryFood) => void
  onPick: (food: LibraryFood) => void
}) {
  const t = useTheme(),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [added, setAdded] = useState<Record<string, number>>({}),
    foods = useFoods(search, liveMode)
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
  else if (!all.length && needle)
    body = (
      <Copy
        size={14}
        muted
        style={{ paddingHorizontal: 16, paddingVertical: 10 }}
      >
        {`No saved food matches “${q.trim()}”.`}
      </Copy>
    )
  else if (!all.length)
    body = (
      <View
        style={{ paddingHorizontal: 16, paddingBottom: 8 }}
        testID="foods-empty"
      >
        <Dimmed>
          {SAMPLE_FOODS.slice(0, 2).map((f) => (
            <FoodRow key={f.id} food={f} added={0} />
          ))}
        </Dimmed>
        <EmptyFoot hint="No saved foods yet. Snap a nutrition label and tell Fern to save it, and it shows here for one-tap adds." />
      </View>
    )
  else
    body = (needle ? all : all.slice(0, TOP)).map((f) => (
      <FoodRow
        key={f.id}
        food={f}
        added={added[f.id] ?? 0}
        onAdd={() => add(f)}
        onPick={() => onPick(f)}
      />
    ))
  return (
    <View style={{ gap: 4 }}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
        <Field
          label="Search your foods"
          hideLabel
          placeholder="Search your foods"
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
      {body}
    </View>
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
      <Tap
        label={`Add ${amount} of ${food.name}`}
        hint={added ? `Added ${added} so far` : undefined}
        onPress={onAdd ?? (() => {})}
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
    </Line>
  )
}

/** Meals eaten on other days, newest first, each once: one tap logs the
 * same foods again on this day, with Undo, and goes back to the day. */
function RecentMeals({ day }: { day: string }) {
  const t = useTheme(),
    meals = fitStore.use((s) => s.meals),
    seen = new Set<string>(),
    recent = [...meals]
      .filter(
        (m) => m.status === "confirmed" && dayKey(new Date(m.eatenAt)) !== day,
      )
      .sort((a, b) => b.eatenAt.localeCompare(a.eatenAt))
      .filter((m) => {
        const key = m.items.map((i) => i.name).join("|")
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 5)
  if (!recent.length) return null
  return (
    <View style={{ marginTop: 8 }}>
      <Copy
        size={12}
        weight="medium"
        muted
        style={{ paddingHorizontal: 16, paddingVertical: 6 }}
      >
        Recent meals
      </Copy>
      {recent.map((m) => {
        const what = m.items
          .map((i) => i.name.replace(/\s*\(.*\)/, ""))
          .join(", ")
        const kcal = Math.round(C.mealTotals(m).kcal).toLocaleString("en-US")
        return (
          <Tap
            key={m.id}
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
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderTopWidth: 1,
              borderColor: border(t.line, 0.5),
            }}
          >
            <Line style={{ gap: 12, alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Copy size={14} weight="medium">
                  {what}
                </Copy>
                <Copy size={12} muted>
                  {`${m.label[0].toUpperCase()}${m.label.slice(1)} · ${C.fmtDay(C.mealDay(m))}`}
                </Copy>
              </View>
              <Copy
                size={13}
                weight="semibold"
                style={{ fontVariant: ["tabular-nums"], paddingTop: 1 }}
              >
                {`${kcal} kcal`}
              </Copy>
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
            </Line>
          </Tap>
        )
      })}
    </View>
  )
}
