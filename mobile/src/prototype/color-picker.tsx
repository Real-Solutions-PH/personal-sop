// A small colour picker with no native module: preset swatches, a hue strip
// to tap or drag along, and a hex field for an exact colour.
import { LinearGradient } from "expo-linear-gradient"
import { useState } from "react"
import { TextInput, View } from "react-native"
import { Copy, Line, Tap } from "./native-kit"
import { fonts, useTheme } from "./theme"

export const SWATCHES = [
  "#E5484D",
  "#F76B15",
  "#FFB224",
  "#30A46C",
  "#12A594",
  "#0091FF",
  "#3E63DD",
  "#8E4EC6",
  "#D6409F",
  "#1C2024",
  "#8B8D98",
  "#F1E9DD",
] as const

/** ``h`` 0..360, ``s`` and ``l`` 0..1 -> ``#rrggbb``. */
export function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return `#${[f(0), f(8), f(4)]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase()
}

/** A full ``#rrggbb`` (case-insensitive), or null. */
export function parseHex(text: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(text.trim())
  return m ? `#${m[1].toUpperCase()}` : null
}

/** Relative luminance 0..1, to pick readable ink on a colour. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** ``hex`` mixed toward black by ``amount`` 0..1. */
export function shade(hex: string, amount: number): string {
  return `#${[1, 3, 5]
    .map((i) =>
      Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * (1 - amount))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase()
}

const HUES = [
  "#FF0000",
  "#FFFF00",
  "#00FF00",
  "#00FFFF",
  "#0000FF",
  "#FF00FF",
  "#FF0000",
] as const

export function ColorPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (hex: string) => void
}) {
  const t = useTheme()
  const [width, setWidth] = useState(0)
  const [draft, setDraft] = useState(value)
  const pickAt = (x: number) => {
    if (!width) return
    const hue = (Math.max(0, Math.min(width, x)) / width) * 360
    const hex = hslToHex(hue, 0.72, 0.48)
    setDraft(hex)
    onChange(hex)
  }
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {SWATCHES.map((c) => (
          <Tap
            key={c}
            label={`Colour ${c}`}
            onPress={() => {
              setDraft(c)
              onChange(c)
            }}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: c,
              borderWidth: value === c ? 3 : 1,
              borderColor: value === c ? t.text : t.line,
            }}
          >
            <View />
          </Tap>
        ))}
      </View>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Hue"
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => pickAt(e.nativeEvent.locationX)}
        onResponderMove={(e) => pickAt(e.nativeEvent.locationX)}
        style={{ height: 36, justifyContent: "center" }}
      >
        <LinearGradient
          colors={HUES}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          pointerEvents="none"
          style={{ height: 24, borderRadius: 12 }}
        />
      </View>
      <Line style={{ gap: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: value,
            borderWidth: 1,
            borderColor: t.line,
          }}
        />
        <TextInput
          value={draft}
          onChangeText={(v) => {
            setDraft(v)
            const hex = parseHex(v)
            if (hex) onChange(hex)
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          accessibilityLabel="Hex colour"
          placeholder="#3E63DD"
          placeholderTextColor={t.muted}
          style={{
            flex: 1,
            height: 44,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: parseHex(draft) ? t.line : t.bad,
            color: t.text,
            fontFamily: fonts.medium,
            fontSize: 16,
          }}
        />
      </Line>
      {!parseHex(draft) && (
        <Copy size={12} style={{ color: t.bad }}>
          Use a 6-digit hex colour, like #3E63DD.
        </Copy>
      )}
    </View>
  )
}
