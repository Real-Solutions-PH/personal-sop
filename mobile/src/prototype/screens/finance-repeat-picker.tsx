import { parseKey, repeatLabel, shortDate } from "@domain/finance/calc"
import { useState } from "react"
import { View } from "react-native"
import {
  isLastDay,
  type Preset,
  presetOf,
  previewDates,
  type Repeat,
  ruleFrom,
  type Unit,
  unitOf,
} from "../finance-repeat"
import { Stepper } from "../fitness-controls"
import { Copy } from "../native-kit"
import { Button, Choices, Sheet, Toggle } from "../ui"

export {
  followStart,
  type Repeat,
  repeatText,
  ruleFrom,
} from "../finance-repeat"

/**
 * The Repeat sheet for money: presets (Weekly, Monthly, Every 2 months,
 * Every 3 months, Yearly) plus Custom (every N days, weeks, months or
 * years), all counted from ``start``. Tasks have their own Repeat sheet
 * (task-detail.tsx), which also repeats "after done"; money only repeats on
 * the calendar.
 */
export function RepeatPicker(props: {
  value: Repeat
  start: string
  onPick: (rule: Repeat) => void
  onClose: () => void
  semimonthly?: boolean
}) {
  return (
    <Sheet title="Repeat" open onClose={props.onClose}>
      <RepeatChooser {...props} />
    </Sheet>
  )
}

/** The Repeat choices without their sheet, for a sheet that shows them as
 * a step (as the scheduled-payment editor does with its category). */
export function RepeatChooser({
  value,
  start,
  onPick,
  onClose,
  semimonthly = false,
}: {
  value: Repeat
  start: string
  onPick: (rule: Repeat) => void
  onClose: () => void
  /** Offer the payday preset "15th & 30th" (scheduled payments). */
  semimonthly?: boolean
}) {
  const [preset, setPreset] = useState<Preset>(presetOf(value))
  const [unit, setUnit] = useState<Unit>(unitOf(value))
  const [every, setEvery] = useState(
    value && "every" in value && value.every ? value.every : 1,
  )
  const [lastDay, setLastDay] = useState(
    (value?.kind === "monthly" || value?.kind === "yearly") && value.day >= 31,
  )
  const monthEnd = isLastDay(start) && parseKey(start).getDate() < 31
  const rule: Repeat =
    preset === "never"
      ? null
      : preset === "semimonthly"
        ? value?.kind === "semimonthly"
          ? value
          : { kind: "semimonthly", days: [15, 30] }
        : preset === "custom"
          ? ruleFrom(unit, every, start, lastDay)
          : preset === "weekly"
            ? ruleFrom("weeks", 1, start)
            : preset === "yearly"
              ? ruleFrom("years", 1, start, lastDay)
              : ruleFrom(
                  "months",
                  preset === "every2" ? 2 : preset === "every3" ? 3 : 1,
                  start,
                  lastDay,
                )
  const monthly = rule?.kind === "monthly" || rule?.kind === "yearly"
  const dates = previewDates(rule, start)
  return (
    <>
      <Choices
        wrap
        value={preset}
        onChange={setPreset}
        options={[
          { value: "never", label: "Never" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
          { value: "every2", label: "Every 2 months" },
          { value: "every3", label: "Every 3 months" },
          { value: "yearly", label: "Yearly" },
          ...(semimonthly
            ? [{ value: "semimonthly" as const, label: "15th & 30th" }]
            : []),
          { value: "custom", label: "Custom" },
        ]}
      />
      {preset === "custom" && (
        <View style={{ gap: 12 }}>
          <Stepper
            label="Every"
            value={every}
            onChange={setEvery}
            step={1}
            min={1}
            max={
              unit === "days"
                ? 365
                : unit === "weeks"
                  ? 52
                  : unit === "months"
                    ? 24
                    : 10
            }
            decimals={0}
          />
          <Choices
            value={unit}
            onChange={(u) => {
              setUnit(u)
              const cap =
                u === "days"
                  ? 365
                  : u === "weeks"
                    ? 52
                    : u === "months"
                      ? 24
                      : 10
              if (every > cap) setEvery(cap)
            }}
            options={[
              { value: "days", label: every === 1 ? "Day" : "Days" },
              { value: "weeks", label: every === 1 ? "Week" : "Weeks" },
              { value: "months", label: every === 1 ? "Month" : "Months" },
              { value: "years", label: every === 1 ? "Year" : "Years" },
            ]}
          />
        </View>
      )}
      {monthly && monthEnd && (
        <Toggle
          label="On the last day of each month"
          value={lastDay}
          onChange={setLastDay}
        />
      )}
      {rule && (
        <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
          <Copy size={14} weight="medium">
            {repeatLabel(rule)}
          </Copy>
          <Copy size={12} muted>
            {dates.length
              ? `Next: ${dates.map((d) => shortDate(d)).join(" · ")}`
              : "No dates from this start"}
          </Copy>
        </View>
      )}
      <Button
        onPress={() => {
          onPick(rule)
          onClose()
        }}
      >
        {rule ? "Set repeat" : "Don't repeat"}
      </Button>
    </>
  )
}
