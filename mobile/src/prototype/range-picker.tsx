// Date-range pickers for finance trends: a row of preset chips plus a
// "Pick date" chip that opens date fields. Forecasts pick an end date
// ahead of today; look-backs pick a window behind it. The hooks hold the
// choice and turn it into dates.
import * as C from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import {
  AHEAD_PRESETS,
  type AheadPreset,
  aheadEnd,
  BACK_PRESETS,
  type BackPreset,
  backRange,
  type DateRange,
} from "@domain/finance/forecast"
import { CalendarDays } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { ScrollView, View } from "react-native"
import { Copy, Line, Tap } from "./native-kit"
import { radius, useTheme } from "./theme"
import { DateField } from "./ui"

function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string
  active: boolean
  onPress: () => void
  icon?: ReactNode
}) {
  const t = useTheme()
  return (
    <Tap
      onPress={onPress}
      role="radio"
      selected={active}
      label={label}
      style={{
        height: 36,
        paddingHorizontal: 12,
        borderRadius: radius.pill,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderWidth: 1,
        borderColor: active ? t.text : t.line,
        backgroundColor: active ? t.soft : t.card,
      }}
    >
      {icon}
      <Copy size={13} weight="medium">
        {label}
      </Copy>
    </Tap>
  )
}

function Chips({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      style={{ marginHorizontal: -16 }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
    >
      {children}
    </ScrollView>
  )
}

export type Ahead = { preset: AheadPreset } | { to: string }

/** A forecast's end date: a preset or a picked day. */
export function useAhead(s: FinState, initial: AheadPreset = "month") {
  const [sel, setSel] = useState<Ahead>({ preset: initial })
  const to = "to" in sel ? sel.to : aheadEnd(s, sel.preset)
  return { sel, setSel, to }
}

export function AheadPicker({
  value,
  onChange,
  presets = AHEAD_PRESETS.map((p) => p.value),
  to,
}: {
  value: Ahead
  onChange: (v: Ahead) => void
  presets?: AheadPreset[]
  /** The end date the current choice resolves to, to seed "Pick date". */
  to: string
}) {
  const t = useTheme()
  const custom = "to" in value
  const today = C.today()
  return (
    <View style={{ gap: 4 }}>
      <Chips>
        {AHEAD_PRESETS.filter((p) => presets.includes(p.value)).map((p) => (
          <Chip
            key={p.value}
            label={p.label}
            active={!custom && value.preset === p.value}
            onPress={() => onChange({ preset: p.value })}
          />
        ))}
        <Chip
          label={custom ? C.shortDate(value.to) : "Pick date"}
          active={custom}
          icon={<CalendarDays size={14} color={t.muted} />}
          onPress={() => onChange({ to: custom ? value.to : to })}
        />
      </Chips>
      {custom && (
        <DateField
          label="Up to"
          value={value.to}
          onChangeText={(v) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(v))
              onChange({ to: v < today ? today : v })
          }}
        />
      )}
    </View>
  )
}

export type Back = { preset: BackPreset } | { range: DateRange }

/** A look-back window: a preset or two picked days. */
export function useBack(s: FinState, initial: BackPreset = "this") {
  const [sel, setSel] = useState<Back>({ preset: initial })
  const range = "range" in sel ? sel.range : backRange(s, sel.preset)
  const label =
    "range" in sel
      ? undefined
      : sel.preset === "this" || sel.preset === "last"
        ? C.monthLabel(C.monthOf(range.from, s.settings.monthStartDay), true)
        : `Last ${BACK_PRESETS.find((p) => p.value === sel.preset)?.label}`
  return { sel, setSel, range, label }
}

export function BackPicker({
  value,
  onChange,
  range,
}: {
  value: Back
  onChange: (v: Back) => void
  /** The window the current choice resolves to, to seed "Pick dates". */
  range: DateRange
}) {
  const t = useTheme()
  const custom = "range" in value
  const set = (next: DateRange) => {
    if (![next.from, next.to].every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)))
      return
    onChange({
      range: next.from <= next.to ? next : { from: next.to, to: next.from },
    })
  }
  return (
    <View style={{ gap: 4 }}>
      <Chips>
        {BACK_PRESETS.map((p) => (
          <Chip
            key={p.value}
            label={p.label}
            active={!custom && value.preset === p.value}
            onPress={() => onChange({ preset: p.value })}
          />
        ))}
        <Chip
          label={
            custom
              ? `${C.shortDate(value.range.from)} – ${C.shortDate(value.range.to)}`
              : "Pick dates"
          }
          active={custom}
          icon={<CalendarDays size={14} color={t.muted} />}
          onPress={() => onChange({ range: custom ? value.range : range })}
        />
      </Chips>
      {custom && (
        <Line style={{ gap: 8 }}>
          <View style={{ flex: 1 }}>
            <DateField
              label="From"
              value={value.range.from}
              onChangeText={(from) => set({ ...value.range, from })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <DateField
              label="To"
              value={value.range.to}
              onChangeText={(to) => set({ ...value.range, to })}
            />
          </View>
        </Line>
      )}
    </View>
  )
}
