// The Nutrition page, opened to see how the day (or the week) stands
// against the goals and limits and to log what was eaten: one period
// filter at the top; the overview of calories, macros, fiber and the
// limits, each tappable for its breakdown; Log a meal; the day's meals by
// slot; calories by macro over the period; then the links, once.
import * as C from "@domain/fitness/calc"
import type { Macros, Meal } from "@domain/fitness/data"
import {
  dayDetail,
  fiberSplit,
  limitAverages,
  limitsFor,
} from "@domain/fitness/limits"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import {
  BarChart3,
  BookOpen,
  Camera,
  ChevronRight,
  History,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  Share2,
  Sparkles,
  Target,
  UtensilsCrossed,
} from "lucide-react-native"
import { useEffect, useState } from "react"
import { Text, View } from "react-native"
import { FlashLine, useMealFlash } from "../body-moments"
import { Cheer } from "../motion"
import {
  Bar,
  border,
  Copy,
  Frame,
  Line,
  LinkRow,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import type { NutrientKey } from "../nutrient-insights"
import {
  amt,
  daysEnding,
  nutrientDays,
  type Period,
  periodMacros,
} from "../nutrition-period"
import { useTheme } from "../theme"
import { Button, Empty, Screen } from "../ui"
import { Ring } from "../visual"
import { DashedRule } from "./dashed-rule"
import { LockedPreview } from "./locked-preview"
import { LimitList } from "./nutrient-limits"
import { PeriodBar } from "./nutrition-period-bar"

/** Ring sizes for the width the rings get: the full size on a wide card,
 * smaller on a narrow one (Fern's card sits inside a message), and the three
 * macro rings on a row of their own when even the small sizes don't fit. */
export function ringLayout(width: number, rings = 3) {
  const GAP = 16,
    SMALL_GAP = 8,
    gaps = (rings - 1) * SMALL_GAP
  if (!width) return { stacked: false, big: 112, small: 60 }
  // Four small rings (fiber beside the macros) leave the big ring less room.
  const big = Math.max(
    80,
    Math.min(112, Math.round(width * (rings > 3 ? 0.28 : 0.34))),
  )
  const small = Math.floor((width - big - GAP - gaps) / rings)
  if (small >= 44) return { stacked: false, big, small: Math.min(60, small) }
  return {
    stacked: true,
    big: 112,
    small: Math.max(44, Math.min(60, Math.floor((width - gaps) / rings))),
  }
}
const num = (v: number) => Math.round(v).toLocaleString("en-US")
const RING_MACROS = [
  { key: "protein", label: "Protein", accent: "fit" },
  { key: "carbs", label: "Carbs", accent: "tsk" },
  { key: "fat", label: "Fat", accent: "life" },
] as const
export function MacroRings({
  totals,
  target,
  cheer = 0,
  average = false,
  onOpen,
  fiber,
}: {
  totals: Macros
  target?: Macros
  /** Goes up when the protein goal is reached: its ring pops and bursts. */
  cheer?: number
  /** The totals are a daily average over a period, not one day. */
  average?: boolean
  /** Each ring opens that nutrient's breakdown. */
  onOpen?: (key: "kcal" | "protein" | "carbs" | "fat") => void
  /** Fiber as a fourth small ring, against its daily goal. */
  fiber?: { value: number; goal: number }
}) {
  const t = useTheme(),
    [width, setWidth] = useState(0),
    { stacked, big, small } = ringLayout(width, fiber ? 4 : 3),
    left = target && !average ? target.kcal - totals.kcal : undefined
  const open = (key: "kcal" | "protein" | "carbs" | "fat", label: string) =>
    onOpen ? { onPress: () => onOpen(key), label } : null
  const tappable = (
    key: "kcal" | "protein" | "carbs" | "fat",
    label: string,
    child: React.ReactNode,
    style?: object,
  ) => {
    const o = open(key, label)
    // Keyed by nutrient: the macro rings are drawn from a list.
    return o ? (
      <Tap key={key} label={o.label} onPress={o.onPress} style={style}>
        {child}
      </Tap>
    ) : (
      <View key={key} style={style}>
        {child}
      </View>
    )
  }
  const kcal = tappable(
    "kcal",
    `Calories: ${num(totals.kcal)}${target ? ` of ${num(target.kcal)}` : ""} kcal${average ? " a day on average" : ""}. Open the calorie breakdown`,
    <Ring
      size={big}
      value={target ? totals.kcal / target.kcal : 0}
      strokeWidth={big >= 100 ? 10 : 8}
      color={t.nut}
    >
      <Copy
        size={big >= 100 ? 24 : 20}
        weight="semibold"
        // The ring is a fixed circle: its figures grow only so far.
        maxScale={1.15}
        style={{
          lineHeight: big >= 100 ? 24 : 20,
          color: left !== undefined && left < 0 ? t.bad : t.text,
        }}
      >
        {num(left === undefined ? totals.kcal : Math.abs(left))}
      </Copy>
      <Copy size={12} muted maxScale={1.15} style={{ marginTop: 2 }}>
        {left === undefined
          ? average
            ? "kcal a day"
            : "kcal eaten"
          : left < 0
            ? "kcal over"
            : "kcal left"}
      </Copy>
    </Ring>,
  )
  const macros = (
    <Line
      style={{
        flex: stacked ? undefined : 1,
        alignSelf: stacked ? "stretch" : undefined,
        gap: 8,
        justifyContent: "space-between",
        alignItems: "flex-start",
      }}
    >
      {RING_MACROS.map((m) =>
        tappable(
          m.key,
          `${m.label}: ${num(totals[m.key])}${target ? ` of ${num(target[m.key])}` : ""} g${average ? " a day on average" : ""}. Open the ${m.label.toLowerCase()} breakdown`,
          <>
            <Cheer
              fire={m.key === "protein" ? cheer : 0}
              color={t[m.accent]}
              size={small}
            >
              <Ring
                size={small}
                strokeWidth={small >= 56 ? 5 : 4}
                color={t[m.accent]}
                value={target ? totals[m.key] / target[m.key] : 0}
              >
                <Copy
                  size={small >= 52 ? 12 : 11}
                  weight="semibold"
                  maxScale={1.15}
                >
                  {num(totals[m.key])}
                </Copy>
              </Ring>
            </Cheer>
            <View>
              <Line style={{ gap: 1, justifyContent: "center" }}>
                <Copy
                  size={12}
                  muted
                  maxScale={1.3}
                  style={{ textAlign: "center", lineHeight: 12.5 }}
                >
                  {m.label}
                </Copy>
                {onOpen && <ChevronRight size={10} color={t.muted} />}
              </Line>
              {target && (
                <Copy
                  size={12}
                  muted
                  maxScale={1.3}
                  style={{ textAlign: "center", lineHeight: 12.5 }}
                >
                  {average
                    ? `of ${num(target[m.key])} g`
                    : `${num(Math.max(0, target[m.key] - totals[m.key]))} g left`}
                </Copy>
              )}
            </View>
          </>,
          { flex: 1, minWidth: 0, alignItems: "center", gap: 4 },
        ),
      )}
      {fiber && (
        <View
          testID="fiber-ring"
          accessible
          accessibilityLabel={`Fiber: ${num(fiber.value)} of ${num(fiber.goal)} g`}
          style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 4 }}
        >
          <Ring
            size={small}
            strokeWidth={small >= 56 ? 5 : 4}
            color={t.hab}
            value={fiber.goal ? fiber.value / fiber.goal : 0}
          >
            <Copy
              size={small >= 52 ? 12 : 11}
              weight="semibold"
              maxScale={1.15}
            >
              {num(fiber.value)}
            </Copy>
          </Ring>
          <View>
            <Copy
              size={12}
              muted
              maxScale={1.3}
              style={{ textAlign: "center", lineHeight: 12.5 }}
            >
              Fiber
            </Copy>
            <Copy
              size={12}
              muted
              maxScale={1.3}
              style={{ textAlign: "center", lineHeight: 12.5 }}
            >
              {fiber.value >= fiber.goal
                ? "goal met"
                : `${num(fiber.goal - fiber.value)} g left`}
            </Copy>
          </View>
        </View>
      )}
    </Line>
  )
  return (
    <View
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      // Each ring is its own control; the row is laid out by its width.
    >
      {stacked ? (
        <View style={{ alignItems: "center", gap: 12 }}>
          {kcal}
          {macros}
        </View>
      ) : (
        <Line style={{ gap: 16 }}>
          {kcal}
          {macros}
        </Line>
      )}
    </View>
  )
}
/** The day's fiber by kind under the totals line: "Fiber: soluble 2 / 10 g
 * · insoluble 3 / 20 g · 1 g not split". Drawn once an item carries a split
 * or a goal for one is set; fiber from items logged before the split was
 * tracked is said as "not split" (see ``fiberSplit``). */
