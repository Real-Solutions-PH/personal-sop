// Shared money's online-only reads: who this person may lend to (the
// people they follow and who follow them), uploading a payment's proof
// photo, and the short-lived URLs of the proofs on a loan. Loans themselves
// read from the synced store and write through sync actions (mappers/shared).

import type { LoanPerson } from "@domain/finance/loans"
import { http as authHttp } from "./auth"
import type { Fetch, Http } from "./http"
import { uploadMedia } from "./media"

interface WPerson {
  id: string
  name: string
  handle: string | null
  photo_media_id: string | null
  photo_url?: string | null
}

export interface Connection extends LoanPerson {
  photoUrl?: string
}

interface Deps {
  http: Http
  fetch: Fetch
}

const defaults = (): Deps => ({
  http: authHttp,
  fetch: (input, init) => fetch(input, init),
})

/** Everyone connected to ``me`` either way, by name. */
export async function connections(
  me: string,
  deps: Partial<Deps> = {},
): Promise<Connection[]> {
  const { http } = { ...defaults(), ...deps }
  const [following, followers] = await Promise.all(
    (["following", "followers"] as const).map((dir) =>
      http.request<{ data: WPerson[] }>(
        "GET",
        `/social/people/${me}/${dir}?limit=100`,
      ),
    ),
  )
  const byId = new Map<string, Connection>()
  for (const p of [...following.data, ...followers.data])
    if (p.id !== me && !byId.has(p.id))
      byId.set(p.id, {
        id: p.id,
        name: p.name || "Someone",
        handle: p.handle ?? undefined,
        photoMediaId: p.photo_media_id ?? undefined,
        photoUrl: p.photo_url ?? undefined,
      })
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Upload a picked photo; its media id goes on the payment. */
export async function uploadProof(
  uri: string,
  deps: Partial<Deps> = {},
): Promise<string> {
  const media = await uploadMedia(
    { kind: "image", uri, mime: "image/jpeg" },
    { ...defaults(), ...deps },
  )
  return media.id
}

export interface Proof {
  url: string
  previewUrl?: string
}

/** Payment id -> its proof photo's URLs (valid for a few minutes). */
export async function proofUrls(
  loanId: string,
  deps: Partial<Deps> = {},
): Promise<Record<string, Proof>> {
  const { http } = { ...defaults(), ...deps }
  const loan = await http.request<{
    payments: {
      id: string
      proof_url: string | null
      proof_preview_url: string | null
    }[]
  }>("GET", `/finance/shared/loans/${loanId}`)
  const out: Record<string, Proof> = {}
  for (const p of loan.payments)
    if (p.proof_url)
      out[p.id] = {
        url: p.proof_url,
        previewUrl: p.proof_preview_url ?? undefined,
      }
  return out
}
