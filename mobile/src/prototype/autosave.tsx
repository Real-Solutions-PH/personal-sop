import { Check, CircleAlert } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { Text, View } from "react-native"
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { fonts, useTheme } from "./theme"

// The app's save rule (see the forms PR): a page that edits something that
// already exists — a record, a profile, a setting — saves as you go, the way
// iOS Settings, Notes and Reminders do. Nothing to find at the bottom of the
// page; the header says "Saved" once it is. Creating something new keeps an
// explicit action that is always on screen (a header button, or a footer
// pinned on the keyboard).

/** How long edits pause before they are written. */
export const AUTOSAVE_MS = 600

export type AutosaveState =
  | { kind: "idle" }
  | { kind: "saved"; count: number }
  | { kind: "invalid"; reason: string }

/**
 * Saves ``value`` with ``persist`` a moment after it stops changing, and
 * once more on leaving the page if an edit is still waiting. Nothing is
 * written while ``invalid`` names a reason (the mark shows it instead), and
 * nothing on mount: opening a page is not an edit.
 */
export function useAutosave<T>(
  value: T,
  persist: (value: T) => void,
  { invalid, delay = AUTOSAVE_MS }: { invalid?: string; delay?: number } = {},
): AutosaveState {
  const [count, setCount] = useState(0)
  const latest = useRef({ value, persist, invalid })
  latest.current = { value, persist, invalid }
  const pending = useRef(false)
  const opened = useRef(JSON.stringify(value))
  const key = JSON.stringify(value)
  // Keyed on the value's content: a parent re-render with an equal draft is
  // not an edit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on content
  useEffect(() => {
    if (key === opened.current && !pending.current && !count) return
    if (invalid) {
      pending.current = false
      return
    }
    pending.current = true
    const id = setTimeout(() => {
      pending.current = false
      latest.current.persist(latest.current.value)
      setCount((n) => n + 1)
    }, delay)
    return () => clearTimeout(id)
  }, [key, invalid])
  // Leaving mid-edit (back, swipe) still saves the last valid draft.
  useEffect(
    () => () => {
      const l = latest.current
      if (pending.current && !l.invalid) l.persist(l.value)
    },
    [],
  )
  if (invalid && key !== opened.current)
    return { kind: "invalid", reason: invalid }
  return count ? { kind: "saved", count } : { kind: "idle" }
}

/** The header's save state: a check that pops green on each save and then
 * settles to a quiet "Saved", or why the last edit is not saved. */
export function SavedMark({ state }: { state: AutosaveState }) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const fresh = useSharedValue(0)
  const count = state.kind === "saved" ? state.count : 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per save
  useEffect(() => {
    if (!count) return
    fresh.value = 1
    fresh.value = withSequence(
      withTiming(1, { duration: 1400 }),
      withTiming(0, { duration: reduced ? 0 : 400 }),
    )
    if (!reduced)
      scale.value = withSequence(
        withSpring(1.25, { damping: 12, stiffness: 420 }),
        withSpring(1, { damping: 14, stiffness: 260 }),
      )
  }, [count])
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const glow = useAnimatedStyle(() => ({ opacity: fresh.value }))
  if (state.kind === "idle") return null
  if (state.kind === "invalid")
    return (
      <View
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 8,
          maxWidth: 180,
        }}
      >
        <CircleAlert size={14} color={t.warn} />
        <Text
          style={{
            fontFamily: fonts.medium,
            fontSize: 12,
            lineHeight: 16,
            color: t.warn,
            flexShrink: 1,
          }}
        >
          {state.reason}
        </Text>
      </View>
    )
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel="Saved"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        minHeight: 44,
      }}
    >
      <Animated.View style={pop}>
        <View>
          <Check size={14} color={t.muted} strokeWidth={2.5} />
          <Animated.View style={[{ position: "absolute" }, glow]}>
            <Check size={14} color={t.good} strokeWidth={2.5} />
          </Animated.View>
        </View>
      </Animated.View>
      <View>
        <Text
          style={{ fontFamily: fonts.medium, fontSize: 12, color: t.muted }}
        >
          Saved
        </Text>
        <Animated.Text
          style={[
            {
              position: "absolute",
              fontFamily: fonts.medium,
              fontSize: 12,
              color: t.good,
            },
            glow,
          ]}
        >
          Saved
        </Animated.Text>
      </View>
    </View>
  )
}
