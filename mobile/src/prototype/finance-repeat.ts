// The money Repeat rule as the Repeat sheet builds it: presets, custom
// intervals and how a rule follows its start date. Pure, so it is tested
// without rendering.
import {
  addDays,
  lastDom,
  occurrences,
  parseKey,
  repeatLabel,
} from "@domain/finance/calc"
import type { PlannedItem, Schedule } from "@domain/finance/data"

/** What the Repeat row can hold: a repeating schedule, or none. */
export type Repeat = Exclude<Schedule, { kind: "once" }> | null

export type Unit = "days" | "weeks" | "months" | "years"
export type Preset =
  | "never"
  | "weekly"
  | "monthly"
  | "every2"
  | "every3"
  | "yearly"
  | "semimonthly"
  | "custom"

export const isLastDay = (day: string) => {
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
  // "The last day" (31) follows a start on a month's last day, and stays
  // the last day only while the new start is one too.
  const fromDay = (day: number) =>
    day === was.getDate() || (day >= 31 && isLastDay(from))
  const toDay = (day: number) =>
    day >= 31 && isLastDay(to) ? 31 : now.getDate()
  switch (rule.kind) {
    case "weekly":
      return rule.anchor === from ? { ...rule, anchor: to } : rule
    case "monthly":
      return fromDay(rule.day) ? { ...rule, day: toDay(rule.day) } : rule
    case "yearly":
      return fromDay(rule.day) && rule.month === was.getMonth() + 1
        ? { ...rule, month: now.getMonth() + 1, day: toDay(rule.day) }
        : rule
    default:
      return rule
  }
}

export function presetOf(rule: Repeat): Preset {
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

export const unitOf = (rule: Repeat): Unit =>
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
