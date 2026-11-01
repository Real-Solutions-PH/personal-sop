// The profile photo on the server: uploaded as media, then set with
// PATCH /profile ``photo_media_id`` so every viewer and the owner's other
// devices see it. The photo is local-first: it shows at once from the file
// on this device, and a change the server has not taken yet is kept in the
// dash store (``profilePhotoPending``) and retried on the next connect.

import {
  dashStore,
  setProfilePhoto,
  setProfilePhotoPending,
} from "@domain/dash/store"
import { getConnectivity, toast } from "@domain/lib/platform"
import { socialStore } from "@/prototype/social/store"
import { http as authHttp } from "./auth"
import { type Fetch, type Http, NetworkError } from "./http"
import { dataUriToBytes, uploadMedia } from "./media"

export interface PhotoDeps {
  http: Http
  fetch: Fetch
  /** Write an inline photo to a file; null when it could not be. */
  keep: (bytes: Uint8Array) => Promise<string | null>
}
const defaults = (): PhotoDeps => ({
  http: authHttp,
  fetch: (input, init) => fetch(input, init),
  // Loaded when needed: the media helpers pull in the picker and UI modules.
  keep: async (bytes) =>
    (await import("@/prototype/media")).keepAvatarBytes(bytes),
})

export const PHOTO_FAILED =
  "Couldn't update your profile photo. Please try again."
export const PHOTO_OFFLINE =
  "You're offline. Your photo will update when you reconnect."

/** Each call's number: a newer change makes an older result stale. */
let seq = 0

export type PhotoResult = "ok" | "pending" | "failed" | "stale"

/** Save ``uri`` (or, undefined, the removal) as my profile photo on the
 * server. ``previous`` is the local photo to put back when the upload is
 * refused. Success shows no toast: the photo itself changes. */
export async function syncProfilePhoto(
  uri: string | undefined,
  opts: { previous?: string; deps?: Partial<PhotoDeps> } = {},
): Promise<PhotoResult> {
  const n = ++seq
  const d = { ...defaults(), ...opts.deps }
  const target = uri ?? null
  const was = dashStore.get().profilePhotoPending
  let mediaId = was && was.uri === target ? was.mediaId : undefined
  const later = (): PhotoResult => {
    setProfilePhotoPending({ uri: target, mediaId })
    toast.warning(PHOTO_OFFLINE)
    return "pending"
  }
  if (!getConnectivity()) return later()
  try {
    if (uri && !mediaId) {
      const media = await uploadMedia(
        { kind: "image", uri, mime: "image/jpeg" },
        d,
      )
      if (n !== seq) return "stale"
      mediaId = media.id
    }
    // Uploaded: a PATCH that fails from here retries with this id.
    setProfilePhotoPending({ uri: target, mediaId })
    await d.http.request("PATCH", "/profile", {
      photo_media_id: mediaId ?? null,
    })
    if (n !== seq) return "stale"
    setProfilePhotoPending(undefined)
    if (!uri)
      socialStore.set((s) =>
        s.me ? { ...s, me: { ...s.me, photo: undefined } } : s,
      )
    if (uri?.startsWith("data:")) {
      // A photo saved before photos were files: keep it as one from now on.
      const file = await d.keep(dataUriToBytes(uri).bytes)
      if (file && dashStore.get().profile.photo === uri) setProfilePhoto(file)
    }
    return "ok"
  } catch (error) {
    if (n !== seq) return "stale"
    if (error instanceof NetworkError) return later()
    toast.error(PHOTO_FAILED)
    if (mediaId) return "pending"
    setProfilePhotoPending(undefined)
    setProfilePhoto(opts.previous)
    return "failed"
  }
}

/** On connect: send a change the server has not taken yet, or upload a
 * photo still held as inline data. */
export function retryProfilePhoto(
  deps?: Partial<PhotoDeps>,
): Promise<PhotoResult> | undefined {
  const s = dashStore.get()
  if (s.profilePhotoPending)
    return syncProfilePhoto(s.profilePhotoPending.uri ?? undefined, { deps })
  if (s.profile.photo?.startsWith("data:"))
    return syncProfilePhoto(s.profile.photo, { deps })
  return undefined
}
