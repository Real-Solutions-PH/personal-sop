import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type { Macros, Meal } from "@domain/fitness/data"
import { dayDetail, fiberGoalFor, limitsFor } from "@domain/fitness/limits"
import { fitStore } from "@domain/fitness/store"
import { openCapture } from "@domain/lib/capture"
import { dayKey } from "@domain/lib/day"
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  History,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  Sparkles,
  Target,
  UtensilsCrossed,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, View } from "react-native"
import {
  Bar,
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, Empty, Screen, undo } from "../ui"
import { Ring } from "../visual"
import { LimitList } from "./nutrient-limits"
import { NutritionTrend } from "./nutrition-trend"
import { StatsShell } from "./stats-shell"
/** Ring sizes for the width the rings get: the full size on a wide card,
 * smaller on a narrow one (Fern's card sits inside a message), and the three
 * macro rings on a row of their own when even the small sizes don't fit. */
export function ringLayout(width: number) {
  const GAP = 16,
    SMALL_GAP = 8
  if (!width) return { stacked: false, big: 112, small: 60 }
  const big = Math.max(80, Math.min(112, Math.round(width * 0.34)))
  const small = Math.floor((width - big - GAP - 2 * SMALL_GAP) / 3)
  if (small >= 44) return { stacked: false, big, small: Math.min(60, small) }
  return {
    stacked: true,
    big: 112,
    small: Math.max(44, Math.min(60, Math.floor((width - 2 * SMALL_GAP) / 3))),
  }
}
export function MacroRings({
  totals,
  target,
}: {
  totals: Macros
  target?: Macros
}) {
  const t = useTheme(),
    [width, setWidth] = useState(0),
    { stacked, big, small } = ringLayout(width),
    left = target ? target.kcal - totals.kcal : undefined
  const kcal = (
    <Ring
      size={big}
      value={target ? totals.kcal / target.kcal : 0}
      strokeWidth={big >= 100 ? 10 : 8}
      color={t.nut}
    >
      <Copy
        size={big >= 100 ? 24 : 20}
        weight="semibold"
        style={{
          lineHeight: big >= 100 ? 24 : 20,
          color: left !== undefined && left < 0 ? t.bad : t.text,
        }}
      >
        {left === undefined
          ? Math.round(totals.kcal)
          : Math.abs(Math.round(left))}
      </Copy>
      <Copy size={10} muted style={{ marginTop: 2 }}>
        {left === undefined
          ? "kcal eaten"
          : left < 0
            ? "kcal over"
            : "kcal left"}
      </Copy>
    </Ring>
  )
  const macros = (
    <Line
      style={{
        flex: stacked ? undefined : 1,
        alignSelf: stacked ? "stretch" : undefined,
        gap: 8,
        justifyContent: "space-between",
      }}
    >
      {(
        [
          { key: "protein", label: "Protein", accent: "fit" },
          { key: "carbs", label: "Carbs", accent: "tsk" },
          { key: "fat", label: "Fat", accent: "life" },
        ] as const
      ).map((m) => (
        <View
          key={m.key}
          style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 4 }}
        >
          <Ring
            size={small}
            strokeWidth={small >= 56 ? 5 : 4}
            color={t[m.accent]}
            value={target ? totals[m.key] / target[m.key] : 0}
          >
            <Copy size={small >= 52 ? 12 : 11} weight="semibold">
              {Math.round(totals[m.key])}
            </Copy>
          </Ring>
          <View>
            <Copy
              size={10}
              muted
              lines={1}
              style={{ textAlign: "center", lineHeight: 12.5 }}
            >
              {m.label}
            </Copy>
            {target && (
              <Copy
                size={10}
                muted
                lines={1}
                style={{ textAlign: "center", lineHeight: 12.5 }}
              >
                {Math.max(0, Math.round(target[m.key] - totals[m.key]))}g left
              </Copy>
            )}
          </View>
        </View>
      ))}
    </Line>
  )
  return (
    <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
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
export function Nutrition({
  day: initial = dayKey(),
  history = false,
  embedded = false,
}: {
  day?: string
  history?: boolean
  /** A section of the Fitness page instead of its own screen. */
  embedded?: boolean
}) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    [day, setDay] = useState(initial),
    today = dayKey(),
    [range, setRange] = useState("14"),
    totals = C.dayTotals(s, day),
    target = C.targetFor(s, day),
    meals = C.mealsOn(s, day),
    detail = dayDetail(meals),
    seen = new Set<string>(),
    recent = [...s.meals]
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
      .slice(0, 5),
    adherence = C.adherence(s, Number(range))
  const pill = (text: string, color: string) => (
    <Copy
      size={11}
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
  if (history)
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
            action={
              <Button onPress={() => go("/fitness?tab=eat")}>Log today</Button>
            }
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
                  onPress={() => go(`/fitness?tab=eat&day=${d.day}`)}
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
                              value={
                                d.target ? d.totals.kcal / d.target.kcal : 0
                              }
                              color={t.nut}
                            />
                          </View>
                          <Copy size={12} muted>
                            {Math.round(d.totals.kcal)}
                            {d.target ? `/${d.target.kcal}` : ""} kcal · P{" "}
                            {Math.round(d.totals.protein)}
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
  return (
    <StatsShell embedded={embedded} title="Nutrition" heading="Nutrition">
      <Line style={{ justifyContent: "space-between" }}>
        <IconTap
          size={40}
          icon={ChevronLeft}
          label="Previous day"
          onPress={() => setDay(C.addDays(day, -1))}
        />
        <View style={{ alignItems: "center" }}>
          <Copy weight="semibold">
            {day === today ? "Today" : C.relDay(`${day}T12:00:00`)}
          </Copy>
          <Copy size={12} muted>
            {C.fmtDay(day)}
          </Copy>
        </View>
        <IconTap
          size={40}
          icon={ChevronRight}
          label="Next day"
          color={day >= today ? border(t.muted, 0.3) : t.muted}
          onPress={() => {
            if (day < today) setDay(C.addDays(day, 1))
          }}
        />
      </Line>
      <Frame style={{ padding: 16 }}>
        <MacroRings totals={totals.totals} target={target} />
        {target ? (
          <Line style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
            <Copy size={12} muted>
              {Math.round(totals.totals.kcal).toLocaleString("en-US")} /{" "}
              {target.kcal.toLocaleString("en-US")} kcal · P{" "}
              {Math.round(totals.totals.protein)}/{target.protein} g
              {detail.fiber !== undefined &&
                ` · Fiber ${Math.round(detail.fiber)}/${fiberGoalFor(target)} g`}
            </Copy>
            {!!totals.pending && pill(`+${totals.pending} pending`, t.warn)}
            {!!totals.toReview && pill(`${totals.toReview} to review`, t.nut)}
          </Line>
        ) : (
          <View style={{ marginTop: 12, gap: 8 }}>
            <Copy size={14} muted>
              No targets set — showing totals eaten.
            </Copy>
            <Button small onPress={() => go("/fitness/nutrition/targets")}>
              Set targets
            </Button>
          </View>
        )}
      </Frame>
      <Frame style={{ padding: 16 }}>
        <LimitList detail={detail} limits={limitsFor(target)} />
      </Frame>
      <NutritionTrend onPickDay={setDay} />
      <Frame style={{ padding: 8 }}>
        <Line style={{ gap: 8 }}>
          {(
            [
              { label: "Photo", icon: Camera, mode: "photo" },
              { label: "Chat", icon: MessageSquare, mode: "text" },
              { label: "Voice", icon: Mic, mode: "voice" },
              { label: "Manual", icon: Pencil, mode: "manual" },
            ] as const
          ).map((b) => (
            <Tap
              key={b.label}
              onPress={() =>
                b.mode === "manual"
                  ? go(`/fitness/nutrition/new?day=${day}`)
                  : openCapture({ mode: b.mode, hint: "meal" })
              }
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 8,
                gap: 4,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 16,
                  backgroundColor: `${t.nut}26`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <b.icon size={20} color={t.nut} />
              </View>
              <Copy size={12}>{b.label}</Copy>
            </Tap>
          ))}
        </Line>
      </Frame>
      <Line style={{ gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            icon={History}
            tone="quiet"
            onPress={() => go("/fitness/nutrition/history")}
          >
            History
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            icon={Target}
            tone="quiet"
            onPress={() => go("/fitness/nutrition/targets")}
          >
            Targets
          </Button>
        </View>
      </Line>
      {!meals.length ? (
        <Empty
          title="Nothing logged — snap your plate"
          detail="A photo is enough; AI estimates the macros and you confirm."
          action={
            <Button
              icon={Camera}
              onPress={() => openCapture({ mode: "photo", hint: "meal" })}
            >
              Log a meal
            </Button>
          }
        />
      ) : (
        ["breakfast", "lunch", "snack", "dinner"].map((label) => {
          const list = meals.filter((m) => m.label === label),
            total = C.sumMacros(
              list
                .filter((m) => m.status !== "pending_estimate")
                .map(C.mealTotals),
            )
          if (!list.length) return null
          return (
            <View key={label} style={{ marginTop: -12 }}>
              <SectionHeading
                action={
                  <Copy size={12} muted>
                    {Math.round(total.kcal)} kcal
                  </Copy>
                }
              >
                {label}
              </SectionHeading>
              <Frame>
                {list.map((m, i) => (
                  <Tap
                    key={m.id}
                    onPress={() => go(`/fitness/nutrition/meals/${m.id}`)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      borderTopWidth: i ? 1 : 0,
                      borderColor: border(t.line, 0.6),
                    }}
                  >
                    <Line>
                      <MealThumb meal={m} />
                      <View style={{ flex: 1 }}>
                        <Copy size={14} weight="medium" lines={1}>
                          {m.items.length
                            ? m.items
                                .map((i) => i.name.replace(/\s*\(.*\)/, ""))
                                .join(", ")
                            : m.rawInput}
                        </Copy>
                        <Line style={{ gap: 8 }}>
                          <Copy size={12} muted>
                            {C.fmtTime(m.eatenAt)}
                          </Copy>
                          {m.status === "pending_estimate"
                            ? pill("Estimating when online", t.warn)
                            : m.status === "estimated"
                              ? pill("Review", t.nut)
                              : m.source === "connector"
                                ? pill("via Claude", t.muted)
                                : null}
                        </Line>
                      </View>
                      {m.status !== "pending_estimate" && (
                        <View style={{ alignItems: "flex-end" }}>
                          <Copy size={14} weight="semibold">
                            {Math.round(C.mealTotals(m).kcal)}
                          </Copy>
                          <Copy size={12} muted>
                            P{Math.round(C.mealTotals(m).protein)}
                          </Copy>
                        </View>
                      )}
                    </Line>
                  </Tap>
                ))}
              </Frame>
            </View>
          )
        })
      )}
      {!!recent.length && (
        <View style={{ marginTop: -12 }}>
          <SectionHeading>Quick re-log</SectionHeading>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -16 }}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: 4,
              gap: 8,
            }}
          >
            {recent.map((m) => (
              <Tap
                key={m.id}
                onPress={() => {
                  const c = A.duplicateMeal(m.id, day)
                  if (c) undo(`Logged ${c.label}`, () => A.deleteMeal(c.id))
                }}
                style={{
                  width: 160,
                  padding: 12,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: border(t.line, 0.6),
                  backgroundColor: t.card,
                }}
              >
                <Copy size={14} weight="medium" lines={2}>
                  {m.items
                    .map((i) => i.name.replace(/\s*\(.*\)/, ""))
                    .join(", ")}
                </Copy>
                <Line style={{ marginTop: 4, justifyContent: "space-between" }}>
                  <Copy size={12} muted>
                    {Math.round(C.mealTotals(m).kcal)} kcal
                  </Copy>
                  <Plus size={16} color={t.nut} />
                </Line>
              </Tap>
            ))}
          </ScrollView>
        </View>
      )}
    </StatsShell>
  )
}
