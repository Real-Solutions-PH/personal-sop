// Live social: the store's actions against a fake HTTP layer, and the event
// stream's nudges as fake events. Prototype-mode behaviour is covered by
// src/prototype/__tests__/social.test.ts, which runs without these mocks.

import {
  cheer,
  connectSocial,
  createPost,
  deleteComment,
  deletePost,
  ME,
  openChatLive,
  openPersonLive,
  openPostLive,
  sendMessage,
  setNote,
  setPostDraft,
  socialStore,
  toggleLike,
  toggleShowScores,
  typingStore,
  unsend,
} from "@/prototype/social/store"
import { ApiError, type Http } from "../http"
import { createSocialLive, TYPING_EVERY_MS } from "../social"

jest.mock("../config", () => ({
  ...jest.requireActual("../config"),
  liveMode: true,
}))
// The real auth module builds a Supabase client; the tests pass their own Http.
jest.mock("../auth", () => ({ http: {} }))
let mockOnline = true
const mockToasts: string[] = []
jest.mock("@domain/lib/platform", () => ({
  ...jest.requireActual("@domain/lib/platform"),
  getConnectivity: () => mockOnline,
  toast: (m: string) => void mockToasts.push(m),
}))

const MEID = "11111111-1111-4111-8111-111111111111"
const ANA = "22222222-2222-4222-8222-222222222222"
const POST = "33333333-3333-4333-8333-333333333333"
const CHAT = "44444444-4444-4444-8444-444444444444"

type Call = { method: string; path: string; body?: unknown }
type Route = (call: Call) => unknown
function fakeHttp(routes: Record<string, Route>) {
  const calls: Call[] = []
  const http: Http = {
    async request<T>(method: string, path: string, body?: unknown) {
      const call = { method, path, body }
      calls.push(call)
      const key = `${method} ${path.split("?")[0]}`
      const route = routes[key]
      if (!route) throw new ApiError(404, "not_found", key)
      return route(call) as T
    },
    raw: () => Promise.reject(new Error("unused")),
  }
  return { http, calls }
}
const brief = (id: string, name: string, handle: string) => ({
  id,
  name,
  handle,
  accent: "fit",
  photo_media_id: null,
  verified: false,
})
const wirePost = (over: Record<string, unknown> = {}) => ({
  id: POST,
  author: brief(ANA, "Ana Reyes", "ana.lifts"),
  created_at: "2026-10-19T08:00:00Z",
  caption: "Squat PR #legday",
  media: [
    {
      media_id: "m1",
      kind: "image",
      ratio: 1.5,
      url: "https://cdn.test/m1.jpg",
    },
  ],
  progress: null,
  location: "BGC",
  tags: ["legday"],
  likes: 3,
  liked: false,
  saved: false,
  comments: 2,
  liked_by: [brief(MEID, "Me", "me")],
  ...over,
})
const empty = { data: [], count: 0 }
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  mockOnline = true
  mockToasts.length = 0
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
  }))
  typingStore.setState({}, true)
})
afterEach(() => connectSocial(null))

