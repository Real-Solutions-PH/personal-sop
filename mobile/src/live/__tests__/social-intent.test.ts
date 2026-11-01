// Toggles under rapid taps: one write in flight per target, the last tap
// wins, a refusal puts back only that field, and responses or reads that
// land meanwhile never flip the button back or reload photos.

import {
  addComment,
  cheer,
  connectSocial,
  ME,
  type Post,
  reactTo,
  type SocialRemote,
  socialStore,
  toggleCloseFriend,
  toggleCommentLike,
  toggleFollow,
  toggleLike,
  toggleNoteLike,
  toggleSave,
  toggleStoryLike,
} from "@/prototype/social/store"
import { ApiError, type Http } from "../http"
import { createSocialLive, MEDIA_URL_REUSE_MS } from "../social"

jest.mock("../config", () => ({
  ...jest.requireActual("../config"),
  liveMode: true,
}))
jest.mock("../auth", () => ({ http: {} }))
let mockOnline = true
const mockToasts: string[] = []
jest.mock("@domain/lib/platform", () => ({
  ...jest.requireActual("@domain/lib/platform"),
  getConnectivity: () => mockOnline,
  toast: Object.assign((m: string) => void mockToasts.push(m), {
    error: (m: string) => void mockToasts.push(m),
    warning: (m: string) => void mockToasts.push(m),
  }),
}))

const MEID = "11111111-1111-4111-8111-111111111111"
const ANA = "22222222-2222-4222-8222-222222222222"
const POST = "33333333-3333-4333-8333-333333333333"

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** Calls are held until the test answers them, in any order. */
type Held = {
  name: string
  args: unknown[]
  ok: () => Promise<void>
  fail: (e?: unknown) => Promise<void>
}
function holdingRemote() {
  const held: Held[] = []
  const hold =
    (name: string) =>
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        held.push({
          name,
          args,
          ok: async () => {
            resolve(undefined)
            await settle()
          },
          fail: async (e = new ApiError(500, "boom", "boom")) => {
            reject(e)
            await settle()
          },
        })
      })
  const names = [
    "likePost",
    "savePost",
    "likeComment",
    "likeStory",
    "likeNote",
    "follow",
    "closeFriend",
    "react",
    "addComment",
  ]
  const remote = Object.fromEntries(
    names.map((n) => [n, hold(n)]),
  ) as unknown as SocialRemote
  return { remote, held }
}

const basePost = (over: Partial<Post> = {}): Post => ({
  id: POST,
  by: ANA,
  at: 0,
  caption: "",
  media: [],
  likes: 3,
  liked: false,
  saved: false,
  likedBy: [],
  comments: [
    { id: "c1", by: ANA, text: "nice", at: 0, likes: 0, liked: false },
  ],
  ...over,
})
const post = () => socialStore.get().posts[0]

beforeEach(() => {
  mockOnline = true
  mockToasts.length = 0
  socialStore.set((s) => ({
    ...s,
    me: undefined,
    people: [
      {
        id: ANA,
        name: "Ana",
        username: "ana",
        bio: "",
        accent: "fit",
        followers: 10,
        following: 3,
        isFollowing: false,
      },
    ],
    posts: [basePost()],
    stories: [{ id: "s1", by: ANA, at: Date.now(), kind: "text", text: "hi" }],
    notes: [{ id: "n1", by: ANA, text: "hey", at: Date.now() }],
    chats: [
      {
        id: "ch1",
        members: [ANA],
        messages: [{ id: "m1", by: ANA, at: 0, text: "yo", reactions: {} }],
        readAt: 0,
        muted: false,
        pinned: false,
      },
    ],
  }))
})
afterEach(() => connectSocial(null))

