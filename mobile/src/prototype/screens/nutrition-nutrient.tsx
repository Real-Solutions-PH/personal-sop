// One nutrient's breakdown, opened from its ring or bar on the Nutrition
// page: the amount for the period against its goal or limit, day by day,
// then the foods that gave the most of it and the meals that gave the most
// (or the most per calorie). It reads the page's period and day, and can
// change them here. Counted from the logged items; nothing is estimated.
import * as C from "@domain/fitness/calc"
import type { Meal } from "@domain/fitness/data"
import { limitLevel } from "@domain/fitness/limits"
import { fitStore } from "@domain/fitness/store"
import { openCapture } from "@domain/lib/capture"
import { dayKey } from "@domain/lib/day"
import { BarChart3, Info, Trophy, UtensilsCrossed } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { Text, View } from "react-native"
import { mealName } from "../meal-breakdown"
import { GrowBar } from "../motion"
import { border, Copy, Frame, Line, Segmented, Tap } from "../native-kit"
import { go } from "../navigation"
import {
  MIN_MEAL_KCAL,
  type NutrientKey,
  rankMeals,
  topFoods,
} from "../nutrient-insights"
import {
  amt,
  daysEnding,
  isLimit,
  NUTRIENT_INFO,
  nutrientDays,
  type Period,
  withUnit,
} from "../nutrition-period"
import { type Accent, useTheme } from "../theme"
import { Screen } from "../ui"
import { DashedRule } from "./dashed-rule"
import { LockedPreview } from "./locked-preview"
import { PeriodBar } from "./nutrition-period-bar"

const SHOWN = 5
const CHART = 112
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"]

/** The page's colour for each nutrient, so it reads the same everywhere. */
export const NUTRIENT_ACCENT: Partial<Record<NutrientKey, Accent>> = {
  kcal: "nut",
  protein: "fit",
  carbs: "tsk",
  fat: "life",
}