export function FiberSplitLine({
  items,
  soluble: solubleGoal,
  insoluble: insolubleGoal,
}: {
  items: Parameters<typeof fiberSplit>[0]
  soluble?: number
  insoluble?: number
}) {
  const f = fiberSplit(items),
    g = (v: number) =>
      v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 1 : 0 }),
    kind = (label: string, v: number | undefined, goal?: number) =>
      v === undefined && goal === undefined
        ? null
        : `${label} ${v === undefined ? "—" : g(v)}${goal === undefined ? "" : ` / ${g(goal)}`} g`
  const parts = [
    kind("soluble", f.soluble, solubleGoal),
    kind("insoluble", f.insoluble, insolubleGoal),
  ].filter(Boolean)
  if (!parts.length) return null
  if (f.unsplit > 0) parts.push(`${g(f.unsplit)} g not split`)
  return (
    <Copy size={12} muted style={{ marginTop: 6 }}>
      {`Fiber: ${parts.join(" · ")}`}
    </Copy>
  )
}
export function MealThumb({ meal, size = 44 }: { meal: Meal; size?: number }) {
  const t = useTheme(),
    Icon = meal.photo
      ? UtensilsCrossed
      : {
          photo: Camera,
          voice: Mic,
          text: MessageSquare,
          manual: Pencil,
          connector: Sparkles,
        }[meal.source]
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        backgroundColor: meal.photo ? `${t.nut}66` : t.soft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={20} color={meal.photo ? "#fff" : t.muted} />
    </View>
  )
}

