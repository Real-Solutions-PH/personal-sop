import * as C from "@domain/fitness/calc"
import type { FitnessState } from "@domain/fitness/data"
import {
  dayDetail,
  LIMIT_LABEL,
  type LimitKey,
  limitAverages,
  limitsFor,
} from "@domain/fitness/limits"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { ShieldCheck, Utensils } from "lucide-react-native"
import { useState } from "react"
import { Copy, Frame, Line, Segmented } from "../native-kit"
import {
  daysEnding,
  nutrientDays,
  PERIODS,
  type Period,
  periodMacros,
} from "../nutrition-period"
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
  Rings,
  ShareComposer,
  StackBars,
  Stems,
  Sub,
  Title,
} from "../share-kit"
import { useTheme } from "../theme"
import { Screen, Toggle } from "../ui"

export type FoodLayout = "day" | "week" | "macros" | "stack"
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
// ---------------------------------------------------------------------------
// Macro cards: the Nutrition page's Day / 7 days / 30 days views, and its
// "Calories by macro" chart with fiber as a fourth target line.
// ---------------------------------------------------------------------------

type Grams = { kcal: number; protein: number; carbs: number; fat: number }

/** One period of the page's overview, as a card reads it: the day's totals
 * or the average over its settled logged days, against the targets. */
export type MacroCardData = {
  period: Period
  /** The card's window: "Sat 8 Nov", "2–8 Nov", "10 Oct – 8 Nov". */
  window: string
  /** Days the averages read (the day itself for a day). */
  days: number
  totals: Grams
  target: Grams | null
  fiber: { value: number | null; goal: number | undefined }
  /** Each stay-under limit known in the period: amount and limit. */
  limits: { key: LimitKey; amount: number; limit: number }[]
  /** Settled days on calorie target / protein hit, of the days judged. */
  kcalDays: { hit: number; judged: number }
  proteinDays: { hit: number; judged: number }
  amounts: boolean
}

/** One day of the stacked chart: calories from protein, carbs less fiber,
 * fiber, and fat, bottom first. Carbs on a label include fiber, so the
 * fiber is carved out of the carbs: the bar is as tall as the page's. */
export type StackDay = { day: string; parts: number[] }
export type StackCardData = {
  period: Period
  window: string
  days: StackDay[]
  /** Where each target ends on the stacked bars, in kcal, bottom first:
   * protein, carbs less the fiber goal, fiber, fat (the calorie target).
   * Empty when the macro targets don't make the calorie target (within
   * 5%): then ``kcal`` is the one line, as on the page. */
  lines: { key: "protein" | "carbs" | "fiber" | "fat"; at: number }[]
  kcal: number | null
  /** The period's split of calories, 0–1 each (protein, carbs, fat). */
  split: { protein: number; carbs: number; fat: number } | null
  /** Average calories a settled logged day; null with none. */
  avgKcal: number | null
  kcalDays: { hit: number; judged: number }
  amounts: boolean
}

const _KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const

const shortDay = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })

/** The window a period covers, as a card dates it. */
export function windowOf(end: string, n: number): string {
  if (n === 1)
    return new Date(`${end}T12:00:00`).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
  const first = daysEnding(end, n)[0]
  const sameMonth = first.slice(0, 7) === end.slice(0, 7)
  return sameMonth
    ? `${Number(first.slice(8))}–${shortDay(end)}`
    : `${shortDay(first)} – ${shortDay(end)}`
}

const grams = (t: ReturnType<typeof C.budgetFor>): Grams | null =>
  t ? { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat } : null

/** The page's overview for the ``n`` days ending ``end`` (``periodMacros``,
 * ``nutrientDays`` and the limit averages it reads). */
export function macroData(
  s: FitnessState,
  end: string,
  period: Period,
  amounts: boolean,
): MacroCardData {
  const n = Number(period),
    today = dayKey(),
    m = periodMacros(s, end, n),
    fiber = nutrientDays(s, "fiber", end, n),
    kcal = nutrientDays(s, "kcal", end, n),
    protein = nutrientDays(s, "protein", end, n),
    lim = limitsFor(m.target),
    settled = daysEnding(end, n)
      .filter((d) => n === 1 || d !== today)
      .map((d) => C.mealsOn(s, d))
      .filter((list) => list.length),
    detail =
      n === 1 ? dayDetail(C.mealsOn(s, end)) : limitAverages(settled, lim).avg
  return {
    period,
    window: windowOf(end, n),
    days: m.days,
    totals: m.totals,
    target: grams(m.target),
    fiber: { value: fiber.value, goal: fiber.goal },
    limits: (["satFat", "sugar", "sodium"] as const)
      .filter((k) => detail[k] !== undefined)
      .map((k) => ({ key: k, amount: detail[k] as number, limit: lim[k] })),
    kcalDays: { hit: kcal.hit, judged: kcal.judged },
    proteinDays: { hit: protein.hit, judged: protein.judged },
    amounts,
  }
}

/** The page's "Calories by macro" chart for the period: a day reads the 7
 * days to it, as the page does. */
