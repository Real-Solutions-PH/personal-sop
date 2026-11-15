// Words the phone's recogniser should expect while the person dictates
// (iOS ``contextualStrings``). The server's Deepgram pass already gets the
// same kind of list as key terms (backend capture/vocabulary.py); this is
// for the live words and for whenever the server's pass is not used (it
// failed, or Send was tapped before it came back).
//
// Measured on the 350 test clips (ADR-0016 amendment): Apple's recogniser
// made 22.6% word errors without hints and 19.8% with the person's names as
// contextual strings, and kept 79% of names and numbers against 71%.
import { finStore } from "@domain/finance/store"
import { habitsStore } from "@domain/habits/store"

/** Apple advises a short list; past ~100 phrases it stops helping. */
const MAX_TERMS = 100
const MAX_WORDS = 4

// The assistant's name, then food, places and brands a person in the
// Philippines says that an English recogniser has rarely heard (the head of
// the server's fixed list).
const FIXED = [
  "Fern",
  "Unfurl",
  "whey protein",
  "adobo",
  "sinigang",
  "tapsilog",
  "longsilog",
  "pancit canton",
  "lumpia",
  "lechon",
  "kare-kare",
  "longganisa",
  "tocino",
  "halo-halo",
  "merienda",
  "ulam",
  "sisig",
  "bulalo",
  "tinola",
  "pandesal",
  "Jollibee",
  "Chowking",
  "Mang Inasal",
  "Meralco",
  "PLDT",
  "GCash",
  "Maya",
  "Shopee",
  "Lazada",
  "7-Eleven",
]

/** A stored name as it is said: no bracketed notes, at most four words. */
export function sayable(name: string): string | null {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/,| with | from /)[0]
    .split(/\s+/)
    .filter(Boolean)
  const out = words.slice(0, MAX_WORDS).join(" ")
  return out.length >= 3 ? out : null
}

/** "Fern", the person's own names, then the fixed list; deduplicated
 * without regard to case and capped. */
export function dictationVocabulary(own: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [FIXED[0], ...own, ...FIXED.slice(1)]) {
    const t = sayable(raw)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length >= MAX_TERMS) break
  }
  return out
}

/** The vocabulary for this person now: live habit and account names. */
export function currentVocabulary(): string[] {
  const own: string[] = []
  try {
    for (const h of habitsStore.get().habits)
      if (h.status !== "archived") own.push(h.name)
    for (const a of finStore.get().accounts) if (!a.archived) own.push(a.name)
  } catch {
    // A store not ready yet: the fixed list still helps.
  }
  return dictationVocabulary(own)
}
