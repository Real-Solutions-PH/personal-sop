// One food in the library, read first: it answers "is this food good for
// my targets, and how much should I eat?". In order: who the food is
// (photo, name, kind, other names, where its numbers came from), what to do
// with it (Log this at the chosen amount; Edit your own food; copy a
// built-in one to change it), the amount, its calories and macro split
// against today's targets, its nutrition facts, what its numbers say about
// it, and the person's own history with it. Every figure follows the
// amount. Editing lives on its own page (nutrition-food-edit).
import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type { Meal } from "@domain/fitness/data"
import { fiberGoalFor, limitsFor } from "@domain/fitness/limits"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import type { UseQueryResult } from "@tanstack/react-query"
import { Image } from "expo-image"
import {
  BadgeCheck,
  BookOpen,
  ChevronRight,
  CircleCheck,
  CloudOff,
  CopyPlus,
  ExternalLink,
  History,
  type LucideIcon,
  Pencil,
  Plus,
  ThumbsUp,
  TriangleAlert,
  Undo2,
} from "lucide-react-native"
import { useState } from "react"
import { Linking, View } from "react-native"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { type Scaled, scaleFood } from "@/live/food-scale"
import { ApiError } from "@/live/http"
import {
  foodEditError,
  type LibraryFood,
  markFoodUsed,
  sourceCredit,
  useCopyFood,
  useFood,
  verifiedLabel,
} from "@/live/nutrition-foods"
import { mealSaved } from "../body-moments"
import { dayIntake } from "../body-rewards"
import { Stepper } from "../fitness-controls"
import {
  foodHistory,
  type Highlight,
  highlights,
  MACRO_KEYS,
  type MacroKey,
  macroSplit,
  shareOf,
  stepFor,
  wholePercents,
} from "../food-facts"
import { Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { go, replace } from "../navigation"
import { useTheme } from "../theme"
import { Button, Empty, Screen } from "../ui"
import { LockedPreview } from "./locked-preview"
import {
  amountLabel,
  defaultAmount,
  libraryItem,
  unitsFor,
} from "./nutrition-food-pick"

/** A number with thousands separators, one decimal at most. */
export const fmt = (v: number) =>
  v.toLocaleString("en-US", { maximumFractionDigits: 1 })
/** A whole number with thousands separators. */
const whole = (v: number) => Math.round(v).toLocaleString("en-US")

export const BASIS_LABEL: Record<string, string> = {
  "100g": "per 100 g",
  piece: "per piece",
  serving: "per serving",
}
export const STATE_LABEL: Record<string, string> = {
  raw: "Raw",
  cooked: "Cooked",
  as_sold: "As sold",
}

/** Shown while signed out, and as the dimmed preview of an empty library. */
export const SAMPLE_FOODS: LibraryFood[] = [
  {
    id: "sample-1",
    name: "Chicken breast, grilled",
    aliases: [],
    basis: "100g",
    unit_grams: null,
    state: "cooked",
    kcal: 165,
    protein: 31,
    carbs: 0,
    fat: 3.6,
    fiber: 0,
    sat_fat: 1,
    sugar: 0,
    sodium: 74,
    notes: null,
    source: "label",
    verified: true,
    use_count: 12,
    last_used_at: null,
    photo_media_id: null,
    photo_url: null,
    can_edit: false,
  },
  {
    id: "sample-2",
    name: "Greek yogurt, plain",
    aliases: [],
    basis: "serving",
    unit_grams: 170,
    state: "as_sold",
    kcal: 100,
    protein: 17,
    carbs: 6,
    fat: 0.7,
    fiber: 0,
    sat_fat: 0.2,
    sugar: 0,
    sodium: 61,
    notes: null,
    source: "label",
    verified: false,
    use_count: 4,
    last_used_at: null,
    photo_media_id: null,
    photo_url: null,
    can_edit: false,
  },
]

/** The macro colours the rings and day bars use. */
const MACRO = {
  protein: { label: "Protein", accent: "fit" },
  carbs: { label: "Carbs", accent: "tsk" },
  fat: { label: "Fat", accent: "life" },
} as const

/** A food's photo, or the library's book icon when it has none. */
export function FoodThumb({
  food,
  size = 36,
  uri,
}: {
  food: Pick<LibraryFood, "photo_url" | "photo_media_id" | "name">
  size?: number
  /** A local photo shown in place of the server's (an upload in flight). */
  uri?: string
}) {
  const t = useTheme(),
    src = uri ?? food.photo_url
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size >= 64 ? 16 : 8,
        backgroundColor: `${t.nut}26`,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {src ? (
        <Image
          source={
            uri || !food.photo_media_id
              ? { uri: src }
              : { uri: src, cacheKey: food.photo_media_id }
          }
          style={{ width: size, height: size }}
          contentFit="cover"
          accessibilityLabel={`Photo of ${food.name}`}
        />
      ) : (
        <BookOpen
          size={Math.round(size / 2.4)}
          color={t.nut}
          accessibilityLabel="No photo"
        />
      )}
    </View>
  )
}