describe("the store's latest-intent writer", () => {
  test("a cheer double-tap sends at most two requests and ends uncheered", async () => {
    const { remote, held } = holdingRemote()
    connectSocial(remote)
    toggleLike(POST)
    expect(post()).toMatchObject({ liked: true, likes: 4 })
    toggleLike(POST)
    expect(post()).toMatchObject({ liked: false, likes: 3 })
    expect(held).toHaveLength(1)
    await held[0].ok()
    // The second request carries the last tap.
    expect(held).toHaveLength(2)
    expect(held[1].args).toEqual([POST, false, undefined])
    expect(post()).toMatchObject({ liked: false, likes: 3 })
    await held[1].ok()
    expect(held).toHaveLength(2)
    expect(post()).toMatchObject({ liked: false, likes: 3 })
    expect(mockToasts).toEqual([])
  })

  test("five taps in a burst end on the last one with two requests", async () => {
    const { remote, held } = holdingRemote()
    connectSocial(remote)
    for (let i = 0; i < 5; i++) toggleLike(POST)
    expect(post()).toMatchObject({ liked: true, likes: 4 })
    await held[0].ok()
    await held[1]?.ok()
    // Tap 1 (on) was in flight; taps 2-5 end on "on", which is what tap 1
    // already confirmed, so no second request is needed.
    expect(held).toHaveLength(1)
    expect(held[0].args).toEqual([POST, true, "keep_going"])
    expect(post()).toMatchObject({ liked: true, likes: 4 })
  })

  test("a refused cheer reverts only the cheer and keeps a comment added meanwhile", async () => {
    const { remote, held } = holdingRemote()
    connectSocial(remote)
    cheer(POST, "proud")
    addComment(POST, "great")
    await held[0].fail()
    expect(post()).toMatchObject({ liked: false, likes: 3, myCheer: undefined })
    expect(post().comments.map((c) => c.text)).toEqual(["nice", "great"])
    expect(mockToasts).toEqual(["Couldn't cheer the post. Please try again."])
  })

  test("first write lands, second is refused: back to the first's value", async () => {
    const { remote, held } = holdingRemote()
    connectSocial(remote)
    toggleLike(POST) // on
    toggleLike(POST) // off, waits
    await held[0].ok() // server: on
    await held[1].fail() // off refused
    expect(post()).toMatchObject({ liked: true, likes: 4 })
    expect(mockToasts).toHaveLength(1)
  })

  test("switching cheer kind while an un-cheer is in flight sends the new kind", async () => {
    socialStore.set((s) => ({
      ...s,
      posts: [
        basePost({
          liked: true,
          myCheer: "proud",
          likes: 4,
          cheers: { keep_going: 3, proud: 1, inspired: 0 },
        }),
      ],
    }))
    const { remote, held } = holdingRemote()
    connectSocial(remote)
    cheer(POST, "proud") // take back
    cheer(POST, "inspired")
    expect(post()).toMatchObject({ myCheer: "inspired", likes: 4 })
    await held[0].ok()
    expect(held[1].args).toEqual([POST, true, "inspired"])
  })

  test("offline reverts at once with the offline toast and sends nothing", () => {
    const { remote, held } = holdingRemote()
    connectSocial(remote)
    mockOnline = false
    toggleSave(POST)
    expect(post().saved).toBe(false)
    expect(held).toEqual([])
    expect(mockToasts).toEqual(["You're offline. Couldn't save the post."])
  })

  test("a 404 (the post is gone) drops the write quietly", async () => {
    const { remote, held } = holdingRemote()
    connectSocial(remote)
    toggleLike(POST)
    await held[0].fail(new ApiError(404, "not_found", "gone"))
    expect(mockToasts).toEqual([])
  })

  const toggles: [
    string,
    () => void,
    string,
    () => unknown,
    unknown,
    unknown,
  ][] = [
    [
      "save",
      () => toggleSave(POST),
      "savePost",
      () => post().saved,
      true,
      false,
    ],
    [
      "follow",
      () => toggleFollow(ANA),
      "follow",
      () => socialStore.get().people[0].isFollowing,
      true,
      false,
    ],
    [
      "close friend",
      () => toggleCloseFriend(ANA),
      "closeFriend",
      () => !!socialStore.get().people[0].closeFriend,
      true,
      false,
    ],
    [
      "comment like",
      () => toggleCommentLike(POST, "c1"),
      "likeComment",
      () => post().comments[0].liked,
      true,
      false,
    ],
    [
      "story like",
      () => toggleStoryLike("s1"),
      "likeStory",
      () => !!socialStore.get().stories[0].liked,
      true,
      false,
    ],
    [
      "note like",
      () => toggleNoteLike(ANA),
      "likeNote",
      () => !!socialStore.get().notes[0].liked,
      true,
      false,
    ],
    [
      "message reaction",
      () => reactTo("ch1", "m1", "🔥"),
      "react",
      () => socialStore.get().chats[0].messages[0].reactions[ME] ?? null,
      "🔥",
      null,
    ],
  ]
  test.each(
    toggles,
  )("%s: a double tap ends on the last tap with two requests", async (_, tap, name, read, on, off) => {
    const { remote, held } = holdingRemote()
    connectSocial(remote)
    tap()
    expect(read()).toEqual(on)
    tap()
    expect(read()).toEqual(off)
    expect(held.map((h) => h.name)).toEqual([name])
    await held[0].ok()
    expect(held).toHaveLength(2)
    expect(held[1].args.at(-1)).toEqual(off)
    await held[1].ok()
    expect(held).toHaveLength(2)
    expect(read()).toEqual(off)
    expect(mockToasts).toEqual([])
  })
})

// ------------------------------------------------------------ live layer

