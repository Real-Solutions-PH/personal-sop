// The five mood faces, shared by Journal, capture edit and Today's check-in.
// Kept out of journal.tsx so Today doesn't load the journal screen.
import { MOODS, type Mood } from "@domain/capture/data"
import { Annoyed, Frown, Laugh, Meh, Smile } from "lucide-react-native"
import { border, Copy, Line, Tap } from "../native-kit"
import { useTheme } from "../theme"

export const moodIcons = { 1: Frown, 2: Annoyed, 3: Meh, 4: Smile, 5: Laugh }

export function MoodPicker({
  value,
  onChange,
}: {
  value?: Mood
  onChange: (v: Mood | undefined) => void
}) {
  const t = useTheme()
  return (
    <Line style={{ gap: 6 }}>
      {MOODS.map((m) => {
        const I = moodIcons[m.v],
          on = value === m.v
        return (
          <Tap
            key={m.v}
            label={m.label}
            selected={on}
            onPress={() => onChange(on ? undefined : m.v)}
            style={{
              height: 56,
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              borderRadius: 12,
              backgroundColor: on ? border(t.life, 0.2) : t.soft,
              borderWidth: on ? 2 : 0,
              borderColor: t.life,
            }}
          >
            <I size={20} color={on ? t.life : t.muted} />
            <Copy size={10} style={{ color: on ? t.life : t.muted }}>
              {m.label}
            </Copy>
          </Tap>
        )
      })}
    </Line>
  )
}
