import { fireEvent, render, screen } from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { PostDetail } from "../social/post"
import { connectSocial, type SocialRemote, socialStore } from "../social/store"

jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: chain,
    GestureDetector: ({ children }: { children: unknown }) => children,
  }
})
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

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const show = (id: string) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <PostDetail id={id} />
    </SafeAreaProvider>,
  )

const FIRE = "🔥"
const BICEPS = "💪"
const CLAP = "👏"

const remote = { addComment: jest.fn() } as unknown as SocialRemote

beforeEach(() => {
  socialStore.reset()
  connectSocial(remote)
})
afterEach(() => connectSocial(null))

const seeded = () => {
  const post = socialStore.get().posts.find((p) => p.comments.length > 0)
  if (!post) throw new Error("seed has a post with comments")
  return post
}
const commentsOf = (id: string) =>
  socialStore.get().posts.find((p) => p.id === id)?.comments ?? []
const box = () => screen.getByLabelText("Add a comment")
const select = (start: number, end = start) =>
  fireEvent(box(), "selectionChange", {
    nativeEvent: { selection: { start, end } },
  })

test("tapping an emoji fills the box, shows Post and adds no comment", () => {
  const post = seeded()
  const before = commentsOf(post.id).length
  show(post.id)
  expect(screen.queryByText("Post")).toBeNull()
  fireEvent.press(screen.getByLabelText(`Add ${FIRE} to your comment`))
  expect(box().props.value).toBe(FIRE)
  expect(screen.getByText("Post")).toBeTruthy()
  expect(commentsOf(post.id)).toHaveLength(before)
  expect(remote.addComment).not.toHaveBeenCalled()
})

test("an emoji lands at the cursor and the cursor moves past it", () => {
  const post = seeded()
  show(post.id)
  fireEvent.changeText(box(), "great set")
  select("great ".length)
  fireEvent.press(screen.getByLabelText(`Add ${BICEPS} to your comment`))
  expect(box().props.value).toBe(`great ${BICEPS}set`)
  // The controlled selection is applied for one render and then released.
  expect(box().props.selection).toBeUndefined()
  // A second tap goes after the first one.
  fireEvent.press(screen.getByLabelText(`Add ${FIRE} to your comment`))
  expect(box().props.value).toBe(`great ${BICEPS}${FIRE}set`)
})

test("an emoji replaces highlighted text", () => {
  const post = seeded()
  show(post.id)
  fireEvent.changeText(box(), "so good")
  select(3, 7)
  fireEvent.press(screen.getByLabelText(`Add ${FIRE} to your comment`))
  expect(box().props.value).toBe(`so ${FIRE}`)
})

test("emoji then Post adds exactly one comment and clears the box", () => {
  const post = seeded()
  const before = commentsOf(post.id).length
  show(post.id)
  fireEvent.changeText(box(), "nice ")
  fireEvent.press(screen.getByLabelText(`Add ${CLAP} to your comment`))
  fireEvent.press(screen.getByText("Post"))
  const after = commentsOf(post.id)
  expect(after).toHaveLength(before + 1)
  expect(after.at(-1)?.text).toBe(`nice ${CLAP}`)
  expect(box().props.value).toBe("")
})

test("an emoji tap while replying keeps the reply", () => {
  const post = seeded()
  const parent = post.comments.find((c) => !c.replyTo)
  if (!parent) throw new Error("seed has a root comment")
  show(post.id)
  fireEvent.press(screen.getAllByText("Reply")[0])
  expect(screen.getByText(/Replying to/)).toBeTruthy()
  fireEvent.press(screen.getByLabelText(`Add ${FIRE} to your comment`))
  expect(screen.getByText(/Replying to/)).toBeTruthy()
  fireEvent.press(screen.getByText("Post"))
  expect(commentsOf(post.id).at(-1)?.replyTo).toBe(parent.id)
})