test("refresh loads the feed and maps server posts into the store's shape", async () => {
  const { http, calls } = fakeHttp({
    "GET /social/me": () => ({
      ...brief(MEID, "Me", "me"),
      bio: "hi",
      followers: 4,
      following: 5,
      is_me: true,
      is_following: false,
      close_friend: false,
      scores_visible: true,
    }),
    "GET /social/feed": ({ path }) =>
      path.includes("tab=following")
        ? { data: [wirePost()], count: 1, next_cursor: "c2" }
        : { data: [], count: 0 },
    "GET /social/stories": () => empty,
    "GET /social/notes": () => empty,
    "GET /social/chats": () => empty,
    "GET /social/activity": () => ({ ...empty, unread: 0 }),
    [`GET /social/people/${MEID}/following`]: () => empty,
    "GET /social/drafts/post": () => ({ kind: "post", body: {} }),
    "GET /social/drafts/story": () => ({ kind: "story", body: {} }),
  })
  const live = createSocialLive({ http, userId: MEID })
  await live.refresh()

  const s = socialStore.get()
  // Hand-read from wirePost(): one post by Ana, liked by me (ME), two
  // comments on the server, none loaded yet.
  expect(s.posts).toEqual([
    {
      id: POST,
      by: ANA,
      at: Date.parse("2026-10-19T08:00:00Z"),
      caption: "Squat PR #legday",
      media: [
        {
          id: "m1",
          kind: "image",
          uri: "https://cdn.test/m1.jpg",
          urlAt: expect.any(Number),
          ratio: 1.5,
        },
      ],
      progress: undefined,
      location: "BGC",
      likes: 3,
      liked: false,
      saved: false,
      likedBy: [ME],
      comments: [],
      commentCount: 2,
    },
  ])
  expect(s.people.map((p) => [p.id, p.name, p.username])).toEqual([
    [ANA, "Ana Reyes", "ana.lifts"],
  ])
  expect(s.me).toEqual({ bio: "hi", followers: 4, following: 5, id: MEID })
  expect(calls.find((c) => c.path.includes("tab=following"))?.path).toBe(
    "/social/feed?tab=following&limit=20",
  )

  // The next following page passes the keyset cursor back.
  await live.loadMoreFeed("following")
  expect(calls.at(-1)?.path).toBe(
    "/social/feed?tab=following&limit=20&cursor=c2",
  )
})

test("a like is applied at once and rolled back with a toast when the server fails", async () => {
  socialStore.set((s) => ({
    ...s,
    posts: [
      {
        id: POST,
        by: ANA,
        at: 0,
        caption: "",
        media: [],
        likes: 3,
        liked: false,
        saved: false,
        likedBy: [],
        comments: [],
      },
    ],
  }))
  let fail: (e: unknown) => void = () => {}
  const { http, calls } = fakeHttp({
    [`PUT /social/posts/${POST}/like`]: () =>
      new Promise((_, reject) => {
        fail = reject
      }),
  })
  connectSocial(createSocialLive({ http, userId: MEID }))

  toggleLike(POST)
  const post = () => socialStore.get().posts[0]
  // Optimistic: liked before the server answers.
  expect(post()).toMatchObject({ liked: true, likes: 4 })
  expect(calls).toEqual([
    {
      method: "PUT",
      path: `/social/posts/${POST}/like?kind=keep_going`,
      body: undefined,
    },
  ])

  fail(new ApiError(500, "boom", "boom"))
  await settle()
  expect(post()).toMatchObject({ liked: false, likes: 3 })
  expect(mockToasts).toEqual(["Couldn't cheer the post. Please try again."])
})

test("a cheer sends its kind and keeps the server's counts, not its other fields", async () => {
  socialStore.set((s) => ({
    ...s,
    posts: [
      {
        id: POST,
        by: ANA,
        at: 0,
        caption: "",
        media: [],
        likes: 3,
        liked: false,
        saved: false,
        likedBy: [],
        comments: [],
      },
    ],
  }))
  // Hand-written server answer: 3 earlier cheers plus mine, and the post's
  // check-in card as the API stores it (snake_case flag).
  const answer = wirePost({
    likes: 4,
    liked: true,
    cheers: { keep_going: 2, proud: 2, inspired: 0 },
    my_cheer: "proud",
    progress: {
      accent: "fit",
      kind: "Habit streak",
      title: "Morning run",
      stats: [],
      day: 12,
      of: 30,
      before_after: false,
    },
  })
  const { http, calls } = fakeHttp({
    [`PUT /social/posts/${POST}/like`]: () => answer,
  })
  connectSocial(createSocialLive({ http, userId: MEID }))

  cheer(POST, "proud")
  // Optimistic: an older post counts its likes as "keep going".
  expect(socialStore.get().posts[0]).toMatchObject({
    likes: 4,
    myCheer: "proud",
    cheers: { keep_going: 3, proud: 1, inspired: 0 },
  })
  expect(calls[0].path).toBe(`/social/posts/${POST}/like?kind=proud`)
  await settle()
  expect(socialStore.get().posts[0]).toMatchObject({
    likes: 4,
    liked: true,
    myCheer: "proud",
    cheers: { keep_going: 2, proud: 2, inspired: 0 },
  })
  // A reaction answer moves counters only; the card is read with the post.
  expect(socialStore.get().posts[0].progress).toBeUndefined()
})

