import { GripVertical } from "lucide-react-native"
import { type ReactNode, useEffect } from "react"
import { View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { feel } from "./motion"
import { useTheme } from "./theme"

/** The drag in flight, shared by every row: which row is lifted, how far
 * it has moved, and the place it would land on. */
interface Drag {
  from: SharedValue<number>
  to: SharedValue<number>
  dy: SharedValue<number>
  heights: SharedValue<number[]>
}

/** Where a lifted row lands: the slot its centre has moved into. */
function landing(heights: number[], from: number, dy: number) {
  "worklet"
  let top = 0
  for (let i = 0; i < from; i++) top += heights[i]
  const centre = top + heights[from] / 2 + dy
  let y = 0
  for (let i = 0; i < heights.length; i++) {
    if (centre < y + heights[i]) return i
    y += heights[i]
  }
  return heights.length - 1
}

/**
 * Rows that reorder by dragging their grip: the row lifts (a haptic on
 * pickup), its neighbours slide aside, and it lands with a second haptic.
 * Screen readers get Move up / Move down on the grip instead of a drag.
 */
export function ReorderList<K extends string>({
  keys,
  label,
  onMove,
  renderRow,
}: {
  keys: K[]
  label: (k: K) => string
  onMove: (k: K, to: number) => void
  renderRow: (k: K, grip: ReactNode) => ReactNode
}) {
  const drag: Drag = {
    from: useSharedValue(-1),
    to: useSharedValue(-1),
    dy: useSharedValue(0),
    heights: useSharedValue<number[]>(keys.map(() => 56)),
  }
  const count = keys.length
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize on count only
  useEffect(() => {
    if (drag.heights.value.length !== count)
      drag.heights.value = Array.from(
        { length: count },
        (_, i) => drag.heights.value[i] ?? 56,
      )
  }, [count])
  const drop = (from: number, to: number) => {
    feel.impact()
    if (to !== from && to >= 0) onMove(keys[from], to)
    drag.from.value = -1
    drag.to.value = -1
    drag.dy.value = 0
  }
  return (
    <View>
      {keys.map((k, i) => (
        <ReorderRow
          key={k}
          index={i}
          count={count}
          drag={drag}
          name={label(k)}
          onDrop={drop}
          onStep={(d) => {
            const to = i + d
            if (to < 0 || to >= count) return
            feel.select()
            onMove(k, to)
          }}
          render={(grip) => renderRow(k, grip)}
        />
      ))}
    </View>
  )
}

function ReorderRow({
  index,
  count,
  drag,
  name,
  onDrop,
  onStep,
  render,
}: {
  index: number
  count: number
  drag: Drag
  name: string
  onDrop: (from: number, to: number) => void
  onStep: (delta: number) => void
  render: (grip: ReactNode) => ReactNode
}) {
  const t = useTheme()
  const pan = Gesture.Pan()
    .minDistance(0)
    .onStart(() => {
      drag.from.value = index
      drag.to.value = index
      drag.dy.value = 0
      runOnJS(feel.impact)()
    })
    .onUpdate((e) => {
      drag.dy.value = e.translationY
      const to = landing(drag.heights.value, index, e.translationY)
      if (to !== drag.to.value) {
        drag.to.value = to
        runOnJS(feel.select)()
      }
    })
    .onEnd(() => {
      runOnJS(onDrop)(index, drag.to.value)
    })
  const style = useAnimatedStyle(() => {
    const from = drag.from.value
    if (from === index)
      return {
        zIndex: 10,
        shadowOpacity: 0.18,
        transform: [{ translateY: drag.dy.value }, { scale: 1.02 }],
      }
    const to = drag.to.value,
      h = from < 0 ? 0 : drag.heights.value[from]
    const shift =
      from < 0
        ? 0
        : from < to && index > from && index <= to
          ? -h
          : from > to && index < from && index >= to
            ? h
            : 0
    return {
      zIndex: 0,
      shadowOpacity: 0,
      transform: [
        { translateY: from < 0 ? 0 : withTiming(shift, { duration: 160 }) },
        { scale: 1 },
      ],
    }
  })
  const grip = (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Reorder ${name}`}
        accessibilityValue={{ text: `${index + 1} of ${count}` }}
        accessibilityHint="Drag up or down, or swipe up or down to move"
        accessibilityActions={[
          { name: "increment", label: "Move down" },
          { name: "decrement", label: "Move up" },
        ]}
        onAccessibilityAction={(e) =>
          onStep(e.nativeEvent.actionName === "increment" ? 1 : -1)
        }
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        style={{
          width: 32,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <GripVertical size={18} color={t.muted} />
      </View>
    </GestureDetector>
  )
  return (
    <Animated.View
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height
        if (drag.heights.value[index] === h) return
        const next = [...drag.heights.value]
        next[index] = h
        drag.heights.value = next
      }}
      style={[
        {
          backgroundColor: t.card,
          shadowColor: "#000",
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
        style,
      ]}
    >
      {render(grip)}
    </Animated.View>
  )
}
