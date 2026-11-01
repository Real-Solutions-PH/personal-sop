// My check-in survives a tray read that lands while it uploads, plays from
// the local file, and a story with a dead link is re-read once.

import {
  addStory,
  connectSocial,
  loadStoriesIfStale,
  ME,
  refreshStory,
  socialStore,
} from "@/prototype/social/store"
import { ApiError, type Http } from "../http"
import { createSocialLive, type SocialDeps } from "../social"

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
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
const wireStory = (id: string, owner: string, url: string | null) => ({
  id,
  owner_id: owner,
  created_at: "2026-10-30T08:00:00Z",
  expires_at: "2026-10-31T08:00:00Z",
  kind: "image",
  media: url ? { media_id: `m-${id}`, kind: "image", ratio: null, url } : null,
  text: null,
  bg: null,
  progress: null,
  audience: "everyone",
  seen: false,
  liked: false,
  likes: null,
})
function live(
  routes: Record<string, () => unknown>,
  extra: Partial<SocialDeps> = {},
) {
  const held: Record<string, (v: unknown) => void> = {}
  const http: Http = {
    request<T>(method: string, path: string) {
      const key = `${method} ${path}`
      const r = routes[key]
      if (r === undefined) throw new ApiError(404, "not_found", key)
      const v = r()
      if (v === "hold")
        return new Promise<T>((resolve) => {
          held[key] = resolve as (v: unknown) => void
        })
      if (v instanceof Error) return Promise.reject(v)
      return Promise.resolve(v as T)
    },
    raw: () => Promise.reject(new Error("unused")),
  }
  const l = createSocialLive({ http, userId: MEID, ...extra })
  connectSocial(l)
  return { l, held }
}

beforeEach(() => {
  socialStore.set((s) => ({ ...s, stories: [], seen: [], people: [] }))
})
afterEach(() => connectSocial(null))

test("a tray read that lands mid-upload keeps my story, and the POST maps it", async () => {
  let uploaded: (id: string) => void = () => {}
  const upload = () => new Promise<string>((r) => (uploaded = r))
  const { l, held } = live(
    {
      "GET /social/stories": () => ({ data: [] }),
      "POST /social/stories": () => "hold",
    },
    { upload, fileExists: () => true },
  )
  const story = addStory({ kind: "image", uri: "file:///docs/s.jpg" })
  await settle()
  // The tray read starts and lands while the photo is still uploading.
  await l.loadStories()
  expect(socialStore.get().stories.map((x) => x.id)).toEqual([story.id])
  uploaded("m1")
  await settle()
  held["POST /social/stories"](wireStory(story.id, MEID, "https://cdn/s.jpg"))
  await settle()
  const mine = socialStore.get().stories.find((x) => x.id === story.id)
  expect(mine).toMatchObject({
    by: ME,
    uri: "file:///docs/s.jpg",
    remoteUri: "https://cdn/s.jpg",
  })
  expect(socialStore.get().seen).toContain(story.id)
})

test("createStory puts the story back when a read removed it", async () => {
  const { l } = live(
    {
      "POST /social/stories": () => wireStory("s9", MEID, "https://cdn/9.jpg"),
    },
    { upload: async () => "m9", fileExists: () => false },
  )
  await l.createStory({
    id: "s9",
    by: ME,
    at: Date.now(),
    kind: "image",
    uri: "file:///x.jpg",
  })
  const s = socialStore.get().stories.find((x) => x.id === "s9")
  // The local file is gone: the server's URL is used.
  expect(s?.uri).toBe("https://cdn/9.jpg")
  expect(s?.remoteUri).toBeUndefined()
})

test("refreshStory takes a fresh link; a deleted story is removed", async () => {
  socialStore.set((s) => ({
    ...s,
    stories: [
      {
        id: "a",
        by: ANA,
        at: Date.now(),
        kind: "image",
        uri: "https://cdn/old",
      },
      { id: "b", by: ANA, at: Date.now(), kind: "image", uri: "https://cdn/b" },
    ],
  }))
  live({
    "GET /social/stories/a": () => wireStory("a", ANA, "https://cdn/new"),
    "GET /social/stories/b": () => new ApiError(404, "not_found", "gone"),
  })
  expect(await refreshStory("a")).toBe("ok")
  expect(socialStore.get().stories.find((x) => x.id === "a")?.uri).toBe(
    "https://cdn/new",
  )
  expect(await refreshStory("b")).toBe("gone")
  expect(socialStore.get().stories.map((x) => x.id)).toEqual(["a"])
})

test("the tray reloads on feed focus at most once every 30 s", async () => {
  let reads = 0
  live({
    "GET /social/stories": () => {
      reads += 1
      return { data: [] }
    },
  })
  const t0 = Date.now()
  const clock = jest.spyOn(Date, "now")
  clock.mockReturnValue(t0 + 60_000)
  await loadStoriesIfStale()
  await loadStoriesIfStale()
  expect(reads).toBe(1)
  clock.mockReturnValue(t0 + 95_000)
  await loadStoriesIfStale()
  expect(reads).toBe(2)
  clock.mockRestore()
})

test("a post read keeps the preview and placeholder it already has for the same photo", async () => {
  const POST = "33333333-3333-4333-8333-333333333333"
  const post = (media: Record<string, unknown>) => ({
    id: POST,
    author: {
      id: ANA,
      name: "Ana",
      handle: "ana",
      accent: "fit",
      photo_media_id: null,
      verified: false,
    },
    created_at: "2026-10-30T08:00:00Z",
    caption: "",
    media: [
      {
        media_id: "m1",
        kind: "image",
        ratio: 1,
        url: "https://cdn/f",
        ...media,
      },
    ],
    progress: null,
    location: null,
    tags: [],
    likes: 0,
    liked: false,
    saved: false,
    comments: 0,
    liked_by: [],
  })
  let next: unknown = post({
    preview_url: "https://cdn/p",
    lqip: "data:image/jpeg;base64,AA",
    width: 2048,
    height: 1536,
  })
  const { l } = live({ [`GET /social/posts/${POST}`]: () => next })
  socialStore.set((s) => ({ ...s, posts: [] }))
  await l.loadPost(POST)
  next = post({})
  await l.loadPost(POST)
  expect(socialStore.get().posts[0].media[0]).toMatchObject({
    previewUri: "https://cdn/p",
    lqip: "data:image/jpeg;base64,AA",
    width: 2048,
    height: 1536,
  })
})
