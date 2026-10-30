"use client"
import type { ModuleKey } from "../contract"
import { dayKey } from "../lib/day"
import { createStore, uid } from "../lib/store"
import {
  type DashState,
  type Goal,
  type Identity,
  type ReviewState,
  type ShareTemplate,
  seed,
  type WrapUp,
} from "./data"
/** Goal references that moved when Nutrition became its own module
 * (ADR-0024); the server renames its copies in the same release. */
export const MOVED_METRICS: Record<string, string> = {
  "fitness:protein": "nutrition:protein",
  "fitness:calories": "nutrition:calories",
}
/** State saved before Nutrition was its own module: its switch follows the
 * Fitness one (meals were part of Fitness), its weight is the default, and
 * goals on a moved metric point at the new reference. */
export function upgradeDash(s: DashState): DashState {
  const enabled = { ...seed().enabled, ...s.enabled }
  const weights = { ...seed().weights, ...s.weights }
  if (s.enabled.nutrition === undefined)
    enabled.nutrition = s.enabled.fitness ?? true
  const moved = s.goals.some((g) => MOVED_METRICS[g.metric])
  // Focus (ADR-0025) and Screen time arrive switched on with the default
  // weight; each is left out of the Life Score until it has data.
  if (
    s.enabled.nutrition !== undefined &&
    s.weights.nutrition !== undefined &&
    s.enabled.focus !== undefined &&
    s.weights.focus !== undefined &&
    s.enabled.screen !== undefined &&
    s.weights.screen !== undefined &&
    !moved
  )
    return s
  return {
    ...s,
    enabled,
    weights,
    goals: moved
      ? s.goals.map((g) =>
          MOVED_METRICS[g.metric]
            ? { ...g, metric: MOVED_METRICS[g.metric] }
            : g,
        )
      : s.goals,
  }
}
export const dashStore = createStore<DashState>("dash", seed, {
  upgrade: upgradeDash,
})
const set = dashStore.set
export function saveGoal(
  g: Omit<Goal, "id" | "createdAt" | "status"> & {
    id?: string
  },
): Goal {
  const existing = g.id
    ? dashStore.get().goals.find((x) => x.id === g.id)
    : null
  const goal: Goal = existing
    ? { ...existing, ...g, id: existing.id }
    : { ...g, id: uid(), createdAt: dayKey(), status: "active" }
  set((s) => ({
    ...s,
    goals: existing
      ? s.goals.map((x) => (x.id === goal.id ? goal : x))
      : [goal, ...s.goals],
  }))
  return goal
}
export const archiveGoal = (id: string) =>
  set((s) => ({
    ...s,
    goals: s.goals.map((g) =>
      g.id === id ? { ...g, status: "archived" as const } : g,
    ),
  }))
export const restoreGoal = (id: string) =>
  set((s) => ({
    ...s,
    goals: s.goals.map((g) =>
      g.id === id ? { ...g, status: "active" as const } : g,
    ),
  }))
export const deleteGoal = (id: string) =>
  set((s) => ({
    ...s,
    goals: s.goals.filter((g) => g.id !== id),
    profile: {
      ...s.profile,
      identities: s.profile.identities.map((i) =>
        i.goalId === id ? { ...i, goalId: undefined } : i,
      ),
    },
  }))
export const setWeight = (m: ModuleKey, w: number) =>
  set((s) => ({ ...s, weights: { ...s.weights, [m]: w } }))
export const resetWeights = () =>
  set((s) => ({ ...s, weights: seed().weights }))
export const setEnabled = (m: ModuleKey, on: boolean) =>
  set((s) => ({ ...s, enabled: { ...s.enabled, [m]: on } }))
export const updateProfile = (p: Partial<DashState["profile"]>) =>
  set((s) => ({ ...s, profile: { ...s.profile, ...p } }))
export const setIdentities = (identities: Identity[]) =>
  updateProfile({ identities: identities.slice(0, 3) })
export const saveReview = (id: string, patch: Partial<ReviewState>) =>
  set((s) => ({
    ...s,
    reviews: {
      ...s.reviews,
      [id]: { ...(s.reviews[id] ?? { done: false }), ...patch },
    },
  }))
export const markNotifRead = (id: string) =>
  set((s) => ({
    ...s,
    notifs: s.notifs.map((n) => (n.id === id ? { ...n, read: true } : n)),
  }))
export const markAllRead = () =>
  set((s) => ({ ...s, notifs: s.notifs.map((n) => ({ ...n, read: true })) }))
export const noteMiss = (id: string, note: string) =>
  set((s) => {
    const missNotes = { ...s.missNotes }
    if (note.trim()) missNotes[id] = note.trim()
    else delete missNotes[id]
    return { ...s, missNotes }
  })
export const sealDay = (day: string, w: Omit<WrapUp, "at">) =>
  set((s) => ({
    ...s,
    wrapups: { ...s.wrapups, [day]: { ...w, at: new Date().toISOString() } },
  }))
export const unsealDay = (day: string) =>
  set((s) => {
    const wrapups = { ...s.wrapups }
    delete wrapups[day]
    return { ...s, wrapups }
  })
export const saveShareDefaults = (
  t: ShareTemplate,
  fields: Record<string, boolean>,
) => set((s) => ({ ...s, share: { ...s.share, [t]: fields } }))
export const setOnboarded = (v: boolean) => set((s) => ({ ...s, onboarded: v }))
export const skipSetup = (m: ModuleKey) =>
  set((s) => ({
    ...s,
    setupSkipped: Array.from(new Set([...s.setupSkipped, m])),
  }))
export const setSetupHidden = (v: boolean) =>
  set((s) => ({ ...s, setupHidden: v }))
export const setInstallDismissed = (v: boolean) =>
  set((s) => ({ ...s, installDismissed: v }))
export const setPush = (p: Partial<DashState["push"]>) =>
  set((s) => ({ ...s, push: { ...s.push, ...p } }))
export const setTargetThreshold = (v: number) =>
  set((s) => ({ ...s, targetThreshold: v }))
export const setEveningStart = (hm: string) =>
  set((s) => ({ ...s, eveningStart: hm }))
export const markTrophiesSeen = (ids: string[]) =>
  set((s) => ({
    ...s,
    seenTrophies: Array.from(new Set([...s.seenTrophies, ...ids])),
  }))
export const setProfilePhoto = (photo: string | undefined) =>
  set((s) => ({ ...s, profile: { ...s.profile, photo } }))
export const setProfilePhotoPending = (
  pending: DashState["profilePhotoPending"],
) => set((s) => ({ ...s, profilePhotoPending: pending }))
/** Edit profile's Save: name, handle and identities in one write. */
export const saveProfileEdits = (p: {
  name: string
  handle: string
  identities: Identity[]
}) =>
  set((s) => ({
    ...s,
    profile: {
      ...s.profile,
      name: p.name,
      handle: p.handle,
      identities: p.identities.slice(0, 3),
    },
  }))
