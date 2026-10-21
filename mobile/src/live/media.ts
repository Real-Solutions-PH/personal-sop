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

import { ApiError, type Fetch, type Http, NetworkError } from "./http"

export type MediaKind = "image" | "video" | "audio" | "file"

export interface UploadInput {
  kind: MediaKind
  /** The bytes, a ``data:`` URI, or a local file URI (``file://``). */
  bytes?: Uint8Array
  uri?: string
  mime?: string
  /** Client-minted id: a retried upload reuses the same media row. */
  id?: string
  width?: number
  height?: number
  durationSec?: number
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
  const ticket = await deps.http.request<Ticket>("POST", "/media/uploads", {
    ...(input.id ? { id: input.id } : {}),
    kind: input.kind,
    mime,
    size_bytes: bytes.byteLength,
    ...(input.width ? { width: Math.round(input.width) } : {}),
    ...(input.height ? { height: Math.round(input.height) } : {}),
    ...(input.durationSec !== undefined
      ? { duration_sec: input.durationSec }
      : {}),
  })
  let put: Response
  try {
    put = await deps.fetch(ticket.upload_url, {
      method: "PUT",
      headers: ticket.headers,
      body: bytes as unknown as BodyInit,
    })
  } catch (error) {
    throw new NetworkError(String(error))
  }
  if (!put.ok)
    throw new ApiError(put.status, "upload_failed", "The upload did not finish")
  const done = await deps.http.request<MediaRow>(
    "POST",
    `/media/${ticket.id}/complete`,
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
