import { Minus, Plus } from "lucide-react-native"
import { TextInput, View } from "react-native"
import { Copy, Line, Tap } from "./native-kit"
import { fonts, useTheme } from "./theme"
/** Thousands grouped ("2,100"), decimals as typed ("102.5"). */
export const grouped = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 6 })
/** A typed amount: a comma before exactly three digits groups thousands;
 * any other comma is a decimal mark ("2,100" is 2100, "2,5" is 2.5). */
export const parseAmount = (v: string) =>
  Number.parseFloat(v.replace(/,(?=\d{3}(?!\d))/g, "").replace(",", "."))
export function Stepper({
  value,
  onChange,
  step,
  min = 0,
  max = 9999,
  label,
  unit,
  decimals = 1,
  compact = false,
}: {
  value: number
  onChange: (n: number) => void
  step: number
  min?: number
  max?: number
  label: string
  unit?: string
  decimals?: number
  compact?: boolean
}) {
  const t = useTheme(),
    clamp = (n: number) =>
      Math.min(
        max,
        Math.max(min, Math.round(n * 10 ** decimals) / 10 ** decimals),
      )
  return (
    <View>
      <Copy
        size={12}
        muted
        style={{
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: 0.6,
          marginBottom: 6,
        }}
      >
        {label}
      </Copy>
      <Line style={{ gap: compact ? 4 : 8 }}>
        <Tap
          label={`Decrease ${label}`}
          onPress={() => onChange(clamp(value - step))}
          style={{
            width: compact ? 32 : 48,
            height: compact ? 44 : 48,
            borderRadius: compact ? 12 : 16,
            backgroundColor: t.soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Minus size={20} color={t.text} />
        </Tap>
        <Line
          style={{
            flex: 1,
            gap: 4,
            justifyContent: "center",
            alignItems: "baseline",
          }}
        >
          <TextInput
            accessibilityLabel={label}
            value={Number.isFinite(value) ? grouped(value) : ""}
            onChangeText={(v) => {
              const n = parseAmount(v)
              onChange(Number.isFinite(n) ? n : 0)
            }}
            onBlur={() => onChange(clamp(value))}
            keyboardType="decimal-pad"
            style={{
              flex: 1,
              minWidth: 0,
              padding: 0,
              fontSize: compact ? 24 : 30,
              fontFamily: fonts.semibold,
              textAlign: "center",
              color: t.text,
            }}
          />
          {unit && (
            <Copy size={14} muted>
              {unit}
            </Copy>
          )}
        </Line>
        <Tap
          label={`Increase ${label}`}
          onPress={() => onChange(clamp(value + step))}
          style={{
            width: compact ? 32 : 48,
            height: compact ? 44 : 48,
            borderRadius: compact ? 12 : 16,
            backgroundColor: t.soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Plus size={20} color={t.text} />
        </Tap>
      </Line>
    </View>
  )
}
