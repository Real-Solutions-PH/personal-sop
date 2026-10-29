import { useEnabled } from "@domain/dash/hooks"
import {
  BookOpen,
  CheckSquare,
  Dumbbell,
  Smartphone,
  Target,
  Timer,
  Utensils,
  Wallet,
} from "lucide-react-native"
import { useState } from "react"
import { type TextStyle, View } from "react-native"
import { useShown } from "./extras"
import { Copy, Line, Measure, Tap } from "./native-kit"
import { go } from "./navigation"
import { fonts, useTheme } from "./theme"
export function AppLauncher({ title = "Your apps" }: { title?: string }) {
  const t = useTheme(),
    enabled = useEnabled(),
    journal = useShown("journal")
  const apps = [
    {
      key: "habits",
      label: "Habits",
      href: "/habits",
      icon: Target,
      accent: "hab",
    },
    {
      key: "tasks",
      label: "Tasks",
      href: "/tasks",
      icon: CheckSquare,
      accent: "tsk",
    },
    {
      key: "fitness",
      label: "Fitness",
      href: "/fitness",
      icon: Dumbbell,
      accent: "fit",
    },
    {
      key: "nutrition",
      label: "Nutrition",
      href: "/nutrition",
      icon: Utensils,
      accent: "nut",
    },
    {
      key: "focus",
      label: "Focus",
      href: "/focus",
      icon: Timer,
      accent: "foc",
    },
    {
      key: "finance",
      label: "Finance",
      href: "/finance",
      icon: Wallet,
      accent: "fin",
    },
    {
      key: "screen",
      label: "Screen time",
      href: "/screen",
      icon: Smartphone,
      accent: "scr",
    },
    {
      key: "journal",
      label: "Journal",
      href: "/journal",
      icon: BookOpen,
      accent: "life",
    },
  ] as const
  const shown = apps.filter((a) =>
    a.key === "journal" ? journal : enabled[a.key],
  )
  // Six apps share a phone's width, so each tile gives up a little room;
  // past six they wrap into rows of four, which keeps room for the names.
  const wrap = shown.length > 6,
    perRow = wrap ? 4 : shown.length
  const box = !wrap && shown.length > 5 ? 50 : 56
  // Names show only while every one fits whole under its tile (the tile is
  // a little wider than the icon box); at a larger text size the row keeps
  // its icons, and each tile is still named for screen readers.
  const label: TextStyle = {
    fontFamily: fonts.medium,
    fontSize: !wrap && shown.length > 5 ? 11 : 12,
  }
  const [row, setRow] = useState(0),
    [need, setNeed] = useState<Record<string, number>>({}),
    room = wrap
      ? row / perRow
      : row
        ? (row - 4 * (shown.length - 1)) / shown.length
        : 0,
    labels = room > 0 && shown.every((a) => need[a.key] && need[a.key] <= room)
  return (
    <View>
      <Copy
        size={12}
        weight="medium"
        muted
        style={{
          letterSpacing: 0.6,
          marginTop: 12,
          marginBottom: 8,
          paddingHorizontal: 4,
        }}
      >
        {title.toUpperCase()}
      </Copy>
      <View
        testID="app-launcher-row"
        onLayout={(e) => setRow(e.nativeEvent.layout.width)}
      >
        <Line style={{ gap: wrap ? 0 : 4, flexWrap: wrap ? "wrap" : "nowrap" }}>
          {shown.map((a) => (
            <Tap
              key={a.key}
              label={a.label}
              onPress={() => go(a.href)}
              style={{
                ...(wrap ? { width: "25%" } : { flex: 1 }),
                alignItems: "center",
                paddingVertical: 6,
                gap: 6,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: box,
                  width: box,
                  borderRadius: 16,
                  backgroundColor: `${t[a.accent]}26`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <a.icon size={24} color={t[a.accent]} />
              </View>
              {labels && (
                <Copy size={label.fontSize} weight="medium" lines={1}>
                  {a.label}
                </Copy>
              )}
              <Measure
                text={a.label}
                style={label}
                onWidth={(w) => setNeed((n) => ({ ...n, [a.key]: w }))}
              />
            </Tap>
          ))}
        </Line>
      </View>
    </View>
  )
}
