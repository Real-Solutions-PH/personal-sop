// The body moments that outlive the form they happen on. Saving a meal
// closes its form and lands on the Nutrition page, so the save decides
// what it earned (./body-rewards) and leaves it here as a flash; the page
// plays it once and lets it go. A weigh-in's sheet closes onto the page
// that opened it, which shows the step itself. Each save gives its haptic
// at once: success for a win, warning for a miss.

import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { createStore } from "@domain/lib/store"
import { useEffect, useState } from "react"
import { Text, View } from "react-native"
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated"
import {
  type Crossing,
  crossings,
  dayIntake,
  type GoalKey,
  goalsReached,
  weighStep,
} from "./body-rewards"
import { feel, markCompletion } from "./motion"
import { fonts, useTheme } from "./theme"

/** How long a flash stays on the page it lands on. */
export const FLASH_MS = 3200
/** A flash older than this when its page opens is history, not news. */
const STALE_MS = 6000

// ------------------------------------------------------------------ meals

export const mealFlash = createStore(
  "meal-flash",
  () => ({
    day: "",
    at: 0,
    over: [] as Crossing[],
    goals: [] as GoalKey[],
  }),
  { persist: false },
)

/** The days each goal was last celebrated on this phone: once a day. */
export const goalDays = createStore("nutrition-goal-days", () => ({
  protein: "",
  fiber: "",
}))

/** Call around a save that adds food to ``day``: ``before`` is the day's
 * intake read just before it. Buzzes and leaves the flash. */
export function mealSaved(before: ReturnType<typeof dayIntake>, day: string) {
  const s = fitStore.get()
  const after = dayIntake(s, day)
  const target = C.budgetFor(s, day)
  const over = crossings(before, after, target)
  const seen = goalDays.get()
  const goals = goalsReached(before, after, target).filter(
    (k) => seen[k] !== day,
  )
  if (goals.length)
    goalDays.set((g) => ({
      ...g,
      ...Object.fromEntries(goals.map((k) => [k, day])),
    }))
  markCompletion()
  if (over.length) feel.warning()
  else feel.success()
  mealFlash.set({ day, at: Date.now(), over, goals })
}

/** The flash for ``day`` while it plays, else null. Played once per page:
 * the page clears it when its time is up. */
export function useMealFlash(day: string) {
  const f = mealFlash.use((x) => x)
  const live = f.day === day && f.at > 0 && Date.now() - f.at < STALE_MS
  useEffect(() => {
    if (!live) return
    const id = setTimeout(
      () => mealFlash.set((x) => (x.at === f.at ? { ...x, at: 0 } : x)),
      FLASH_MS,
    )
    return () => clearTimeout(id)
  }, [live, f.at])
  return live ? f : null
}

// ------------------------------------------------------------------ weight

/** Call before logging a new weigh-in: buzzes, and says what it was a
 * step toward. The page that logged it shows the step; only that one, so
 * a second copy of the page lower in the stack stays still. */
export function weighInSaved(kg: number, measuredAt: string) {
  const step = weighStep(fitStore.get(), kg, measuredAt) ?? null
  // Reaching the goal lands as a card, which gives its own success tap.
  if (step?.reached) feel.impact()
  else feel.success()
  return step
}

// ------------------------------------------------------------------ pieces

const never = ReduceMotion.Never

/** A short line that lands with a fade and, for a miss, one small shake:
 * "+180 kcal over", "▼0.3 kg toward goal". ``tone`` picks the colour. */
export function FlashLine({
  text,
  tone,
  testID,
  center = false,
}: {
  text: string
  tone: "good" | "bad" | "warn" | "muted"
  testID?: string
  center?: boolean
}) {
  const t = useTheme(),
    reduced = useReducedMotion(),
    x = useSharedValue(0),
    color = tone === "muted" ? t.muted : t[tone]
  const [shook] = useState(tone === "bad" && !reduced)
  useEffect(() => {
    if (!shook) return
    const step = (to: number) =>
      withTiming(to, { duration: 50, reduceMotion: never })
    x.value = withSequence(step(-4), step(4), step(-3), step(2), step(0))
  }, [shook, x])
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }))
  return (
    <Animated.View
      testID={testID}
      entering={FadeIn.duration(180).reduceMotion(never)}
      exiting={FadeOut.duration(150).reduceMotion(never)}
      accessibilityLiveRegion="polite"
      style={[{ alignSelf: center ? "center" : "flex-start" }, style]}
    >
      <View
        style={{
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 99,
          backgroundColor: `${color}1f`,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.semibold,
            fontSize: 12,
            lineHeight: 16,
            color,
            fontVariant: ["tabular-nums"],
          }}
        >
          {text}
        </Text>
      </View>
    </Animated.View>
  )
}
