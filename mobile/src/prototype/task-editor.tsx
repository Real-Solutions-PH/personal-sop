// The task editor's controls, grouped by what they mean (Kai, 2026-11-06):
// every choice carries an icon, dates run nearest to furthest, and an
// action that takes something away (No date, Off, No priority) sits apart
// from the ones that set it. Shared by "New task", the task page and its
// Date & reminder sheet so the three read the same.
import { PRIORITIES, type TaskPriority } from "@domain/tasks/data"
import * as L from "@domain/tasks/logic"
import {
  Bell,
  BellOff,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarX2,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Clock,
  type LucideIcon,
  Minus,
  Sofa,
  Sunrise,
  Timer,
} from "lucide-react-native"
import type { ReactNode } from "react"
import { Pressable, Text, View } from "react-native"
import { Copy } from "./native-kit"
import { fonts, useTheme } from "./theme"

type Theme = ReturnType<typeof useTheme>

/** A titled group of controls; the heading carries its own icon. */
export function EditorSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
}) {
  const t = useTheme()
  return (
    <View style={{ gap: 8, marginTop: 10 }}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={title}
        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        <Icon size={14} color={t.muted} />
        <Copy size={13} weight="medium" muted>
          {title}
        </Copy>
      </View>
      {children}
    </View>
  )
}

/** One choice: icon, label and an optional quiet hint ("Sat"). Chosen is a
 * 2 pt ink outline (ADR-0019), never colour alone. */
export function Chip({
  icon: Icon,
  label,
  hint,
  color,
  selected = false,
  onPress,
  a11y,
}: {
  icon: LucideIcon
  label: string
  hint?: string
  color?: string
  selected?: boolean
  onPress: () => void
  a11y?: string
}) {
  const t = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? (hint ? `${label}, ${hint}` : label)}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 22,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? t.text : t.line,
        backgroundColor: t.card,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      <Icon size={16} color={color ?? t.text} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: t.text }}>
        {label}
      </Text>
      {hint ? (
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: t.muted }}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  )
}

/** A row of chips that wraps, with an optional cluster set apart after a
 * hairline: the action that clears. */
export function ChipRow({
  children,
  apart,
}: {
  children: ReactNode
  apart?: ReactNode
}) {
  const t = useTheme()
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
      }}
    >
      {children}
      {/* The hairline travels with the clearing chip, so when the row
          wraps it never dangles at the end of the line above. */}
      {apart ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <View
            style={{ width: 1, height: 28, backgroundColor: t.line }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          {apart}
        </View>
      ) : null}
    </View>
  )
}

export interface DueShortcut {
  key: "today" | "tomorrow" | "weekend" | "nextWeek"
  label: string
  icon: LucideIcon
  day: string
}
/** Today, Tomorrow, This weekend (the coming Saturday) and Next week (a week
 * from today), nearest first. The weekend drops out when it is today,
 * tomorrow or a week away, so no two shortcuts land on one day. */
export function dueShortcuts(today: string): DueShortcut[] {
  const dow = new Date(`${today}T12:00:00`).getDay()
  const toSat = (6 - dow + 7) % 7
  const out: DueShortcut[] = [
    { key: "today", label: "Today", icon: CalendarCheck, day: today },
    {
      key: "tomorrow",
      label: "Tomorrow",
      icon: Sunrise,
      day: L.addDays(today, 1),
    },
  ]
  if (toSat >= 2 && toSat < 7)
    out.push({
      key: "weekend",
      label: "This weekend",
      icon: Sofa,
      day: L.addDays(today, toSat),
    })
  out.push({
    key: "nextWeek",
    label: "Next week",
    icon: CalendarPlus,
    day: L.addDays(today, 7),
  })
  return out
}
const weekdayShort = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" })

