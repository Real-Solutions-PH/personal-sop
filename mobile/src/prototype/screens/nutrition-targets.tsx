import { setMacroTarget } from "@domain/fitness/actions"
import { fmtDay, latestBodyweight, targetFor } from "@domain/fitness/calc"
import type { Macros, NutrientLimits } from "@domain/fitness/data"
import { DAILY_LIMITS, FIBER_GOAL } from "@domain/fitness/limits"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { Sparkles } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { Stepper } from "../fitness-controls"
import { border, Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { replace } from "../navigation"
import { useTheme } from "../theme"
import { Button, Screen } from "../ui"
export function MacroTargets() {
  const s = fitStore.use((s) => s),
    theme = useTheme(),
    current = targetFor(s, dayKey()),
    [t, setT] = useState<Macros>(
      current ?? { kcal: 2100, protein: 160, carbs: 210, fat: 70 },
    ),
    [limits, setLimits] = useState({
      satFatMax: current?.satFatMax ?? DAILY_LIMITS.satFat,
      sugarMax: current?.sugarMax ?? DAILY_LIMITS.sugar,
      sodiumMax: current?.sodiumMax ?? DAILY_LIMITS.sodium,
      fiberGoal: current?.fiberGoal ?? FIBER_GOAL,
    }),
    [suggestion, setSuggestion] = useState<Macros | null>(null),
    calc = t.protein * 4 + t.carbs * 4 + t.fat * 9,
    mismatch = Math.abs(calc - t.kcal) > t.kcal * 0.05,
    history = [...s.targets].sort((a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom),
    )
  const split = () => {
    const fat = Math.round((t.kcal * 0.27) / 9),
      carbs = Math.max(0, Math.round((t.kcal - t.protein * 4 - fat * 9) / 4))
    setT({ ...t, fat, carbs })
  }
  const suggest = () => {
    const bw = latestBodyweight(s) ?? 75,
      dir = s.settings.goalDirection,
      kcal =
        Math.round(
          (bw * (dir === "cut" ? 27 : dir === "bulk" ? 36 : 32)) / 50,
        ) * 50,
      protein = Math.round(bw * 2.1),
      fat = Math.round((kcal * 0.27) / 9)
    setSuggestion({
      kcal,
      protein,
      fat,
      carbs: Math.round((kcal - protein * 4 - fat * 9) / 4),
    })
  }
  return (
    <Screen title="Macro targets">
      {!current && (
        <Frame style={{ padding: 16 }}>
          <Copy size={14}>
            No targets yet. Enter calories and protein — carbs and fat can
            auto-split.
          </Copy>
        </Frame>
      )}
      <Frame style={{ padding: 16, gap: 20 }}>
        <Stepper
          label="Calories"
          value={t.kcal}
          onChange={(kcal) => setT({ ...t, kcal })}
          step={50}
          min={800}
          max={6000}
          unit="kcal"
          decimals={0}
        />
        <Stepper
          label="Protein"
          value={t.protein}
          onChange={(protein) => setT({ ...t, protein })}
          step={5}
          max={500}
          unit="g"
          decimals={0}
        />
        <Line style={{ gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Stepper
              compact
              label="Carbs"
              value={t.carbs}
              onChange={(carbs) => setT({ ...t, carbs })}
              step={5}
              max={900}
              unit="g"
              decimals={0}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Stepper
              compact
              label="Fat"
              value={t.fat}
              onChange={(fat) => setT({ ...t, fat })}
              step={5}
              max={300}
              unit="g"
              decimals={0}
            />
          </View>
        </Line>
        <View
          style={{
            padding: 12,
            borderRadius: 12,
            backgroundColor: mismatch ? `${theme.warn}26` : `${theme.good}1a`,
          }}
        >
          <Copy size={14} style={{ color: mismatch ? theme.warn : theme.good }}>
            P×4 + C×4 + F×9 ={" "}
            <Copy
              size={14}
              weight="semibold"
              style={{ color: mismatch ? theme.warn : theme.good }}
            >
              {calc.toLocaleString("en-US")}
            </Copy>{" "}
            kcal
            {mismatch
              ? ` — ${calc > t.kcal ? "over" : "under"} your ${t.kcal.toLocaleString("en-US")} by ${Math.abs(calc - t.kcal).toLocaleString("en-US")}.`
              : " ✓ adds up."}
          </Copy>
          {mismatch && (
            <Tap onPress={split}>
              <Copy
                size={14}
                weight="semibold"
                style={{ color: theme.warn, textDecorationLine: "underline" }}
              >
                Auto-split carbs/fat
              </Copy>
            </Tap>
          )}
        </View>
      </Frame>
      <View style={{ marginTop: -12 }}>
        <SectionHeading
          action={
            <Tap
              onPress={() =>
                setLimits({
                  satFatMax: DAILY_LIMITS.satFat,
                  sugarMax: DAILY_LIMITS.sugar,
                  sodiumMax: DAILY_LIMITS.sodium,
                  fiberGoal: FIBER_GOAL,
                })
              }
            >
              <Copy size={12} weight="semibold" style={{ color: theme.nut }}>
                WHO defaults
              </Copy>
            </Tap>
          }
        >
          Stay under
        </SectionHeading>
        <Frame style={{ padding: 16, gap: 20 }}>
          <Line style={{ gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Stepper
                compact
                label="Sat fat"
                value={limits.satFatMax}
                onChange={(satFatMax) => setLimits({ ...limits, satFatMax })}
                step={1}
                max={200}
                unit="g"
                decimals={0}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Stepper
                compact
                label="Sugar"
                value={limits.sugarMax}
                onChange={(sugarMax) => setLimits({ ...limits, sugarMax })}
                step={1}
                max={300}
                unit="g"
                decimals={0}
              />
            </View>
          </Line>
          <Stepper
            label="Sodium"
            value={limits.sodiumMax}
            onChange={(sodiumMax) => setLimits({ ...limits, sodiumMax })}
            step={100}
            max={10000}
            unit="mg"
            decimals={0}
          />
          <Stepper
            label="Fiber goal"
            value={limits.fiberGoal}
            onChange={(fiberGoal) => setLimits({ ...limits, fiberGoal })}
            step={1}
            max={150}
            unit="g"
            decimals={0}
          />
          <Copy size={12} muted>
            Defaults follow WHO guidance for a 2,000 kcal day. Today, Nutrition
            and Stats hold your meals against these.
          </Copy>
        </Frame>
      </View>
      <Frame style={{ padding: 16 }}>
        <Line style={{ justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Copy size={14} weight="medium">
              Help me pick
            </Copy>
            <Copy size={12} muted>
              From your latest weight and goal (
              {
                {
                  cut: "lose weight",
                  maintain: "maintain",
                  bulk: "gain weight",
                }[s.settings.goalDirection]
              }
              ). A starting point, not advice.
            </Copy>
          </View>
          <Button small tone="quiet" icon={Sparkles} onPress={suggest}>
            Suggest
          </Button>
        </Line>
        {suggestion && (
          <Line
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              backgroundColor: `${theme.nut}1a`,
              justifyContent: "space-between",
            }}
          >
            <Copy size={14}>
              {suggestion.kcal} kcal · P{suggestion.protein} · C
              {suggestion.carbs} · F{suggestion.fat}
            </Copy>
            <Tap
              onPress={() => {
                setT(suggestion)
                setSuggestion(null)
              }}
            >
              <Copy size={14} weight="semibold" style={{ color: theme.nut }}>
                Use
              </Copy>
            </Tap>
          </Line>
        )}
      </Frame>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>History</SectionHeading>
        <Frame>
          {history.map((h, i) => (
            <Line
              key={h.id}
              style={{
                justifyContent: "space-between",
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderTopWidth: i ? 1 : 0,
                borderColor: border(theme.line, 0.6),
              }}
            >
              <View>
                <Copy size={14} weight="medium">
                  {i === 0 ? "Current" : "Previous"}
                </Copy>
                <Copy size={12} muted>
                  from {fmtDay(h.effectiveFrom)}
                </Copy>
              </View>
              <Copy size={14} muted>
                {h.kcal} · P{h.protein} C{h.carbs} F{h.fat}
              </Copy>
            </Line>
          ))}
          {!history.length && (
            <Copy size={14} muted style={{ padding: 16 }}>
              No targets saved yet.
            </Copy>
          )}
        </Frame>
      </View>
      <View style={{ marginTop: 12, paddingVertical: 12 }}>
        <Button
          onPress={() => {
            if (
              ![t.kcal, t.protein, t.carbs, t.fat].every(Number.isFinite) ||
              t.kcal < 800 ||
              t.kcal > 6000 ||
              t.protein < 0 ||
              t.protein > 500 ||
              t.carbs < 0 ||
              t.carbs > 900 ||
              t.fat < 0 ||
              t.fat > 300
            ) {
              toast.error("Enter targets within the supported range")
              return
            }
            if (
              ![
                limits.satFatMax,
                limits.sugarMax,
                limits.sodiumMax,
                limits.fiberGoal,
              ].every((n) => Number.isFinite(n) && n >= 0)
            ) {
              toast.error("Enter limits of zero or more")
              return
            }
            // A limit left at its default is stored as unset, so it keeps
            // following the default.
            const own: NutrientLimits = {
              satFatMax:
                limits.satFatMax === DAILY_LIMITS.satFat
                  ? undefined
                  : limits.satFatMax,
              sugarMax:
                limits.sugarMax === DAILY_LIMITS.sugar
                  ? undefined
                  : limits.sugarMax,
              sodiumMax:
                limits.sodiumMax === DAILY_LIMITS.sodium
                  ? undefined
                  : limits.sodiumMax,
              fiberGoal:
                limits.fiberGoal === FIBER_GOAL ? undefined : limits.fiberGoal,
            }
            setMacroTarget({ ...t, ...own })
            toast.success("Targets saved — effective today")
            replace("/nutrition")
          }}
        >
          Save · effective today
        </Button>
      </View>
    </Screen>
  )
}
