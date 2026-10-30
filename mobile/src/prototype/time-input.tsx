import { Clock } from "lucide-react-native"
import { useEffect, useState } from "react"
import { Platform, TextInput, View } from "react-native"
import { Copy, Tap } from "./native-kit"
import { fonts, useTheme } from "./theme"
import { Button, Sheet } from "./ui"

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
const asDate = (v: string) => new Date(`2000-01-01T${v}:00`)

/** Compact time control. One tap opens the time wheel: Android's clock
 * dialog, and on iOS a sheet with the wheel already turning (the inline
 * compact picker needed a second tap). Web keeps an editable draft and
 * commits only a valid time. */
export function TimeInput({
  value,
  onChange,
  label,
  field = false,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  /** Drawn as a form field (the Date field's box), to sit beside one. */
  field?: boolean
}) {
  const t = useTheme(),
    [draft, setDraft] = useState(value),
    [open, setOpen] = useState(false),
    [turning, setTurning] = useState(() => asDate(value))
  useEffect(() => setDraft(value), [value])
  const Picker =
    Platform.OS !== "web"
      ? (
          require("@react-native-community/datetimepicker") as typeof import("@react-native-community/datetimepicker")
        ).default
      : null
  const style = field
    ? {
        minHeight: 44,
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: t.line,
        borderRadius: 12,
        paddingHorizontal: 12,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
      }
    : {
        backgroundColor: t.soft,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 6,
      }
  if (Platform.OS === "web")
    return (
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
          width: field ? undefined : 70,
        }}
      />
    )
  return (
    <View>
      <Tap
        label={label}
        onPress={() => {
          setTurning(asDate(value))
          setOpen(true)
        }}
        style={style}
      >
        <Copy size={14}>{value}</Copy>
        {field && <Clock size={16} color={t.muted} />}
      </Tap>
      {Picker && Platform.OS === "android" && open && (
        <Picker
          value={asDate(value)}
          mode="time"
          display="default"
          onChange={(event, date) => {
            setOpen(false)
            if (event.type === "set" && date) onChange(hhmm(date))
          }}
        />
      )}
      {Picker && Platform.OS === "ios" && (
        <Sheet title={label} open={open} onClose={() => setOpen(false)}>
          <View style={{ alignItems: "center" }}>
            <Picker
              testID="time-wheel"
              value={turning}
              mode="time"
              display="spinner"
              themeVariant={t.dark ? "dark" : "light"}
              textColor={t.text}
              onChange={(_, date) => date && setTurning(date)}
            />
          </View>
          <Button
            onPress={() => {
              onChange(hhmm(turning))
              setOpen(false)
            }}
          >
            Done
          </Button>
        </Sheet>
      )}
    </View>
  )
}
