import { Gem } from "lucide-react-native"
import { useEffect, useState } from "react"
import { Text, View } from "react-native"
import { fonts, useTheme } from "../theme"
import { Button } from "../ui"
import {
  allowanceStore,
  allowanceView,
  PLUS_HREF,
  plusAvailable,
  refreshAllowance,
} from "./allowance"
import { replying } from "./store"

/** Above Fern's composer: how many messages are left today once 3 or fewer
 * remain; at zero, when they come back and an "Unfurl Plus" button (the
 * paywall, or a calm "coming soon" while this build cannot buy). */
export function AllowanceNote({ name }: { name: string }) {
  const t = useTheme()
  const a = allowanceStore.use((s) => s)
  const answering = replying((s) => s.id)
  const [soon, setSoon] = useState(false)
  // Asked when the chat opens and again each time a reply ends.
  useEffect(() => {
    if (answering === null) void refreshAllowance()
  }, [answering])
  const view = allowanceView(a, name)
  if (view.kind === "none") return null
  if (view.kind === "few")
    return (
      <Text
        accessibilityLiveRegion="polite"
        style={{
          color: t.muted,
          fontFamily: fonts.semibold,
          fontSize: 12,
          textAlign: "center",
          paddingHorizontal: 16,
          paddingTop: 6,
        }}
      >
        {view.text}
      </Text>
    )
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 4,
        gap: 10,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          color: t.text,
          fontFamily: fonts.body,
          fontSize: 14,
          lineHeight: 20,
          textAlign: "center",
        }}
      >
        {view.text}
      </Text>
      {soon ? (
        <Text
          style={{
            color: t.muted,
            fontFamily: fonts.body,
            fontSize: 13,
            textAlign: "center",
          }}
        >
          Unfurl Plus is coming soon. Your messages come back on their own until
          then.
        </Text>
      ) : (
        <Button
          small
          icon={Gem}
          {...(plusAvailable()
            ? { href: PLUS_HREF }
            : { onPress: () => setSoon(true) })}
        >
          Unfurl Plus
        </Button>
      )}
    </View>
  )
}
