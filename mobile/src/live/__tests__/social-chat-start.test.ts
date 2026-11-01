// Starting and opening a 1:1 chat against a fake HTTP layer: the typing
// nudge waits for the chat to exist, a start lost in transit is retried, and
// a chat is only "gone" when the server says so about the chat itself.

import {
  chatStarts,
  connectSocial,
  directChat,
  noteTyping,
  openChatLive,
  retryDirectChat,
  socialStore,
} from "@/prototype/social/store"
import { ApiError, type Http, NetworkError } from "../http"
import { createSocialLive, START_CHAT_RETRY_MS } from "../social"

jest.mock("../config", () => ({
  ...jest.requireActual("../config"),
  liveMode: true,
}))
jest.mock("../auth", () => ({ http: {} }))
const mockToasts: string[] = []
jest.mock("@domain/lib/platform", () => ({
  ...jest.requireActual("@domain/lib/platform"),
  getConnectivity: () => true,
  toast: Object.assign((m: string) => void mockToasts.push(m), {
    error: (m: string) => void mockToasts.push(m),
    warning: (m: string) => void mockToasts.push(m),
  }),
}))

const MEID = "11111111-1111-4111-8111-111111111111"
const ANA = "22222222-2222-4222-8222-222222222222"
const SERVER_CHAT = "55555555-5555-4555-8555-555555555555"

type Call = { method: string; path: string; body?: unknown }
type Route = (call: Call) => unknown
function fakeHttp(routes: Record<string, Route>) {
  const calls: Call[] = []
  const http: Http = {
    async request<T>(method: string, path: string, body?: unknown) {
      const call = { method, path, body }
      calls.push(call)
      const route = routes[`${method} ${path.split("?")[0]}`]
      if (!route) throw new ApiError(404, "not_found", path)
      return (await route(call)) as T
    },
    raw: () => Promise.reject(new Error("unused")),
  }
  return { http, calls }
}
const wireChat = (id: string) => ({
  id,
  name: null,
  is_group: false,
  members: [
    {
      id: ANA,
      name: "Ana Reyes",
      handle: "ana",
      accent: "fit",
      photo_media_id: null,
      verified: false,
    },
  ],
  muted: false,
  pinned: false,
  read_at: null,
  read_by: {},
  unread: 0,
  last_message: null,
})
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
const posted = (calls: Call[], suffix: string) =>
  calls.filter((c) => c.method === "POST" && c.path.endsWith(suffix))

beforeEach(() => {
  mockToasts.length = 0
  socialStore.set((s) => ({ ...s, people: [], chats: [] }))
  chatStarts.setState({}, true)
})
afterEach(() => {
  connectSocial(null)
  jest.useRealTimers()
})

test("typing in a chat still being started waits, then uses the server's id", async () => {
  let land: (v: unknown) => void = () => {}
  const { http, calls } = fakeHttp({
    "POST /social/chats/direct": () =>
      new Promise((resolve) => {
        land = resolve
      }),
    [`POST /social/chats/${SERVER_CHAT}/typing`]: () => null,
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  const id = directChat(ANA)
  noteTyping(id)
  await settle()
  // Sent now, it would be a 404 for a chat the server has not made yet.
  expect(posted(calls, "/typing")).toEqual([])
  land(wireChat(SERVER_CHAT))
  await settle()
  expect(posted(calls, "/typing").map((c) => c.path)).toEqual([
    `/social/chats/${SERVER_CHAT}/typing`,
  ])
})

test("a typing or read ping that fails never removes the chat", async () => {
  const { http } = fakeHttp({
    "POST /social/chats/direct": ({ body }) =>
      wireChat((body as { id: string }).id),
    // No typing or read route: both answer 404.
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  const id = directChat(ANA)
  await settle()
  noteTyping(id)
  await settle()
  expect(socialStore.get().chats.map((c) => c.id)).toEqual([id])
  expect(mockToasts).toEqual([])
})

test("a start lost in transit is retried with the same id and opens the chat", async () => {
  jest.useFakeTimers()
  let attempts = 0
  const { http, calls } = fakeHttp({
    "POST /social/chats/direct": ({ body }) => {
      attempts++
      if (attempts === 1) throw new NetworkError("timeout")
      if (attempts === 2) throw new ApiError(503, "unavailable", "busy")
      return wireChat((body as { id: string }).id)
    },
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  const id = directChat(ANA)
  await settle()
  await jest.advanceTimersByTimeAsync(START_CHAT_RETRY_MS[0])
  await jest.advanceTimersByTimeAsync(START_CHAT_RETRY_MS[1])
  await settle()
  const starts = posted(calls, "/chats/direct")
  expect(starts).toHaveLength(3)
  expect(new Set(starts.map((c) => (c.body as { id: string }).id))).toEqual(
    new Set([id]),
  )
  expect(socialStore.get().chats.map((c) => c.id)).toEqual([id])
  expect(chatStarts.getState()[id]).toBeUndefined()
  expect(mockToasts).toEqual([])
})

test("a start that keeps failing says why, offers a retry, and is not 'gone'", async () => {
  jest.useFakeTimers()
  let up = false
  const { http } = fakeHttp({
    "POST /social/chats/direct": ({ body }) => {
      if (!up) throw new NetworkError("timeout")
      return wireChat((body as { id: string }).id)
    },
    [`GET /social/chats/${SERVER_CHAT}/messages`]: () => ({
      data: [],
      count: 0,
    }),
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  const id = directChat(ANA)
  const open = openChatLive(id)
  for (const ms of START_CHAT_RETRY_MS) await jest.advanceTimersByTimeAsync(ms)
  await settle()
  expect(mockToasts).toEqual([
    "Couldn't reach Unfurl to start the chat. Check your connection and try again.",
  ])
  expect(chatStarts.getState()[id]).toEqual({ personId: ANA })
  expect(await open).toBe("failed")

  up = true
  retryDirectChat(id)
  await settle()
  expect(chatStarts.getState()[id]).toBeUndefined()
  expect(socialStore.get().chats.map((c) => c.id)).toEqual([id])
})

test("a start the server refuses is not retried and names the reason", async () => {
  const { http, calls } = fakeHttp({
    "POST /social/chats/direct": () => {
      throw new ApiError(404, "person_not_found", "Person not found")
    },
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  directChat(ANA)
  await settle()
  expect(posted(calls, "/chats/direct")).toHaveLength(1)
  expect(mockToasts).toEqual([
    "Couldn't start the chat: that account isn't available.",
  ])
})

test("opening a chat: 404 is gone, a server fault is a failure to load", async () => {
  let fault = true
  const { http } = fakeHttp({
    [`GET /social/chats/${SERVER_CHAT}`]: () => {
      if (fault) throw new ApiError(500, "internal", "boom")
      return wireChat(SERVER_CHAT)
    },
    [`GET /social/chats/${SERVER_CHAT}/messages`]: () => ({
      data: [],
      count: 0,
    }),
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  expect(await openChatLive(SERVER_CHAT)).toBe("failed")
  fault = false
  expect(await openChatLive(SERVER_CHAT)).toBe("ok")
  expect(await openChatLive("66666666-6666-4666-8666-666666666666")).toBe(
    "gone",
  )
})
