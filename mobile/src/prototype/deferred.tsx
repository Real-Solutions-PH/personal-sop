import { LaggingReads } from "@domain/lib/store"
import type { LucideIcon } from "lucide-react-native"
import { type ReactNode, startTransition, useEffect, useState } from "react"
import { View } from "react-native"
import { Frame, Group } from "./native-kit"
import { type Accent, useTheme } from "./theme"

// A screen's heavy sections (cards summarising months of history) render
// after the screen's first paint, each on its own: the screen and every
// section's placeholder show at once, then the sections fill in top to
// bottom, one per frame, each as soon as its own render is done and never
// waiting for a sibling. Each one renders in a transition, which React
// works on in the background and sets aside for a tap made meanwhile.

const waiting: Array<{ show: () => void }> = []
let active: { show: () => void } | null = null

/** Let the next waiting section render. */
function release() {
  active = waiting.shift() ?? null
  const item = active
  if (!item) return
  // A frame first, so the section before it is on screen.
  requestAnimationFrame(() => {
    if (active === item) startTransition(item.show)
  })
}

/** `fallback` at once, then `children` once its turn comes. With `lag`, the
 * section's store reads also update in a transition after each change (see
 * `LaggingReads`): for read-only summaries, never for a section holding the
 * control a person just tapped. */
export function Deferred({
  fallback,
  lag = false,
  children,
}: {
  fallback: ReactNode
  lag?: boolean
  children: ReactNode
}) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const item = { show: () => setShown(true) }
    waiting.push(item)
    if (!active) release()
    return () => {
      const i = waiting.indexOf(item)
      if (i >= 0) waiting.splice(i, 1)
      // Unmounted while it was the one rendering: the next goes on.
      if (active === item) release()
    }
  }, [])
  // Rendered and committed: the next section's turn.
  useEffect(() => {
    if (shown) release()
  }, [shown])
  if (!shown) return fallback
  return lag ? (
    <LaggingReads.Provider value>{children}</LaggingReads.Provider>
  ) : (
    children
  )
}

/** A module card still rendering: its real header over a dimmed body the
 * height of a typical card. */
export function CardSkeleton({
  title,
  icon,
  accent,
  href,
  height = 120,
}: {
  title: string
  icon: LucideIcon
  accent: Accent
  href: string
  height?: number
}) {
  return (
    <Group title={title} icon={icon} accent={accent} href={href}>
      <Placeholder height={height} />
    </Group>
  )
}

/** A summary card still rendering: a dimmed card of its usual height. */
export function FrameSkeleton({ height }: { height: number }) {
  return (
    <Frame style={{ padding: 16 }}>
      <Placeholder height={height} />
    </Frame>
  )
}

function Placeholder({ height }: { height: number }) {
  const t = useTheme()
  return (
    <View
      accessibilityLabel="Loading"
      style={{ gap: 10, paddingHorizontal: 16, paddingBottom: 16, height }}
    >
      {[0.9, 0.6, 0.75].map((w) => (
        <View
          key={w}
          style={{
            width: `${w * 100}%`,
            height: 14,
            borderRadius: 7,
            backgroundColor: t.soft,
            opacity: 0.6,
          }}
        />
      ))}
    </View>
  )
}