export function stackData(
  s: FitnessState,
  end: string,
  period: Period,
  amounts: boolean,
): StackCardData {
  const n = period === "1" ? 7 : Number(period),
    today = dayKey(),
    target = C.budgetFor(s, end),
    fiberGoal = nutrientDays(s, "fiber", end, 1).goal ?? 0,
    days = daysEnding(end, n).map((day) => {
      const t = C.dayTotals(s, day).totals,
        fiber = Math.min(t.carbs, dayDetail(C.mealsOn(s, day)).fiber ?? 0)
      return {
        day,
        parts: [t.protein * 4, (t.carbs - fiber) * 4, fiber * 4, t.fat * 9],
      }
    }),
    targetTotal = target
      ? target.protein * 4 + target.carbs * 4 + target.fat * 9
      : 0,
    stacked =
      !!target &&
      targetTotal > 0 &&
      Math.abs(targetTotal - target.kcal) <= target.kcal * 0.05,
    fib = target ? Math.min(fiberGoal, target.carbs) : 0,
    settled = daysEnding(end, n)
      .filter((d) => d !== today)
      .map((d) => C.dayTotals(s, d))
      .filter((d) => d.count > 0),
    sum = C.sumMacros(settled.map((d) => d.totals)),
    split =
      sum.protein + sum.carbs + sum.fat > 0
        ? (() => {
            const k = {
              protein: sum.protein * 4,
              carbs: sum.carbs * 4,
              fat: sum.fat * 9,
            }
            const all = k.protein + k.carbs + k.fat
            return {
              protein: k.protein / all,
              carbs: k.carbs / all,
              fat: k.fat / all,
            }
          })()
        : null,
    kcal = nutrientDays(s, "kcal", end, n)
  return {
    period,
    window: windowOf(end, n),
    days,
    lines:
      stacked && target
        ? [
            { key: "protein", at: target.protein * 4 },
            { key: "carbs", at: (target.protein + target.carbs - fib) * 4 },
            { key: "fiber", at: (target.protein + target.carbs) * 4 },
            { key: "fat", at: targetTotal },
          ]
        : [],
    kcal: target?.kcal ?? null,
    split,
    avgKcal: settled.length ? sum.kcal / settled.length : null,
    kcalDays: { hit: kcal.hit, judged: kcal.judged },
    amounts,
  }
}

const PERIOD_TITLE: Record<Period, string> = {
  "1": "Macros today",
  "7": "Macros, last 7 days",
  "30": "Macros, last 30 days",
}

const g = (v: number) => `${fmt(Math.round(v))} g`

export function MacroCard({
  width,
  look,
  data: d,
}: {
  width: number
  look: CardLook
  data: MacroCardData
}) {
  const c = cardInk(look),
    sq = look.format === "1:1",
    tall = look.format === "9:16",
    day = d.period === "1",
    t = d.target,
    share = (v: number, goal: number | undefined) => (goal ? v / goal : null),
    kcalShare = share(d.totals.kcal, t?.kcal),
    kcalOff = kcalShare !== null && d.days > 0 && kcalShare > 1.1,
    ring = (
      name: string,
      v: number | null,
      goal: number | undefined,
      color: string,
      near: boolean,
    ) => {
      const r = v === null ? null : share(v, goal)
      return {
        name,
        value: v === null ? "—" : d.amounts || r === null ? g(v) : pct(r),
        share: r,
        color,
        bad: near && r !== null && r > 1.1,
      }
    }
  const rings = [
    ring("Protein", d.totals.protein, t?.protein, c.area("fit"), false),
    ring("Carbs", d.totals.carbs, t?.carbs, c.area("tsk"), true),
    ring("Fat", d.totals.fat, t?.fat, c.area("life"), true),
    ring("Fiber", d.fiber.value, d.fiber.goal, c.good, false),
  ]
  const limitRows = d.limits.slice(0, sq ? 2 : 3).map((l) => {
    const r = l.limit ? l.amount / l.limit : 0,
      { label, unit } = LIMIT_LABEL[l.key],
      over = r > 1
    return {
      name: label,
      value: r,
      mark: r > 1 ? 1 / r : undefined,
      color: over ? c.bad : c.area("nut"),
      bad: over,
      label: d.amounts
        ? `${fmt(Math.round(l.amount))} / ${fmt(Math.round(l.limit))} ${unit}`
        : `${pct(r)} of limit`,
    }
  })
  const hero = d.amounts
    ? day && t
      ? {
          value: fmt(Math.round(Math.abs(t.kcal - d.totals.kcal))),
          unit: d.totals.kcal > t.kcal ? "kcal over" : "kcal left",
        }
      : {
          value: fmt(Math.round(d.totals.kcal)),
          unit: day
            ? "kcal"
            : `kcal a day over ${fmt(d.days)} logged ${d.days === 1 ? "day" : "days"}`,
        }
    : {
        value: kcalShare === null ? "—" : fmt(Math.round(kcalShare * 100), 5),
        unit: day
          ? "% of calorie goal"
          : `% of calorie goal, a day over ${fmt(d.days)} logged ${d.days === 1 ? "day" : "days"}`,
      }
  const sub =
    d.days === 0
      ? day
        ? "Nothing logged yet today"
        : "No settled day logged in this window"
      : day
        ? kcalOff
          ? `Calories ${fmt(Math.round(((kcalShare ?? 1) - 1) * 100), 5)}% over goal`
          : null
        : `On calorie target ${fmt(d.kcalDays.hit)} of ${fmt(d.kcalDays.judged)} days · protein hit ${fmt(d.proteinDays.hit)} of ${fmt(d.proteinDays.judged)}`
  return (
    <CardFrame width={width} look={look} accent="nut" date={d.window}>
      <Title>{PERIOD_TITLE[d.period]}</Title>
      <Hero
        value={hero.value}
        unit={hero.unit}
        small
        delta={kcalOff ? <Change good={false}>over goal</Change> : undefined}
      />
      {sub ? <Sub bad={kcalOff}>{sub}</Sub> : null}
      <Body end>
        <Rings rings={rings} size={tall ? 72 : sq ? 54 : 62} />
        {limitRows.length ? <Meters rows={limitRows} /> : null}
      </Body>
    </CardFrame>
  )
}

