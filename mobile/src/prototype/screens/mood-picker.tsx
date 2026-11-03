// The five mood faces, shared by Journal, capture edit and Today's check-in.
// Kept out of journal.tsx so Today doesn't load the journal screen.
import { MOODS, type Mood } from "@domain/capture/data"
import { Check } from "lucide-react-native"
import { View } from "react-native"
import { moodLeaves } from "../brand/mood-leaf"
import { Copy, Line, Tap } from "../native-kit"
import { useTheme } from "../theme"

/** The mood marks, drawn as leaves (brand/mood-leaf). */
export const moodIcons = moodLeaves

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
              height: 60,
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              borderRadius: 12,
              backgroundColor: t.card,
              // Selected is a 2 pt ink outline and a check, never colour
              // alone; the rest sit on a hairline.
              borderWidth: on ? 2 : 1,
              borderColor: on ? t.text : t.line,
            }}
          >
            {on && (
              <View
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: t.text,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Check size={10} strokeWidth={3} color={t.card} />
              </View>
            )}
            <I size={22} color={on ? t.life : t.muted} />
            <Copy
              size={12}
              weight={on ? "medium" : undefined}
              muted={!on}
              lines={1}
            >
              {m.label}
            </Copy>
          </Tap>
        )
      })}
    </Line>
  )
}
