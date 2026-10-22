import { Pressable, Text } from "react-native"
import { fonts, useTheme } from "../theme"
import { type Msg, retryAsk } from "./store"

/** Under a question the server has not stored yet: it waits for a
 * connection (sent on reconnect), or it failed and can be sent again. */
export function AskStatus({ m }: { m: Msg }) {
  const t = useTheme()
  if (m.status === "queued")
    return (
      <Text
        style={{ color: t.muted, fontFamily: fonts.semibold, fontSize: 11 }}
      >
        Waiting for a connection
      </Text>
    )
  if (m.status !== "failed") return null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Not sent. Retry"
      onPress={() => retryAsk(m.id)}
      hitSlop={8}
    >
      <Text
        style={{ color: t.muted, fontFamily: fonts.semibold, fontSize: 11 }}
      >
        Not sent ·{" "}
        <Text style={{ color: t.primary, fontFamily: fonts.semibold }}>
          Retry
        </Text>
      </Text>
    </Pressable>
  )
}
