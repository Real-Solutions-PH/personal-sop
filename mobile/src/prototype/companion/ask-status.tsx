import { Pressable, Text } from "react-native"
import { fonts, useTheme } from "../theme"
import { type Msg, replying, retryAsk, stopReply } from "./store"

/** Under a question not answered yet: queued (the server holds it and
 * answers it in order, even with the app closed; Send now stops the reply
 * ahead of it), waiting for a connection (handed over on reconnect), or
 * failed and can be sent again. */
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
        {m.held ? "Queued" : "Waiting for a connection"}
      </Text>
    )
  if (m.status !== "failed") return null
  // Stopped after recording something: running it again is the person's
  // call (it could record twice), so it says it did not finish.
  const cut = m.error === "interrupted" || m.error === "reply_failed"
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cut ? "Couldn't finish. Retry" : "Not sent. Retry"}
      onPress={() => retryAsk(m.id)}
      hitSlop={8}
    >
      <Text
        style={{ color: t.muted, fontFamily: fonts.semibold, fontSize: 11 }}
      >
        {cut ? "Couldn't finish" : "Not sent"} ·{" "}
        <Text style={{ color: t.primary, fontFamily: fonts.semibold }}>
          Retry
        </Text>
      </Text>
    </Pressable>
  )
}
