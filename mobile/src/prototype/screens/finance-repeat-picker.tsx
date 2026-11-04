import {
  addDays,
  lastDom,
  occurrences,
  parseKey,
  repeatLabel,
  shortDate,
} from "@domain/finance/calc"
import type { PlannedItem, Schedule } from "@domain/finance/data"
import { useState } from "react"
import { View } from "react-native"
import { Stepper } from "../fitness-controls"
import { Copy } from "../native-kit"
import { Button, Choices, Sheet, Toggle } from "../ui"

/** What the Repeat row can hold: a repeating schedule, or none. */
export type Repeat = Exclude<Schedule, { kind: "once" }> | null

type Unit = "days" | "weeks" | "months" | "years"
type Preset =
  | "never"
  | "weekly"
  | "monthly"
  | "every2"
  | "every3"
  | "yearly"
  | "semimonthly"
  | "custom"

const isLastDay = (day: string) => {
  const d = parseKey(day)
  return d.getDate() === lastDom(d.getFullYear(), d.getMonth())
}

/** The schedule for "every ``every`` ``unit``" from ``start``: weekly on the
 * start's weekday, monthly on its day (31 = the last day), yearly on its
 * date. */
export function ruleFrom(
  unit: Unit,
  every: number,
  start: string,
  lastDay = false,
): Exclude<Schedule, { kind: "once" | "semimonthly" }> {
  const d = parseKey(start)
  const day = lastDay ? 31 : d.getDate()
  switch (unit) {
    case "days":
      return { kind: "daily", every }
    case "weeks":
      return { kind: "weekly", every, anchor: start }
    case "months":
      return { kind: "monthly", day, every }
    case "years":
      return { kind: "yearly", month: d.getMonth() + 1, day, every }
  }
}

/** Keeps a rule on the same footing when the start date moves: a weekly
 * anchor and a day of the month that came from the old start follow it. */
export function followStart(rule: Repeat, from: string, to: string): Repeat {
  if (!rule || from === to) return rule
  const was = parseKey(from)
  const now = parseKey(to)
  switch (rule.kind) {
    case "weekly":
      return rule.anchor === from ? { ...rule, anchor: to } : rule
    case "monthly":
      return rule.day === was.getDate() ? { ...rule, day: now.getDate() } : rule
    case "yearly":
      return rule.day === was.getDate() && rule.month === was.getMonth() + 1
        ? { ...rule, month: now.getMonth() + 1, day: now.getDate() }
        : rule
    default:
      return rule
  }
}

function presetOf(rule: Repeat): Preset {
  if (!rule) return "never"
  const every = "every" in rule && rule.every ? rule.every : 1
  if (rule.kind === "semimonthly") return "semimonthly"
  if (rule.kind === "weekly" && every === 1) return "weekly"
  if (rule.kind === "yearly" && every === 1) return "yearly"
  if (rule.kind === "monthly")
    return every === 1
      ? "monthly"
      : every === 2
        ? "every2"
        : every === 3
          ? "every3"
          : "custom"
  return "custom"
}

const unitOf = (rule: Repeat): Unit =>
  rule?.kind === "daily"
    ? "days"
    : rule?.kind === "weekly"
      ? "weeks"
      : rule?.kind === "yearly"
        ? "years"
        : "months"

/** The next few dates a rule lands on from ``start``, for the preview. */
export function previewDates(rule: Repeat, start: string, n = 3) {
  if (!rule) return []
  return occurrences(
    { schedule: rule, start, end: { kind: "never" } } as PlannedItem,
    start,
    addDays(start, 3700),
  ).slice(0, n)
}

/** The plain words for the Repeat row: "Never" or "Every 3 months on the
 * 15th". */
export const repeatText = (rule: Repeat) => (rule ? repeatLabel(rule) : "Never")

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
