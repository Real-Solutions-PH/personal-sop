// The big "you did it" pop-up, for the rare wins: a Life Score level reached,
// a savings goal hit. A card rises in the middle of the screen over
// everything (the overlay layer), its badge pops with a burst, the phone
// gives a success tap and a chime, and it leaves on its own. It never
// blocks: only the card takes touches, and a tap dismisses it. Under Reduce
// Motion it fades in and out where it stands.
import { type ReactNode, useEffect, useState } from "react"
import { AccessibilityInfo, Pressable, Text, View } from "react-native"
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useReducedMotion,
  ZoomIn,
} from "react-native-reanimated"
import { chime } from "./chime"
import { FernCelebrates } from "./companion/fern-celebrates"
import { momentSlot } from "./moment"
import { Cheer, feel } from "./motion"
import { Copy } from "./native-kit"
import { Overlay } from "./overlay"
import { fonts, useTheme } from "./theme"

/** How long a big moment stays: long enough to read two lines. */
export const BIG_MS = 3800

/** ``show`` for ``ms``, then false; a later ``show`` starts it again. */
export function useMomentTimer(show: boolean, ms = BIG_MS) {
  const [up, setUp] = useState(show)
  useEffect(() => {
    if (!show) return
    setUp(true)
    const id = setTimeout(() => setUp(false), ms)
    return () => clearTimeout(id)
  }, [show, ms])
  return [up && show, () => setUp(false)] as const
}

export function BigMoment({
  label,
  title,
  detail,
  badge,
  tint,
  say,
  onClose,
  testID,
}: {
  /** The small coloured line naming what happened ("Level up"). */
  label: string
  title: string
  detail: ReactNode
  /** What was won, in the chip on Fern's corner (drawn for a 72 pt disc). */
  badge: ReactNode
  tint: string
  say: string
  onClose: () => void
  testID: string
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const [fire, setFire] = useState(0)
  useEffect(() => {
    momentSlot.set({ holder: "big" })
    return () =>
      momentSlot.set((s) => (s.holder === "big" ? { holder: null } : s))
  }, [])
  useEffect(() => {
    feel.success()
    chime()
    AccessibilityInfo.announceForAccessibility(say)
    // After the card lands, so the burst plays where the badge settled.
    const id = setTimeout(() => setFire(1), 180)
    return () => clearTimeout(id)
  }, [say])
  const never = ReduceMotion.Never
  return (
    <Overlay>
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 24,
          right: 24,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Animated.View
          testID={testID}
          entering={
            reduced
              ? FadeIn.duration(200).reduceMotion(never)
              : ZoomIn.springify()
                  .damping(14)
                  .stiffness(220)
                  .reduceMotion(never)
          }
          exiting={FadeOut.duration(160).reduceMotion(never)}
          style={{
            width: "100%",
            maxWidth: 340,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.card,
            boxShadow: "0px 12px 32px rgba(0, 0, 0, 0.32)",
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={say}
            accessibilityHint="Dismisses"
            onPress={onClose}
            style={{
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 20,
              paddingTop: 24,
              paddingBottom: 20,
            }}
          >
            <Cheer fire={fire} color={tint} size={96}>
              <View style={{ marginBottom: 8 }}>
                <FernCelebrates
                  size={96}
                  badge={badge}
                  badgeTint={tint}
                  badgeScale={0.5}
                />
              </View>
            </Cheer>
            <Copy size={12} weight="medium" style={{ color: tint }}>
              {label.toUpperCase()}
            </Copy>
            <Text
              style={{
                fontFamily: fonts.semibold,
                fontSize: 22,
                lineHeight: 28,
                color: t.text,
                textAlign: "center",
              }}
            >
              {title}
            </Text>
            {detail}
          </Pressable>
        </Animated.View>
      </View>
    </Overlay>
  )
}
