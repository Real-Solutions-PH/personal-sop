// A page with too little data still shows its real layout, dimmed and inert,
// under one card that says what is missing and the one step that fills it.
// The person sees what the page will hold instead of a placeholder.
import type { LucideIcon } from "lucide-react-native"
import { Lock } from "lucide-react-native"
import type { ReactNode } from "react"
import { View } from "react-native"
import { Copy, Frame, Line } from "../native-kit"
import { useTheme } from "../theme"
import { Button } from "../ui"

export function LockedPreview({
  locked,
  title,
  detail,
  progress,
  action,
  color,
  icon: Icon = Lock,
  children,
}: {
  locked: boolean
  title: string
  detail: string
  /** e.g. 1 of 3 logged days; draws a bar. */
  progress?: { now: number; max: number }
  action: { label: string; onPress?: () => void; href?: string }
  color?: string
  icon?: LucideIcon
  children: ReactNode
}) {
  const t = useTheme()
  const tint = color ?? t.primary
  return (
    <>
      {locked && (
        <Frame
          style={{
            padding: 16,
            marginTop: 16,
            marginBottom: 12,
            gap: 10,
            borderColor: `${tint}55`,
          }}
        >
          <Line style={{ gap: 10 }}>
            <Icon size={18} color={tint} />
            <Copy size={16} weight="semibold" style={{ flex: 1 }}>
              {title}
            </Copy>
          </Line>
          {progress && (
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{
                min: 0,
                max: progress.max,
                now: progress.now,
              }}
              style={{
                height: 6,
                borderRadius: 3,
                backgroundColor: t.soft,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: `${(Math.min(progress.max, progress.now) / progress.max) * 100}%`,
                  height: 6,
                  backgroundColor: tint,
                }}
              />
            </View>
          )}
          <Copy size={14} muted>
            {detail}
          </Copy>
          <Button href={action.href} onPress={action.onPress}>
            {action.label}
          </Button>
        </Frame>
      )}
      <View
        pointerEvents={locked ? "none" : "auto"}
        accessibilityElementsHidden={locked}
        importantForAccessibility={locked ? "no-hide-descendants" : "auto"}
        style={{ opacity: locked ? 0.35 : 1 }}
      >
        {children}
      </View>
    </>
  )
}
