import { createStore } from "@domain/lib/store"
// Parts of the app outside the scored areas that a person can hide for a
// cleaner app; hiding keeps the data. Held on the account (the profile's
// ``enabled_extras``, synced by src/live/mappers/dash.ts); this store is
// the device's copy, and the account's choice wins once it has one.
export const EXTRAS = [
  { key: "journal", label: "Journal" },
  { key: "social", label: "Community" },
  { key: "weather", label: "Weather" },
  { key: "calendar", label: "Calendar" },
] as const
export type Extra = (typeof EXTRAS)[number]["key"]
export const extrasStore = createStore<Record<Extra, boolean>>(
  "native-extras",
  () => ({ journal: true, social: true, weather: true, calendar: true }),
)
export const useShown = (k: Extra) => extrasStore.use((s) => s[k])
export const setShown = (k: Extra, on: boolean) =>
  extrasStore.set((s) => ({ ...s, [k]: on }))
