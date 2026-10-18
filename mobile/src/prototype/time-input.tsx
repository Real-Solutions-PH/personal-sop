import { useEffect, useState } from "react"
import { Platform, TextInput, View } from "react-native"
import { Copy, Tap } from "./native-kit"
import { fonts, useTheme } from "./theme"
/** "17:46" → "5:46 PM" — the app's display format for clock times. */
export function fmtClock(value: string) {
  const m = /^(\d{2}):(\d{2})$/.exec(value)
  if (!m) return value
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`
}
/** Accept "17:46", "5:46", "5:46 pm" or "5:46PM"; return "HH:mm" or null. */
export function parseClock(input: string) {
  const m = /^\s*(\d{1,2}):([0-5]\d)\s*([ap])?\.?m?\.?\s*$/i.exec(input)
  if (!m) return null
  let h = Number(m[1])
  const ap = m[3]?.toLowerCase()
  if (ap) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (ap === "p" ? 12 : 0)
  } else if (h > 23) return null
  return `${String(h).padStart(2, "0")}:${m[2]}`
}
/** Compact time control. Keep an editable draft on web; commit only a valid time. */
export function TimeInput({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  label: string
}) {
  const t = useTheme(),
    [draft, setDraft] = useState(fmtClock(value)),
    [open, setOpen] = useState(false)
  // Re-sync only when the value moved away from what the draft already says,
  // so committing "5:46" mid-typing doesn't clobber the "PM" still to come.
  useEffect(
    () => setDraft((d) => (parseClock(d) === value ? d : fmtClock(value))),
    [value],
  )
  const Picker =
    open && Platform.OS !== "web"
      ? (
          require("@react-native-community/datetimepicker") as typeof import("@react-native-community/datetimepicker")
        ).default
      : null
  const style = {
    backgroundColor: t.soft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  }
  return (
    <View>
      {Platform.OS === "web" ? (
        <TextInput
          accessibilityLabel={label}
          value={draft}
          onChangeText={(v) => {
            setDraft(v)
            const parsed = parseClock(v)
            if (parsed) onChange(parsed)
          }}
          onBlur={() => setDraft(fmtClock(value))}
          maxLength={8}
          style={{
            ...style,
            fontFamily: fonts.body,
            fontSize: 14,
            color: t.text,
            width: 84,
          }}
        />
      ) : (
        <Tap label={label} onPress={() => setOpen(!open)} style={style}>
          <Copy size={14}>{fmtClock(value)}</Copy>
        </Tap>
      )}
      {Picker && (
        <Picker
          value={new Date(`2000-01-01T${value}:00`)}
          mode="time"
          display="default"
          onChange={(event, date) => {
            setOpen(false)
            if (event.type === "set" && date)
              onChange(
                `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
              )
          }}
        />
      )}
    </View>
  )
}
