// Media uploads for live mode (photos, recordings, statement files).
//
// Three steps, the media module's contract:
//   1. POST /media/uploads   -> a ticket: the media id and a presigned URL
//   2. PUT <upload_url>      -> the bytes, straight to object storage (no
//                               bearer token: the URL carries its own grant)
//   3. POST /media/{id}/complete -> the server sniffs the bytes and answers
//                               "ready" or "rejected"
// The caller then sends whatever references the media (a capture's
// ``media_id``). A network failure is a NetworkError so callers can keep the
// item queued and retry; a refusal is an ApiError or MediaRejected.

import { ApiError, type Fetch, type Http, NetworkError, timed } from "./http"

/** How long one upload may take, by its size. A phone on a weak mobile
 * network moves a 600 KB photo in well over the 15 s other requests get
 * (one of four photos sent together finished after 38 s), so the limit
 * allows 30 s plus 16 KB/s, up to 5 minutes. */
export function uploadTimeoutMs(bytes: number): number {
  return Math.min(30_000 + Math.ceil(bytes / 16), 300_000)
}

export type MediaKind = "image" | "video" | "audio" | "file"

export interface UploadInput {
  kind: MediaKind
  /** The bytes, a ``data:`` URI, or a local file URI (``file://``). */
  bytes?: Uint8Array
  uri?: string
  mime?: string
  /** Client-minted id: a retried upload reuses the same media row, and one
   * an earlier try already finished is used as it is. */
  id?: string
  width?: number
  height?: number
  durationSec?: number
  /** A photo's preview rendition (already uploaded) and inline placeholder. */
  previewId?: string
  lqip?: string
}

export interface UploadedMedia {
  id: string
  kind: MediaKind
  mime: string
  state: "ready"
  url: string | null
}

export class MediaRejected extends Error {
  constructor(readonly id: string) {
    super("The server rejected that file")
  }
}

interface Ticket {
  id: string
  upload_url: string
  headers: Record<string, string>
}

interface MediaRow {
  id: string
  kind: MediaKind
  mime: string
  state: "pending" | "ready" | "rejected"
  url?: string | null
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** Standard base64 -> bytes (no dependency on ``atob``). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "")
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let n = 0
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i])
    const b = B64.indexOf(clean[i + 1])
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1
    out[n++] = (a << 2) | (b >> 4)
    if (c >= 0) out[n++] = ((b & 15) << 4) | (c >> 2)
    if (d >= 0) out[n++] = ((c & 3) << 6) | d
  }
  return out.slice(0, n)
}

/** ``data:<mime>;base64,<data>`` -> its mime type and bytes. */
export function dataUriToBytes(uri: string): {
  mime: string
  bytes: Uint8Array
} {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(uri)
  if (!m) throw new Error("Not a data URI")
  const bytes = m[2]
    ? base64ToBytes(m[3])
    : new TextEncoder().encode(decodeURIComponent(m[3]))
  return { mime: m[1], bytes }
}

async function read(
  input: UploadInput,
  fetchImpl: Fetch,
): Promise<{ mime: string; bytes: Uint8Array }> {
  if (input.bytes)
    return {
      mime: input.mime ?? "application/octet-stream",
      bytes: input.bytes,
    }
  if (!input.uri) throw new Error("Nothing to upload")
  if (input.uri.startsWith("data:")) {
    const d = dataUriToBytes(input.uri)
    return { mime: input.mime ?? d.mime, bytes: d.bytes }
  }
  let res: Response
  try {
    res = await fetchImpl(input.uri, {})
  } catch (error) {
    throw new Error(`Could not read the file: ${String(error)}`)
  }
  // An expired presigned link answers 403 with an XML body: never upload
  // that as the photo.
  if (res.ok === false)
    throw new Error(`Could not read the file (${res.status})`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return {
    mime: input.mime ?? res.headers?.get?.("content-type") ?? "",
    bytes,
  }
}

/** Upload one file and wait for the server's verdict. */
export async function uploadMedia(
  input: UploadInput,
  deps: { http: Http; fetch: Fetch },
): Promise<UploadedMedia> {
  const { mime, bytes } = await read(input, deps.fetch)
  let ticket: Ticket
  try {
    ticket = await deps.http.request<Ticket>("POST", "/media/uploads", {
      ...(input.id ? { id: input.id } : {}),
      kind: input.kind,
      mime,
      size_bytes: bytes.byteLength,
      ...(input.width ? { width: Math.round(input.width) } : {}),
      ...(input.height ? { height: Math.round(input.height) } : {}),
      ...(input.durationSec !== undefined
        ? { duration_sec: input.durationSec }
        : {}),
      ...(input.previewId ? { preview_id: input.previewId } : {}),
      ...(input.lqip ? { lqip: input.lqip } : {}),
    })
  } catch (error) {
    // A retry after an earlier try finished this upload but failed later
    // (a slow photo among several on a phone network): the server refuses a
    // second ticket for a finished id, so every Retry failed the same way.
    // The finished upload is the one we want: use it.
    if (
      input.id &&
      error instanceof ApiError &&
      error.code === "media_already_uploaded"
    ) {
      const row = await deps.http.request<MediaRow>("GET", `/media/${input.id}`)
      if (row.state === "ready")
        return {
          id: row.id,
          kind: row.kind,
          mime: row.mime,
          state: "ready",
          url: row.url ?? null,
        }
      throw new MediaRejected(input.id)
    }
    throw error
  }
  const limit = uploadTimeoutMs(bytes.byteLength)
  let put: Response
  try {
    // Bounded: a dead connection used to leave the send waiting forever.
    put = await timed(limit, (signal) =>
      deps.fetch(ticket.upload_url, {
        method: "PUT",
        headers: ticket.headers,
        body: bytes as unknown as BodyInit,
        signal,
      }),
    )
  } catch (error) {
    if (error instanceof NetworkError) throw error
    throw new NetworkError(String(error))
  }
  if (!put.ok)
    throw new ApiError(put.status, "upload_failed", "The upload did not finish")
  // The server reads the stored file back before it answers: on a busy
  // server that has taken longer than 15 s, and the send failed though the
  // photo was in. It gets the upload's limit.
  const done = await deps.http.request<MediaRow>(
    "POST",
    `/media/${ticket.id}/complete`,
    undefined,
    { timeoutMs: limit },
  )
  if (done.state !== "ready") throw new MediaRejected(ticket.id)
  return {
    id: done.id,
    kind: done.kind,
    mime: done.mime,
    state: "ready",
    url: done.url ?? null,
  }
}