test("a write made offline fails at once with a toast and changes nothing", () => {
  socialStore.set((s) => ({
    ...s,
    posts: [
      {
        id: POST,
        by: ANA,
        at: 0,
        caption: "",
        media: [],
        likes: 3,
        liked: false,
        saved: false,
        likedBy: [],
        comments: [],
      },
    ],
  }))
  const { http, calls } = fakeHttp({})
  connectSocial(createSocialLive({ http, userId: MEID }))
  mockOnline = false
  toggleLike(POST)
  expect(socialStore.get().posts[0]).toMatchObject({ liked: false, likes: 3 })
  expect(calls).toEqual([])
  expect(mockToasts).toEqual(["You're offline. Couldn't cheer the post."])
})

test("a chat message arriving by event is fetched and merged; typing clears", async () => {
  // The typing indicator's own expiry timer must not outlive the test.
  jest.useFakeTimers()
  socialStore.set((s) => ({
    ...s,
    people: [
      {
        id: ANA,
        name: "Ana Reyes",
        username: "ana.lifts",
        bio: "",
        accent: "fit",
        followers: 0,
        following: 0,
        isFollowing: true,
      },
    ],
    chats: [
      {
        id: CHAT,
        members: [ANA],
        messages: [],
        muted: false,
        pinned: false,
        readAt: 0,
      },
    ],
  }))
  const { http, calls } = fakeHttp({
    [`GET /social/chats/${CHAT}/messages`]: () => ({
      data: [
        {
          id: "msg-1",
          chat_id: CHAT,
          sender_id: ANA,
          at: "2026-10-19T09:00:00Z",
          text: "Are you training tomorrow?",
          media: null,
          post_id: null,
          story_id: null,
          reply_to_id: null,
          system: false,
          reactions: { [MEID]: "👍" },
        },
      ],
      count: 1,
    }),
  })
  const live = createSocialLive({ http, userId: MEID })

  live.handleEvent({
    id: "1",
    type: "chat.typing",
    data: { chat_id: CHAT, user_id: ANA },
  })
  expect(typingStore.getState()[CHAT]?.by).toBe(ANA)

  live.handleEvent({
    id: "2",
    type: "chat.message",
    data: {
      chat_id: CHAT,
      message_id: "msg-1",
      sender_id: ANA,
      at: "2026-10-19T09:00:00Z",
      action: "created",
    },
  })
  await settle()
  expect(calls.map((c) => c.path)).toEqual([
    `/social/chats/${CHAT}/messages?limit=20`,
  ])
  expect(socialStore.get().chats[0].messages).toEqual([
    {
      id: "msg-1",
      by: ANA,
      at: Date.parse("2026-10-19T09:00:00Z"),
      text: "Are you training tomorrow?",
      media: undefined,
      postId: undefined,
      storyReply: undefined,
      replyTo: undefined,
      reactions: { [ME]: "👍" },
      system: undefined,
    },
  ])
  expect(typingStore.getState()[CHAT]).toBeUndefined()

  // A reaction event updates the message in place, no fetch.
  live.handleEvent({
    id: "3",
    type: "chat.reaction",
    data: { chat_id: CHAT, message_id: "msg-1", user_id: ANA, emoji: "🔥" },
  })
  expect(socialStore.get().chats[0].messages[0].reactions).toEqual({
    [ME]: "👍",
    [ANA]: "🔥",
  })
  expect(calls).toHaveLength(1)
  jest.useRealTimers()
})

test("typing posts at most once every 3 seconds per chat", async () => {
  let clock = 1_000_000
  const { http, calls } = fakeHttp({
    [`POST /social/chats/${CHAT}/typing`]: () => null,
  })
  const live = createSocialLive({ http, userId: MEID, now: () => clock })
  const posts = () => calls.filter((c) => c.path.endsWith("/typing")).length

  await live.typing(CHAT)
  clock += 1000
  await live.typing(CHAT)
  clock += TYPING_EVERY_MS - 1000 - 1 // 2,999 ms after the first
  await live.typing(CHAT)
  expect(posts()).toBe(1)
  clock += 1 // exactly 3,000 ms
  await live.typing(CHAT)
  expect(posts()).toBe(2)
})

