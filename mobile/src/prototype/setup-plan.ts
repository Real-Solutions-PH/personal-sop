// Which modules first-run setup asks about, and the "set it up the first
// time you open it" offer for the rest.
//
// Onboarding asks for setup of only the one or two modules the person
// cares about most (identity picks first, in pick order; see priorityOf in
// onboarding-draft.ts), each skippable. Every other ticked module is
// offered its setup step once, the first time its screen is opened, and
// Today's "Finish setting up" card stays the reminder for all of them.

import type { ModuleKey } from "@domain/contract"
import { dashStore } from "@domain/dash/store"
import { finStore } from "@domain/finance/store"
import { fitStore } from "@domain/fitness/store"
import { focusStore } from "@domain/focus/store"
import { habitsStore } from "@domain/habits/store"
import { tasksStore } from "@domain/tasks/store"
import { useScreenSetUp } from "./screen-sync"

import { setupFirstStore, shouldOfferSetup } from "./setup-first"

export {
  FIRST_RUN_LIMIT,
  firstRunSteps,
  markOffered,
  SETUP_TIME,
  setSetupFirst,
  setupFirstStore,
  shouldOfferSetup,
} from "./setup-first"

/** Whether each module already has its starting data. */
export function useSetUp(): Record<ModuleKey, boolean> {
  return {
    finance: finStore.use((s) => s.accounts.length > 0),
    habits: habitsStore.use((s) => s.habits.length > 0),
    fitness: fitStore.use(
      (s) => s.templates.length + s.workouts.length + s.weighIns.length > 0,
    ),
    nutrition: fitStore.use((s) => s.targets.length + s.meals.length > 0),
    focus: focusStore.use((s) => s.settingsSaved || s.sessions.length > 0),
    screen: useScreenSetUp(),
    tasks: tasksStore.use((s) => s.tasks.length > 0),
  }
}

/** The store-backed inputs of shouldOfferSetup, for a screen. */
export function useOfferSetup(k: ModuleKey): boolean {
  const enabled = dashStore.use((s) => s.enabled),
    onboarded = dashStore.use((s) => s.onboarded),
    skipped = dashStore.use((s) => s.setupSkipped),
    offered = setupFirstStore.use((s) => s.offered),
    has = useSetUp()
  return shouldOfferSetup(k, { enabled, onboarded, skipped, offered, has })
}
