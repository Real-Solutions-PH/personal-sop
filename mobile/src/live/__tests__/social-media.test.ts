// The community uploader: what it PUTs, and what it does with the verdict.

import type { Fetch, Http } from "../http"
import { MediaRejected } from "../media"
import { createUploader } from "../social-media"

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

function setup(verdict: "ready" | "rejected" = "ready") {
  const puts: { url: string; body: unknown; headers: unknown }[] = []
  const tickets: unknown[] = []
  let n = 0
  const http: Http = {
    async request<T>(method: string, path: string, body?: unknown) {
      if (method === "POST" && path === "/media/uploads") {
        tickets.push(body)
        n += 1
        return {
          id: `m${n}`,
          upload_url: `https://s3.test/u/m${n}`,
          expires_in: 900,
          headers: { "Content-Type": "image/jpeg" },
        } as T
      }
      if (method === "POST" && path.endsWith("/complete"))
        return {
          id: path.split("/")[2],
          kind: "image",
          mime: "image/jpeg",
          state: verdict,
        } as T
      throw new Error(`unexpected ${method} ${path}`)
    },
    raw: () => Promise.reject(new Error("unused")),
  }
  const fetchImpl: Fetch = async (url, init) => {
    if (init.method === "PUT") {
      puts.push({ url, body: init.body, headers: init.headers })
      return new Response(null, { status: 200 })
    }
    // Reading a local photo: iOS gives no content type for a file URL.
    return new Response(JPEG, { status: 200 })
  }
  return { upload: createUploader(http, fetchImpl), puts, tickets }
}

test("a photo is uploaded as its bytes, with a type the server accepts", async () => {
  // A Blob read from a file URL never landed in storage from a phone: every
  // community upload stayed "pending" and no story was ever created.
  const { upload, puts, tickets } = setup()
  expect(await upload("file:///docs/social/123.jpg", "image")).toBe("m1")
  expect(puts).toHaveLength(1)
  expect(puts[0].body).toBeInstanceOf(Uint8Array)
  expect((puts[0].body as Uint8Array).byteLength).toBe(JPEG.byteLength)
  expect(tickets[0]).toMatchObject({
    kind: "image",
    mime: "image/jpeg",
    size_bytes: JPEG.byteLength,
  })
})

test("a file the server rejects fails the share instead of passing a dead id", async () => {
  const { upload } = setup("rejected")
  await expect(upload("file:///docs/social/1.jpg", "image")).rejects.toThrow(
    MediaRejected,
  )
})

test("the same photo shared to a post and a story uploads once", async () => {
  const { upload, puts } = setup()
  const [a, b] = await Promise.all([
    upload("file:///docs/social/9.jpg", "image"),
    upload("file:///docs/social/9.jpg", "image"),
  ])
  expect(a).toBe(b)
  expect(puts).toHaveLength(1)
})

test("a video declares a video type from its extension", async () => {
  const { upload, tickets } = setup()
  await upload("file:///docs/social/clip.mov", "video")
  await upload("file:///docs/social/clip.mp4", "video")
  expect(tickets.map((t) => (t as { mime: string }).mime)).toEqual([
    "video/quicktime",
    "video/mp4",
  ])
})

test("a file that cannot be read (an expired photo link) asks for no ticket", async () => {
  const tickets: unknown[] = []
  const http: Http = {
    async request<T>(_m: string, _p: string, body?: unknown) {
      tickets.push(body)
      return {} as T
    },
    raw: () => Promise.reject(new Error("unused")),
  }
  const fetchImpl: Fetch = async () =>
    new Response("<Error>AccessDenied</Error>", { status: 403 })
  const upload = createUploader(http, fetchImpl)
  await expect(
    upload("https://s3.test/u/x?X-Amz-Expires=900", "image"),
  ).rejects.toThrow()
  expect(tickets).toEqual([])
})
