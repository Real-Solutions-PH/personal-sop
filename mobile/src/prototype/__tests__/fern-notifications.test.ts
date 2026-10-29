// Fern's "replied" push: tapping it opens that chat (from a cold start too),
// and it shows no banner while that very chat is on screen.
import { captureUi, openCapture } from "@domain/lib/capture"
import { configureStorage, resetAll } from "@domain/lib/store"
import { router } from "expo-router"
import { addMessage, companionStore, currentThread } from "../companion/store"
import {
  chatPage,
  openNotification,
  routeLaunchNotification,
  showsBanner,
} from "../notifications"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  chatPage.setState({ on: false })
  ;(router.push as jest.Mock).mockClear()
})

const reply = (thread: string) => ({
  kind: "companion.reply",
  thread_id: thread,
  href: `/capture?thread=${thread}`,
})

it("a tap on Fern's reply closes the drawer and opens the chat", () => {
  openCapture()
  openNotification(reply("t-1"))
  expect(captureUi.get().open).toBe(false)
  expect(router.push).toHaveBeenCalledWith("/capture?thread=t-1")
})

it("any other notification opens its link", () => {
  openNotification({ href: "/tasks" })
  expect(router.push).toHaveBeenCalledWith("/tasks")
  openNotification({})
  expect(router.push).toHaveBeenCalledTimes(1)
})

it("no banner for a reply to the chat on screen; a banner otherwise", () => {
  addMessage({ role: "me", text: "plan my week" })
  const here = currentThread(companionStore.get()) as string
  // Not looking at Fern at all.
  expect(showsBanner(reply(here))).toBe(true)
  openCapture()
  expect(showsBanner(reply(here))).toBe(false)
  // In Fern, but another chat.
  expect(showsBanner(reply("another-chat"))).toBe(true)
  captureUi.set({ open: false, ctx: {} })
  chatPage.setState({ on: true })
  expect(showsBanner(reply(here))).toBe(false)
  // Reminders always show.
  expect(showsBanner({ href: "/tasks" })).toBe(true)
})

it("the tap that launched the app is routed once", () => {
  const response = {
    notification: {
      request: { identifier: "n-1", content: { data: reply("t-9") } },
    },
  }
  const N = {
    getLastNotificationResponse: jest.fn(() => response),
    clearLastNotificationResponse: jest.fn(),
  }
  routeLaunchNotification(N as never)
  expect(router.push).toHaveBeenCalledWith("/capture?thread=t-9")
  expect(N.clearLastNotificationResponse).toHaveBeenCalled()
  N.getLastNotificationResponse.mockReturnValue(null as never)
  routeLaunchNotification(N as never)
  expect(router.push).toHaveBeenCalledTimes(1)
})