test("a new post uploads its media first and sends the media ids, with no fake likes", async () => {
  jest.useFakeTimers()
  try {
    const uploads: string[] = []
    const { http, calls } = fakeHttp({
      "POST /social/posts": ({ body }) =>
        wirePost({
          id: (body as { id: string }).id,
          author: brief(MEID, "Me", "me"),
          likes: 0,
          liked_by: [],
          comments: 0,
          media: [{ media_id: "srv-1", kind: "image", ratio: null, url: null }],
        }),
    })
    connectSocial(
      createSocialLive({
        http,
        userId: MEID,
        upload: async (uri) => {
          uploads.push(uri)
          return "srv-1"
        },
      }),
    )
    const post = createPost({
      caption: "First 10K",
      media: [{ kind: "image", uri: "file:///local.jpg" }],
    })
    await settle()
    expect(uploads).toEqual(["file:///local.jpg"])
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/social/posts",
      body: {
        id: post.id,
        caption: "First 10K",
        media: [{ media_id: "srv-1", kind: "image", ratio: null }],
      },
    })
    jest.advanceTimersByTime(10_000)
    const saved = socialStore.get().posts.find((p) => p.id === post.id)
    // The server's copy, keeping the local uri until the CDN url exists.
    expect(saved).toMatchObject({
      by: ME,
      likes: 0,
      likedBy: [],
      media: [{ kind: "image", uri: "file:///local.jpg" }],
    })
    expect(socialStore.get().activity).toEqual([])
  } finally {
    jest.useRealTimers()
  }
})

test("a screen that loads before the session connects waits for it", async () => {
  const person = {
    ...brief(ANA, "Ana Reyes", "ana.lifts"),
    bio: "",
    followers: 1,
    following: 0,
    is_me: false,
    is_following: false,
    close_friend: false,
    scores_visible: false,
  }
  const { http, calls } = fakeHttp({
    [`GET /social/people/${ANA}`]: () => person,
    [`GET /social/people/${ANA}/posts`]: () => empty,
    [`GET /social/people/${ANA}/followers`]: () => ({
      data: [{ ...person, ...brief(MEID, "Me", "me"), is_me: true }],
      count: 1,
    }),
    [`GET /social/people/${ANA}/following`]: () => empty,
  })
  // The profile mounts (cold open) before startup connects the remote.
  const loaded = openPersonLive(ANA)
  await settle()
  expect(calls).toEqual([])
  connectSocial(createSocialLive({ http, userId: MEID }))
  await loaded
  expect(calls.map((c) => c.path.split("?")[0])).toContain(
    `/social/people/${ANA}`,
  )
  // The follows screen lists the server's graph, me as ME.
  expect(socialStore.get().graph?.[ANA]).toEqual({
    followers: [ME],
    following: [],
  })
})

