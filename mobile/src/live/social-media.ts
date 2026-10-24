// Social's media upload: the media module's three steps (ticket, PUT to the
// presigned URL, complete) through ``uploadMedia``, the uploader the other
// modules already ship on phones. It PUTs the file's bytes and fails on a
// "rejected" verdict; the Blob PUT this file used to make never landed in
// storage from a phone, so every post photo and story upload stayed pending.

import type { Fetch, Http } from "./http"
import { uploadMedia } from "./media"

export type UploadKind = "image" | "video"

export type Uploader = (uri: string, kind: UploadKind) => Promise<string>

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  gif: "image/gif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
}

/** The type to declare for a local file. iOS gives a file URL no content
 * type, and the server refuses an upload without an allowed one; it then
 * checks the bytes itself, so the extension only has to be plausible. */
export function mimeFor(uri: string, kind: UploadKind): string {
  const data = /^data:([^;,]+)/.exec(uri)
  if (data) return data[1]
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(uri)?.[1]?.toLowerCase()
  const mime = ext ? MIME_BY_EXT[ext] : undefined
  if (mime?.startsWith(kind)) return mime
  return kind === "video" ? "video/mp4" : "image/jpeg"
}

/** Upload one local file and return its server media id. The same file
 * shared twice at once (a post and its story) uploads once. */
export function createUploader(http: Http, fetchImpl: Fetch = fetch): Uploader {
  const inFlight = new Map<string, Promise<string>>()
  return (uri, kind) => {
    const key = `${kind}:${uri}`
    const running = inFlight.get(key)
    if (running) return running
    const job = uploadMedia(
      { kind, uri, mime: mimeFor(uri, kind) },
      { http, fetch: fetchImpl },
    ).then((m) => m.id)
    inFlight.set(key, job)
    // Settled either way: a later share of the same file starts fresh.
    void job.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key),
    )
    return job
  }
}
