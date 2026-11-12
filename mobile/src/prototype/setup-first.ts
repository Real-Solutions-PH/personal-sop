// Which modules first-run setup asks about, and which have been offered
// their setup on first open. Plain data, no screens: the onboarding draft
// writes it at sign-up. The hooks that read it are in setup-plan.ts.

import type { ModuleKey } from "@domain/contract"
import { createStore } from "@domain/lib/store"

/** How long each setup step takes, as the module step and setup show it. */
export const SETUP_TIME: Record<ModuleKey, string> = {
  finance: "1 min",
  habits: "30 sec",
  fitness: "30 sec",
  nutrition: "30 sec",
  focus: "15 sec",
  screen: "1 min",
  tasks: "1 min",
}

/** How many modules first-run setup asks about: one, so onboarding stays
 * within 8 screens (docs/27 fix 5). The rest are offered the first time
 * their screen opens. */
export const FIRST_RUN_LIMIT = 1

/** Set at sign-up from the onboarding draft: the ticked modules, most
 * wanted first. Kept on this phone: setup runs right after sign-up here. */
export const setupFirstStore = createStore<{
  first: ModuleKey[]
  /** Modules already offered their setup on first open. */
  offered: ModuleKey[]
}>("setup-first", () => ({ first: [], offered: [] }))

export const setSetupFirst = (first: ModuleKey[]) =>
  setupFirstStore.set((s) => ({ ...s, first, offered: [] }))

export const markOffered = (k: ModuleKey) =>
  setupFirstStore.set((s) => ({
    ...s,
    offered: s.offered.includes(k) ? s.offered : [...s.offered, k],
  }))

/** The first-run setup steps out of the enabled ``steps`` (in setup's own
 * order): the priority list's first ones, or setup's order without one. */
export function firstRunSteps(
  steps: ModuleKey[],
  first: ModuleKey[],
): ModuleKey[] {
  const ranked = [
    ...first.filter((k) => steps.includes(k)),
    ...steps.filter((k) => !first.includes(k)),
  ]
  return ranked.slice(0, FIRST_RUN_LIMIT)
}

/** Whether opening ``k`` should offer its setup step now: switched on,
 * onboarding finished, no starting data, never skipped, never offered on
 * this phone. Screen time's own screen is its setup. */
export function shouldOfferSetup(
  k: ModuleKey,
  state: {
    enabled: Record<ModuleKey, boolean>
    onboarded: boolean
    skipped: ModuleKey[]
    offered: ModuleKey[]
    has: Record<ModuleKey, boolean>
  },
): boolean {
  return (
    k !== "screen" &&
    state.onboarded &&
    state.enabled[k] &&
    !state.has[k] &&
    !state.skipped.includes(k) &&
    !state.offered.includes(k)
  )
}
