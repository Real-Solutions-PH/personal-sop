import { LinearGradient } from "expo-linear-gradient"
import { useEffect } from "react"
import { View } from "react-native"
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated"
import { useTheme } from "../theme"

/**
 * The companion's face: a softly breathing gradient orb. It breathes faster
 * and glows while it is thinking.
 */
export function Orb({
  size = 32,
  active = false,
}: {
  size?: number
  active?: boolean
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const breath = useSharedValue(0)
  const spin = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    const half = active ? 520 : 1800
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: half, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: half, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    )
    spin.value = withRepeat(
      withTiming(360, {
        duration: active ? 2400 : 9000,
        easing: Easing.linear,
      }),
      -1,
    )
  }, [active, reduced, breath, spin])
  const body = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + breath.value * 0.06 },
      { rotate: `${spin.value}deg` },
    ],
  }))
  const glow = useAnimatedStyle(() => ({
    opacity: (active ? 0.45 : 0.22) + breath.value * 0.25,
    transform: [{ scale: 1.15 + breath.value * 0.2 }],
  }))
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Companion"
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: t.hab,
          },
          glow,
        ]}
      />
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            overflow: "hidden",
          },
          body,
        ]}
      >
        <LinearGradient
          colors={[t.primary, t.hab, t.fit]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        />
        <View
          style={{
            position: "absolute",
            top: size * 0.14,
            left: size * 0.2,
            width: size * 0.34,
            height: size * 0.22,
            borderRadius: size,
            backgroundColor: "#ffffff55",
          }}
        />
      </Animated.View>
    </View>
  )
}
