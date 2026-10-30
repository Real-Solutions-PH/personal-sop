// A photo with renditions uploads its preview first, then the full image
// naming it; videos and older photos upload as before.

import type { Fetch, Http } from "../http"
import { createUploader } from "../social-media"

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const LQIP = "data:image/jpeg;base64,/9j/4AAQ"

function setup() {
  const tickets: Record<string, unknown>[] = []
  const read: string[] = []
  let n = 0
  const http: Http = {
    async request<T>(method: string, path: string, body?: unknown) {
      if (path === "/media/uploads") {
        tickets.push(body as Record<string, unknown>)
        n += 1
        return {
          id: `m${n}`,
          upload_url: `https://s3.test/m${n}`,
          headers: {},
        } as T
      }
      if (path.endsWith("/complete"))
        return {
          id: path.split("/")[2],
          kind: "image",
          mime: "image/jpeg",
          state: "ready",
        } as T
      throw new Error(`unexpected ${method} ${path}`)
    },
    raw: () => Promise.reject(new Error("unused")),
  }
  const fetchImpl: Fetch = async (url, init) => {
    if (init.method === "PUT") return new Response(null, { status: 200 })
    read.push(url)
    return new Response(JPEG, { status: 200 })
  }
  return { upload: createUploader(http, fetchImpl), tickets, read }
}

test("the preview goes first, then the full image with its preview, placeholder and size", async () => {
  const { upload, tickets, read } = setup()
  const id = await upload("file:///a/full.jpg", "image", {
    previewUri: "file:///a/preview.jpg",
    lqip: LQIP,
    width: 2048,
    height: 1536,
  })
  expect(id).toBe("m2")
  expect(read).toEqual(["file:///a/preview.jpg", "file:///a/full.jpg"])
  expect(tickets[0]).toMatchObject({ kind: "image", mime: "image/jpeg" })
  expect(tickets[0]).not.toHaveProperty("preview_id")
  expect(tickets[1]).toMatchObject({
    kind: "image",
    preview_id: "m1",
    lqip: LQIP,
    width: 2048,
    height: 1536,
  })
})

test("a share card's PNG is uploaded as a PNG", async () => {
  const { upload, tickets } = setup()
  await upload("file:///a/card.png", "image", {
    previewUri: "file:///a/p.jpg",
    mime: "image/png",
  })
  expect(tickets[1]).toMatchObject({ mime: "image/png", preview_id: "m1" })
})

test("a video and a photo without renditions upload once, unchanged", async () => {
  const { upload, tickets } = setup()
  await upload("file:///a/clip.mp4", "video", {
    previewUri: "file:///x.jpg",
    lqip: LQIP,
  })
  await upload("file:///a/old.jpg", "image")
  expect(tickets).toHaveLength(2)
  for (const t of tickets) {
    expect(t).not.toHaveProperty("preview_id")
    expect(t).not.toHaveProperty("lqip")
  }
})

test("the same photo shared twice at once uploads once", async () => {
  const { upload, tickets } = setup()
  const extra = { previewUri: "file:///a/p.jpg", lqip: LQIP }
  const [a, b] = await Promise.all([
    upload("file:///a/f.jpg", "image", extra),
    upload("file:///a/f.jpg", "image", extra),
  ])
  expect(a).toBe(b)
  expect(tickets).toHaveLength(2)
})
