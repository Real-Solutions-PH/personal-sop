// What the food library needs apart from drawing: who each food came from
// (the person, Fern, or a public database on the server), the person's own
// meal history read as foods, word search across all of it, the order
// results come in, and which parts of a name matched. One module, so every
// row of the library says its source the same way.
import type { Meal, MealSource } from "@domain/fitness/data"
import type { LibraryFood } from "@/live/nutrition-foods"

export type Origin = "you" | "fern" | "database"
export const ORIGINS: readonly Origin[] = ["you", "fern", "database"]

/** Sources Fern saves a food under (save_food: read from a label, told, a
 * brand); the server's ``FERN_SOURCES``. */
const FERN_SOURCES = new Set(["label", "said", "brand"])
const DATABASE_SOURCES = new Set(["usda", "off", "philfct"])

/** Who a library food came from: the server says (``origin``); an older
 * server or a sample food is read from its source. */
export function originOf(f: Pick<LibraryFood, "source"> & { origin?: string }) {
  if (f.origin === "you" || f.origin === "fern" || f.origin === "database")
    return f.origin
  if (DATABASE_SOURCES.has(f.source)) return "database"
  return FERN_SOURCES.has(f.source) ? "fern" : "you"
}

/** Who logged a meal: by hand (or a connected app) is the person; a photo,
 * a voice note or a message is Fern logging it from the chat. */
export function mealOrigin(source: MealSource): Origin {
  return source === "manual" || source === "connector" ? "you" : "fern"
}

/** The row's source word: the database by name, never just "server". */
export function originLabel(origin: Origin, source = ""): string {
  if (origin === "you") return "You"
  if (origin === "fern") return "Fern"
  if (source === "off") return "Open Food Facts"
  if (source === "philfct") return "FNRI"
  return "USDA"
}

/** One row of the library: a saved food (opens its page), or a food the
 * person ate that the library does not hold (opens the day it was eaten). */
export interface FoodEntry {
  key: string
  name: string
  origin: Origin
  /** Source word (``originLabel``). */
  label: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  /** "per 100 g", "1 cup", … */
  amount: string
  /** When the person last ate it, ms; null when never. */
  at: number | null
  uses: number
  aliases: string[]
  food?: LibraryFood
  /** The day it was last eaten, for a history-only row. */
  day?: string
}

const nameKey = (s: string) => s.trim().toLowerCase()

