import { render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { SocialFeed } from "../social/feed"
import { socialStore } from "../social/store"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  usePathname: () => "/social",
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => {},
  useNavigation: () => ({ addListener: () => () => {} }),
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: chain,
    GestureDetector: ({ children }: { children: ReactNode }) => children,
  }
})
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
})
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
  withSpring: (value: unknown) => value,
  useReducedMotion: () => true,
}))

jest.mock("expo-video", () => ({
  VideoView: require("react-native").View,
  useVideoPlayer: () => ({
    play() {},
    pause() {},
    addListener: () => ({ remove() {} }),
  }),
}))

jest.setTimeout(120_000)

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const show = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SocialFeed />
    </SafeAreaProvider>,
  )

const CAPTION = "Track Tuesday. 6 × 800m, legs are jelly."
// The caption renders after the author's name, in the same text.
const SHOWN = /Track Tuesday\. 6 × 800m, legs are jelly\./

beforeEach(() => socialStore.reset())

test("a member who follows nobody sees other members' posts on Community", () => {
  // Production on 2026-11-06: nobody followed anybody, so the Friends tab
  // the screen opened on held only the viewer's own posts.
  socialStore.set((s) => ({
    ...s,
    people: s.people.map((p) => ({ ...p, isFollowing: false })),
  }))
  expect(socialStore.get().posts.some((p) => p.caption === CAPTION)).toBe(true)
  show()
  expect(screen.getByText(SHOWN)).toBeTruthy()
  expect(
    screen.getByRole("tab", { name: "Everyone" }).props.accessibilityState,
  ).toMatchObject({ selected: true })
})

test("a member who follows someone opens on Friends", () => {
  show()
  // Marco is followed in the seed, so his post is on Friends too.
  expect(screen.getByText(SHOWN)).toBeTruthy()
  expect(
    screen.getByRole("tab", { name: "Friends" }).props.accessibilityState,
  ).toMatchObject({ selected: true })
})
