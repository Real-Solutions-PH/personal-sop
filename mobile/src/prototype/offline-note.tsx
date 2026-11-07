// Offline, said by Fern: a small speech bubble that rises from the Fern
// button in the tab bar, reassuring that nothing is lost while the phone has
// no internet. It takes its own room above the bar, so it never covers the
// page or the tabs. On a page without the bar (a timer, a routine, the chat)
// there is no Fern button to speak from, so a small Fern sits in the bubble.
// In and out: a short fade with a lift of a few points (opacity and
// transform only); under Reduce Motion it simply appears and goes.

import { CloudOff } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Platform, Text, View } from "react-native"
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { FernSprite } from "./companion/fern-sprite"
import { fonts, useTheme } from "./theme"

/** How far the Fern button rises above the tab bar (``marginTop: -30`` on
 * its 72 pt frame, its 60 pt circle centred): the bubble's tail tucks
 * just under the circle's top edge. */
const FERN_RISE = 16
const TAIL = 6

export const OFFLINE_LABEL =
  "Offline. Your changes are safe on this phone and sync when you're back online."

const IN_MS = 200
const OUT_MS = 160

export function OfflineNote({
  offline,
  withBar,
  bottomInset = 0,
}: {
  /** The phone has no internet now. The note stays mounted and fades out
   * before giving its room back, so the page never jumps mid-fade. */
  offline: boolean
  /** The tab bar (and its Fern button) is right below. */
  withBar: boolean
  /** Bottom safe area, when nothing else sits below the note. */
  bottomInset?: number
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(offline)
  const seen = useSharedValue(offline ? 1 : 0)
  // The fade-out ends on the UI thread a frame or more later; by then the
  // phone may be offline again, so the room goes only if it still is online.
  const live = useRef(offline)
  live.current = offline
  useEffect(() => {
    // A view appearing is not spoken on iOS: say it once on the way in.
    // Android already reads it through the polite live region.
    if (offline && Platform.OS === "ios")
      AccessibilityInfo.announceForAccessibility?.(OFFLINE_LABEL)
  }, [offline])
  useEffect(() => {
    const hide = () => {
      if (!live.current) setShown(false)
    }
    if (offline) setShown(true)
    if (reduced) {
      seen.value = offline ? 1 : 0
      if (!offline) setShown(false)
      return
    }
    seen.value = withTiming(
      offline ? 1 : 0,
      { duration: offline ? IN_MS : OUT_MS },
      (done) => {
        if (done && !offline) runOnJS(hide)()
      },
    )
  }, [offline, reduced, seen])
  // A lift of a few points out of Fern, and back down on the way out.
  const motion = useAnimatedStyle(() => ({
    opacity: seen.value,
    transform: [
      { translateY: (1 - seen.value) * 6 },
      { scale: 0.96 + seen.value * 0.04 },
    ],
  }))
  if (!shown) return null
  return (
    <Animated.View
      style={[
        {
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 6,
          paddingBottom: withBar ? FERN_RISE + 2 : Math.max(bottomInset, 8),
        },
        motion,
      ]}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={OFFLINE_LABEL}
      testID="offline-note"
    >
      <View style={{ alignItems: "center", maxWidth: "100%" }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 5,
            paddingLeft: withBar ? 10 : 6,
            paddingRight: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.card,
            maxWidth: "100%",
          }}
        >
          {withBar ? (
            <CloudOff size={14} strokeWidth={2.2} color={t.muted} />
          ) : (
            <FernSprite size={20} state="idle" decorative />
          )}
          <Text
            style={{
              flexShrink: 1,
              fontSize: 13,
              fontFamily: fonts.body,
              color: t.muted,
            }}
          >
            <Text style={{ fontFamily: fonts.medium, color: t.text }}>
              Offline
            </Text>
            {" · your changes are safe on this phone"}
          </Text>
        </View>
        {withBar && (
          // The tail points down at Fern: a small square turned 45°, its
          // lower half showing under the bubble's edge.
          <View
            style={{
              width: TAIL * 2,
              height: TAIL * 2,
              marginTop: -TAIL - 1,
              transform: [{ rotate: "45deg" }],
              borderRightWidth: 1,
              borderBottomWidth: 1,
              borderColor: t.line,
              backgroundColor: t.card,
            }}
          />
        )}
      </View>
    </Animated.View>
  )
}
