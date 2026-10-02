import { useEffect, useState } from "react"
import { Platform, TextInput, View } from "react-native"
import { Copy, Tap } from "./native-kit"
import { fonts, useTheme } from "./theme"
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
    [draft, setDraft] = useState(value),
    [open, setOpen] = useState(false)
  useEffect(() => setDraft(value), [value])
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
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) onChange(v)
          }}
          onBlur={() => setDraft(value)}
          maxLength={5}
          style={{
            ...style,
            fontFamily: fonts.body,
            fontSize: 14,
            color: t.text,
            width: 70,
          }}
        />
      ) : (
        <Tap label={label} onPress={() => setOpen(!open)} style={style}>
          <Copy size={14}>{value}</Copy>
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
