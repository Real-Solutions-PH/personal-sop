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
import { FernMark, fernPalette } from "./brand"
import { companionStore } from "./store"

/**
 * The companion's face: Fern's fiddlehead on a moss-to-sprout orb. It
 * breathes at rest; while thinking it breathes faster, glows, and the frond
 * sways as if unfurling.
 */
export function Orb({
  size = 32,
  active = false,
}: {
  size?: number
  active?: boolean
}) {
  const t = useTheme()
  const name = companionStore.use((s) => s.name)
  const p = fernPalette(t.dark)
  const reduced = useReducedMotion()
  const breath = useSharedValue(0)
  const sway = useSharedValue(0)
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
    sway.value = active
      ? withRepeat(
          withSequence(
            withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) }),
            withTiming(-1, { duration: 700, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
          true,
        )
      : withTiming(0, { duration: 400 })
  }, [active, reduced, breath, sway])
  const body = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.value * 0.05 }],
  }))
  const frond = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sway.value * 9}deg` }],
  }))
  const glow = useAnimatedStyle(() => ({
    opacity: (active ? 0.5 : 0.22) + breath.value * 0.25,
    transform: [{ scale: 1.15 + breath.value * 0.2 }],
  }))
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
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
            backgroundColor: p.sprout,
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
            alignItems: "center",
            justifyContent: "center",
          },
          body,
        ]}
      >
        <LinearGradient
          colors={[p.moss, p.frond, p.sprout]}
          start={{ x: 0.1, y: 1 }}
          end={{ x: 0.9, y: 0 }}
          style={{ position: "absolute", inset: 0 }}
        />
        {size >= 16 && (
          <Animated.View style={frond}>
            <FernMark
              size={size * 0.72}
              color="#ffffff"
              weight={size < 28 ? 2.4 : 2}
            />
          </Animated.View>
        )}
      </Animated.View>
    </View>
  )
}
