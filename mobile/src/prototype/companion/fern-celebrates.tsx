import type { ReactNode } from "react"
import { View } from "react-native"
import { useReducedMotion } from "react-native-reanimated"
import { useTheme } from "../theme"
import { FernSprite } from "./fern-sprite"

/**
 * Fern celebrating a win: the hero of every finish page, moment card and
 * all-done line, so every achievement is celebrated by the same character.
 * It plays Fern's celebrating loop (a hop, the curl unfurling, lifting
 * leaves, twinkles); under Reduce Motion it holds a still celebrating pose.
 * A moment that is a miss (a day sealed below target) passes
 * `mood="consoling"`, so the miss still shows its cost.
 *
 * `badge` names the kind of win (a dumbbell, a trophy) in a small chip at
 * Fern's lower right; `badgeScale` shrinks a badge drawn for a bigger disc
 * to fit it. Purely decorative: the surface around it says what happened.
 */
export function FernCelebrates({
  size,
  mood = "celebrating",
  badge,
  badgeTint,
  badgeScale = 0.5,
}: {
  size: number
  mood?: "celebrating" | "consoling"
  badge?: ReactNode
  badgeTint?: string
  badgeScale?: number
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const chip = Math.max(20, Math.round(size * 0.36))
  return (
    <View
      testID="fern-celebrates"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <FernSprite size={size} state={mood} still={reduced} decorative />
      {badge != null && (
        <View
          style={{
            position: "absolute",
            right: -chip * 0.15,
            bottom: -chip * 0.1,
            width: chip,
            height: chip,
            borderRadius: chip / 2,
            backgroundColor: badgeTint ?? t.good,
            borderWidth: 2,
            borderColor: t.card,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <View style={{ transform: [{ scale: badgeScale }] }}>{badge}</View>
        </View>
      )}
    </View>
  )
}
