// The card every "you did it" moment lands as: a trophy earned, a routine
// finished away from its page. It drops in at the top of the screen over
// everything (the overlay layer), says what landed, leaves on its own and
// never blocks: only the card itself takes touches. One card at a time: a
// second moment waits while another is up, so two never stack.
import { createStore } from "@domain/lib/store"
import { ChevronRight, X } from "lucide-react-native"
import { type ReactNode, useEffect } from "react"
import { AccessibilityInfo, Pressable, Text, View } from "react-native"
import Animated, {
  FadeIn,
  FadeInUp,
  FadeOut,
  FadeOutUp,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { feel, MOTION } from "./motion"
import { Copy } from "./native-kit"
import { Overlay } from "./overlay"
import { fonts, useTheme } from "./theme"

/** Which kind of moment holds the top of the screen, if any. */
export const momentSlot = createStore(
  "moment-slot",
  () => ({ holder: null as string | null }),
  { persist: false },
)

export function MomentCard({
  kind,
  label,
  title,
  detail,
  badge,
  tint,
  discColor,
  say,
  hint,
  onOpen,
  onClose,
  testID,
}: {
  /** Holds the slot while this card is up ("trophy", "routine"). */
  kind: string
  /** The small coloured line naming what happened ("Trophy earned"). */
  label: string
  title: string
  detail: ReactNode
  /** What sits in the coloured disc: an icon or an emoji. */
  badge: ReactNode
  tint: string
  /** The disc's fill when it should not be the full tint (a trophy's
   * wreath badge sits on a soft disc). */
  discColor?: string
  /** Read out by VoiceOver as the card lands. */
  say: string
  hint: string
  onOpen: () => void
  /** Shown as a close button when given. */
  onClose?: () => void
  testID: string
}) {
  const t = useTheme()
  const inset = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const pop = useSharedValue(reduced ? 1 : 0.6)
  useEffect(() => {
    momentSlot.set({ holder: kind })
    return () =>
      momentSlot.set((s) => (s.holder === kind ? { holder: null } : s))
  }, [kind])
  useEffect(() => {
    feel.success()
    AccessibilityInfo.announceForAccessibility(say)
    if (!reduced)
      pop.value = withDelay(
        MOTION.fast,
        withSpring(1, { damping: 9, stiffness: 260 }),
      )
  }, [reduced, pop, say])
  const disc = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }))
  // In from the top edge and back out the same way; a plain fade under
  // Reduce Motion, which still plays so the moment is never silent.
  const never = ReduceMotion.Never
  const entering = reduced
    ? FadeIn.duration(200).reduceMotion(never)
    : FadeInUp.duration(220).reduceMotion(never)
  const exiting = reduced
    ? FadeOut.duration(150).reduceMotion(never)
    : FadeOutUp.duration(150).reduceMotion(never)
  return (
    <Overlay>
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: inset.top + 8,
          left: 16,
          right: 16,
          alignItems: "center",
        }}
      >
        <Animated.View
          testID={testID}
          entering={entering}
          exiting={exiting}
          style={{
            width: "100%",
            maxWidth: 420,
            flexDirection: "row",
            alignItems: "center",
            borderRadius: 18,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.card,
            boxShadow: "0px 8px 24px rgba(0, 0, 0, 0.28)",
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={say}
            accessibilityHint={hint}
            onPress={onOpen}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingVertical: 12,
              paddingLeft: 12,
              paddingRight: onClose ? 0 : 8,
              minHeight: 64,
            }}
          >
            <Animated.View
              style={[
                {
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: discColor ?? tint,
                  alignItems: "center",
                  justifyContent: "center",
                },
                disc,
              ]}
            >
              {badge}
            </Animated.View>
            <View style={{ flex: 1, gap: 2 }}>
              <Copy size={12} weight="medium" style={{ color: tint }}>
                {label}
              </Copy>
              <Text
                style={{
                  fontFamily: fonts.semibold,
                  fontSize: 16,
                  lineHeight: 21,
                  color: t.text,
                }}
              >
                {title}
              </Text>
              {detail}
            </View>
            {!onClose && <ChevronRight size={18} color={t.muted} />}
          </Pressable>
          {onClose && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              onPress={onClose}
              hitSlop={4}
              style={{
                width: 44,
                minHeight: 44,
                alignSelf: "stretch",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={18} color={t.muted} />
            </Pressable>
          )}
        </Animated.View>
      </View>
    </Overlay>
  )
}
