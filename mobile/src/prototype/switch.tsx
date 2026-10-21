import * as Haptics from "expo-haptics"
import { useEffect } from "react"
import { Pressable, View } from "react-native"
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"
import { type Accent, useTheme } from "./theme"
export function Switch({
  label,
  value,
  onChange,
  accent = "tsk",
  compact = false,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  accent?: Accent
  compact?: boolean
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const on = useSharedValue(value ? 1 : 0)
  useEffect(() => {
    on.value = reduced
      ? value
        ? 1
        : 0
      : withSpring(value ? 1 : 0, { damping: 18, stiffness: 300 })
  }, [value, reduced, on])
  const off = t.soft
  const color = t[accent]
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [off, color]),
  }))
  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: on.value * 20 }],
  }))
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {})
        onChange(!value)
      }}
      style={{
        width: compact ? 48 : 56,
        height: compact ? 28 : 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[{ width: 48, height: 28, borderRadius: 14 }, track]}
      >
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 2,
              left: 2,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: "#fff",
              boxShadow: "0px 1px 3px #00000033",
            },
            knob,
          ]}
        />
      </Animated.View>
      <View />
    </Pressable>
  )
}
