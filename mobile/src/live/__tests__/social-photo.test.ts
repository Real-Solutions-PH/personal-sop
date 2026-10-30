// My photo as the server has it reaches this device (set on another one),
// and a person whose photo the server withholds shows initials.

import { dashStore } from "@domain/dash/store"
import { renderHook } from "@testing-library/react-native"
import { connectSocial, socialStore, useMe } from "@/prototype/social/store"
import type { Http } from "../http"
import { createSocialLive } from "../social"

jest.mock("../config", () => ({
  ...jest.requireActual("../config"),
  liveMode: true,
}))
jest.mock("../auth", () => ({ http: {} }))

const MEID = "11111111-1111-4111-8111-111111111111"
const ANA = "22222222-2222-4222-8222-222222222222"
const person = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: "Ana",
  handle: "ana",
  accent: "fit",
  photo_media_id: "m1",
  photo_url: "https://cdn/ana.jpg",
  verified: false,
  bio: "",
  followers: 1,
  following: 1,
  is_me: id === MEID,
  is_following: false,
  close_friend: false,
  scores_visible: true,
  ...over,
})
function http(routes: Record<string, () => unknown>): Http {
  return {
    async request<T>(method: string, path: string) {
      const r = routes[`${method} ${path.split("?")[0]}`]
      if (!r) throw new Error(`unexpected ${method} ${path}`)
      return r() as T
    },
    raw: () => Promise.reject(new Error("unused")),
  }
}

beforeEach(() => {
  dashStore.set((s) => ({ ...s, profile: { ...s.profile, photo: undefined } }))
  socialStore.set((s) => ({ ...s, me: undefined, people: [] }))
})
afterEach(() => connectSocial(null))

test("me() maps my photo_url and useMe shows it when this device has none", async () => {
  const live = createSocialLive({
    http: http({
      "GET /social/me": () =>
        person(MEID, { photo_media_id: "m9", photo_url: "https://cdn/me.jpg" }),
    }),
    userId: MEID,
  })
  await live.refresh().catch(() => {})
  expect(socialStore.get().me?.photo).toBe("https://cdn/me.jpg")
  const { result } = renderHook(() => useMe())
  expect(result.current.photo).toBe("https://cdn/me.jpg")
  // This device's own photo wins.
  dashStore.set((s) => ({
    ...s,
    profile: { ...s.profile, photo: "file:///mine.jpg" },
  }))
  const again = renderHook(() => useMe())
  expect(again.result.current.photo).toBe("file:///mine.jpg")
})

test("a photo the server withholds (null URL) drops the one shown before", async () => {
  socialStore.set((s) => ({
    ...s,
    people: [
      {
        id: ANA,
        name: "Ana",
        username: "ana",
        bio: "",
        accent: "fit",
        followers: 1,
        following: 1,
        isFollowing: false,
        photo: "https://cdn/old.jpg",
      },
    ],
  }))
  const live = createSocialLive({
    http: http({
      [`GET /social/people/${ANA}`]: () => person(ANA, { photo_url: null }),
      [`GET /social/people/${ANA}/followers`]: () => ({ data: [] }),
      [`GET /social/people/${ANA}/following`]: () => ({ data: [] }),
    }),
    userId: MEID,
  })
  await live.openPerson(ANA).catch(() => {})
  expect(socialStore.get().people[0].photo).toBeUndefined()
})
