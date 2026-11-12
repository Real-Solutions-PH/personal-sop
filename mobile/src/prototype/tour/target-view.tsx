// A tour target as a wrapper view, for a control whose screen calls its
// hooks outside the page's Screen: the hook runs here, inside the page, so
// it gets the page's scroll and the tour can bring the control into view.
import type { ReactNode } from "react"
import { View } from "react-native"
import { type TargetId, useTourTarget } from "./targets"

export function TourTarget({
  id,
  enabled = true,
  children,
}: {
  id: TargetId
  enabled?: boolean
  children: ReactNode
}) {
  const ref = useTourTarget(id, enabled)
  return (
    <View ref={ref} collapsable={false}>
      {children}
    </View>
  )
}
