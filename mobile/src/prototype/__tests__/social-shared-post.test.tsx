import { render, screen } from "@testing-library/react-native"
import { StyleSheet } from "react-native"
import { SharedPost } from "../social/chat"
import { socialStore } from "../social/store"

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

beforeEach(() => socialStore.reset())

test("a post I shared is readable: its card is not white text on the page", () => {
  // It sits on the page background, not inside my coloured bubble, so the
  // white "mine" text vanished on the light theme.
  const post = socialStore.get().posts.find((p) => p.caption)
  if (!post) throw new Error("seed has a captioned post")
  render(<SharedPost id={post.id} />)
  const caption = screen.getByText(post.caption)
  const color = StyleSheet.flatten(caption.props.style).color
  expect(String(color).toLowerCase()).not.toMatch(/^#fff(fff)?$/)
})
