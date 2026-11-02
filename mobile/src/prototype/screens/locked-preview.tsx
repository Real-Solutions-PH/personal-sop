// A page with too little data still shows its real layout, dimmed and inert,
// under one card that says what is missing and the one step that fills it.
// The person sees what the page will hold instead of a placeholder.
import type { LucideIcon } from "lucide-react-native"
import { Lock, Plus } from "lucide-react-native"
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
  gap,
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
  /** Space between the children: the wrapper replaces the parent that used
   * to space them, so a section of sibling cards passes its gap here. */
  gap?: number
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
        style={{ opacity: locked ? 0.35 : 1, gap }}
      >
        {children}
      </View>
    </>
  )
}

/** The foot of a single card drawn dimmed from sample data: why it is empty
 * and the one step that fills it. The card above stays its real shape. */
export function EmptyFoot({
  hint,
  action,
  icon = Plus,
  testID,
}: {
  hint: string
  /** Left out when the step that fills it is already on the page. */
  action?: { label: string; onPress?: () => void; href?: string }
  icon?: LucideIcon
  testID?: string
}) {
  return (
    <Line testID={testID} style={{ marginTop: 12, gap: 12 }}>
      <Copy size={13} muted style={{ flex: 1 }}>
        {hint}
      </Copy>
      {action && (
        <Button
          small
          tone="quiet"
          icon={icon}
          href={action.href}
          onPress={action.onPress}
        >
          {action.label}
        </Button>
      )}
    </Line>
  )
}

/** Sample content drawn at the empty-state strength: dimmed, inert and
 * hidden from screen readers, which read the hint beside it instead. */
export function Dimmed({ children }: { children: ReactNode }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ opacity: 0.32 }}
    >
      {children}
    </View>
  )
}
