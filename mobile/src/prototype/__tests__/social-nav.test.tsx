import { toast } from "@domain/lib/platform"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { Compose } from "../social/compose"
import { CreateSheet } from "../social/feed"
import { Inbox } from "../social/inbox"
import { Avatar, NoteComposer } from "../social/kit"
import { pickMedia } from "../social/media"
import { socialStore } from "../social/store"

const mockPush = jest.fn()
let mockParams: Record<string, string> = {}
jest.mock("expo-router", () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  },
  usePathname: () => "/social",
  useLocalSearchParams: () => mockParams,
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
jest.mock("@domain/lib/platform", () => ({
  ...jest.requireActual("@domain/lib/platform"),
  toast: Object.assign(jest.fn(), { success: jest.fn() }),
}))
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
jest.mock("../social/media", () => ({
  ...jest.requireActual("../social/media"),
  pickMedia: jest.fn(async () => [
    { kind: "image", uri: "file:///picked.jpg", ratio: 1 },
  ]),
}))

// A busy machine needs more than 5 s for the first render.
jest.setTimeout(60_000)

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const show = (node: ReactNode) =>
  render(<SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>)

beforeEach(() => {
  socialStore.reset()
  mockPush.mockClear()
  mockParams = {}
})

test("Create → Note closes the sheet, then asks for the note sheet, with no navigation", async () => {
  const onNote = jest.fn()
  const onClose = jest.fn()
  const view = show(<CreateSheet open onClose={onClose} onNote={onNote} />)
  fireEvent.press(screen.getByLabelText(/^Note\. /))
  expect(onClose).toHaveBeenCalledTimes(1)
  // The note sheet waits until this one is fully gone.
  expect(onNote).not.toHaveBeenCalled()
  view.rerender(
    <SafeAreaProvider initialMetrics={metrics}>
      <CreateSheet open={false} onClose={onClose} onNote={onNote} />
    </SafeAreaProvider>,
  )
  await waitFor(() => expect(onNote).toHaveBeenCalledTimes(1), {
    timeout: 10_000,
  })
  expect(mockPush).not.toHaveBeenCalled()
})

test("closing the Create sheet without choosing Note opens nothing", async () => {
  const onNote = jest.fn()
  const view = show(<CreateSheet open onClose={() => {}} onNote={onNote} />)
  view.rerender(
    <SafeAreaProvider initialMetrics={metrics}>
      <CreateSheet open={false} onClose={() => {}} onNote={onNote} />
    </SafeAreaProvider>,
  )
  await act(() => new Promise((r) => setTimeout(r, 50)))
  expect(onNote).not.toHaveBeenCalled()
})

test("sharing from the note sheet says so and navigates nowhere", () => {
  const onClose = jest.fn()
  show(<NoteComposer open onClose={onClose} />)
  fireEvent.changeText(screen.getByLabelText("Note text"), "leg day")
  fireEvent.press(screen.getByText("Share"))
  expect(toast.success).toHaveBeenCalledWith("Note shared")
  expect(onClose).toHaveBeenCalled()
  expect(mockPush).not.toHaveBeenCalled()
  expect(socialStore.get().notes[0]).toMatchObject({ text: "leg day" })
})

test("the inbox ignores a note param", () => {
  mockParams = { note: "1" }
  show(<Inbox />)
  expect(screen.queryByText("New note")).toBeNull()
})

test("an avatar for someone not loaded yet is a placeholder, not a gap", () => {
  show(<Avatar id="nobody-here" size={34} />)
  expect(screen.getByLabelText("Profile photo")).toBeTruthy()
})

test("the empty compose area is a button that opens the library", async () => {
  show(<Compose />)
  const area = screen.getByLabelText("Add photos or videos from your library")
  expect(area.props.accessibilityRole).toBe("button")
  fireEvent.press(area)
  await waitFor(() => expect(pickMedia).toHaveBeenCalledWith({ camera: false }))
})