export function FoodDetail({ id }: { id: string }) {
  const query = useFood(id, liveMode)
  if (!liveMode) {
    const food = SAMPLE_FOODS.find((f) => f.id === id) ?? SAMPLE_FOODS[0]
    return (
      <Screen title="Food">
        <Copy size={12} muted>
          A sample food. Sign in to see and edit the shared food library.
        </Copy>
        <FoodPage food={food} />
      </Screen>
    )
  }
  if (query.data)
    return (
      <Screen title="Food">
        <FoodPage key={query.data.id} food={query.data} />
      </Screen>
    )
  if (query.isError)
    return (
      <Screen title="Food">
        <FoodLoadError query={query} />
      </Screen>
    )
  return (
    <Screen title="Food">
      <DetailSkeleton />
    </Screen>
  )
}

/** A food that did not load: gone (404) reads as not found, anything else
 * offers a retry. */
export function FoodLoadError({
  query,
}: {
  query: Pick<UseQueryResult<LibraryFood>, "error" | "isFetching" | "refetch">
}) {
  const t = useTheme()
  if (query.error instanceof ApiError && query.error.status === 404)
    return (
      <Empty
        title="Food not found"
        detail="It may have been merged into another food or removed."
      />
    )
  return (
    <Frame style={{ padding: 16, gap: 8 }}>
      <Line style={{ gap: 10 }}>
        <CloudOff size={18} color={t.bad} />
        <Copy weight="medium" style={{ flex: 1 }}>
          Couldn’t load this food
        </Copy>
      </Line>
      <Copy size={14} muted>
        The server didn’t answer. Nothing has changed.
      </Copy>
      <Button
        small
        tone="quiet"
        disabled={query.isFetching}
        onPress={() => query.refetch()}
      >
        {query.isFetching ? "Trying again…" : "Try again"}
      </Button>
    </Frame>
  )
}

/** The page's shape while it loads: header, actions, then the cards. */
export function DetailSkeleton() {
  const t = useTheme()
  const bar = (width: `${number}%` | number, height = 12) => (
    <View
      style={{ height, width, borderRadius: 4, backgroundColor: t.soft }}
    />
  )
  return (
    <View
      style={{ gap: 12, opacity: 0.6 }}
      accessibilityLabel="Loading food"
    >
      <Line style={{ gap: 12, alignItems: "flex-start" }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 16,
            backgroundColor: t.soft,
          }}
        />
        <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
          {bar("80%", 20)}
          {bar("40%")}
        </View>
      </Line>
      {bar("100%", 44)}
      {[0, 1, 2].map((i) => (
        <Frame key={i} style={{ padding: 16, gap: 10 }}>
          {bar("35%", 14)}
          {bar("100%", 10)}
          {bar("70%", 10)}
        </Frame>
      ))}
    </View>
  )
}

function kindOf(food: LibraryFood): string {
  if (food.is_global) return "Built-in"
  if (food.can_edit) return food.origin === "fern" ? "Yours · saved by Fern" : "Yours"
  return "A household member's"
}

