import { useEnabled } from "@domain/dash/hooks"
import {
  BookOpen,
  CheckSquare,
  Dumbbell,
  Target,
  Utensils,
  Wallet,
} from "lucide-react-native"
import { View } from "react-native"
import { Copy, Line, Tap } from "./native-kit"
import { go } from "./navigation"
import { useTheme } from "./theme"
export function AppLauncher({ title = "Your apps" }: { title?: string }) {
  const t = useTheme(),
    enabled = useEnabled()
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
      key: "finance",
      label: "Finance",
      href: "/finance",
      icon: Wallet,
      accent: "fin",
    },
    {
      key: "journal",
      label: "Journal",
      href: "/journal",
      icon: BookOpen,
      accent: "life",
    },
  ] as const
  const shown = apps.filter((a) => a.key === "journal" || enabled[a.key])
  // Six apps share a phone's width, so each tile gives up a little room.
  const box = shown.length > 5 ? 50 : 56
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
      <Line style={{ gap: 4 }}>
        {shown.map((a) => (
          <Tap
            key={a.key}
            onPress={() => go(a.href)}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 6,
              gap: 6,
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
            <Copy size={shown.length > 5 ? 11 : 12} weight="medium" lines={1}>
              {a.label}
            </Copy>
          </Tap>
        ))}
      </Line>
    </View>
  )
}
