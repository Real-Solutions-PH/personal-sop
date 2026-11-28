// Joint accounts' online-only calls: the owner shares an account with
// people they're connected with, removes people, and hands out invite
// links; anyone opening a link reads what it invites to and accepts it.
// Everything a member does inside a joint account (accept an invite from
// the inbox, log a transaction, leave) goes through sync actions instead
// (mappers/shared.ts). After a call here, a pull brings the new view.
//
// Invite links are the generic ``/invites`` API (backend
// app/modules/invites): ``kind`` + ``object_id`` name what a link is for.

import type { JointRecord, SharedAccount } from "@domain/finance/joint"
import { http as authHttp } from "./auth"
import { ApiError, type Http } from "./http"
import { accountFromRow, jointRecord } from "./mappers/shared"
import { syncNow } from "./runtime"

export const ACCOUNT_INVITE_KIND = "finance_account"

export type InviteState =
  | "open"
  | "used"
  | "expired"
  | "revoked"
  | "member"
  | "own"

export interface InviteLink {
  id: string
  createdAt: string
  expiresAt: string
}

export interface CreatedLink extends InviteLink {
  url: string
}

export interface InvitePreview {
  state: InviteState
  kind: string
  expiresAt: string
  inviter: { id: string; name: string; handle?: string }
  subject?: { title: string; label: string; points: string[]; href: string }
}

export interface InviteAccepted {
  href: string
  joined: boolean
}

/** Why an accept failed, in words the screen shows. */
export type InviteError = "used" | "expired" | "revoked" | "own" | "missing"

interface WLink {
  id: string
  created_at: string
  expires_at: string
  url?: string
}

const link = (w: WLink): InviteLink => ({
  id: w.id,
  createdAt: w.created_at,
  expiresAt: w.expires_at,
})

const defaults = (): { http: Http } => ({ http: authHttp })

/** One joint account straight from the server: the owner's own (before
 * or after sharing it), or one just joined whose synced view hasn't
 * arrived yet. */
export async function fetchAccount(
  accountId: string,
  deps: Partial<{ http: Http }> = {},
): Promise<SharedAccount> {
  const { http } = { ...defaults(), ...deps }
  const w = await http.request<Record<string, unknown>>(
    "GET",
    `/finance/shared/accounts/${accountId}`,
  )
  const out = accountFromRow({
    kind: "account",
    id: `fetched:${accountId}`,
    object_id: accountId,
    role: w.role,
    status: w.my_status,
    data: w,
  })
  if (!out) throw new Error("not a joint account")
  return out
}

/** Older transactions than the synced view holds, newest first. */
export async function olderRecords(
  accountId: string,
  skip: number,
  deps: Partial<{ http: Http }> = {},
): Promise<{ records: JointRecord[]; total: number }> {
  const { http } = { ...defaults(), ...deps }
  const w = await http.request<{
    data: Record<string, unknown>[]
    count: number
  }>(
    "GET",
    `/finance/shared/accounts/${accountId}/records?skip=${skip}&limit=100`,
  )
  return { records: w.data.map(jointRecord), total: w.count }
}

/** The owner invites people they follow or who follow them. */
export async function shareAccount(
  accountId: string,
  memberIds: string[],
  deps: Partial<{ http: Http }> = {},
): Promise<void> {
  const { http } = { ...defaults(), ...deps }
  await http.request("POST", `/finance/shared/accounts/${accountId}/share`, {
    member_ids: memberIds,
  })
  syncNow()
}

/** The owner takes someone out (an invite still pending, or a member). */
export async function removeMember(
  accountId: string,
  userId: string,
  deps: Partial<{ http: Http }> = {},
): Promise<void> {
  const { http } = { ...defaults(), ...deps }
  await http.request(
    "POST",
    `/finance/shared/accounts/${accountId}/members/${userId}/remove`,
  )
  syncNow()
}

export async function createLink(
  accountId: string,
  deps: Partial<{ http: Http }> = {},
): Promise<CreatedLink> {
  const { http } = { ...defaults(), ...deps }
  const w = await http.request<WLink & { url: string }>("POST", "/invites", {
    kind: ACCOUNT_INVITE_KIND,
    object_id: accountId,
  })
  return { ...link(w), url: w.url }
}

/** Links to this account nobody has used yet. */
export async function pendingLinks(
  accountId: string,
  deps: Partial<{ http: Http }> = {},
): Promise<InviteLink[]> {
  const { http } = { ...defaults(), ...deps }
  const out = await http.request<{ data: WLink[] }>(
    "GET",
    `/invites?kind=${ACCOUNT_INVITE_KIND}&object_id=${accountId}`,
  )
  return out.data.map(link)
}

export async function revokeLink(
  inviteId: string,
  deps: Partial<{ http: Http }> = {},
): Promise<void> {
  const { http } = { ...defaults(), ...deps }
  await http.request("POST", `/invites/${inviteId}/revoke`)
}

export async function previewInvite(
  token: string,
  deps: Partial<{ http: Http }> = {},
): Promise<InvitePreview> {
  const { http } = { ...defaults(), ...deps }
  const w = await http.request<{
    state: InviteState
    kind: string
    expires_at: string
    inviter: { id: string; name: string; handle: string | null }
    subject: InvitePreview["subject"] | null
  }>("GET", `/invites/token/${encodeURIComponent(token)}`)
  return {
    state: w.state,
    kind: w.kind,
    expiresAt: w.expires_at,
    inviter: {
      id: w.inviter.id,
      name: w.inviter.name,
      handle: w.inviter.handle ?? undefined,
    },
    subject: w.subject ?? undefined,
  }
}

export async function acceptInvite(
  token: string,
  deps: Partial<{ http: Http }> = {},
): Promise<InviteAccepted> {
  const { http } = { ...defaults(), ...deps }
  const w = await http.request<{ href: string; joined: boolean }>(
    "POST",
    `/invites/token/${encodeURIComponent(token)}/accept`,
  )
  syncNow()
  return { href: w.href, joined: w.joined }
}

/** The error code of a refused accept, if it is one the screen explains. */
export function inviteError(e: unknown): InviteError | null {
  const code = e instanceof ApiError ? e.code : ""
  return (
    (
      {
        invite_used: "used",
        invite_expired: "expired",
        invite_revoked: "revoked",
        own_invite: "own",
        invite_not_found: "missing",
      } as Record<string, InviteError>
    )[code] ?? null
  )
}
