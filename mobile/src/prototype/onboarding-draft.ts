// What a new person answers in onboarding before their account exists. The
// pre-account steps read and write only this draft (on a fresh install the
// dash store holds the demo seed, and sign-up empties it); right after the
// account is created, applyDraft writes the answers into it. Sign-up's
// clearToBlank never touches the draft, and signing in to an existing
// account discards it, so it never reaches another account.

import type { ModuleKey } from "@domain/contract"
import { MODULE_KEYS, seed } from "@domain/dash/data"
import {
  IDENTITIES,
  PACES,
  type Pace,
  STARTERS,
  type Step,
} from "@domain/dash/onboarding"
import {
  dashStore,
  saveGoal,
  setEnabled,
  setIdentities,
  setPush,
} from "@domain/dash/store"
import { createStore, uid } from "@domain/lib/store"
import { setShown } from "./extras"
import { type HeldCapture, holdFirstCapture } from "./first-capture"
import { setSetupFirst } from "./setup-first"

export const OCCUPATIONS = [
  { value: "student", label: "Student" },
  { value: "employed", label: "Employed" },
  { value: "self_employed", label: "Self-employed / freelance" },
  { value: "business_owner", label: "Business owner" },
  { value: "between_jobs", label: "Between jobs" },
  { value: "other", label: "Other" },
] as const
export type Occupation = (typeof OCCUPATIONS)[number]["value"]

export const REFERRALS = [
  { value: "friend", label: "A friend" },
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "app_store", label: "App Store search" },
  { value: "search", label: "Google search" },
  { value: "other", label: "Other" },
] as const
export type ReferralSource = (typeof REFERRALS)[number]["value"]
/** The referral answers that open the optional detail field. */
export const REFERRAL_DETAIL: readonly ReferralSource[] = ["friend", "other"]
export const DETAIL_MAX = 80

export type MobileStep = Step | "about" | "capture" | "account"

/** The extras onboarding offers beside the scored modules; Weather and
 * Calendar stay as they are (on) and are switched in Settings. */
export const DRAFT_EXTRAS = ["journal", "social"] as const
export type DraftExtra = (typeof DRAFT_EXTRAS)[number]

export type OnboardingDraft = {
  /** Up to 3 identity texts. */
  identities: string[]
  occupation: Occupation | null
  occupationDetail: string
  referralSource: ReferralSource | null
  referralDetail: string
  enabled: Record<ModuleKey, boolean>
  /** Journal and Community; a draft saved before they were offered has
   * none (read it through extrasOf). */
  extras?: Record<DraftExtra, boolean>
  /** "Say one thing from today": held until the account exists. */
  firstCapture?: HeldCapture | null
  /** Whether the person changed the module step themself; until then it
   * follows the identity picks (and occupation). */
  modulesTouched?: boolean
  pace: Pace | null
  /** null = no starter goal for that module. */
  targets: Record<ModuleKey, number | null>
  /** "HH:MM" */
  pushMorning: string
  pushEvening: string
  /** Where onboarding resumes. */
  step: MobileStep
}

/** The modules the identity picks stand for, in the order they were
 * picked; a student's Tasks comes after them. */
function pickedModules(
  identities: string[],
  occupation: Occupation | null,
): ModuleKey[] {
  const out: ModuleKey[] = []
  for (const text of identities) {
    const k = IDENTITIES.find((i) => i.text === text)?.module
    if (k && !out.includes(k)) out.push(k)
  }
  if (occupation === "student" && !out.includes("tasks")) out.push("tasks")
  return out
}

/** The module step's starting ticks: only what the identity picks (and a
 * student's Tasks) stand for. Journal and Community start unticked. */
export function preselect(
  identities: string[],
  occupation: Occupation | null,
): Pick<OnboardingDraft, "enabled" | "extras"> {
  const picked = pickedModules(identities, occupation)
  return {
    enabled: Object.fromEntries(
      MODULE_KEYS.map((k) => [k, picked.includes(k)]),
    ) as Record<ModuleKey, boolean>,
    extras: { journal: false, social: false },
  }
}

/** The ticked modules, most wanted first: the identity picks in the order
 * they were made, then the rest ticked by hand in the app's order. Setup
 * asks about the first one or two. */