/** A nutrient's breakdown for the page's day and period. */
const openNutrient = (key: NutrientKey, day: string, period: Period) =>
  go(`/nutrition/nutrient/${key}?day=${day}&range=${period}`)

export function Nutrition({
  day: initial = dayKey(),
  period: initialPeriod = "1",
  history = false,
}: {
  day?: string
  period?: Period
  history?: boolean
}) {
  const [day, setDay] = useState(initial),
    [period, setPeriod] = useState<Period>(initialPeriod),
    n = Number(period)
  if (history) return <NutritionHistory />
  return (
    <Screen title="Nutrition">
      <PeriodBar
        day={day}
        period={period}
        onDay={setDay}
        onPeriod={setPeriod}
      />
      <Overview day={day} period={period} />
      <Button icon={Plus} onPress={() => go(`/nutrition/new?day=${day}`)}>
        Log a meal
      </Button>
      <DayMeals day={day} />
      <CaloriesByMacro day={day} n={n === 1 ? 7 : n} period={period} />
      <Frame style={{ padding: 4 }}>
        <PageLinks />
      </Frame>
    </Screen>
  )
}

function PageLinks() {
  const target = fitStore.use((s) => C.budgetFor(s, dayKey()))
  return (
    <>
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
            ? `${num(target.kcal)} kcal · ${num(target.protein)} g protein`
            : "Set calories, protein and limits"
        }
        icon={Target}
        accent="nut"
        href="/nutrition/targets"
      />
      <LinkRow
        title="Share"
        detail="A card of the day's meals and macros"
        icon={Share2}
        accent="nut"
        href="/nutrition/share"
      />
    </>
  )
}

const pill = (text: string, color: string) => (
  <Copy
    size={12}
    weight="medium"
    style={{
      color,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 99,
      backgroundColor: `${color}1a`,
    }}
  >
    {text}
  </Copy>
)

/** Calories, macros, fiber and the limits for the period: the day against
 * what is left of it, or the daily averages with how many days went well. */