/** Lower case, plain words, as the server folds a name. */
export function words(q: string): string[] {
  return q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/** Foods the person logged that the library does not hold, newest first,
 * one row per name: what they ate, by hand or through Fern, at the amount
 * they last logged. Estimates still waiting for a photo read are left out. */
export function historyEntries(
  meals: readonly Meal[],
  library: readonly LibraryFood[],
): FoodEntry[] {
  const held = new Set(library.map((f) => nameKey(f.name)))
  const out = new Map<string, FoodEntry>()
  const sorted = [...meals]
    .filter((m) => m.status !== "pending_estimate")
    .sort((a, b) => b.eatenAt.localeCompare(a.eatenAt))
  for (const m of sorted) {
    const at = Date.parse(m.eatenAt)
    for (const it of m.items) {
      const k = nameKey(it.name)
      if (!k || held.has(k)) continue
      const seen = out.get(k)
      if (seen) {
        seen.uses += 1
        continue
      }
      const origin = mealOrigin(m.source)
      out.set(k, {
        key: `meal:${k}`,
        name: it.name.trim(),
        origin,
        label: originLabel(origin),
        kcal: it.kcal,
        protein: it.protein,
        carbs: it.carbs,
        fat: it.fat,
        amount: `${it.qty.toLocaleString("en-US")} ${it.unit}`.trim(),
        at,
        uses: 1,
        aliases: [],
        day: m.eatenAt,
      })
    }
  }
  return [...out.values()]
}

/** A saved food as a row; its time is the person's last meal holding it
 * (matched by name), else the household's last use. */
export function libraryEntry(
  f: LibraryFood,
  ateAt: ReadonlyMap<string, number>,
  amount: string,
): FoodEntry {
  const used = f.last_used_at ? Date.parse(f.last_used_at) : Number.NaN
  const origin = originOf(f)
  return {
    key: f.id,
    name: f.name,
    origin,
    label: originLabel(origin, f.source),
    kcal: f.kcal,
    protein: f.protein,
    carbs: f.carbs,
    fat: f.fat,
    amount,
    at: ateAt.get(nameKey(f.name)) ?? (Number.isNaN(used) ? null : used),
    uses: f.use_count,
    aliases: f.aliases,
    food: f,
  }
}

/** When the person last ate each food, by name. */
export function lastAte(meals: readonly Meal[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of meals) {
    if (m.status === "pending_estimate") continue
    const at = Date.parse(m.eatenAt)
    for (const it of m.items) {
      const k = nameKey(it.name)
      if ((out.get(k) ?? -Infinity) < at) out.set(k, at)
    }
  }
  return out
}

/** How well a name answers the words, best first: 0 the name starts with
 * them as whole words ("egg" → "Egg, whole"), 1 it starts with them
 * ("Eggplant"), 2 every word starts a word of the name ("Boiled egg"), 3
 * every word is inside it or an alias; null when a word is missing. */
export function matchRank(
  e: Pick<FoodEntry, "name" | "aliases">,
  ws: readonly string[],
): number | null {
  if (!ws.length) return 3
  const name = e.name.toLowerCase()
  const hay = [name, ...e.aliases.map((a) => a.toLowerCase())].join(" ")
  if (!ws.every((w) => hay.includes(w))) return null
  const nameWords = words(name)
  const joined = nameWords.join(" "),
    typed = ws.join(" ")
  if (joined === typed || joined.startsWith(`${typed} `)) return 0
  if (joined.startsWith(typed)) return 1
  return ws.every((w) => nameWords.some((n) => n.startsWith(w))) ? 2 : 3
}

/** The library's order: the person's own and Fern's foods before database
 * ones; among them the most recently eaten, then the best match, then the
 * most used. Database foods keep the best match first, then the server's
 * order (most trusted source). Entries missing a word are dropped. */
export function rank(entries: readonly FoodEntry[], q: string): FoodEntry[] {
  const ws = words(q)
  return entries
    .map((e, i) => ({ e, i, m: matchRank(e, ws) }))
    .filter((x): x is { e: FoodEntry; i: number; m: number } => x.m !== null)
    .sort((a, b) => {
      const da = a.e.origin === "database" ? 1 : 0,
        db = b.e.origin === "database" ? 1 : 0
      if (da !== db) return da - db
      if (!da) {
        const at = (b.e.at ?? -Infinity) - (a.e.at ?? -Infinity)
        if (at) return at
      }
      return a.m - b.m || (da ? 0 : b.e.uses - a.e.uses) || a.i - b.i
    })
    .map((x) => x.e)
}

/** A name cut into the parts the words matched and the rest, for showing
 * the match. Overlapping matches merge; case is kept as written. */
export function highlight(
  name: string,
  ws: readonly string[],
): { text: string; hit: boolean }[] {
  const lower = name.toLowerCase()
  const hits = new Array<boolean>(name.length).fill(false)
  for (const w of ws) {
    if (!w) continue
    let from = 0
    for (;;) {
      const at = lower.indexOf(w, from)
      if (at < 0) break
      hits.fill(true, at, at + w.length)
      from = at + 1
    }
  }
  const out: { text: string; hit: boolean }[] = []
  for (let i = 0; i < name.length; i++) {
    const last = out.at(-1)
    if (last && last.hit === hits[i]) last.text += name[i]
    else out.push({ text: name[i], hit: hits[i] })
  }
  return out
}
