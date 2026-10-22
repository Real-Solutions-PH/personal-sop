// What a memory's stored values read as. Every surface that shows a memory's
// kind or source imports these, so the server's vocabulary (``response_style``,
// ``inferred``) never reaches the person.

export const MEMORY_KINDS = [
  "response_style",
  "profile",
  "preference",
  "fact",
  "goal",
  "relationship",
  "health",
  "routine",
  "event",
] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const KIND_LABEL: Record<MemoryKind, string> = {
  response_style: "How to answer",
  profile: "About you",
  preference: "Likes",
  fact: "Facts",
  goal: "Goals",
  relationship: "People",
  health: "Health",
  routine: "Routines",
  event: "Events",
}

/** Kinds the server keeps in every conversation whatever the toggle says
 * (``ALWAYS_ON_KINDS`` in backend/app/modules/companion/memory.py). */
export const ALWAYS_ON_KINDS: ReadonlySet<string> = new Set([
  "response_style",
  "profile",
])

export const isKind = (k: unknown): k is MemoryKind =>
  typeof k === "string" && (MEMORY_KINDS as readonly string[]).includes(k)

/** A kind the app does not know yet reads as itself, not as "Facts". */
export const kindLabel = (k: string | undefined) =>
  k === undefined ? KIND_LABEL.fact : isKind(k) ? KIND_LABEL[k] : k

/** Typed in the app counts as something the person said. */
export const sourceLabel = (s: string | undefined, name: string) =>
  s === "inferred"
    ? `${name} noticed`
    : s === undefined || s === "said" || s === "app"
      ? "you said"
      : s

/** "Dog, morning , dog" -> ["dog", "morning"]: the server's own rule
 * (lowercase, 30 characters, 8 tags, no repeats). */
export function parseTags(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(",")) {
    const tag = part.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 30)
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out.slice(0, 8)
}

/** "No memories yet", "1 memory", "1,204 memories". */
export const memoryCount = (n: number) =>
  n === 0
    ? "No memories yet"
    : `${n.toLocaleString()} ${n === 1 ? "memory" : "memories"}`
