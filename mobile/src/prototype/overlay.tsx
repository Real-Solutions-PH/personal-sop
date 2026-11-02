// The one layer every celebration draws in: above the navigation stack, the
// tab bar, Fern's button and every sheet. A burst drawn inside the row that
// fired it is clipped by the row's card and covered by whatever is painted
// after it, so effects are portalled here instead and placed at the window
// position of what fired them. On iOS the layer is its own window
// (FullWindowOverlay), the only thing that draws over a native modal sheet.
// It never takes a touch it was not meant for: the layer is box-none, so only
// a child that asks for touches (the trophy card) can receive one.
import {
  type ComponentRef,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useSyncExternalStore,
} from "react"
import { Platform, StyleSheet, View } from "react-native"
import { FullWindowOverlay } from "react-native-screens"

type Entry = { id: string; node: ReactNode }
let entries: Entry[] = []
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const snapshot = () => entries

function put(id: string, node: ReactNode) {
  const i = entries.findIndex((e) => e.id === id)
  entries =
    i < 0
      ? [...entries, { id, node }]
      : entries.map((e, j) => (j === i ? { id, node } : e))
  emit()
}
function drop(id: string) {
  if (!entries.some((e) => e.id === id)) return
  entries = entries.filter((e) => e.id !== id)
  emit()
}
/** For tests: forget everything portalled. */
export function resetOverlay() {
  entries = []
  emit()
}

/** Draws ``children`` in the top layer instead of here, for as long as it
 * is mounted. Later portals draw over earlier ones. */
export function Overlay({ children }: { children: ReactNode }) {
  const id = useId()
  useLayoutEffect(() => {
    put(id, children)
  })
  useEffect(() => () => drop(id), [id])
  return null
}

const Layer = Platform.OS === "ios" ? FullWindowOverlay : Fragment

/** Mounted once, last, at the app root. */
export function OverlayHost() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (!list.length) return null
  return (
    <Layer>
      <View
        testID="overlay-layer"
        pointerEvents="box-none"
        style={StyleSheet.absoluteFill}
      >
        {list.map((e) => (
          <Fragment key={e.id}>{e.node}</Fragment>
        ))}
      </View>
    </Layer>
  )
}

/** Where something sits in the window, in points. */
export type Box = { x: number; y: number; width: number; height: number }

/** The one seam for reading a view's window position (Jest's native mock
 * never calls back, so tests swap ``measure``). */
export const anchor = {
  measure(view: ComponentRef<typeof View>, done: (box: Box) => void) {
    view.measureInWindow((x, y, width, height) => done({ x, y, width, height }))
  },
}