function FoodPage({ food }: { food: LibraryFood }) {
  const t = useTheme(),
    s = fitStore.use((x) => x),
    start = defaultAmount(food),
    units = unitsFor(food),
    [unit, setUnit] = useState(start.unit),
    [qty, setQty] = useState(start.qty),
    [logged, setLogged] = useState<Meal | null>(null)
  const scaled = scaleFood(food, qty, unit),
    today = dayKey(),
    target = C.budgetFor(s, today),
    eaten = C.dayTotals(s, today).totals,
    history = foodHistory(s.meals, food)
  const log = () => {
    const item = libraryItem(food, qty, unit)
    if (!item) return
    const { id: _id, ...rest } = item
    const before = dayIntake(fitStore.get(), today)
    const meal = A.logMeal({ items: [rest] })
    if (liveMode) markFoodUsed(food.id)
    mealSaved(before, today)
    setLogged(meal)
  }
  return (
    <>
      <Header food={food} />
      <Line style={{ gap: 8, alignItems: "stretch" }}>
        <View style={{ flex: 1 }}>
          <Button icon={Plus} disabled={!scaled} onPress={log}>
            {`Log ${amountLabel(qty, unit)}`}
          </Button>
        </View>
        {liveMode && food.can_edit ? (
          <View style={{ flex: 1 }}>
            <Button
              tone="quiet"
              icon={Pencil}
              href={`/nutrition/foods/edit/${encodeURIComponent(food.id)}`}
            >
              Edit
            </Button>
          </View>
        ) : liveMode ? (
          <View style={{ flex: 1 }}>
            <CopyToMine food={food} />
          </View>
        ) : null}
      </Line>
      {logged && (
        <Logged
          meal={logged}
          onUndo={() => {
            A.deleteMeal(logged.id)
            setLogged(null)
          }}
        />
      )}
      <SectionHeading>Amount</SectionHeading>
      <Frame style={{ padding: 16, gap: 12 }}>
        <Stepper
          label="Amount"
          value={qty}
          step={stepFor(unit)}
          min={stepFor(unit)}
          max={unit === "g" ? 5000 : 50}
          unit={unit === "g" ? "g" : `${unit}${qty === 1 ? "" : "s"}`}
          onChange={setQty}
        />
        {units.length > 1 && (
          <Line style={{ gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            {units.map((u) => (
              <UnitChip
                key={u}
                unit={u}
                active={u === unit}
                onPress={() => {
                  if (u === unit) return
                  setUnit(u)
                  setQty(u === "g" ? 100 : 1)
                }}
              />
            ))}
          </Line>
        )}
        <Copy size={12} muted style={{ textAlign: "center" }}>
          {equivalence(food, qty, unit)}
        </Copy>
      </Frame>
      {scaled ? (
        <>
          <Energy scaled={scaled} />
          <Targets
            scaled={scaled}
            eaten={eaten}
            target={target}
            amount={amountLabel(qty, unit)}
          />
          <Facts
            scaled={scaled}
            amount={amountLabel(qty, unit)}
            limits={target ?? null}
          />
        </>
      ) : (
        <Copy size={14} style={{ color: t.bad }}>
          Enter an amount above 0 to see its numbers.
        </Copy>
      )}
      <About food={food} />
      <YourHistory history={history} onLog={scaled ? log : undefined} />
    </>
  )
}

/** "= 170 g", "100 g is 0.6 of a serving": how the chosen amount relates
 * to the food's own basis, so a person can check the sum. */
function equivalence(food: LibraryFood, qty: number, unit: string): string {
  const per = BASIS_LABEL[food.basis] ?? food.basis
  if (unit !== "g" && food.unit_grams)
    return `${amountLabel(qty, unit)} = ${fmt(qty * food.unit_grams)} g · values ${per}`
  return `Values ${per}`
}

function Header({ food }: { food: LibraryFood }) {
  const t = useTheme(),
    credit = sourceCredit(food)
  return (
    <View style={{ gap: 10 }}>
      <Line style={{ gap: 12, alignItems: "flex-start" }}>
        <FoodThumb food={food} size={72} />
        <View style={{ flex: 1, gap: 4 }}>
          {/* Identity is never cut short: a long name wraps. */}
          <Copy size={22} weight="semibold">
            {food.name}
          </Copy>
          <Line style={{ gap: 6, flexWrap: "wrap" }}>
            <Copy size={12} weight="medium" style={{ color: t.nut }}>
              {kindOf(food)}
            </Copy>
            {food.state && (
              <Copy size={12} muted>
                · {STATE_LABEL[food.state] ?? food.state}
              </Copy>
            )}
            {food.verified && (
              <Line style={{ gap: 3 }}>
                <BadgeCheck size={12} color={t.good} />
                <Copy size={12} muted>
                  {verifiedLabel(food)}
                </Copy>
              </Line>
            )}
          </Line>
          {food.aliases.length > 0 && (
            <Copy size={12} muted>
              {`Also called ${food.aliases.join(", ")}`}
            </Copy>
          )}
        </View>
      </Line>
      {credit &&
        (food.source_url ? (
          <Tap
            label={`${credit.text}. Opens ${credit.site}`}
            onPress={() => {
              if (food.source_url) void Linking.openURL(food.source_url)
            }}
          >
            <Line style={{ gap: 4 }}>
              <Copy size={12} muted style={{ flexShrink: 1 }}>
                {credit.text}
              </Copy>
              <ExternalLink size={12} color={t.muted} />
            </Line>
          </Tap>
        ) : (
          <Copy size={12} muted>
            {credit.text}
          </Copy>
        ))}
    </View>
  )
}

function UnitChip({
  unit,
  active,
  onPress,
}: {
  unit: string
  active: boolean
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Tap
      label={`In ${unit === "g" ? "grams" : `${unit}s`}`}
      role="radio"
      selected={active}
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 99,
        borderWidth: 1,
        borderColor: active ? t.nut : t.line,
        backgroundColor: active ? t.nut : t.card,
      }}
    >
      <Copy size={14} weight="medium" style={{ color: active ? t.bg : t.text }}>
        {unit === "g" ? "grams" : unit}
      </Copy>
    </Tap>
  )
}

