import { useEnabled } from "@domain/dash/hooks"
import {
  BookOpen,
  CheckSquare,
  Dumbbell,
  Target,
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
        {apps
          .filter((a) => a.key === "journal" || enabled[a.key])
          .map((a) => (
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
                  height: 56,
                  width: 56,
                  borderRadius: 16,
                  backgroundColor: `${t[a.accent]}26`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <a.icon size={24} color={t[a.accent]} />
              </View>
              <Copy size={12} weight="medium">
                {a.label}
              </Copy>
            </Tap>
          ))}
      </Line>
    </View>
  )
}
