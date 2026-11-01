// A live account never shows the prototype's demo records: before an
// account's first pull on this device (and after sign-out) every module's
// collections are emptied, keeping only settings-shaped fields. The first
// pull then fills them with the server's rows.

import { captureStore } from "@domain/capture/store"
import { dashStore } from "@domain/dash/store"
import { finStore } from "@domain/finance/store"
import { runLiveStore } from "@domain/fitness/run-live"
import { fitStore } from "@domain/fitness/store"
import { focusStore } from "@domain/focus/store"
import { habitsStore } from "@domain/habits/store"
import { liveStore } from "@domain/lib/live"
import { screenStore } from "@domain/screen/store"
import { tasksStore } from "@domain/tasks/store"
import { companionStore } from "@/prototype/companion/store"
import { socialStore } from "@/prototype/social/store"

export function clearToBlank() {
  habitsStore.set((s) => ({
    ...s,
    habits: [],
    logs: [],
    routines: [],
    runs: [],
    timer: null,
  }))
  tasksStore.set((s) => ({ ...s, lists: [], tasks: [], events: [] }))
  focusStore.set((s) => ({
    ...s,
    sessions: [],
    segments: [],
    settingsSaved: false,
  }))
  screenStore.set((s) => ({ ...s, groups: [], days: [] }))
  fitStore.set((s) => ({
    ...s,
    exercises: [],
    templates: [],
    schedule: Array(7).fill(null),
    workouts: [],
    runs: [],
    weighIns: [],
    targets: [],
    adjustments: [],
    meals: [],
    recipes: [],
    activeId: null,
    rest: null,
    // The demo's goal (lose weight → 76 kg) is sample data, not a setting:
    // start from the server's default so the first sync does not push it.
    settings: {
      ...s.settings,
      goalDirection: "maintain",
      goalWeight: undefined,
    },
  }))
  // A run in progress belongs to the account that started it.
  runLiveStore.set({ active: null })
  finStore.set((s) => ({
    ...s,
    accounts: [],
    categories: [],
    records: [],
    budgets: [],
    planned: [],
    imports: [],
    lookbacks: [],
    threads: [],
  }))
  // The AI spend meter too: the prototype seeds demo spending; live mode
  // reads the real meter from the server (live/capture.ts).
  captureStore.set((s) => ({
    ...s,
    captures: [],
    journal: [],
    spend: { ...s.spend, amount: 0, calls: 0 },
    // The demo's OpenRouter model is sample data: "" is the server default.
    settings: { ...s.settings, model: "" },
  }))
  dashStore.set((s) => ({
    ...s,
    goals: [],
    reviews: {},
    notifs: [],
    missNotes: {},
    wrapups: {},
    onboarded: false,
    setupSkipped: [],
    profile: {
      ...s.profile,
      name: "",
      handle: "",
      identities: [],
      photo: undefined,
    },
  }))
  companionStore.set((s) => ({
    ...s,
    messages: [],
    trackers: [],
    memories: [],
  }))
  socialStore.set((s) => ({
    ...s,
    people: [],
    posts: [],
    stories: [],
    seen: [],
    notes: [],
    chats: [],
    activity: [],
    drafts: {},
  }))
  liveStore.set({ live: null })
}
