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

export const dashStore = createStore<DashState>("dash", seed)
const set = dashStore.set

/** Create or update a goal on any goalable metric (DSH-23). */
export function saveGoal(
  g: Omit<Goal, "id" | "createdAt" | "status"> & { id?: string },
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

/** Seal the day (F-DSH-05). */
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

export const markTrophiesSeen = (ids: string[]) =>
  set((s) => ({
    ...s,
    seenTrophies: Array.from(new Set([...s.seenTrophies, ...ids])),
  }))

/** Profile photo as a small data URL; undefined removes it (back to initials). */
export const setProfilePhoto = (photo: string | undefined) =>
  set((s) => ({ ...s, profile: { ...s.profile, photo } }))
