// A module's stats render either as their own screen (deep links, the Stats
// tab's drill-downs) or inline at the bottom of the module's main page, so
// the numbers are there without another tap.
import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { Line } from "../native-kit"
import { fonts, useTheme } from "../theme"
import { Screen } from "../ui"

export function StatsShell({
  embedded = false,
  title,
  actions,
  children,
}: {
  embedded?: boolean
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  const t = useTheme()
  if (!embedded)
    return (
      <Screen title={title} actions={actions}>
        {children}
      </Screen>
    )
  return (
    <View style={{ gap: 8, marginTop: 28 }}>
      <Line style={{ justifyContent: "space-between" }}>
        <Text
          accessibilityRole="header"
          style={{
            fontFamily: fonts.display,
            fontSize: 22,
            lineHeight: 28,
            color: t.text,
          }}
        >
          Stats
        </Text>
        {actions}
      </Line>
      {children}
    </View>
  )
}