function Overview({ day, period }: { day: string; period: Period }) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    n = Number(period),
    today = dayKey(),
    m = periodMacros(s, day, n),
    target = m.target ?? undefined,
    dayTotals = C.dayTotals(s, day),
    meals = C.mealsOn(s, day),
    flash = useMealFlash(day),
    live = n === 1 ? flash : null,
    [cheer, setCheer] = useState({ protein: 0, fiber: 0 }),
    // The settled days of the period with meals: what averages read.
    settled = daysEnding(day, n)
      .filter((d) => n === 1 || d !== today)
      .map((d) => C.mealsOn(s, d))
      .filter((list) => list.length),
    limits = limitAverages(settled, limitsFor(target)),
    detail = n === 1 ? dayDetail(meals) : limits.avg,
    fiber = nutrientDays(s, "fiber", day, n),
    kcal = nutrientDays(s, "kcal", day, n),
    protein = nutrientDays(s, "protein", day, n),
    open = (k: NutrientKey) => openNutrient(k, day, period)
  // Set after the page is up, so a goal reached on the form it came from
  // still pops here: each Cheer fires on a change, not on its first value.
  useEffect(() => {
    if (!live?.goals.length) return
    setCheer({
      protein: live.goals.includes("protein") ? live.at : 0,
      fiber: live.goals.includes("fiber") ? live.at : 0,
    })
  }, [live?.at, live?.goals])
  const kcalOver = live?.over.find((x) => x.key === "kcal"),
    limitFlash = Object.fromEntries(
      (live?.over ?? [])
        .filter((x) => x.key !== "kcal")
        .map((x) => [x.key, x.text]),
    )
  // A rate's colour: most days well is good, half is worth a look.
  const rate = (hit: number, of: number) =>
    !of ? t.muted : hit / of >= 0.8 ? t.good : hit / of >= 0.5 ? t.warn : t.bad
  return (
    <Frame style={{ padding: 16 }}>
      {n > 1 && (
        <Copy size={12} muted style={{ marginBottom: 10 }}>
          {m.days
            ? `A day on average, over ${m.days.toLocaleString("en-US")} logged day${m.days === 1 ? "" : "s"}`
            : `No settled day logged in these ${n} days`}
        </Copy>
      )}
      <MacroRings
        totals={m.totals}
        target={target}
        cheer={cheer.protein}
        average={n > 1}
        onOpen={open}
      />
      {!!live && (kcalOver || live.goals.length > 0) && (
        <Line style={{ marginTop: 10, gap: 6, flexWrap: "wrap" }}>
          {kcalOver && (
            <FlashLine testID="kcal-over" text={kcalOver.text} tone="bad" />
          )}
          {live.goals.includes("protein") && (
            <FlashLine
              testID="protein-hit"
              text="Protein goal hit"
              tone="good"
            />
          )}
          {live.goals.includes("fiber") && (
            <Cheer fire={cheer.fiber} color={t.good} size={40}>
              <FlashLine testID="fiber-hit" text="Fiber goal hit" tone="good" />
            </Cheer>
          )}
        </Line>
      )}
      {!target ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Copy size={14} muted>
            No targets set — showing what you ate.
          </Copy>
          <Button small icon={Target} onPress={() => go("/nutrition/targets")}>
            Set targets
          </Button>
        </View>
      ) : n === 1 ? (
        <Line style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
          <Copy size={12} muted>
            {`${num(dayTotals.totals.kcal)} of ${num(target.kcal)} kcal eaten`}
          </Copy>
          {!!dayTotals.pending && pill(`+${dayTotals.pending} pending`, t.warn)}
          {!!dayTotals.toReview &&
            pill(`${dayTotals.toReview} to review`, t.nut)}
        </Line>
      ) : (
        // How the period went, day by day: Supporting, so one line, but
        // each rate keeps its colour.
        <Copy size={12} muted style={{ marginTop: 12 }}>
          {"Calories on target "}
          <Text
            style={{ color: rate(kcal.hit, kcal.judged), fontWeight: "600" }}
          >
            {`${kcal.hit} of ${kcal.judged} days`}
          </Text>
          {" · protein hit "}
          <Text
            style={{
              color: rate(protein.hit, protein.judged),
              fontWeight: "600",
            }}
          >
            {`${protein.hit} of ${protein.judged}`}
          </Text>
        </Copy>
      )}
      <View
        style={{
          marginTop: 16,
          paddingTop: 16,
          borderTopWidth: 1,
          borderColor: border(t.line, 0.5),
          gap: 16,
        }}
      >
        <FiberBar
          value={fiber.value}
          goal={fiber.goal}
          average={n > 1}
          hit={fiber.hit}
          judged={fiber.judged}
          onPress={() => open("fiber")}
        >
          {n === 1 && (
            <FiberSplitLine
              items={meals
                .filter((x) => x.status !== "pending_estimate")
                .flatMap((x) => x.items)}
              soluble={target?.fiberSolubleGoal}
              insoluble={target?.fiberInsolubleGoal}
            />
          )}
        </FiberBar>
        {/* Goals fill rings; limits are bars to stay under. */}
        <LimitList
          detail={detail}
          limits={limitsFor(target)}
          scope={n === 1 ? "day" : "average"}
          overDays={n === 1 ? undefined : limits.over}
          flash={limitFlash}
          onOpen={open}
        />
      </View>
    </Frame>
  )
}

