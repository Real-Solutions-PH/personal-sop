// Live social: what the server sends that the store must keep (photos,
// read marks, story views, the scores switch) and the reads a screen needs
// beyond the feed (a shared post, the saved list).

import {
  connectSocial,
  ensurePostLive,
  loadSavedLive,
  loadStoriesLive,
  ME,
  socialStore,
  toggleFollow,
} from "@/prototype/social/store"
import { ApiError, type Http } from "../http"
import { createSocialLive } from "../social"

jest.mock("../config", () => ({
  ...jest.requireActual("../config"),
  liveMode: true,
}))
jest.mock("../auth", () => ({ http: {} }))
jest.mock("@domain/lib/platform", () => ({
  ...jest.requireActual("@domain/lib/platform"),
  getConnectivity: () => true,
  toast: () => {},
}))

const MEID = "11111111-1111-4111-8111-111111111111"
const ANA = "22222222-2222-4222-8222-222222222222"
const POST = "33333333-3333-4333-8333-333333333333"
const CHAT = "44444444-4444-4444-8444-444444444444"
const STORY = "55555555-5555-4555-8555-555555555555"

type Call = { method: string; path: string; body?: unknown }
function fakeHttp(routes: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = []
  const http: Http = {
    async request<T>(method: string, path: string, body?: unknown) {
      const call = { method, path, body }
      calls.push(call)
      const route = routes[`${method} ${path.split("?")[0]}`]
      if (!route) throw new ApiError(404, "not_found", path)
      return route(call) as T
    },
    raw: () => Promise.reject(new Error("unused")),
  }
  return { http, calls }
}
const brief = (id: string, name: string, photo: string | null = null) => ({
  id,
  name,
  handle: name.toLowerCase(),
  accent: "fit",
  photo_media_id: photo ? "m-photo" : null,
  photo_url: photo,
  verified: false,
})
const person = (id: string, over: Record<string, unknown> = {}) => ({
  ...brief(id, id === MEID ? "Me" : "Ana"),
  bio: "",
  followers: 0,
  following: 0,
  is_me: id === MEID,
  is_following: false,
  close_friend: false,
  scores_visible: true,
  show_scores: true,
  ...over,
})
const wirePost = (over: Record<string, unknown> = {}) => ({
  id: POST,
  author: brief(ANA, "Ana", "https://cdn.test/ana.jpg"),
  created_at: "2026-10-19T08:00:00Z",
  caption: "hi",
  media: [],
  progress: null,
  location: null,
  tags: [],
  likes: 0,
  liked: false,
  saved: false,
  comments: 0,
  liked_by: [],
  ...over,
})
const empty = { data: [], count: 0 }
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
const refreshRoutes = (over: Record<string, (c: Call) => unknown> = {}) => ({
  "GET /social/me": () => person(MEID),
  "GET /social/feed": () => ({ data: [wirePost()], count: 1 }),
  "GET /social/stories": () => empty,
  "GET /social/notes": () => empty,
  "GET /social/chats": () => empty,
  "GET /social/activity": () => ({ ...empty, unread: 0 }),
  [`GET /social/people/${MEID}/following`]: () => empty,
  "GET /social/drafts/post": () => ({ kind: "post", body: {} }),
  "GET /social/drafts/story": () => ({ kind: "story", body: {} }),
  ...over,
})

beforeEach(() => {
  socialStore.set((s) => ({
    ...s,
    people: [],
    posts: [],
    stories: [],
    seen: [],
    notes: [],
    chats: [],
    activity: [],
    drafts: {},
    me: undefined,
    showScores: true,
  }))
})
afterEach(() => connectSocial(null))

test("a person's photo comes from the URL the server sends, no media read", async () => {
  const { http, calls } = fakeHttp(refreshRoutes())
  await createSocialLive({ http, userId: MEID }).refresh()
  await settle()
  const ana = socialStore.get().people.find((p) => p.id === ANA)
  expect(ana?.photo).toBe("https://cdn.test/ana.jpg")
  // GET /media/{id} is owner-only: asking for someone else's photo is a 404.
  expect(calls.some((c) => c.path.startsWith("/media/"))).toBe(false)
})

test("my scores switch is read from the server, not left at the default", async () => {
  const { http } = fakeHttp(
    refreshRoutes({
      "GET /social/me": () => person(MEID, { show_scores: false }),
    }),
  )
  await createSocialLive({ http, userId: MEID }).refresh()
  expect(socialStore.get().showScores).toBe(false)
})

test("a chat keeps the other members' read marks from the server", async () => {
  const at = "2026-10-19T08:05:00Z"
  const { http } = fakeHttp(
    refreshRoutes({
      "GET /social/chats": () => ({
        data: [
          {
            id: CHAT,
            name: null,
            is_group: false,
            members: [brief(ANA, "Ana")],
            muted: false,
            pinned: false,
            read_at: null,
            read_by: { [ANA]: at },
            unread: 0,
            last_message: null,
          },
        ],
        count: 1,
      }),
    }),
  )
  await createSocialLive({ http, userId: MEID }).refresh()
  const chat = socialStore.get().chats.find((c) => c.id === CHAT)
  expect(chat?.readBy).toEqual({ [ANA]: Date.parse(at) })
})

