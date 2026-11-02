// Which one-off moments this phone has already shown: a budget month kept,
// a savings goal reached, the focus goal hit today, a Life Score level
// reached. Device-local, like the trophies already presented: a moment is
// something that happened here, and is never synced or replayed.

import { createStore } from "@domain/lib/store"

const KEEP = 200

export const momentsSeen = createStore("moments-seen", () => ({
  keys: [] as string[],
  /** The Life Score level index last seen settled; -1 before the first. */
  level: -1,
  /** A drop not yet dismissed: the level names it fell from and to. */
  drop: { from: "", to: "" },
}))

export const seen = (key: string) => momentsSeen.get().keys.includes(key)

/** True the first time ``key`` is claimed on this phone, and records it. */
export function claimOnce(key: string): boolean {
  if (seen(key)) return false
  momentsSeen.set((s) => ({ ...s, keys: [...s.keys, key].slice(-KEEP) }))
  return true
}

export type LevelStep =
  | { kind: "up"; key: string }
  | { kind: "down" }
  | { kind: "none" }

/** What a settled level change means. The first level ever seen is a
 * baseline, never news; a level reached again after a drop is not a second
 * level-up (``seenKeys`` already holds it). Pure. */
export function levelStep(
  prev: number,
  now: number,
  seenKeys: readonly string[],
): LevelStep {
  if (prev < 0 || now === prev) return { kind: "none" }
  if (now < prev) return { kind: "down" }
  const key = `level-up:${now}`
  return seenKeys.includes(key) ? { kind: "none" } : { kind: "up", key }
}

/** Record a settled level and say what to show for it. */
export function noteLevel(
  now: number,
  names: readonly string[],
): LevelStep {
  const s = momentsSeen.get()
  const step = levelStep(s.level, now, s.keys)
  momentsSeen.set((x) => ({
    ...x,
    level: now,
    keys:
      step.kind === "up" ? [...x.keys, step.key].slice(-KEEP) : x.keys,
    drop:
      step.kind === "down"
        ? { from: names[s.level] ?? "", to: names[now] ?? "" }
        : step.kind === "up"
          ? { from: "", to: "" }
          : x.drop,
  }))
  return step
}

export const dismissDrop = () =>
  momentsSeen.set((s) => ({ ...s, drop: { from: "", to: "" } }))