/** Fiber fills toward its goal, as the rings do: a goal, not a limit. */
function FiberBar({
  value,
  goal,
  average,
  hit,
  judged,
  onPress,
  children,
}: {
  value: number | null
  goal: number | undefined
  average: boolean
  hit: number
  judged: number
  onPress: () => void
  children?: React.ReactNode
}) {
  const t = useTheme(),
    reached = value !== null && goal !== undefined && value >= goal * 0.9,
    right =
      value === null
        ? `not tracked yet${goal ? ` · goal ${amt(goal)} g` : ""}`
        : `${average ? "avg " : ""}${amt(value)}${goal ? ` / ${amt(goal)}` : ""} g${
            average
              ? judged
                ? ` · hit on ${hit} of ${judged} days`
                : ""
              : goal
                ? reached
                  ? " · reached"
                  : ` · ${amt(goal - value)} g to go`
                : ""
          }`
  return (
    <Tap
      label={`Fiber: ${right}. Open the fiber breakdown`}
      onPress={onPress}
      style={{ gap: 4 }}
    >
      {/* The figure sits beside the label, or under it when the text is
          too large to share the line. */}
      <Line
        style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}
      >
        <Line style={{ gap: 2 }}>
          <Copy size={12} weight="medium">
            Fiber
          </Copy>
          <ChevronRight size={12} color={t.muted} />
        </Line>
        <Copy
          size={12}
          style={{
            flexGrow: 1,
            maxWidth: "100%",
            textAlign: "right",
            color: reached ? t.good : t.muted,
          }}
        >
          {right}
        </Copy>
      </Line>
      <Bar
        value={value !== null && goal ? Math.min(1, value / goal) : 0}
        color={t.good}
      />
      {children}
    </Tap>
  )
}

const SLOTS = ["breakfast", "lunch", "snack", "dinner"] as const
const SLOT_LABEL = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Snack",
  dinner: "Dinner",
}
const MINI = [
  { key: "protein", short: "P", accent: "fit" },
  { key: "carbs", short: "C", accent: "tsk" },
  { key: "fat", short: "F", accent: "life" },
] as const

/** The day's meals as a timeline of its four slots: each slot's calories,
 * its meals with their macros, an empty slot that logs straight into it,
 * and "Now" on today. */
function DayMeals({ day }: { day: string }) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    today = dayKey(),
    meals = C.mealsOn(s, day).sort((a, b) =>
      a.eatenAt.localeCompare(b.eatenAt),
    ),
    total = C.sumMacros(
      meals.filter((m) => m.status !== "pending_estimate").map(C.mealTotals),
    ),
    // Where "Now" sits: after the slot the clock is in. A snack between
    // lunch and dinner sits after lunch; a late one (the business day runs
    // past midnight) after dinner.
    now = new Date(),
    nowSlot = C.labelForTime(now),
    nowAfter =
      day !== today
        ? -1
        : nowSlot === "snack"
          ? now.getHours() >= 15 && now.getHours() < 17
            ? 1
            : 3
          : SLOTS.indexOf(nowSlot)
  const rail = (filled: boolean, last: boolean) => (
    <View style={{ width: 16, alignItems: "center", alignSelf: "stretch" }}>
      <View
        style={{
          marginTop: 4,
          width: 12,
          height: 12,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: filled ? t.nut : border(t.muted, 0.5),
          backgroundColor: filled ? t.nut : "transparent",
        }}
      />
      {!last && (
        <View
          style={{
            flex: 1,
            width: 2,
            marginTop: 2,
            backgroundColor: border(t.line, 0.8),
          }}
        />
      )}
    </View>
  )
  const nowMark = (
    <Line key="now" style={{ gap: 10, paddingVertical: 2 }}>
      <View style={{ width: 16, alignItems: "center" }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: t.nut,
          }}
        />
      </View>
      <Copy size={12} weight="semibold" style={{ color: t.nut }}>
        {`Now · ${C.fmtTime(now.toISOString())}`}
      </Copy>
      <View style={{ flex: 1, height: 1, backgroundColor: `${t.nut}55` }} />
    </Line>
  )
  return (
    <Frame style={{ padding: 16, paddingBottom: 8 }}>
      <Line style={{ gap: 8, marginBottom: 12 }}>
        <UtensilsCrossed size={16} color={t.nut} />
        <Copy size={16} weight="semibold" style={{ flex: 1 }}>
          {day === today ? "Today's meals" : `Meals · ${C.fmtDay(day)}`}
        </Copy>
        {!!meals.length && (
          <Copy
            size={13}
            weight="semibold"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {`${num(total.kcal)} kcal`}
          </Copy>
        )}
      </Line>
      {SLOTS.map((slot, i) => {
        const list = meals.filter((m) => m.label === slot),
          counted = list.filter((m) => m.status !== "pending_estimate"),
          sum = C.sumMacros(counted.map(C.mealTotals)),
          last = i === SLOTS.length - 1
        return (
          <View key={slot}>
            <Line style={{ gap: 10, alignItems: "flex-start" }}>
              {rail(list.length > 0, last)}
              <View style={{ flex: 1, paddingBottom: last ? 4 : 14 }}>
                {list.length ? (
                  <Line style={{ justifyContent: "space-between", gap: 8 }}>
                    <Copy size={14} weight="semibold">
                      {SLOT_LABEL[slot]}
                    </Copy>
                    {!!counted.length && (
                      <Copy
                        size={12}
                        muted
                        style={{ fontVariant: ["tabular-nums"] }}
                      >
                        {`${num(sum.kcal)} kcal`}
                      </Copy>
                    )}
                  </Line>
                ) : (
                  // An empty slot logs straight into it.
                  <Tap
                    label={`Log ${slot}`}
                    onPress={() =>
                      go(`/nutrition/new?day=${day}&label=${slot}`)
                    }
                    style={{ minHeight: 24, justifyContent: "center" }}
                  >
                    <Line style={{ justifyContent: "space-between", gap: 8 }}>
                      <Copy size={14} muted>
                        {SLOT_LABEL[slot]}
                      </Copy>
                      <Line style={{ gap: 4 }}>
                        <Plus size={14} color={t.primary} />
                        <Copy
                          size={12}
                          weight="medium"
                          style={{ color: t.primary }}
                        >
                          Log
                        </Copy>
                      </Line>
                    </Line>
                  </Tap>
                )}
                {list.map((m) => (
                  <MealRow key={m.id} meal={m} />
                ))}
              </View>
            </Line>
            {nowAfter === i && !last && nowMark}
          </View>
        )
      })}
      {nowAfter === 3 && nowMark}
    </Frame>
  )
}

