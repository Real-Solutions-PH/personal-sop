import { Pressable, Text } from "react-native"
import { fonts, useTheme } from "../theme"
import { type Msg, replying, retryAsk, stopReply } from "./store"

/** Under a question the server has not stored yet: it waits behind the
 * reply being written (Send now stops that reply), waits for a connection
 * (sent on reconnect), or it failed and can be sent again. */
export function AskStatus({ m }: { m: Msg }) {
  const t = useTheme()
  const busy = replying((s) => s.id !== null)
  // Sent while Fern was still answering: it goes when the reply ends, or
  // at once if the person asks (the reply stops where it is).
  if (m.status === "queued" && busy)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Queued. Send now"
        onPress={stopReply}
        hitSlop={8}
      >
        <Text
          style={{ color: t.muted, fontFamily: fonts.semibold, fontSize: 11 }}
        >
          Queued ·{" "}
          <Text style={{ color: t.primary, fontFamily: fonts.semibold }}>
            Send now
          </Text>
        </Text>
      </Pressable>
    )
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
