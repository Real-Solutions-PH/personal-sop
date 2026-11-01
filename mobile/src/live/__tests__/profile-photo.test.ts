// The profile photo reaches the server: upload, then PATCH /profile with the
// media id; offline or a failed PATCH keeps it pending for the next connect.

import { dashStore, setProfilePhoto } from "@domain/dash/store"
import { socialStore } from "@/prototype/social/store"
import { ApiError, type Http, NetworkError } from "../http"
import {
  PHOTO_FAILED,
  PHOTO_OFFLINE,
  retryProfilePhoto,
  syncProfilePhoto,
} from "../profile-photo"

jest.mock("../auth", () => ({ http: {} }))
let mockOnline = true
const mockToasts: string[] = []
jest.mock("@domain/lib/platform", () => {
  const actual = jest.requireActual("@domain/lib/platform")
  const say = (m: string) => void mockToasts.push(m)
  return {
    ...actual,
    getConnectivity: () => mockOnline,
    toast: Object.assign(say, { success: say, error: say, warning: say }),
  }
})

const FILE = "file:///avatar/1.jpg"
type Call = { method: string; path: string; body?: unknown }

function fakes(opts: { patch?: () => unknown; complete?: () => unknown } = {}) {
  const calls: Call[] = []
  let n = 0
  const http: Http = {
    async request<T>(method: string, path: string, body?: unknown) {
      calls.push({ method, path, body })
      if (path === "/media/uploads") {
        n += 1
        return {
          id: `media-${n}`,
          upload_url: "https://store/put",
          headers: {},
        } as T
      }
      if (path.endsWith("/complete"))
        return (opts.complete?.() ?? {
          id: `media-${n}`,
          kind: "image",
          mime: "image/jpeg",
          state: "ready",
        }) as T
      if (path === "/profile") return (opts.patch?.() ?? {}) as T
      throw new Error(`unexpected ${method} ${path}`)
    },
    raw: () => Promise.reject(new Error("unused")),
  }
  const fetch = jest.fn(
    async (url: string) =>
      ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: { get: () => "image/jpeg" },
        url,
      }) as unknown as Response,
  )
  const keep = jest.fn(async () => FILE)
  return { calls, deps: { http, fetch, keep } }
}
const patches = (calls: Call[]) =>
  calls.filter((c) => c.method === "PATCH").map((c) => c.body)
const pending = () => dashStore.get().profilePhotoPending

beforeEach(() => {
  mockOnline = true
  mockToasts.length = 0
  dashStore.set((s) => ({
    ...s,
    profile: { ...s.profile, photo: undefined },
    profilePhotoPending: undefined,
  }))
  socialStore.set((s) => ({ ...s, me: undefined }))
})

test("a new photo is uploaded, then PATCHed with its media id", async () => {
  const { calls, deps } = fakes()
  setProfilePhoto(FILE)
  expect(await syncProfilePhoto(FILE, { deps })).toBe("ok")
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
    "POST /media/uploads",
    "POST /media/media-1/complete",
    "PATCH /profile",
  ])
  expect(patches(calls)).toEqual([{ photo_media_id: "media-1" }])
  expect(pending()).toBeUndefined()
  // The photo itself changes: no success toast.
  expect(mockToasts).toEqual([])
})

test("removing the photo sends null", async () => {
  socialStore.set((s) => ({
    ...s,
    me: { bio: "", followers: 0, following: 0, photo: "https://cdn/me" },
  }))
  const { calls, deps } = fakes()
  expect(await syncProfilePhoto(undefined, { deps })).toBe("ok")
  expect(patches(calls)).toEqual([{ photo_media_id: null }])
  expect(socialStore.get().me?.photo).toBeUndefined()
  expect(mockToasts).toEqual([])
})

test("a failed PATCH keeps the local photo and the uploaded id pending", async () => {
  const { calls, deps } = fakes({
    patch: () => {
      throw new ApiError(500, "boom", "boom")
    },
  })
  setProfilePhoto(FILE)
  expect(await syncProfilePhoto(FILE, { previous: "old", deps })).toBe(
    "pending",
  )
  expect(dashStore.get().profile.photo).toBe(FILE)
  expect(pending()).toEqual({ uri: FILE, mediaId: "media-1" })
  expect(mockToasts).toEqual([PHOTO_FAILED])
  expect(calls.filter((c) => c.path === "/media/uploads")).toHaveLength(1)
})

test("a refused upload puts the previous photo back", async () => {
  const { deps } = fakes({
    complete: () => ({ id: "media-1", state: "rejected" }),
  })
  setProfilePhoto(FILE)
  expect(await syncProfilePhoto(FILE, { previous: "old.jpg", deps })).toBe(
    "failed",
  )
  expect(dashStore.get().profile.photo).toBe("old.jpg")
  expect(pending()).toBeUndefined()
  expect(mockToasts).toEqual([PHOTO_FAILED])
})

test("offline keeps it pending and sends nothing", async () => {
  mockOnline = false
  const { calls, deps } = fakes()
  setProfilePhoto(FILE)
  expect(await syncProfilePhoto(FILE, { deps })).toBe("pending")
  expect(calls).toEqual([])
  expect(pending()).toEqual({ uri: FILE, mediaId: undefined })
  expect(mockToasts).toEqual([PHOTO_OFFLINE])
})

test("a network failure mid-upload is kept for later, like offline", async () => {
  const { deps } = fakes()
  deps.fetch.mockImplementation(async () => {
    throw new NetworkError("down")
  })
  setProfilePhoto(FILE)
  // Reading a local file failing is not a network failure; the PUT is.
  deps.fetch
    .mockImplementationOnce(
      async () =>
        ({
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1]).buffer,
          headers: { get: () => "image/jpeg" },
        }) as unknown as Response,
    )
    .mockImplementationOnce(async () => {
      throw new Error("socket closed")
    })
  expect(await syncProfilePhoto(FILE, { deps })).toBe("pending")
  expect(mockToasts).toEqual([PHOTO_OFFLINE])
})

test("the retry on connect reuses the media id already uploaded", async () => {
  dashStore.set((s) => ({
    ...s,
    profile: { ...s.profile, photo: FILE },
    profilePhotoPending: { uri: FILE, mediaId: "media-9" },
  }))
  const { calls, deps } = fakes()
  expect(await retryProfilePhoto(deps)).toBe("ok")
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["PATCH /profile"])
  expect(patches(calls)).toEqual([{ photo_media_id: "media-9" }])
  // Success says nothing.
  expect(mockToasts).toEqual([])
})

test("a photo still held as inline data is uploaded once and kept as a file", async () => {
  const data = "data:image/jpeg;base64,AQID"
  setProfilePhoto(data)
  const { calls, deps } = fakes()
  expect(await retryProfilePhoto(deps)).toBe("ok")
  expect(dashStore.get().profile.photo).toBe(FILE)
  expect(deps.keep).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
  expect(retryProfilePhoto(deps)).toBeUndefined()
  expect(calls.filter((c) => c.path === "/media/uploads")).toHaveLength(1)
})

test("a newer change wins over an older one still uploading", async () => {
  const { calls, deps } = fakes()
  const first = syncProfilePhoto("file:///a.jpg", { deps })
  const second = syncProfilePhoto("file:///b.jpg", { deps })
  expect(await first).toBe("stale")
  expect(await second).toBe("ok")
  expect(patches(calls)).toEqual([{ photo_media_id: "media-2" }])
})