/** One meal: what it was (whole, wrapping), then when, its macros and its
 * state on one line, and its calories at the right. The row opens it. */
function MealRow({ meal: m }: { meal: Meal }) {
  const t = useTheme(),
    waiting = m.status === "pending_estimate",
    tot = C.mealTotals(m),
    what = m.items.length
      ? m.items.map((i) => i.name.replace(/\s*\(.*\)/, "")).join(", ")
      : m.rawInput
  return (
    <Tap
      label={`${what}, ${C.fmtTime(m.eatenAt)}${waiting ? ", estimating when online" : `, ${num(tot.kcal)} kcal, protein ${num(tot.protein)} g, carbs ${num(tot.carbs)} g, fat ${num(tot.fat)} g`}. Open meal`}
      onPress={() => go(`/nutrition/meals/${m.id}`)}
      style={{ paddingVertical: 8 }}
    >
      <Line style={{ alignItems: "flex-start", gap: 10 }}>
        <MealThumb meal={m} size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <Copy size={14} weight="medium">
            {what}
          </Copy>
          <Line style={{ gap: 8, flexWrap: "wrap" }}>
            <Copy size={12} muted>
              {C.fmtTime(m.eatenAt)}
            </Copy>
            {!waiting && (
              <Copy size={12} muted style={{ fontVariant: ["tabular-nums"] }}>
                {MINI.map((x, i) => (
                  <Text key={x.key}>
                    {i ? "  " : ""}
                    <Text style={{ color: t[x.accent], fontWeight: "600" }}>
                      {x.short}
                    </Text>
                    {` ${num(tot[x.key])}`}
                  </Text>
                ))}
              </Copy>
            )}
            {waiting
              ? pill("Estimating when online", t.warn)
              : m.status === "estimated"
                ? pill("Review", t.nut)
                : m.source === "connector"
                  ? pill("via Claude", t.muted)
                  : null}
          </Line>
        </View>
        {!waiting && (
          <Copy
            size={14}
            weight="semibold"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {num(tot.kcal)}
          </Copy>
        )}
      </Line>
    </Tap>
  )
}

const MACROS = [
  // Energy per gram, and the colours the macro rings use.
  { key: "protein", label: "Protein", kcal: 4, accent: "fit" },
  { key: "carbs", label: "Carbs", kcal: 4, accent: "tsk" },
  { key: "fat", label: "Fat", kcal: 9, accent: "life" },
] as const
const CHART = 120
const pct = (v: number) => `${Math.round(v * 100)}%`

/** Where the calories came from, a bar a day over the period (a day is
 * shown in the week it closes), against each macro's target stacked as the
 * bars are, in dashes so a bar touching its line shows through. Each macro
 * row opens its breakdown. */
