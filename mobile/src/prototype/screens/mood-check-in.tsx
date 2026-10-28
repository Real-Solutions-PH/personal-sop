// A one-tap mood check-in on Today. One a day: tapping another face changes
// it; tapping the picked face again leaves it. Stored as a journal entry
// tagged CHECK_IN, so Journal's mood trend sees it.
import { checkInMood } from "@domain/capture/actions"
import { CHECK_IN } from "@domain/capture/data"
import { captureStore } from "@domain/capture/store"
import { dayKey } from "@domain/lib/day"
import { Copy, Frame } from "../native-kit"
import { MoodPicker } from "./mood-picker"

export function MoodCheckIn() {
  const day = dayKey(),
    mood = captureStore.use(
      (s) =>
        s.journal.find((j) => j.day === day && j.tags.includes(CHECK_IN))?.mood,
    )
  return (
    <Frame style={{ padding: 16, marginTop: 16, gap: 10 }}>
      <Copy weight="semibold">How's today?</Copy>
      <MoodPicker value={mood} onChange={(v) => v && checkInMood(v, day)} />
    </Frame>
  )
}
