// "Keep reminding me" on a task or habit: once it is overdue, the phone
// repeats the reminder every interval for the rest of that day (outside
// quiet hours) until it is done. Off is null; on defaults to every hour.
// The repeats are planned in local-reminders.ts.

import { BellRing } from "lucide-react-native"
import { View } from "react-native"
import { Copy, Line, Segmented } from "../native-kit"
import { askForReminders } from "../reminders"
import { Switch } from "../switch"
import { useTheme } from "../theme"

export const NAG_CHOICES = [
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hr" },
  { value: "120", label: "2 hr" },
  { value: "180", label: "3 hr" },
]
const DEFAULT = 60

export const nagLabel = (min: number) =>
  min % 60 ? `${min} min` : min === 60 ? "hour" : `${min / 60} hours`

export function KeepReminding({
  value,
  onChange,
  accent,
  unavailable,
}: {
  value: number | null | undefined
  onChange: (min: number | null) => void
  accent: "tsk" | "hab"
  /** Why there is no overdue moment yet ("Add a date first"); shown
   * instead of the switch, which would have nothing to repeat. */
  unavailable?: string
}) {
  const t = useTheme(),
    on = !!value
  return (
    <View style={{ gap: 12 }}>
      <Line style={{ alignItems: "flex-start", gap: 12 }}>
        <BellRing size={16} color={on ? t[accent] : t.muted} />
        <View style={{ flex: 1, gap: 2 }}>
          <Copy size={14} weight="medium">
            Keep reminding me
          </Copy>
          <Copy size={12} muted>
            {unavailable ??
              (on
                ? `Every ${nagLabel(value)} once it's overdue, until done or the day ends. Skips quiet hours.`
                : "For what can't slip, like medicine: repeat the reminder until it's done.")}
          </Copy>
        </View>
        {!unavailable && (
          <Switch
            compact
            accent={accent}
            label="Keep reminding me"
            value={on}
            onChange={(next) => {
              onChange(next ? DEFAULT : null)
              if (next) void askForReminders()
            }}
          />
        )}
      </Line>
      {on && !unavailable && (
        <Segmented
          value={String(value)}
          onChange={(v) => onChange(Number(v))}
          options={
            NAG_CHOICES.some((c) => c.value === String(value))
              ? NAG_CHOICES
              : [
                  ...NAG_CHOICES,
                  { value: String(value), label: `${value} min` },
                ]
          }
        />
      )}
    </View>
  )
}
