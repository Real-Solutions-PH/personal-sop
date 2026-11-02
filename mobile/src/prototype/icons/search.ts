import { createStore } from "@domain/lib/store"
import { ALL_ICONS, findIcon, type IconEntry, iconKey, words } from "./catalog"

/** "running" → "run", "dishes" → "dish", "groceries" → "grocery": enough
 * for a habit or category name to meet its icon's words. */
export function stem(w: string) {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`
  if (w.length > 5 && w.endsWith("ing")) {
    const s = w.slice(0, -3)
    return /(.)\1$/.test(s) ? s.slice(0, -1) : s
  }
  if (/(sh|ch|x|ss)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    return w.slice(0, -1)
  return w
}
const stems = new Map(ALL_ICONS.map((i) => [i, i.words.map(stem)]))
const nameWords = new Map(ALL_ICONS.map((i) => [i, new Set(words(i.name))]))

/** How well one typed word matches an icon: a whole word (best, and more
 * the more of the name it is: "Running" over "Running shoe"), the start of
 * a word, or (4+ letters) inside one. */
function score(icon: IconEntry, q: string, partial: boolean) {
  const qs = stem(q),
    name = nameWords.get(icon) ?? new Set<string>()
  let best = 0
  icon.words.forEach((w, n) => {
    if ((stems.get(icon)?.[n] ?? w) === qs)
      best = Math.max(best, 4 + (name.has(w) ? 1 / name.size : 0))
    else if (q.length >= 2 && w.startsWith(q)) best = Math.max(best, 2)
    else if (partial && q.length >= 4 && w.includes(q)) best = Math.max(best, 1)
  })
  return best
}
const ranked = (scored: [IconEntry, number][]) =>
  scored
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([i]) => i)

/** Search: every typed word must match ("hot drink" finds coffee). */
export function searchIcons(query: string): IconEntry[] {
  const qs = words(query)
  if (!qs.length) return []
  return ranked(
    ALL_ICONS.map((i) => {
      const each = qs.map((q) => score(i, q, true))
      return [i, each.includes(0) ? 0 : each.reduce((a, b) => a + b, 0)]
    }),
  )
}

const FILLER = new Set(
  "a an and the my to of for in on at with every each day daily week weekly min mins minutes x times new more less go do get".split(
    " ",
  ),
)
/** Icons for a record's name ("Run 5k" → runner first), then `fallback` to
 * fill the row. Any word may match. */
export function suggestIcons(
  name: string,
  fallback: string[],
  limit = 12,
): IconEntry[] {
  const qs = words(name).filter((w) => !FILLER.has(w) && !/^\d+$/.test(w))
  const hits = qs.length
    ? ranked(
        ALL_ICONS.map((i) => [
          i,
          qs.reduce((sum, q) => sum + score(i, q, false), 0),
        ]),
      )
    : []
  const out = [...hits]
  for (const e of fallback) {
    const i = findIcon(e)
    if (i && !out.includes(i)) out.push(i)
  }
  return out.slice(0, limit)
}

function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    prev = row
  }
  return prev[b.length]
}
/** For a search with no matches: icons whose words are a typo or two away
 * ("cofee" → coffee), closest first. */
export function closestIcons(query: string, limit = 12): IconEntry[] {
  const qs = words(query).filter((q) => q.length >= 3)
  if (!qs.length) return []
  const scored = ALL_ICONS.map((i): [IconEntry, number] => {
    let best = 9
    for (const q of qs) {
      const room = q.length > 5 ? 2 : 1
      for (const w of i.words) {
        const d = distance(q, w.slice(0, Math.max(q.length, w.length)))
        if (d <= room) best = Math.min(best, d)
        // "photograph" still finds the camera through "photo".
        if (w.length >= 4 && q.startsWith(w)) best = Math.min(best, 1.5)
      }
    }
    return [i, best]
  }).filter(([, d]) => d < 9)
  return scored
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([i]) => i)
}

/** The last icons picked, newest first: device-only, like other picker
 * conveniences. */
export const recentIcons = createStore<{ icons: string[] }>(
  "icon-recent",
  () => ({ icons: [] }),
)
export const RECENT_LIMIT = 16
export function rememberIcon(emoji: string) {
  recentIcons.set((s) => ({
    icons: [
      emoji,
      ...s.icons.filter((e) => iconKey(e) !== iconKey(emoji)),
    ].slice(0, RECENT_LIMIT),
  }))
}
