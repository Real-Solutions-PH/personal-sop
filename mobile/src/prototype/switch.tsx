import { Pressable, View } from "react-native"
import { type Accent, useTheme } from "./theme"
export function Switch({
  label,
  value,
  onChange,
  accent = "tsk",
  compact = false,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  accent?: Accent
  compact?: boolean
}) {
  const t = useTheme()
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{
        width: compact ? 48 : 56,
        height: compact ? 28 : 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 48,
          height: 28,
          borderRadius: 14,
          backgroundColor: value ? t[accent] : t.soft,
        }}
      >
        <View
          style={{
            position: "absolute",
            top: 2,
            left: value ? 22 : 2,
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: "#fff",
            boxShadow: "0px 1px 2px #00000026",
          }}
        />
      </View>
    </Pressable>
  )
}