/** A share that rounds to nothing still says it is there. */
const pct = (v: number) =>
  v > 0 && v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`

// Shown dimmed, never as numbers, while the period has no meals yet.
const sampleItem = (name: string, m: Partial<Meal["items"][number]>) => ({
  id: name,
  name,
  qty: 1,
  unit: "serving",
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  satFat: 0,
  sugar: 0,
  sodium: 0,
  ...m,
})
export const SAMPLE_MEALS: Meal[] = (
  [
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
          sodium: 90,
        }),
        sampleItem("Pandesal", {
          kcal: 240,
          protein: 7,
          carbs: 46,
          fat: 3,
          sugar: 6,
          fiber: 2,
          sodium: 380,
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
          satFat: 6,
          sodium: 720,
        }),
        sampleItem("Rice", { kcal: 240, protein: 4, carbs: 53, fiber: 1 }),
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
          satFat: 5,
          sugar: 41,
          sodium: 110,
        }),
      ],
    ],
  ] as const
).map(([label, at, items], i) => ({
  id: `sample-${i}`,
  label,
  eatenAt: `2026-01-01T${at}:00`,
  source: "text" as const,
  rawInput: "",
  status: "confirmed" as const,
  items: items.map((x) => ({ ...x })),
}))

export function NutrientDetail({
  nutrient,
  day: initialDay = dayKey(),
  period: initialPeriod = "1",
}: {
  nutrient: NutrientKey
  day?: string
  period?: Period
}) {
  const t = useTheme(),
    s = fitStore.use((s) => s),
    [day, setDay] = useState(initialDay),
    [period, setPeriod] = useState<Period>(initialPeriod),
    n = Number(period),
    info = NUTRIENT_INFO[nutrient],
    real = daysEnding(day, n).flatMap((d) => C.mealsOn(s, d)),
    locked = !real.some((m) => m.status !== "pending_estimate"),
    meals = locked ? SAMPLE_MEALS : real
  return (
    <Screen title={info.label}>
      <PeriodBar
        day={day}
        period={period}
        onDay={setDay}
        onPeriod={setPeriod}
      />
      <LockedPreview
        locked={locked}
        title={`Your ${info.label.toLowerCase()} breakdown starts here`}
        detail={`Log a meal and this shows your ${info.label.toLowerCase()} against your ${isLimit(nutrient) ? "limit" : "goal"}, the foods that gave the most of it, and the meals that gave the most for their calories.`}
        action={{
          label: "Snap a meal",
          onPress: () => openCapture({ mode: "photo", hint: "meal" }),
        }}
        color={t.nut}
        icon={BarChart3}
        gap={16}
      >
        <Amount nutrient={nutrient} day={day} n={n} onPickDay={setDay} />
        <TopFoods meals={meals} nutrient={nutrient} />
        <TopMeals meals={meals} nutrient={nutrient} oneDay={n === 1} />
      </LockedPreview>
    </Screen>
  )
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Trophy
  title: string
  children: ReactNode
}) {
  const t = useTheme()
  return (
    <Frame style={{ paddingVertical: 12 }}>
      <Line style={{ paddingHorizontal: 12, gap: 8 }}>
        <Icon size={16} color={t.nut} />
        <Copy size={16} weight="semibold" style={{ flex: 1 }}>
          {title}
        </Copy>
      </Line>
      {children}
    </Frame>
  )
}

/** The period's amount against its goal or limit, then each day. */
function Amount({
  nutrient,
  day,
  n,
  onPickDay,
}: {
  nutrient: NutrientKey
  day: string
  n: number
  onPickDay: (day: string) => void
}) {
  const t = useTheme(),
    s = fitStore.use((s) => s),
    { label, unit, kind } = NUTRIENT_INFO[nutrient],
    r = nutrientDays(s, nutrient, day, n),
    // A day is drawn among the week it closes, so its bar has neighbours.
    chart = n === 1 ? nutrientDays(s, nutrient, day, 7) : r,
    value = r.value,
    goal = r.goal,
    open = n === 1 && day === dayKey(),
    // What the amount means for this nutrient: a limit passed is red, a
    // goal short (once the day is over) or a target missed is orange.
    tone = (() => {
      if (value === null || goal === undefined) return t.text
      if (kind === "under") {
        const l = limitLevel(value, goal).level
        return l === "over" ? t.bad : l === "near" ? t.warn : t.good
      }
      if (kind === "reach")
        return value >= goal * 0.9 ? t.good : open ? t.text : t.warn
      if (Math.abs(value - goal) <= goal * 0.1) return t.good
      if (value > goal) return nutrient === "kcal" ? t.bad : t.warn
      return open ? t.text : t.warn
    })(),
    gap = value === null || goal === undefined ? 0 : goal - value,
    against =
      goal === undefined
        ? null
        : `${kind === "under" ? "limit" : "goal"} ${withUnit(goal, unit)}`,
    where =
      value === null || goal === undefined
        ? null
        : kind === "under"
          ? gap < 0
            ? `${withUnit(-gap, unit)} past it`
            : `${withUnit(gap, unit)} room`
          : kind === "reach"
            ? gap <= goal * 0.1
              ? "reached"
              : `${withUnit(gap, unit)} to go`
            : gap < 0
              ? `${withUnit(-gap, unit)} over`
              : `${withUnit(gap, unit)} left`,
    verb = kind === "under" ? "under" : kind === "reach" ? "hit" : "on target",
    top = Math.max(
      1,
      ...chart.points.map((p) => Math.max(p.value ?? 0, (p.goal ?? 0) * 1.15)),
    ),
    colorOf = (status: string) =>
      status === "hit"
        ? t.good
        : status === "over"
          ? kind === "under" || nutrient === "kcal"
            ? t.bad
            : t.warn
          : status === "miss"
            ? t.warn
            : t.muted,
    chartGoal = chart.points.find((p) => p.goal !== undefined)?.goal
  return (
    <Frame style={{ padding: 16, gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Line style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <Copy
            size={30}
            weight="displayMedium"
            style={{ color: value === null ? t.muted : tone }}
          >
            {value === null ? "Not tracked" : withUnit(value, unit)}
          </Copy>
          {where && (
            <Copy size={14} weight="semibold" style={{ color: tone }}>
              {where}
            </Copy>
          )}
        </Line>
        <Copy size={12} muted>
          {[
            value === null
              ? n === 1
                ? `No ${label.toLowerCase()} recorded this day`
                : `No ${label.toLowerCase()} recorded in these ${n} days`
              : n === 1
                ? open
                  ? "so far today"
                  : "this day"
                : `a day on average, over ${r.tracked.toLocaleString("en-US")} logged day${r.tracked === 1 ? "" : "s"}`,
            against,
            n > 1 && r.judged
              ? `${verb} on ${r.hit.toLocaleString("en-US")} of ${r.judged.toLocaleString("en-US")} days`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Copy>
      </View>
      <View
        accessible
        accessibilityLabel={`${label}, ${chart.points.length} days to ${C.fmtDay(day)}: ${chart.points
          .map(
            (p) =>
              `${C.fmtDay(p.day)} ${p.value === null ? "not logged" : withUnit(p.value, unit)}`,
          )
          .join("; ")}`}
        style={{ height: CHART, justifyContent: "flex-end" }}
      >
        <Line
          style={{
            alignItems: "flex-end",
            gap: chart.points.length > 14 ? 2 : 4,
          }}
        >
          {chart.points.map((p, i) => (
            <Tap
              key={p.day}
              label={`Show ${C.fmtDay(p.day)}`}
              onPress={() => onPickDay(p.day)}
              style={{ flex: 1, height: CHART, justifyContent: "flex-end" }}
            >
              {p.value === null ? (
                <View
                  style={{
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: t.line,
                  }}
                />
              ) : (
                <GrowBar
                  index={i}
                  height={Math.max(3, (p.value / top) * CHART)}
                  style={{
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    backgroundColor: colorOf(p.status),
                    // The day the page is on stands out from its week.
                    opacity:
                      p.status === "open"
                        ? 0.45
                        : n === 1 && p.day !== day
                          ? 0.55
                          : 1,
                  }}
                />
              )}
            </Tap>
          ))}
        </Line>
        {chartGoal !== undefined && (
          <DashedRule
            testID="nutrient-goal-line"
            bottom={(chartGoal / top) * CHART}
            color={kind === "under" ? t.bad : t.text}
          />
        )}
      </View>
      <Line style={{ gap: chart.points.length > 14 ? 2 : 4, marginTop: -6 }}>
        {chart.points.map((p, i) => {
          const every =
            chart.points.length <= 7 ? 1 : chart.points.length <= 14 ? 2 : 5
          return (
            <Copy
              key={p.day}
              size={10}
              muted={p.day !== day}
              weight={p.day === day ? "semibold" : "body"}
              lines={1}
              style={{ flex: 1, textAlign: "center" }}
            >
              {(chart.points.length - 1 - i) % every === 0
                ? chart.points.length <= 7
                  ? WEEKDAY[new Date(`${p.day}T12:00:00`).getDay()]
                  : String(Number(p.day.slice(8)))
                : ""}
            </Copy>
          )
        })}
      </Line>
    </Frame>
  )
}

const ShowAll = ({
  all,
  count,
  noun,
  onPress,
}: {
  all: boolean
  count: number
  noun: string
  onPress: () => void
}) => {
  const t = useTheme()
  return (
    <Tap
      label={all ? `Show the top ${SHOWN} only` : `Show all ${count} ${noun}`}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 2,
        borderTopWidth: 1,
        borderColor: border(t.line, 0.5),
      }}
    >
      <Copy size={13} weight="medium" style={{ color: t.nut }}>
        {all
          ? `Show top ${SHOWN}`
          : `Show all ${count.toLocaleString("en-US")} ${noun}`}
      </Copy>
    </Tap>
  )
}

const Note = ({ children }: { children: string }) => {
  const t = useTheme()
  return (
    <Line style={{ paddingHorizontal: 12, paddingTop: 10, gap: 6 }}>
      <Info size={14} color={t.muted} />
      <Copy size={12} muted style={{ flex: 1 }}>
        {children}
      </Copy>
    </Line>
  )
}

function TopFoods({
  meals,
  nutrient,
}: {
  meals: Meal[]
  nutrient: NutrientKey
}) {
  const t = useTheme(),
    [all, setAll] = useState(false),
    { label, unit } = NUTRIENT_INFO[nutrient],
    r = topFoods(meals, nutrient),
    rows = all ? r.rows : r.rows.slice(0, SHOWN),
    accent = NUTRIENT_ACCENT[nutrient],
    bar = accent ? t[accent] : isLimit(nutrient) ? t.warn : t.good
  return (
    <Card icon={UtensilsCrossed} title={`Top foods for ${label.toLowerCase()}`}>
      {!r.rows.length && (
        <Copy size={13} muted style={{ paddingHorizontal: 12, paddingTop: 8 }}>
          {r.unknown
            ? `None of the ${r.unknown.toLocaleString("en-US")} foods logged carry a ${label.toLowerCase()} value yet.`
            : `No ${label.toLowerCase()} in the foods logged.`}
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
        <ShowAll
          all={all}
          count={r.rows.length}
          noun="foods"
          onPress={() => setAll(!all)}
        />
      )}
      {!!r.unknown && !!r.rows.length && (
        <Note>
          {`${r.unknown.toLocaleString("en-US")} food${r.unknown === 1 ? " has" : "s have"} no ${label.toLowerCase()} value and ${r.unknown === 1 ? "is" : "are"} not counted.`}
        </Note>
      )}
    </Card>
  )
}

function TopMeals({
  meals,
  nutrient,
  oneDay,
}: {
  meals: Meal[]
  nutrient: NutrientKey
  oneDay: boolean
}) {
  const t = useTheme(),
    perKcal = nutrient !== "kcal",
    [by, setBy] = useState<"amount" | "per100">(
      nutrient === "protein" || nutrient === "fiber" ? "per100" : "amount",
    ),
    mode = perKcal ? by : "amount",
    [all, setAll] = useState(false),
    { label, unit } = NUTRIENT_INFO[nutrient],
    r = rankMeals(meals, nutrient, mode),
    rows = all ? r.rows : r.rows.slice(0, SHOWN),
    accent = NUTRIENT_ACCENT[nutrient],
    color = accent ? t[accent] : isLimit(nutrient) ? t.warn : t.good,
    name = (m: Meal) => {
      if (oneDay) return mealName(m, meals, C.fmtTime)
      const kind = m.label[0].toUpperCase() + m.label.slice(1)
      return `${kind} · ${C.fmtDay(C.mealDay(m))}`
    }
  return (
    <Card
      icon={Trophy}
      title={
        mode === "per100"
          ? `Most ${label.toLowerCase()} per calorie`
          : `Meals with the most ${label.toLowerCase()}`
      }
    >
      {perKcal && (
        <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
          <Segmented
            value={by}
            onChange={(v) => {
              setBy(v)
              setAll(false)
            }}
            options={[
              { value: "amount", label: "Most" },
              { value: "per100", label: "Per 100 kcal" },
            ]}
          />
        </View>
      )}
      {!r.rows.length && (
        <Copy size={13} muted style={{ paddingHorizontal: 12, paddingTop: 10 }}>
          {mode === "per100" && r.skipped && !r.unknown
            ? `No meal of ${MIN_MEAL_KCAL} kcal or more yet.`
            : `No meal with ${label.toLowerCase()} recorded yet.`}
        </Copy>
      )}
      <View style={{ marginTop: 8 }}>
        {rows.map((m, i) => {
          const what = m.meal.items.length
            ? m.meal.items
                .map((x) => x.name.replace(/\s*\(.*\)/, ""))
                .join(", ")
            : m.meal.rawInput
          const each = m.count > 1 ? " each" : ""
          const hero =
            mode === "per100"
              ? withUnit(m.per100, unit)
              : withUnit(m.amount / m.count, unit)
          return (
            <Tap
              key={m.meal.id}
              label={`${name(m.meal)}, ${what}: ${
                mode === "per100"
                  ? `${hero} ${label.toLowerCase()} per 100 kcal, `
                  : ""
              }${withUnit(m.amount / m.count, unit)} in ${amt(m.kcal / m.count)} kcal${m.count > 1 ? ` each time, eaten ${m.count} times` : ""}. Open meal`}
              onPress={() => go(`/nutrition/meals/${m.meal.id}`)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 10,
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
                  <Copy size={12} muted lines={2}>
                    {what}
                  </Copy>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Copy
                    size={i === 0 && !all ? 17 : 15}
                    weight="semibold"
                    style={{ color, fontVariant: ["tabular-nums"] }}
                  >
                    {hero}
                  </Copy>
                  <Copy size={11} muted>
                    {mode === "per100"
                      ? "per 100 kcal"
                      : nutrient === "kcal"
                        ? `${amt(m.protein / m.count)} g protein${each}`
                        : `in ${amt(m.kcal / m.count)} kcal${each}`}
                  </Copy>
                </View>
              </Line>
            </Tap>
          )
        })}
      </View>
      {r.rows.length > SHOWN && (
        <ShowAll
          all={all}
          count={r.rows.length}
          noun="meals"
          onPress={() => setAll(!all)}
        />
      )}
      {mode === "per100" && !!r.skipped && (
        <Note>
          {`${r.skipped.toLocaleString("en-US")} drink${r.skipped === 1 ? " or bite" : "s or bites"} under ${MIN_MEAL_KCAL} kcal left out.`}
        </Note>
      )}
      {!!r.unknown && !!r.rows.length && (
        <Note>
          {`${r.unknown.toLocaleString("en-US")} meal${r.unknown === 1 ? " has" : "s have"} no ${label.toLowerCase()} value and ${r.unknown === 1 ? "is" : "are"} not ranked.`}
        </Note>
      )}
    </Card>
  )
}