const LINE_NAME = {
  protein: "Protein",
  carbs: "Carbs",
  fiber: "Fiber",
  fat: "Fat",
} as const

export function StackCard({
  width,
  look,
  data: d,
}: {
  width: number
  look: CardLook
  data: StackCardData
}) {
  const c = cardInk(look),
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    today = dayKey(),
    end = d.days.at(-1)?.day ?? today,
    color = {
      protein: c.area("fit"),
      carbs: c.area("tsk"),
      fiber: c.good,
      fat: c.area("life"),
    },
    n = d.days.length,
    label = (day: string) =>
      n <= 7
        ? new Date(`${day}T12:00:00`)
            .toLocaleDateString("en-GB", { weekday: "short" })
            .slice(0, 1)
        : String(Number(day.slice(8)))
  const lines = d.lines.length
    ? d.lines.map((l) => ({
        at: l.at,
        color: color[l.key],
        name: LINE_NAME[l.key],
      }))
    : d.kcal
      ? [{ at: d.kcal, color: c.good, name: "Goal" }]
      : []
  const hero = d.amounts
    ? {
        value: d.avgKcal === null ? "—" : fmt(Math.round(d.avgKcal)),
        unit: "kcal a day",
      }
    : {
        value: fmt(d.kcalDays.hit),
        unit: `of ${fmt(d.kcalDays.judged)} days on target`,
      }
  return (
    <CardFrame
      width={width}
      look={look}
      accent="nut"
      date={d.period === "1" ? "Last 7 days" : d.window}
    >
      <Title>Calories by macro</Title>
      <Hero value={hero.value} unit={hero.unit} small />
      {d.split ? (
        <Sub>
          {`Protein ${pct(d.split.protein)} · carbs ${pct(d.split.carbs)} · fat ${pct(d.split.fat)}`}
        </Sub>
      ) : (
        <Sub>Nothing logged in this window yet</Sub>
      )}
      <Body end>
        <StackBars
          days={d.days.map((x) => ({
            label: label(x.day),
            parts: x.parts,
            on: x.day === end ? true : x.day === today ? false : undefined,
          }))}
          colors={[color.protein, color.carbs, color.fiber, color.fat]}
          lines={lines}
          height={tall ? 200 : sq ? 120 : 160}
          label={`Calories by macro a day, ${d.window}; dashed lines are the protein, carbs, fiber and fat targets, stacked`}
        />
      </Body>
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
    [amounts, setAmounts] = useState(false),
    [period, setPeriod] = useState<Period>("1")
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
  const macros = macroData(s, today, period, amounts),
    stack = stackData(s, today, period, amounts)
  const caption =
    layout === "day"
      ? `Food today: protein ${pct(target?.protein ? totals.protein / target.protein : null)} of goal · Unfurl`
      : layout === "week"
        ? `Food this week: calories on target ${data.week.filter((x) => x.verdict === "hit").length} of 7 days · Unfurl`
        : layout === "macros"
          ? `${PERIOD_TITLE[period]} · Unfurl`
          : `Calories by macro, ${stack.window} · Unfurl`
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
            { key: "macros", label: "Macros" },
            { key: "stack", label: "By macro" },
          ] as const
        ).map((item) => ({
          ...item,
          render: (width: number, look: CardLook) =>
            // Keyed by the period: a new period is a new card, so the
            // frame's fit rule starts again from the full card rather than
            // keep what it dropped for another period's layout.
            item.key === "macros" ? (
              <MacroCard key={period} width={width} look={look} data={macros} />
            ) : item.key === "stack" ? (
              <StackCard key={period} width={width} look={look} data={stack} />
            ) : (
              <FoodCard kind={item.key} width={width} look={look} data={data} />
            ),
        }))}
      >
        {(layout === "macros" || layout === "stack") && (
          <Segmented value={period} onChange={setPeriod} options={PERIODS} />
        )}
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
