// Turning a module back on from outside Settings (Fern's "Finance is off"
// line, the capture card that says the same). Screen time turns on only
// once iOS allows it, as in Settings.
import type { ModuleKey } from "@domain/contract"
import { AREA } from "@domain/dash/data"
import { setEnabled } from "@domain/dash/store"
import { enableScreenTime } from "./screen-sync"

export const isModuleKey = (k: unknown): k is ModuleKey =>
  typeof k === "string" && k in AREA

export function turnModuleOn(k: ModuleKey) {
  if (k === "screen") void enableScreenTime()
  else setEnabled(k, true)
}
