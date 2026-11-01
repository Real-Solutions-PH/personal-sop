import { act, renderHook } from "@testing-library/react-native"
import { useRing } from "../social/kit"
import { addStory, ME, markSeen, socialStore } from "../social/store"

// The note sheet in the social kit uses the shared Sheet, which loads sonner.
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withTiming: (value: unknown) => value,
  useReducedMotion: () => true,
}))

beforeEach(() => socialStore.reset())

test("your own ring stays lit after posting, though the check-in is seen", () => {
  const { result } = renderHook(() => useRing(ME))
  expect(result.current).toBeNull()
  let id = ""
  act(() => {
    id = addStory({ kind: "text", text: "Day 3 run done" }).id
  })
  // Posting marks your own check-in seen; the ring must not turn grey,
  // or it reads as "nothing to open".
  expect(socialStore.get().seen).toContain(id)
  expect(result.current).toBe("unseen")
})

test("someone else's ring greys out once all their check-ins are seen", () => {
  const { result } = renderHook(() => useRing("ana"))
  expect(result.current).toBe("unseen")
  act(() => {
    for (const s of socialStore.get().stories.filter((x) => x.by === "ana"))
      markSeen(s.id)
  })
  expect(result.current).toBe("seen")
})
