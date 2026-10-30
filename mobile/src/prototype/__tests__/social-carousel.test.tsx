import { render } from "@testing-library/react-native"
import { isValidElement } from "react"
import { MediaCarousel } from "../social/kit"

// The note sheet in the social kit uses the shared Sheet, which loads sonner.
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withTiming: (value: unknown) => value,
  withSpring: (value: unknown) => value,
  useReducedMotion: () => true,
}))

// Keep the gesture the carousel builds, to look inside its worklets.
const gestures: { handlers: Record<string, unknown> }[] = []
jest.mock("react-native-gesture-handler", () => {
  const actual = jest.requireActual("react-native-gesture-handler")
  return {
    ...actual,
    GestureDetector: ({
      gesture,
      children,
    }: {
      gesture: { handlers: Record<string, unknown> }
      children: unknown
    }) => {
      gestures.push(gesture)
      return children
    },
  }
})

/** Every value a worklet closes over, nested objects included. */
function captured(fn: unknown): unknown[] {
  const closure = (fn as { __closure?: Record<string, unknown> }).__closure
  expect(closure).toBeDefined() // the worklets plugin ran; nothing vacuous
  const out: unknown[] = []
  const seen = new Set<unknown>()
  const walk = (v: unknown) => {
    if (seen.has(v)) return
    seen.add(v)
    out.push(v)
    if (v && typeof v === "object" && !isValidElement(v))
      for (const x of Object.values(v)) walk(x)
  }
  walk(closure)
  return out
}

test("the double-tap worklet captures nothing Worklets cannot copy", () => {
  // A React element in a worklet's closure throws "[Worklets] Cannot copy
  // value of type FiberNode" on device, which took down the whole feed.
  render(
    <MediaCarousel
      media={[{ kind: "image", uri: "https://example.test/a.jpg" }]}
      width={300}
      active
      onDoubleTap={() => {}}
    />,
  )
  const onEnd = gestures.at(-1)?.handlers.onEnd
  expect(onEnd).toBeInstanceOf(Function)
  expect(captured(onEnd).filter((v) => isValidElement(v)).length).toBe(0)
})
