import { GripVertical } from "lucide-react-native"
import { useRef } from "react"
import { PanResponder, View } from "react-native"
import { useTheme } from "./theme"
export function DragHandle({
  name,
  onMove,
  rowHeight = 56,
}: {
  name: string
  onMove: (delta: number) => void
  rowHeight?: number
}) {
  const t = useTheme(),
    move = useRef(onMove)
  move.current = onMove
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderRelease: (_, g) =>
        move.current(Math.round(g.dy / rowHeight)),
    }),
  ).current
  return (
    <View
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Reorder ${name}`}
      accessibilityHint="Drag up or down to move"
      accessibilityActions={[
        { name: "increment", label: "Move down" },
        { name: "decrement", label: "Move up" },
      ]}
      onAccessibilityAction={(e) =>
        move.current(e.nativeEvent.actionName === "increment" ? 1 : -1)
      }
      style={{
        width: 40,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <GripVertical size={16} color={t.muted} />
    </View>
  )
}