function CaloriesByMacro({
  day,
  n,
  period,
}: {
  day: string
  n: number
  period: Period
}) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    today = dayKey(),
    days = daysEnding(day, n).map((d) => ({
      day: d,
      totals: C.dayTotals(s, d).totals,
    })),
    logged = days.some((d) => d.totals.kcal > 0),
    target = C.budgetFor(s, day),
    rows = MACROS.map((m) => ({ ...m, r: nutrientDays(s, m.key, day, n) })),
    splitTotal = rows.reduce((a, m) => a + (m.r.value ?? 0) * m.kcal, 0),
    targetTotal = target
      ? MACROS.reduce((a, m) => a + target[m.key] * m.kcal, 0)
      : 0,
    top = Math.max(
      1,
      target?.kcal ?? 0,
      targetTotal,
      ...days.map((d) =>
        MACROS.reduce((a, m) => a + d.totals[m.key] * m.kcal, 0),
      ),
    ),
    every = n <= 7 ? 1 : n <= 14 ? 2 : 5,
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
        : []
  return (
    <LockedPreview
      locked={!logged}
      title="Where your calories come from starts here"
      detail="Log meals for a few days and this shows each day's calories split by protein, carbs and fat, against your targets."
      action={{ label: "Log a meal", href: `/nutrition/new?day=${day}` }}
      color={t.nut}
      icon={BarChart3}
    >
      <Frame style={{ padding: 16, gap: 12 }}>
        <View style={{ gap: 2 }}>
          <Line style={{ gap: 8 }}>
            <BarChart3 size={16} color={t.nut} />
            <Copy size={16} weight="semibold" style={{ flex: 1 }}>
              Calories by macro
            </Copy>
          </Line>
          <Copy size={12} muted>
            {`${period === "1" ? "The 7 days to this day" : `${n} days`} · ${
              target
                ? `dashed lines are each macro's target, stacked to ${num(target.kcal)} kcal`
                : "each bar a day"
            }`}
          </Copy>
        </View>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Calories by macro, ${n} days to ${C.fmtDay(day)}${target ? `; targets ${MACROS.map((m) => `${m.label.toLowerCase()} ${num(target[m.key])} g`).join(", ")}` : ""}`}
          style={{ height: CHART, justifyContent: "flex-end" }}
        >
          <Line style={{ alignItems: "flex-end", gap: n > 14 ? 2 : 4 }}>
            {days.map((d) => {
              const parts = MACROS.map((m) => ({
                ...m,
                kcal: d.totals[m.key] * m.kcal,
              }))
              const total = parts.reduce((a, p) => a + p.kcal, 0)
              return (
                <View
                  key={d.day}
                  style={{ flex: 1, height: CHART, justifyContent: "flex-end" }}
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
                        // The page's day at full strength; today, still
                        // open, lighter.
                        opacity:
                          d.day === today && d.day !== day
                            ? 0.45
                            : d.day === day
                              ? 1
                              : 0.7,
                      }}
                    >
                      {parts.map((p) => (
                        <View
                          key={p.key}
                          style={{ flex: p.kcal, backgroundColor: t[p.accent] }}
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
          {/* The targets stacked as the bars are: protein's line where its
              target calories end, carbs' above it, fat's at the top. A
              segment reaching its own dashes is that macro on target. */}
          {stacked.map((m) => (
            <DashedRule
              key={m.key}
              testID={`macro-target-${m.key}`}
              bottom={(m.at / top) * CHART}
              color={t[m.accent]}
              width={2}
            />
          ))}
          {/* A calorie target the macro targets don't add up to keeps its
              own line. */}
          {target && !stacked.length && (
            <DashedRule
              testID="kcal-target"
              bottom={(target.kcal / top) * CHART}
              color={t.good}
            />
          )}
        </View>
        <Line style={{ gap: n > 14 ? 2 : 4, marginTop: -4 }}>
          {days.map((d, i) => (
            <Copy
              key={d.day}
              size={12}
              muted={d.day !== day}
              weight={d.day === day ? "semibold" : "body"}
              style={{ flex: 1, textAlign: "center" }}
            >
              {(days.length - 1 - i) % every ? "" : Number(d.day.slice(8))}
            </Copy>
          ))}
        </Line>
        {/* One row per macro: its share of the calories, then its grams a
            day against its target. Each opens that macro's breakdown. */}
        <View>
          {rows.map((m) => {
            const goal = target?.[m.key] ?? 0
            const avg = `avg ${m.r.value === null ? "—" : num(m.r.value)}${goal ? ` / ${num(goal)}` : ""} g`
            const days =
              goal && m.r.judged
                ? `${m.key === "protein" ? "hit" : "within 10%"} on ${num(m.r.hit)} of ${num(m.r.judged)} days`
                : null
            const line = days ? `${avg} · ${days}` : avg
            return (
              <Tap
                key={m.key}
                label={`${m.label}: ${line}. Open the ${m.label.toLowerCase()} breakdown`}
                onPress={() => openNutrient(m.key, day, period)}
                style={{ paddingVertical: 6 }}
              >
                {/* Every row the same two lines: the macro, its share and
                    its grams a day; then how many days landed. */}
                <Line style={{ gap: 8, alignItems: "flex-start" }}>
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      marginTop: 3,
                      borderRadius: 3,
                      backgroundColor: t[m.accent],
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Line style={{ justifyContent: "space-between", gap: 8 }}>
                      <Copy size={13} weight="medium">
                        {m.label}
                        <Text style={{ color: t.muted, fontWeight: "400" }}>
                          {`  ${
                            splitTotal
                              ? pct(((m.r.value ?? 0) * m.kcal) / splitTotal)
                              : "—"
                          }`}
                        </Text>
                      </Copy>
                      <Copy size={13} style={{ fontVariant: ["tabular-nums"] }}>
                        {avg}
                      </Copy>
                    </Line>
                    {days && (
                      <Copy
                        size={12}
                        style={{
                          textAlign: "right",
                          color:
                            m.r.hit / m.r.judged >= 0.8
                              ? t.good
                              : m.r.hit / m.r.judged >= 0.5
                                ? t.warn
                                : t.bad,
                        }}
                      >
                        {days}
                      </Copy>
                    )}
                  </View>
                  <ChevronRight
                    size={14}
                    color={t.muted}
                    style={{ marginTop: 2 }}
                  />
                </Line>
              </Tap>
            )
          })}
        </View>
      </Frame>
    </LockedPreview>
  )
}

function NutritionHistory() {
  const t = useTheme(),
    s = fitStore.use((s) => s),
    [range, setRange] = useState("14"),
    adherence = C.adherence(s, Number(range))
  return (
    <Screen title="Nutrition history">
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: "7", label: "7 days" },
          { value: "14", label: "14 days" },
          { value: "30", label: "30 days" },
        ]}
      />
      {!adherence.days.some((d) => d.meals) ? (
        <Empty
          title="No meals logged in this range"
          detail="On-target stats appear once you log at least one day."
          action={<Button onPress={() => go("/nutrition")}>Log today</Button>}
        />
      ) : (
        <>
          <Frame style={{ padding: 16 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
              {[
                {
                  label: "Calories on target",
                  value: `${Math.round(adherence.calorie * 100)}%`,
                },
                {
                  label: "Protein hit rate",
                  value: `${Math.round(adherence.protein * 100)}%`,
                },
                { label: "Over-target days", value: adherence.overDays },
                {
                  label: "Days logged",
                  value: `${Math.round(adherence.coverage * 100)}%`,
                },
              ].map((v, i) => (
                <View key={v.label} style={{ width: "46%" }}>
                  <Copy
                    size={30}
                    weight="displayMedium"
                    style={{ color: i === 0 ? t.nut : t.text }}
                  >
                    {v.value}
                  </Copy>
                  <Copy size={12} muted>
                    {v.label}
                  </Copy>
                </View>
              ))}
            </View>
          </Frame>
          {adherence.coverage < 0.8 && (
            <Copy size={12} muted>
              Logged under 80% of days — these stats are incomplete, not
              perfect.
            </Copy>
          )}
          <View style={{ gap: 4, marginTop: 4 }}>
            {[...adherence.days].reverse().map((d) => (
              <Tap
                key={d.day}
                onPress={() => go(`/nutrition?day=${d.day}`)}
                style={{ paddingHorizontal: 4, paddingVertical: 12 }}
              >
                <Line>
                  <View style={{ flex: 1 }}>
                    <Line style={{ justifyContent: "space-between" }}>
                      <Copy weight="medium">{C.fmtDay(d.day)}</Copy>
                      {pill(
                        d.verdict === "none"
                          ? d.meals
                            ? "No target"
                            : "Not logged"
                          : d.verdict === "hit"
                            ? "On target"
                            : d.verdict === "over"
                              ? "Over"
                              : "Under",
                        d.verdict === "hit"
                          ? t.good
                          : d.verdict === "over"
                            ? t.bad
                            : d.verdict === "none"
                              ? t.muted
                              : t.warn,
                      )}
                    </Line>
                    {d.meals ? (
                      <>
                        <View style={{ marginVertical: 4 }}>
                          <Bar
                            value={d.target ? d.totals.kcal / d.target.kcal : 0}
                            color={t.nut}
                          />
                        </View>
                        <Copy size={12} muted>
                          {Math.round(d.totals.kcal).toLocaleString("en-US")}
                          {d.target
                            ? `/${d.target.kcal.toLocaleString("en-US")}`
                            : ""}{" "}
                          kcal · P {Math.round(d.totals.protein)}
                          {d.target ? `/${d.target.protein}` : ""} g{" "}
                          {d.proteinHit ? "✓" : ""}
                        </Copy>
                      </>
                    ) : (
                      <Copy size={14} muted>
                        —
                      </Copy>
                    )}
                  </View>
                  <ChevronRight size={16} color={t.muted} />
                </Line>
              </Tap>
            ))}
          </View>
        </>
      )}
    </Screen>
  )
}
