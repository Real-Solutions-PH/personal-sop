// Fern's one-time offer to bring back a hidden part (the server's
// ``module_intro`` block): what it adds, with "Turn on" and "Not for me".
// Either answer is acknowledged in place; "Not for me" is kept on the
// account, so neither Fern nor Today offers that part again.
import { dashStore } from "@domain/dash/store"
import { Check, Power } from "lucide-react-native"
import { Pressable, Text, View } from "react-native"
import Animated, { ZoomIn } from "react-native-reanimated"
import { extrasStore } from "../extras"
import {
  INTRO_LABEL,
  type IntroKey,
  notForMe,
  partOn,
  turnPartOn,
} from "../module-intro"
import { feel } from "../motion"
import { fonts, useTheme } from "../theme"

const isIntroKey = (k: unknown): k is IntroKey =>
  typeof k === "string" && Object.hasOwn(INTRO_LABEL, k)

export function ModuleIntroBlock({
  module,
  text,
}: {
  module: string
  text: string
}) {
  const t = useTheme()
  const enabled = dashStore.use((s) => s.enabled)
  const dismissed = dashStore.use((s) => s.intro.dismissed)
  const shown = extrasStore.use((s) => s)
  if (!isIntroKey(module)) return null
  const label = INTRO_LABEL[module]
  const done = (line: string, good: boolean) => (
    <Animated.View
      entering={ZoomIn}
      style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
    >
      <Check size={16} color={good ? t.good : t.muted} />
      <Text
        style={{
          flex: 1,
          color: t.text,
          fontFamily: fonts.medium,
          fontSize: 14,
        }}
      >
        {line}
      </Text>
    </Animated.View>
  )
  if (partOn(module, enabled, shown))
    return done(`${label} is on. It shows on Today again.`, true)
  if (dismissed.includes(module))
    return done(`Got it. I won't bring up ${label} again.`, false)
  const chip = (
    title: string,
    onPress: () => void,
    primary: boolean,
    icon?: boolean,
  ) => (
    <Pressable
      cssInterop={false}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        minHeight: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: primary ? `${t.primary}66` : t.line,
        backgroundColor: pressed ? `${t.primary}26` : "transparent",
      })}
    >
      {icon && <Power size={14} color={t.primary} />}
      <Text
        style={{
          color: primary ? t.primary : t.text,
          fontFamily: fonts.medium,
          fontSize: 13,
        }}
      >
        {title}
      </Text>
    </Pressable>
  )
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          color: t.muted,
          fontFamily: fonts.body,
          fontSize: 14,
          lineHeight: 20,
        }}
      >
        {text}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {chip(
          `Turn on ${label}`,
          () => {
            feel.tap()
            turnPartOn(module)
          },
          true,
          true,
        )}
        {chip("Not for me", () => notForMe(module), false)}
      </View>
    </View>
  )
}