test("a post draft is saved without the inline web image", async () => {
  const { http, calls } = fakeHttp({
    "PUT /social/drafts/post": (c) => ({
      kind: "post",
      body: (c.body as { body: unknown }).body,
      updated_at: null,
    }),
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  setPostDraft({
    caption: "Tasks this week",
    media: [{ kind: "image", uri: "data:image/png;base64,AAAA", ratio: 1 }],
  })
  await settle()
  expect(calls).toEqual([
    {
      method: "PUT",
      path: "/social/drafts/post",
      body: { body: { caption: "Tasks this week", media: [] } },
    },
  ])
})

test("a read in flight when I delete a post does not bring it back", async () => {
  let answer: (v: unknown) => void = () => {}
  const { http } = fakeHttp({
    [`GET /social/posts/${POST}`]: () =>
      new Promise((resolve) => {
        answer = resolve
      }),
    [`GET /social/posts/${POST}/comments`]: () => empty,
    [`DELETE /social/posts/${POST}`]: () => undefined,
  })
  socialStore.set((s) => ({
    ...s,
    posts: [
      {
        id: POST,
        by: ME,
        at: 0,
        caption: "",
        media: [],
        likes: 0,
        liked: false,
        saved: false,
        likedBy: [],
        comments: [],
      },
    ],
  }))
  connectSocial(createSocialLive({ http, userId: MEID }))
  const opened = openPostLive(POST)
  await settle()
  deletePost(POST)
  answer(wirePost({ author: brief(MEID, "Me", "me") }))
  await opened
  await settle()
  expect(socialStore.get().posts).toEqual([])
})

test("a note left while the notes list loads survives that list", async () => {
  let answer: (v: unknown) => void = () => {}
  const { http } = fakeHttp({
    "GET /social/notes": () =>
      new Promise((resolve) => {
        answer = resolve
      }),
    "PUT /social/notes/me": () => ({
      id: "n1",
      person: brief(MEID, "Me", "me"),
      text: "Deep work",
      created_at: "2026-10-19T08:00:00Z",
      liked: false,
      likes: 0,
    }),
  })
  const live = createSocialLive({ http, userId: MEID })
  connectSocial(live)
  const refreshing = live.refresh().catch(() => {})
  await settle()
  setNote("Deep work")
  await settle()
  answer(empty)
  await refreshing
  await settle()
  expect(socialStore.get().notes.map((n) => [n.by, n.text])).toEqual([
    [ME, "Deep work"],
  ])
})

test("messages sent back to back reach the server in order", async () => {
  socialStore.set((s) => ({
    ...s,
    chats: [
      {
        id: CHAT,
        members: [ANA],
        messages: [],
        muted: false,
        pinned: false,
        readAt: 0,
      },
    ],
  }))
  const answers: ((v: unknown) => void)[] = []
  const { http, calls } = fakeHttp({
    [`POST /social/chats/${CHAT}/messages`]: (c) =>
      new Promise((resolve) =>
        answers.push(() =>
          resolve({
            id: (c.body as { id: string }).id,
            chat_id: CHAT,
            sender_id: MEID,
            at: "2026-10-19T08:00:00Z",
            text: (c.body as { text: string }).text,
            media: null,
            post_id: null,
            story_id: null,
            reply_to_id: null,
            system: false,
            reactions: {},
          }),
        ),
      ),
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  sendMessage(CHAT, { text: "Hi" })
  sendMessage(CHAT, { text: "❤️" })
  await settle()
  // The second waits until the first has been stored.
  expect(calls.map((c) => (c.body as { text: string }).text)).toEqual(["Hi"])
  answers[0](undefined)
  await settle()
  expect(calls.map((c) => (c.body as { text: string }).text)).toEqual([
    "Hi",
    "❤️",
  ])
})

test("a write made before the session connects is sent once it does", async () => {
  const { http, calls } = fakeHttp({
    "PATCH /social/me": () => ({}),
  })
  toggleShowScores()
  await settle()
  expect(calls).toEqual([])
  connectSocial(createSocialLive({ http, userId: MEID }))
  await settle()
  expect(calls).toEqual([
    { method: "PATCH", path: "/social/me", body: { show_scores: false } },
  ])
  expect(mockToasts).toEqual([])
})

test("undo right after delete restores only once the delete has landed", async () => {
  let deleted: (v: unknown) => void = () => {}
  const { http, calls } = fakeHttp({
    [`DELETE /social/posts/${POST}`]: () =>
      new Promise((resolve) => {
        deleted = resolve
      }),
    [`POST /social/posts/${POST}/restore`]: () =>
      wirePost({ author: brief(MEID, "Me", "me") }),
  })
  socialStore.set((s) => ({
    ...s,
    posts: [
      {
        id: POST,
        by: ME,
        at: 0,
        caption: "",
        media: [],
        likes: 0,
        liked: false,
        saved: false,
        likedBy: [],
        comments: [],
      },
    ],
  }))
  connectSocial(createSocialLive({ http, userId: MEID }))
  const restore = deletePost(POST)
  restore()
  await settle()
  expect(calls.map((c) => c.method)).toEqual(["DELETE"])
  deleted(undefined)
  await settle()
  expect(calls.map((c) => c.method)).toEqual(["DELETE", "POST"])
  expect(socialStore.get().posts.map((p) => p.id)).toEqual([POST])
})

test("a read in flight when I delete a message does not bring it back", async () => {
  const msg = {
    id: "m1",
    chat_id: CHAT,
    sender_id: MEID,
    at: "2026-10-19T08:00:00Z",
    text: "Oops typo",
    media: null,
    post_id: null,
    story_id: null,
    reply_to_id: null,
    system: false,
    reactions: {},
  }
  socialStore.set((s) => ({
    ...s,
    chats: [
      {
        id: CHAT,
        members: [ANA],
        messages: [
          { id: "m1", by: ME, at: 0, text: "Oops typo", reactions: {} },
        ],
        muted: false,
        pinned: false,
        readAt: 0,
      },
    ],
  }))
  let answer: (v: unknown) => void = () => {}
  const { http } = fakeHttp({
    [`GET /social/chats/${CHAT}/messages`]: () =>
      new Promise((resolve) => {
        answer = resolve
      }),
    [`DELETE /social/chats/${CHAT}/messages/m1`]: () => undefined,
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  const opened = openChatLive(CHAT)
  await settle()
  unsend(CHAT, "m1")
  answer({ data: [msg], count: 1 })
  await opened
  await settle()
  // It stays as a tombstone, with nothing of the message left.
  expect(socialStore.get().chats[0].messages).toEqual([
    expect.objectContaining({ id: "m1", deleted: true, text: undefined }),
  ])
})

test("a chat list read in flight when I delete does not bring the message back", async () => {
  const msg = {
    id: "m1",
    chat_id: CHAT,
    sender_id: MEID,
    at: "2026-10-19T08:00:00Z",
    text: "Oops typo",
    media: null,
    post_id: null,
    story_id: null,
    reply_to_id: null,
    system: false,
    reactions: {},
  }
  socialStore.set((s) => ({
    ...s,
    chats: [
      {
        id: CHAT,
        members: [ANA],
        messages: [
          { id: "m1", by: ME, at: 0, text: "Oops typo", reactions: {} },
        ],
        muted: false,
        pinned: false,
        readAt: 0,
      },
    ],
  }))
  let answer: (v: unknown) => void = () => {}
  const { http } = fakeHttp({
    "GET /social/chats": () =>
      new Promise((resolve) => {
        answer = resolve
      }),
    [`DELETE /social/chats/${CHAT}/messages/m1`]: () => undefined,
  })
  const live = createSocialLive({ http, userId: MEID })
  connectSocial(live)
  const refreshing = live.refresh().catch(() => {})
  await settle()
  unsend(CHAT, "m1")
  answer({
    data: [
      {
        id: CHAT,
        name: null,
        is_group: false,
        members: [
          brief(MEID, "Me", "me"),
          brief(ANA, "Ana Reyes", "ana.lifts"),
        ],
        muted: false,
        pinned: false,
        read_at: null,
        unread: 0,
        last_message: msg,
        last_message_at: msg.at,
      },
    ],
    count: 1,
  })
  await refreshing
  await settle()
  // It stays as a tombstone, with nothing of the message left.
  expect(socialStore.get().chats[0].messages).toEqual([
    expect.objectContaining({ id: "m1", deleted: true, text: undefined }),
  ])
})

const oneChat = () =>
  socialStore.set((s) => ({
    ...s,
    chats: [
      {
        id: CHAT,
        members: [ANA],
        messages: [
          { id: "m1", by: ME, at: 0, text: "Oops typo", reactions: {} },
        ],
        muted: false,
        pinned: false,
        readAt: 0,
      },
    ],
  }))

test("deleting a message leaves a tombstone, and Undo restores it after the delete lands", async () => {
  oneChat()
  let land: (v: unknown) => void = () => {}
  const { http, calls } = fakeHttp({
    [`DELETE /social/chats/${CHAT}/messages/m1`]: () =>
      new Promise((resolve) => {
        land = resolve
      }),
    [`POST /social/chats/${CHAT}/messages/m1/restore`]: () => ({
      id: "m1",
      chat_id: CHAT,
      sender_id: MEID,
      at: "2026-10-19T08:00:00Z",
      text: "Oops typo",
      media: null,
      post_id: null,
      story_id: null,
      reply_to_id: null,
      system: false,
      reactions: {},
      deleted: false,
    }),
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  const restore = unsend(CHAT, "m1")
  expect(socialStore.get().chats[0].messages).toEqual([
    { id: "m1", by: ME, at: 0, reactions: {}, deleted: true },
  ])
  restore()
  // Shown back at once, but the restore waits for the delete to land, or
  // the delete would arrive second and win.
  expect(socialStore.get().chats[0].messages[0].text).toBe("Oops typo")
  await settle()
  expect(calls.map((c) => c.method)).toEqual(["DELETE"])
  land(undefined)
  await settle()
  expect(calls.map((c) => c.method)).toEqual(["DELETE", "POST"])
  const [m] = socialStore.get().chats[0].messages
  expect(m.deleted).toBeFalsy()
  expect(m.text).toBe("Oops typo")
})

test("someone else deleting a message turns it into a tombstone live", () => {
  oneChat()
  const { http } = fakeHttp({})
  const live = createSocialLive({ http, userId: MEID })
  connectSocial(live)
  live.handleEvent({
    type: "chat.message",
    data: { chat_id: CHAT, message_id: "m1", action: "unsent" },
  } as never)
  expect(socialStore.get().chats[0].messages).toEqual([
    { id: "m1", by: ME, at: 0, reactions: {}, deleted: true },
  ])
})

test("a comment deleted elsewhere leaves the open post at once", () => {
  socialStore.set((s) => ({
    ...s,
    posts: [
      {
        id: POST,
        by: ANA,
        at: 0,
        caption: "",
        media: [],
        likes: 0,
        liked: false,
        saved: false,
        likedBy: [],
        comments: [
          { id: "c1", by: ANA, text: "a", at: 1, likes: 0, liked: false },
          {
            id: "c2",
            by: ME,
            text: "b",
            at: 2,
            likes: 0,
            liked: false,
            replyTo: "c1",
          },
          { id: "c3", by: ME, text: "c", at: 3, likes: 0, liked: false },
        ],
      } as never,
    ],
  }))
  const { http } = fakeHttp({})
  const live = createSocialLive({ http, userId: MEID })
  connectSocial(live)
  live.handleEvent({
    type: "social.comment",
    data: { post_id: POST, comment_id: "c1", action: "deleted" },
  } as never)
  expect(socialStore.get().posts[0].comments.map((c) => c.id)).toEqual(["c3"])
})

test("Undo on a comment delete waits for the delete, then restores the thread", async () => {
  socialStore.set((s) => ({
    ...s,
    posts: [
      {
        id: POST,
        by: ANA,
        at: 0,
        caption: "",
        media: [],
        likes: 0,
        liked: false,
        saved: false,
        likedBy: [],
        comments: [
          { id: "c1", by: ME, text: "mine", at: 1, likes: 0, liked: false },
        ],
      } as never,
    ],
  }))
  let land: (v: unknown) => void = () => {}
  const { http, calls } = fakeHttp({
    [`DELETE /social/posts/${POST}/comments/c1`]: () =>
      new Promise((resolve) => {
        land = resolve
      }),
    [`POST /social/posts/${POST}/comments/c1/restore`]: () => ({
      data: [
        {
          id: "c1",
          post_id: POST,
          author: brief(MEID, "Me", "me"),
          text: "mine",
          created_at: "2026-10-19T08:00:00Z",
          likes: 0,
          liked: false,
          reply_to_id: null,
        },
      ],
      count: 1,
    }),
  })
  connectSocial(createSocialLive({ http, userId: MEID }))
  const restore = deleteComment(POST, "c1")
  expect(socialStore.get().posts[0].comments).toEqual([])
  restore()
  expect(socialStore.get().posts[0].comments.map((c) => c.id)).toEqual(["c1"])
  await settle()
  expect(calls.map((c) => c.method)).toEqual(["DELETE"])
  land(undefined)
  await settle()
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
    `DELETE /social/posts/${POST}/comments/c1`,
    `POST /social/posts/${POST}/comments/c1/restore`,
  ])
  expect(socialStore.get().posts[0].comments.map((c) => c.text)).toEqual([
    "mine",
  ])
})