type Call = { method: string; path: string }
function deferredHttp(answer: (c: Call) => unknown) {
  const calls: (Call & { release: () => Promise<void> })[] = []
  const http: Http = {
    request<T>(method: string, path: string) {
      return new Promise<T>((resolve) => {
        const call = { method, path }
        calls.push({
          ...call,
          release: async () => {
            resolve(answer(call) as T)
            await settle()
          },
        })
      })
    },
    raw: () => Promise.reject(new Error("unused")),
  }
  return { http, calls }
}
const brief = (id: string, name: string) => ({
  id,
  name,
  handle: name.toLowerCase(),
  accent: "fit",
  photo_media_id: null,
  verified: false,
})
const wirePost = (over: Record<string, unknown> = {}) => ({
  id: POST,
  author: brief(ANA, "Ana"),
  created_at: "2026-10-19T08:00:00Z",
  caption: "Squat PR",
  media: [{ media_id: "m1", kind: "image", ratio: 1, url: "https://cdn/new" }],
  progress: null,
  location: null,
  tags: [],
  likes: 3,
  liked: false,
  saved: false,
  comments: 1,
  liked_by: [],
  ...over,
})
const photoPost = (urlAt = Date.now()) =>
  basePost({
    caption: "Squat PR",
    media: [{ id: "m1", kind: "image", uri: "https://cdn/old", urlAt }],
  })

describe("live responses and reads", () => {
  test("a like response moves the counts only and keeps the photo uri", async () => {
    socialStore.set((s) => ({ ...s, posts: [photoPost()] }))
    const { http, calls } = deferredHttp(() =>
      wirePost({
        likes: 9,
        liked: true,
        my_cheer: "keep_going",
        cheers: { keep_going: 9, proud: 0, inspired: 0 },
        caption: "edited elsewhere",
      }),
    )
    connectSocial(createSocialLive({ http, userId: MEID }))
    toggleLike(POST)
    await calls[0].release()
    expect(post()).toMatchObject({ likes: 9, liked: true, caption: "Squat PR" })
    expect(post().media[0].uri).toBe("https://cdn/old")
    expect(post().comments).toHaveLength(1)
  })

  test("a response that lands while a newer tap is pending does not flip it back", async () => {
    socialStore.set((s) => ({ ...s, posts: [photoPost()] }))
    const { http, calls } = deferredHttp((c) =>
      c.method === "PUT"
        ? wirePost({ likes: 4, liked: true, my_cheer: "keep_going" })
        : wirePost({ likes: 3, liked: false }),
    )
    connectSocial(createSocialLive({ http, userId: MEID }))
    toggleLike(POST)
    toggleLike(POST)
    await calls[0].release()
    // The PUT's answer says "liked"; the newer un-cheer is still pending.
    expect(post()).toMatchObject({ liked: false, likes: 3 })
    expect(calls.map((c) => c.method)).toEqual(["PUT", "DELETE"])
    await calls[1].release()
    expect(post()).toMatchObject({ liked: false, likes: 3 })
  })

  test("a feed read that lands while a cheer is pending keeps the cheer", async () => {
    socialStore.set((s) => ({ ...s, posts: [photoPost()] }))
    const { http, calls } = deferredHttp((c) =>
      c.path.startsWith("/social/posts/") && c.method === "GET"
        ? wirePost()
        : wirePost({ likes: 4, liked: true, my_cheer: "keep_going" }),
    )
    const live = createSocialLive({ http, userId: MEID })
    connectSocial(live)
    toggleLike(POST)
    void live.openPost(POST).catch(() => {})
    // The post read (index 1) lands first, still unliked on the server.
    await calls[1].release()
    expect(post()).toMatchObject({ liked: true, likes: 4 })
  })

  test("mapMedia keeps the shown uri for 10 minutes, then adopts the new one", async () => {
    let clock = 1_000_000
    socialStore.set((s) => ({ ...s, posts: [photoPost(clock)] }))
    const { http, calls } = deferredHttp(() => wirePost())
    const live = createSocialLive({ http, userId: MEID, now: () => clock })
    connectSocial(live)
    void live.loadPost(POST)
    await calls[0].release()
    expect(post().media[0].uri).toBe("https://cdn/old")
    clock += MEDIA_URL_REUSE_MS + 1
    void live.loadPost(POST)
    await calls[1].release()
    expect(post().media[0]).toMatchObject({
      uri: "https://cdn/new",
      urlAt: clock,
    })
  })

  test("a follow response is not applied over a newer pending unfollow", async () => {
    const person = (on: boolean) => ({
      ...brief(ANA, "Ana"),
      bio: "",
      followers: on ? 11 : 10,
      following: 3,
      is_following: on,
      close_friend: false,
    })
    const { http, calls } = deferredHttp((c) => person(c.method === "PUT"))
    connectSocial(createSocialLive({ http, userId: MEID }))
    toggleFollow(ANA)
    toggleFollow(ANA)
    await calls[0].release()
    expect(socialStore.get().people[0]).toMatchObject({
      isFollowing: false,
      followers: 10,
    })
    await calls.find((c) => c.method === "DELETE")?.release()
    expect(socialStore.get().people[0]).toMatchObject({
      isFollowing: false,
      followers: 10,
    })
  })
})