test("my own check-in carries its real view count", async () => {
  const { http } = fakeHttp(
    refreshRoutes({
      "GET /social/stories": () => ({
        data: [
          {
            person: brief(MEID, "Me"),
            items: [
              {
                id: STORY,
                owner_id: MEID,
                created_at: new Date().toISOString(),
                kind: "text",
                media: null,
                text: "day 3",
                bg: null,
                progress: null,
                audience: "everyone",
                seen: true,
                liked: false,
                likes: 1,
                views: 4,
              },
            ],
          },
        ],
        count: 1,
      }),
    }),
  )
  await createSocialLive({ http, userId: MEID }).refresh()
  const story = socialStore.get().stories.find((s) => s.id === STORY)
  expect(story?.by).toBe(ME)
  expect(story?.views).toBe(4)
})

test("a shared post that is not loaded yet is fetched", async () => {
  const { http, calls } = fakeHttp({
    [`GET /social/posts/${POST}`]: () => wirePost({ caption: "shared" }),
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  expect(await ensurePostLive(POST)).toBe("ok")
  expect(socialStore.get().posts.find((p) => p.id === POST)?.caption).toBe(
    "shared",
  )
  // Already here: no second read.
  await ensurePostLive(POST)
  expect(calls.filter((c) => c.path === `/social/posts/${POST}`)).toHaveLength(
    1,
  )
  expect(await ensurePostLive("66666666-6666-4666-8666-666666666666")).toBe(
    "gone",
  )
})

test("the saved tab reads the saved list from the server", async () => {
  const { http } = fakeHttp({
    "GET /social/saved": () => ({
      data: [wirePost({ saved: true, created_at: "2025-01-01T00:00:00Z" })],
      count: 1,
    }),
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  await loadSavedLive()
  expect(socialStore.get().posts.find((p) => p.id === POST)?.saved).toBe(true)
})

test("following someone moves my own following count at once", async () => {
  const { http } = fakeHttp({
    [`PUT /social/people/${ANA}/follow`]: () =>
      person(ANA, { is_following: true, followers: 1 }),
    [`GET /social/people/${ANA}`]: () => person(ANA, { is_following: true }),
    [`GET /social/people/${ANA}/followers`]: () => empty,
    [`GET /social/people/${ANA}/following`]: () => empty,
    [`GET /social/people/${ANA}/posts`]: () => empty,
    [`GET /social/people/${ANA}/scorecard`]: () => {
      throw new ApiError(404, "scorecard_not_found", "")
    },
  })
  socialStore.set((s) => ({
    ...s,
    me: { bio: "", followers: 0, following: 2 },
    people: [
      {
        id: ANA,
        name: "Ana",
        username: "ana",
        bio: "",
        accent: "fit",
        followers: 0,
        following: 0,
        isFollowing: false,
      },
    ],
  }))
  connectSocial(createSocialLive({ http, userId: MEID }))
  toggleFollow(ANA)
  expect(socialStore.get().me?.following).toBe(3)
  await settle()
  toggleFollow(ANA)
  expect(socialStore.get().me?.following).toBe(2)
})

test("a post its author deleted leaves at once and comes back on undo", async () => {
  const { http } = fakeHttp({
    [`GET /social/posts/${POST}`]: () => wirePost({ caption: "back" }),
  })
  const live = createSocialLive({ http, userId: MEID })
  socialStore.set((s) => ({ ...s, posts: [] }))
  live.handleEvent({
    type: "social.post",
    data: { post_id: POST, action: "restored" },
  } as never)
  await settle()
  expect(socialStore.get().posts.map((p) => p.id)).toEqual([POST])
  live.handleEvent({
    type: "social.post",
    data: { post_id: POST, action: "deleted" },
  } as never)
  expect(socialStore.get().posts).toEqual([])
})

test("a message from someone I don't know yet loads their name", async () => {
  const CY = "77777777-7777-4777-8777-777777777777"
  const { http } = fakeHttp({
    [`GET /social/chats/${CHAT}`]: () => ({
      id: CHAT,
      name: "Gym",
      is_group: true,
      members: [brief(ANA, "Ana")],
      muted: false,
      pinned: false,
      read_at: null,
      read_by: {},
      unread: 0,
      last_message: null,
    }),
    [`GET /social/chats/${CHAT}/messages`]: () => ({
      data: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          chat_id: CHAT,
          sender_id: CY,
          at: "2026-10-19T08:00:00Z",
          text: "left the group",
          media: null,
          post_id: null,
          story_id: null,
          reply_to_id: null,
          system: true,
          reactions: {},
        },
      ],
      count: 1,
    }),
    [`GET /social/people/${CY}`]: () =>
      person(CY, { name: "Cy", handle: "cy" }),
  })
  await createSocialLive({ http, userId: MEID }).openChat(CHAT)
  await settle()
  expect(socialStore.get().people.find((p) => p.id === CY)?.name).toBe("Cy")
})

test("opening my check-ins reloads the tray, so the view count is current", async () => {
  let views = 0
  const { http, calls } = fakeHttp({
    "GET /social/stories": () => ({
      data: [
        {
          person: brief(MEID, "Me"),
          items: [
            {
              id: STORY,
              owner_id: MEID,
              created_at: new Date().toISOString(),
              kind: "text",
              media: null,
              text: "day 3",
              bg: null,
              progress: null,
              audience: "everyone",
              seen: true,
              liked: false,
              likes: 0,
              views,
            },
          ],
        },
      ],
      count: 1,
    }),
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  await loadStoriesLive()
  views = 2
  await loadStoriesLive()
  expect(calls.filter((c) => c.path === "/social/stories")).toHaveLength(2)
  expect(socialStore.get().stories.find((x) => x.id === STORY)?.views).toBe(2)
})
