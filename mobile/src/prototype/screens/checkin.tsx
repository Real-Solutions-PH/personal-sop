// The daily check-in the evening notification opens. Fern's question is
// static (no model call); the one answer goes through capture with the
// checkin hint, so nobody has to remember to log. Sending marks the day,
// which moves tonight's ask to tomorrow.
import { sendCapture } from "@domain/capture/actions"
import { captureStore } from "@domain/capture/store"
import { setPush } from "@domain/dash/store"
import { dayKey } from "@domain/lib/day"
import { useState } from "react"
import { View } from "react-native"
import { FernSprite } from "../companion/fern-sprite"
import { Copy, Frame, Line } from "../native-kit"
import { replace } from "../navigation"
import { Button, Screen } from "../ui"
import { Exchange, ThreadComposer } from "./capture-thread"

export function CheckIn({
  onDone = () => replace("/today"),
}: {
  onDone?: () => void
}) {
  const [capId, setCapId] = useState<string | null>(null)
  const cap = captureStore.use((s) =>
    capId ? s.captures.find((c) => c.id === capId) : undefined,
  )
  const answer = (text: string) => {
    setCapId(sendCapture({ text, source: "text", hint: "checkin" }))
    setPush({ lastCheckin: dayKey() })
  }
  return (
    <Screen title="Check-in">
      <Frame style={{ padding: 16 }}>
        <Line style={{ gap: 12, alignItems: "flex-start" }}>
          <FernSprite size={48} state="listening" decorative />
          <View style={{ flex: 1, gap: 4 }}>
            <Copy size={20} weight="semibold">
              How did today go?
            </Copy>
            <Copy size={14} muted>
              One sentence or a voice note — I'll log the habits, meals,
              spending and tasks in it.
            </Copy>
          </View>
        </Line>
      </Frame>
      {cap ? (
        <View style={{ gap: 12 }}>
          <Exchange cap={cap} />
          <Button onPress={onDone}>Done</Button>
        </View>
      ) : (
        <ThreadComposer
          hints={false}
          placeholder="e.g. gym done, lunch was 300, didn't read"
          onText={(text) => text && answer(text)}
        />
      )}
    </Screen>
  )
}