/** What a Log this tap did, with the way back. */
function Logged({ meal, onUndo }: { meal: Meal; onUndo: () => void }) {
  const t = useTheme(),
    kcal = C.mealTotals(meal).kcal
  return (
    <Frame
      style={{ padding: 12, gap: 8, borderColor: `${t.good}66` }}
      testID="food-logged"
    >
      <Line style={{ gap: 8 }}>
        <CircleCheck size={18} color={t.good} />
        <Copy size={14} weight="medium" style={{ flex: 1 }}>
          {`Logged to ${meal.label} · ${whole(kcal)} kcal`}
        </Copy>
      </Line>
      <Line style={{ gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button small tone="quiet" icon={Undo2} onPress={onUndo}>
            Undo
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            small
            tone="quiet"
            icon={ChevronRight}
            href={`/nutrition/meals/${encodeURIComponent(meal.id)}`}
          >
            Open meal
          </Button>
        </View>
      </Line>
    </Frame>
  )
}

/** Calories, then each macro's grams and share of the calories, drawn as
 * one proportional bar in the macro colours. */
function Energy({ scaled }: { scaled: Scaled }) {
  const t = useTheme(),
    split = macroSplit(scaled),
    pct = wholePercents(split),
    any = MACRO_KEYS.some((k) => split[k] > 0)
  return (
    <>
      <SectionHeading>Calories and macros</SectionHeading>
      <Frame style={{ padding: 16, gap: 12 }}>
        <Line style={{ gap: 6, alignItems: "baseline" }}>
          <Copy size={40} weight="display">
            {whole(scaled.kcal)}
          </Copy>
          <Copy size={14} muted>
            kcal
          </Copy>
        </Line>
        {any && (
          <View
            accessibilityLabel={`Calories by macro: ${MACRO_KEYS.map((k) => `${MACRO[k].label.toLowerCase()} ${pct[k]}%`).join(", ")}`}
            style={{
              flexDirection: "row",
              height: 12,
              borderRadius: 6,
              overflow: "hidden",
              gap: 2,
            }}
          >
            {MACRO_KEYS.filter((k) => split[k] > 0).map((k) => (
              <View
                key={k}
                style={{ flex: split[k], backgroundColor: t[MACRO[k].accent] }}
              />
            ))}
          </View>
        )}
        <View style={{ gap: 8 }}>
          {MACRO_KEYS.map((k) => (
            <Line key={k} style={{ gap: 8 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: t[MACRO[k].accent],
                }}
              />
              <Copy size={14} style={{ flex: 1 }}>
                {MACRO[k].label}
              </Copy>
              <Copy size={14} weight="semibold">
                {`${fmt(scaled[k])} g`}
              </Copy>
              <Copy
                size={12}
                muted
                style={{ minWidth: 40, textAlign: "right" }}
              >
                {`${pct[k]}%`}
              </Copy>
            </Line>
          ))}
        </View>
      </Frame>
    </>
  )
}

const TARGET_ROWS: { key: "kcal" | MacroKey; label: string; unit: string }[] =
  [
    { key: "kcal", label: "Calories", unit: "kcal" },
    { key: "protein", label: "Protein", unit: "g" },
    { key: "carbs", label: "Carbs", unit: "g" },
    { key: "fat", label: "Fat", unit: "g" },
  ]

/** This amount against today's targets: what is already eaten, what this
 * adds, on one bar with the target marked. With no targets set, the same
 * bars show dimmed behind a way to set them. */
function Targets({
  scaled,
  eaten,
  target,
  amount,
}: {
  scaled: Scaled
  eaten: Record<"kcal" | MacroKey, number>
  target: Record<"kcal" | MacroKey, number> | undefined
  amount: string
}) {
  const sample = { kcal: 2000, protein: 150, carbs: 200, fat: 65 }
  const goal = target ?? sample,
    had = target ? eaten : { kcal: 900, protein: 60, carbs: 100, fat: 30 }
  return (
    <>
      <SectionHeading>{`${amount} against today`}</SectionHeading>
      <LockedPreview
        locked={!target}
        title="Set your daily targets"
        detail="See how much of your day each amount of this food takes."
        action={{ label: "Set targets", href: "/nutrition/targets" }}
      >
        <Frame style={{ padding: 16, gap: 14 }}>
          {TARGET_ROWS.map((r) => (
            <TargetRow
              key={r.key}
              row={r}
              eaten={had[r.key]}
              add={scaled[r.key]}
              target={goal[r.key]}
            />
          ))}
        </Frame>
      </LockedPreview>
    </>
  )
}

function TargetRow({
  row,
  eaten,
  add,
  target,
}: {
  row: (typeof TARGET_ROWS)[number]
  eaten: number
  add: number
  target: number
}) {
  const t = useTheme(),
    color = row.key === "kcal" ? t.nut : t[MACRO[row.key].accent],
    share = shareOf(add, target),
    after = eaten + add,
    scale = Math.max(target, after, 1),
    left = target - after
  // Protein is a goal to reach; calories, carbs and fat are budgets.
  const reach = row.key === "protein"
  const status =
    left >= 0
      ? { text: `${whole(left)} ${row.unit} left after this`, color: t.muted }
      : reach
        ? { text: "Target reached", color: t.good }
        : {
            text: `${whole(-left)} ${row.unit} over after this`,
            color: t.warn,
          }
  return (
    <View style={{ gap: 6 }}>
      <Line style={{ gap: 8, alignItems: "baseline" }}>
        <Copy size={14} weight="medium" style={{ flex: 1 }}>
          {row.label}
        </Copy>
        <Copy size={14} weight="semibold">
          {`+${fmt(add)} ${row.unit}`}
        </Copy>
        {share !== null && (
          <Copy size={12} muted>
            {`${whole(share * 100)}% of ${whole(target)}`}
          </Copy>
        )}
      </Line>
      <View
        accessibilityLabel={`${row.label}: ${whole(eaten)} eaten today, this adds ${fmt(add)}, target ${whole(target)} ${row.unit}`}
        style={{ height: 8, justifyContent: "center" }}
      >
        <View
          style={{
            flexDirection: "row",
            height: 8,
            borderRadius: 4,
            overflow: "hidden",
            backgroundColor: t.soft,
          }}
        >
          <View
            style={{
              width: `${(Math.min(eaten, scale) / scale) * 100}%`,
              backgroundColor: `${color}59`,
            }}
          />
          <View
            style={{
              width: `${(Math.min(add, scale - Math.min(eaten, scale)) / scale) * 100}%`,
              backgroundColor: color,
            }}
          />
        </View>
        <View
          style={{
            position: "absolute",
            left: `${(target / scale) * 100}%`,
            top: -3,
            height: 14,
            width: 2,
            borderRadius: 1,
            backgroundColor: t.text,
            transform: [{ translateX: -1 }],
          }}
        />
      </View>
      <Copy size={12} style={{ color: status.color }}>
        {status.text}
      </Copy>
    </View>
  )
}

type FactRow = {
  key: keyof Scaled
  label: string
  unit: string
  sub?: boolean
  /** A goal to reach or a limit to stay under, and its daily amount. */
  kind: "goal" | "limit"
  daily: number | null
}

/** Fiber (and its two kinds), sugar, saturated fat and sodium, each with
 * its share of the day's goal or limit. A value the food does not carry is
 * left out: unknown is never shown as 0. */
function Facts({
  scaled,
  amount,
  limits,
}: {
  scaled: Scaled
  amount: string
  limits: Parameters<typeof limitsFor>[0]
}) {
  const t = useTheme(),
    lim = limitsFor(limits)
  const rows: FactRow[] = [
    {
      key: "fiber",
      label: "Fiber",
      unit: "g",
      kind: "goal",
      daily: fiberGoalFor(limits),
    },
    {
      key: "fiber_soluble",
      label: "Soluble",
      unit: "g",
      sub: true,
      kind: "goal",
      daily: limits?.fiberSolubleGoal ?? null,
    },
    {
      key: "fiber_insoluble",
      label: "Insoluble",
      unit: "g",
      sub: true,
      kind: "goal",
      daily: limits?.fiberInsolubleGoal ?? null,
    },
    { key: "sugar", label: "Added sugar", unit: "g", kind: "limit", daily: lim.sugar },
    {
      key: "sat_fat",
      label: "Saturated fat",
      unit: "g",
      kind: "limit",
      daily: lim.satFat,
    },
    { key: "sodium", label: "Sodium", unit: "mg", kind: "limit", daily: lim.sodium },
  ]
  const known = rows.filter((r) => {
    const v = scaled[r.key]
    return v !== null && v !== undefined
  })
  return (
    <>
      <SectionHeading>{`Nutrition facts · ${amount}`}</SectionHeading>
      {known.length ? (
        <Frame style={{ paddingHorizontal: 16 }}>
          {known.map((r, i) => {
            const v = scaled[r.key] as number,
              share = shareOf(v, r.daily),
              // One amount at 20% of a day's figure is a lot of it (the
              // FDA's 5/20 rule): good for a goal, one to watch for a limit.
              big = share !== null && share >= 0.2,
              tone = big ? (r.kind === "goal" ? t.good : t.warn) : t.muted
            return (
              <Line
                key={r.key}
                style={{
                  gap: 8,
                  paddingVertical: 10,
                  paddingLeft: r.sub ? 16 : 0,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: t.line,
                }}
              >
                <Copy size={14} muted={r.sub} style={{ flex: 1 }}>
                  {r.label}
                </Copy>
                <Copy size={14} weight="semibold">
                  {`${fmt(v)} ${r.unit}`}
                </Copy>
                {share !== null && (
                  <Copy
                    size={12}
                    style={{ color: tone, minWidth: 72, textAlign: "right" }}
                  >
                    {`${whole(share * 100)}% of ${r.kind === "goal" ? "goal" : "limit"}`}
                  </Copy>
                )}
              </Line>
            )
          })}
        </Frame>
      ) : (
        <Copy size={12} muted style={{ paddingHorizontal: 4 }}>
          Only calories and macros are known for this food.
        </Copy>
      )}
    </>
  )
}

const HIGHLIGHT_ICON: Record<Highlight["tone"], LucideIcon> = {
  good: ThumbsUp,
  watch: TriangleAlert,
}

/** What the numbers say (per the food's own basis, so they do not move
 * with the amount), the food's notes, and how its values are stated. */
function About({ food }: { food: LibraryFood }) {
  const t = useTheme(),
    marks = highlights(food),
    meta = [
      `Values ${BASIS_LABEL[food.basis] ?? food.basis}`,
      food.basis !== "100g" && food.unit_grams
        ? `${fmt(food.unit_grams)} g each`
        : null,
      food.barcode ? `Barcode ${food.barcode}` : null,
    ].filter(Boolean)
  return (
    <>
      <SectionHeading>About</SectionHeading>
      <Frame style={{ padding: 16, gap: 10 }}>
        {marks.map((h) => {
          const Icon = HIGHLIGHT_ICON[h.tone],
            color = h.tone === "good" ? t.good : t.warn
          return (
            <Line key={h.key} style={{ gap: 8, alignItems: "flex-start" }}>
              <View style={{ paddingTop: 2 }}>
                <Icon size={14} color={color} />
              </View>
              <Copy size={14} style={{ flex: 1 }}>
                <Copy size={14} weight="medium" style={{ color }}>
                  {h.label}
                </Copy>
                <Copy size={14} muted>
                  {`  ${h.detail}`}
                </Copy>
              </Copy>
            </Line>
          )
        })}
        {!!food.notes && <Copy size={14}>{food.notes}</Copy>}
        <Copy size={12} muted>
          {meta.join(" · ")}
        </Copy>
      </Frame>
    </>
  )
}

/** How often and how much the person eats this food, from their meals,
 * each recent one opening its meal. Never eaten: the same rows, dimmed,
 * behind a way to log it. */
function YourHistory({
  history,
  onLog,
}: {
  history: ReturnType<typeof foodHistory>
  onLog?: () => void
}) {
  const t = useTheme(),
    none = history.count === 0
  const sample = {
    count: 3,
    last: "Yesterday, lunch",
    usual: "1 serving",
  }
  const lastText = history.last
    ? `${C.relDay(history.last.meal.eatenAt)}, ${history.last.meal.label}`
    : sample.last
  const usualText = history.usual
    ? amountLabel(history.usual.qty, history.usual.unit)
    : sample.usual
  return (
    <>
      <SectionHeading icon={History}>Your history</SectionHeading>
      <LockedPreview
        locked={none}
        icon={History}
        title="Not logged yet"
        detail="Log it once and how often, when and how much you eat it shows here."
        action={{ label: "Log this", onPress: onLog }}
      >
        <Frame style={{ padding: 16, gap: 10 }}>
          <Line style={{ gap: 6, alignItems: "baseline" }}>
            <Copy size={28} weight="display">
              {whole(none ? sample.count : history.count)}
            </Copy>
            <Copy size={14} muted>
              {(none ? sample.count : history.count) === 1
                ? "time logged"
                : "times logged"}
            </Copy>
          </Line>
          <Line style={{ gap: 8 }}>
            <Copy size={14} muted style={{ flex: 1 }}>
              Last
            </Copy>
            <Copy size={14} weight="medium">
              {lastText}
            </Copy>
          </Line>
          <Line style={{ gap: 8 }}>
            <Copy size={14} muted style={{ flex: 1 }}>
              Usually
            </Copy>
            <Copy size={14} weight="medium">
              {usualText}
            </Copy>
          </Line>
        </Frame>
        {history.recent.length > 0 && (
          <Frame style={{ marginTop: 8 }}>
            {history.recent.map(({ meal, item }, i) => (
              <Tap
                key={`${meal.id}-${item.id}`}
                label={`${C.relDay(meal.eatenAt)} ${meal.label}, ${amountLabel(item.qty, item.unit)}, ${whole(item.kcal)} kcal. Open meal`}
                onPress={() => go(`/nutrition/meals/${encodeURIComponent(meal.id)}`)}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: t.line,
                }}
              >
                <Line style={{ gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Copy size={14} weight="medium">
                      {`${C.relDay(meal.eatenAt)} · ${meal.label}`}
                    </Copy>
                    <Copy size={12} muted>
                      {C.fmtTime(meal.eatenAt)}
                    </Copy>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Copy size={14}>{amountLabel(item.qty, item.unit)}</Copy>
                    <Copy size={12} muted>
                      {`${whole(item.kcal)} kcal`}
                    </Copy>
                  </View>
                  <ChevronRight size={16} color={t.muted} />
                </Line>
              </Tap>
            ))}
          </Frame>
        )}
      </LockedPreview>
    </>
  )
}

/** A food the member cannot edit becomes one of their own: copy it and open
 * the copy, ready to edit. A failure says why, on screen and in a toast. */
function CopyToMine({ food }: { food: LibraryFood }) {
  const t = useTheme(),
    copy = useCopyFood(),
    [error, setError] = useState<string | null>(null)
  return (
    <View style={{ gap: 6 }}>
      <Button
        tone="quiet"
        icon={CopyPlus}
        disabled={copy.isPending}
        onPress={() => {
          setError(null)
          copy.mutate(food.id, {
            onSuccess: (mine) =>
              replace(`/nutrition/foods/${encodeURIComponent(mine.id)}`),
            onError: (e) => {
              const text =
                e instanceof ApiError && e.status !== 404
                  ? "Couldn't copy this food. Please try again."
                  : foodEditError(e)
              setError(text)
              toast.error(text)
            },
          })
        }}
      >
        {copy.isPending ? "Copying…" : "Copy to mine"}
      </Button>
      {error && (
        <Copy size={12} style={{ color: t.bad }}>
          {error}
        </Copy>
      )}
    </View>
  )
}