export function priorityOf(d: OnboardingDraft): ModuleKey[] {
  const picked = pickedModules(d.identities, d.occupation).filter(
    (k) => d.enabled[k],
  )
  return [
    ...picked,
    ...MODULE_KEYS.filter((k) => d.enabled[k] && !picked.includes(k)),
  ]
}

/** Nothing ticked yet: the module step follows the identity picks. */
export function newDraft(): OnboardingDraft {
  const push = seed().push
  return {
    identities: [],
    occupation: null,
    occupationDetail: "",
    referralSource: null,
    referralDetail: "",
    ...preselect([], null),
    pace: "gentle",
    targets: { ...PACES.gentle.targets },
    pushMorning: push.morning,
    pushEvening: push.evening,
    step: "identity",
  }
}

// Wrapped in an object: a store seeded with bare null cannot read its
// saved state back after a restart.
export const draftStore = createStore<{ draft: OnboardingDraft | null }>(
  "onboarding-draft",
  () => ({ draft: null }),
)

export const getDraft = () => draftStore.get().draft

/** The draft, started fresh if there is none. */
export function ensureDraft(): OnboardingDraft {
  const d = getDraft()
  if (d) return d
  const fresh = newDraft()
  draftStore.set({ draft: fresh })
  return fresh
}

/** A patch that sets ``enabled`` or ``extras`` is the person's own choice
 * (the module step); one that changes the identity picks or occupation
 * re-derives the ticks until then. */
export function editDraft(patch: Partial<OnboardingDraft>) {
  draftStore.set((s) => {
    const next = { ...(s.draft ?? newDraft()), ...patch }
    if ("enabled" in patch || "extras" in patch) next.modulesTouched = true
    else if (
      !next.modulesTouched &&
      ("identities" in patch || "occupation" in patch)
    )
      Object.assign(next, preselect(next.identities, next.occupation))
    return { draft: next }
  })
}

export function discardDraft() {
  draftStore.set({ draft: null })
}

/** The draft's Journal and Community choice. */
export const extrasOf = (d: OnboardingDraft): Record<DraftExtra, boolean> =>
  d.extras ?? { journal: true, social: true }

/** The modules that get a starter goal. */
export const startersOf = (d: OnboardingDraft): ModuleKey[] =>
  MODULE_KEYS.filter((k) => d.enabled[k] && d.targets[k] !== null)

/** Sign-up's "about you" answers for the server, without the unanswered
 * ones; null when there is no draft. */
export function aboutOf(d: OnboardingDraft | null) {
  if (!d) return null
  const occupationDetail = d.occupationDetail.trim()
  const referralDetail = d.referralDetail.trim()
  return {
    ...(d.occupation ? { occupation: d.occupation } : {}),
    ...(d.occupation && occupationDetail ? { occupationDetail } : {}),
    ...(d.referralSource ? { referralSource: d.referralSource } : {}),
    ...(d.referralSource &&
    REFERRAL_DETAIL.includes(d.referralSource) &&
    referralDetail
      ? { referralDetail }
      : {}),
  }
}
export type About = NonNullable<ReturnType<typeof aboutOf>>

/** Writes the draft into the signed-in account through the store's own
 * actions (sync pushes them as creates), then clears it. Returns how many
 * starter goals were added. A no-op without a draft. */
export function applyDraft(): number {
  const d = getDraft()
  if (!d) return 0
  for (const k of MODULE_KEYS) setEnabled(k, d.enabled[k])
  // Written to the extras store, which syncs to the account's
  // enabled_extras with the rest of the profile.
  const extras = extrasOf(d)
  for (const k of DRAFT_EXTRAS) setShown(k, extras[k])
  // First-run setup asks about the top one or two of these.
  setSetupFirst(priorityOf(d))
  // Sent through the capture path once live mode starts (session.ts).
  holdFirstCapture(d.firstCapture ?? null)
  setPush({ morning: d.pushMorning, evening: d.pushEvening })
  if (d.identities.length)
    setIdentities(d.identities.map((text) => ({ id: uid(), text })))
  let added = 0
  for (const k of startersOf(d)) {
    const starter = STARTERS[k]
    if (
      dashStore
        .get()
        .goals.some((g) => g.metric === starter.metric && g.status === "active")
    )
      continue
    saveGoal({
      ...starter,
      target: d.targets[k] ?? starter.target,
      via: "onboarding",
    })
    added++
  }
  discardDraft()
  return added
}
