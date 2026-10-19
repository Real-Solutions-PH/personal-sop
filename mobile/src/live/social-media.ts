// Social's media upload: POST /media/uploads for a ticket, PUT the bytes
// to the presigned URL, then POST /media/{id}/complete. Kept apart from any
// other module's uploader so the two can evolve without touching one file.

import type { Fetch, Http } from "./http"

export type UploadKind = "image" | "video"

interface UploadTicket {
  id: string
  upload_url: string
  expires_in: number
  headers: Record<string, string>
}

export type Uploader = (uri: string, kind: UploadKind) => Promise<string>

const fallbackMime = (kind: UploadKind) =>
  kind === "video" ? "video/mp4" : "image/jpeg"

/** Upload one local file and return its server media id. */
export function createUploader(http: Http, fetchImpl: Fetch = fetch): Uploader {
  return async (uri, kind) => {
    const local = await fetchImpl(uri, {})
    if (!local.ok) throw new Error("Could not read the file")
    const blob = await local.blob()
    const mime = blob.type || fallbackMime(kind)
    const ticket = await http.request<UploadTicket>("POST", "/media/uploads", {
      kind,
      mime,
      size_bytes: blob.size,
    })
    const put = await fetchImpl(ticket.upload_url, {
      method: "PUT",
      headers: { "Content-Type": mime, ...ticket.headers },
      body: blob,
    })
    if (!put.ok) throw new Error(`Upload failed (${put.status})`)
    await http.request("POST", `/media/${ticket.id}/complete`)
    return ticket.id
  }
}