/** The date shortcuts. ``onClear`` adds "No date", set apart. */
export function DueShortcuts({
  value,
  onChange,
  onClear,
  today = L.today(),
}: {
  value: string
  onChange: (day: string) => void
  onClear?: () => void
  today?: string
}) {
  const t = useTheme()
  return (
    <ChipRow
      apart={
        onClear ? (
          <Chip
            icon={CalendarX2}
            label="No date"
            color={t.muted}
            selected={!value}
            onPress={onClear}
          />
        ) : null
      }
    >
      {dueShortcuts(today).map((s) => (
        <Chip
          key={s.key}
          icon={s.icon}
          label={s.label}
          // Today and Tomorrow name their day already; the rest say which.
          hint={
            s.key === "today" || s.key === "tomorrow"
              ? undefined
              : weekdayShort(s.day)
          }
          color={t.tsk}
          selected={value === s.day}
          onPress={() => onChange(s.day)}
        />
      ))}
    </ChipRow>
  )
}

export type Remind = "off" | "0" | "15" | "60" | "1440"
/** Lead times, nearest the due time first. */
export const REMIND_OPTIONS: readonly {
  value: Exclude<Remind, "off">
  label: string
  icon: LucideIcon
}[] = [
  { value: "0", label: "At time", icon: Bell },
  { value: "15", label: "15 min before", icon: Timer },
  { value: "60", label: "1 hour before", icon: Clock },
  { value: "1440", label: "1 day before", icon: CalendarClock },
]
export function RemindChoices({
  value,
  onChange,
}: {
  value: Remind
  onChange: (v: Remind) => void
}) {
  const t = useTheme()
  return (
    <ChipRow
      apart={
        <Chip
          icon={BellOff}
          label="Off"
          a11y="No reminder"
          color={t.muted}
          selected={value === "off"}
          onPress={() => onChange("off")}
        />
      }
    >
      {REMIND_OPTIONS.map((o) => (
        <Chip
          key={o.value}
          icon={o.icon}
          label={o.label}
          a11y={`Remind ${o.label === "At time" ? "at the due time" : o.label}`}
          color={t.tsk}
          selected={value === o.value}
          onPress={() => onChange(o.value)}
        />
      ))}
    </ChipRow>
  )
}

/** Each level's icon and colour: the shape climbs with the level so it
 * reads without colour; red, amber and blue add to it. */
export function priorityLook(
  t: Theme,
  p: TaskPriority,
): { icon: LucideIcon; color: string } {
  switch (p) {
    case "high":
      return { icon: ChevronsUp, color: t.bad }
    case "medium":
      return { icon: ChevronUp, color: t.warn }
    case "low":
      return { icon: ChevronDown, color: t.tsk }
    default:
      return { icon: Minus, color: t.muted }
  }
}

/** High, Medium, Low (most first, the order a person ranks in), and "None"
 * set apart as the clearing choice. */
export function PriorityPicker({
  value,
  onChange,
}: {
  value: TaskPriority
  onChange: (p: TaskPriority) => void
}) {
  const t = useTheme()
  const chip = (p: TaskPriority) => {
    const look = priorityLook(t, p)
    return (
      <Chip
        key={p}
        icon={look.icon}
        color={look.color}
        label={p === "none" ? "None" : L.PRIORITY_LABEL[p]}
        a11y={`${L.PRIORITY_LABEL[p]}${p === "none" ? "" : " priority"}`}
        selected={value === p}
        onPress={() => onChange(p)}
      />
    )
  }
  return (
    <ChipRow apart={chip("none")}>
      {[...PRIORITIES]
        .reverse()
        .filter((p) => p !== "none")
        .map(chip)}
    </ChipRow>
  )
}

/** On a task row: the level's icon and word in its colour. Nothing for
 * "none", so plain tasks stay quiet. */
export function PriorityMark({
  priority,
  size = 12,
}: {
  priority: TaskPriority | undefined
  size?: number
}) {
  const t = useTheme()
  if (!priority || priority === "none") return null
  const look = priorityLook(t, priority)
  return (
    <View
      accessible
      accessibilityLabel={`${L.PRIORITY_LABEL[priority]} priority`}
      style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
    >
      <look.icon size={size + 2} color={look.color} />
      <Text
        style={{ fontFamily: fonts.medium, fontSize: size, color: look.color }}
      >
        {L.PRIORITY_LABEL[priority]}
      </Text>
    </View>
  )
}
