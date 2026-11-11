// Quick-add syntax for one task line: "Reply SOW tomorrow 3pm !high #work".
// Dates, times and repeats come from `parseTask` (the parser the server's
// `tasks/parse.py` mirrors), so the two never disagree; this layer adds
// `!priority` and `#list`, finds where each recognised token sits in the
// input so the field can highlight it, and lets the person switch a token
// off (`ignore`) so it stays in the title as plain text.
import type { Recurrence, TaskPriority } from "./data"
import { today } from "./logic"
import { parseTask } from "./parse"

/** date: sets the day · time: sets the clock (and implies today) ·
 * when: both ("tonight") · repeat: a recurrence (and its first day). */
export type QuickTokenKind =
  | "date"
  | "time"
  | "when"
  | "repeat"
  | "priority"
  | "list"

export interface QuickToken {
  kind: QuickTokenKind
  /** The token exactly as typed. */
  text: string
  /** Lowercased text — what `ignore` holds to switch this token off. */
  key: string
  start: number
  end: number
}

export interface QuickParse {
  title: string
  dueDate: string | null
  dueTime: string | null
  recurrence: Recurrence | null
  priority: TaskPriority | null
  listId: string | null
  /** In input order. */
  tokens: QuickToken[]
}

const PRIORITY: Record<string, TaskPriority> = {
  high: "high",
  hi: "high",
  h: "high",
  "1": "high",
  medium: "medium",
  med: "medium",
  m: "medium",
  "2": "medium",
  low: "low",
  lo: "low",
  l: "low",
  "3": "low",
}
const BANG = /(^|\s)(!([a-z0-9]+))(?=\s|$)/gi
const HASH = /(^|\s)(#([^\s#!]+))(?=\s|$)/gi
const CLOCK =
  /^(?:at )?(?:\d{1,2}(?::\d{2})? ?(?:am|pm)|(?:[01]?\d|2[0-3]):[0-5]\d|noon)$/i
// Private-use code points: no regex in `parseTask` matches them, and \b
// treats them as non-word, so a masked token reads as an opaque gap.
const HOLE = "\uE000",
  FILL = "\uE001",
  HOLES = /\uE000\uE001*/g

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")

/** The list a `#name` names: an exact match on the name with case, spaces
 * and punctuation ignored, else the only list whose name starts with it. */
function findList(
  name: string,
  lists: readonly { id: string; name: string }[],
): string | null {
  const n = squash(name)
  if (!n) return null
  const exact = lists.find((l) => squash(l.name) === n)
  if (exact) return exact.id
  const starts = lists.filter((l) => squash(l.name).startsWith(n))
  return starts.length === 1 ? starts[0].id : null
}

function kindOf(text: string, tk: string): QuickTokenKind {
  if (CLOCK.test(text)) return "time"
  const alone = parseTask(text, tk)
  if (alone.recurrence) return "repeat"
  return alone.dueTime ? "when" : "date"
}

export function parseQuickAdd(
  input: string,
  opts: {
    today?: string
    lists?: readonly { id: string; name: string }[]
    ignore?: ReadonlySet<string>
  } = {},
): QuickParse {
  const tk = opts.today ?? today(),
    ignore = opts.ignore ?? new Set<string>(),
    tokens: QuickToken[] = []
  // Same length as the input throughout, so positions carry over.
  let masked = input
  const blank = (start: number, end: number, fill: string) => {
    masked = masked.slice(0, start) + fill + masked.slice(end)
  }
  let priority: TaskPriority | null = null,
    listId: string | null = null
  // Literal holes, left to right, put back into the title at the end.
  const literal: { start: number; text: string }[] = []
  const hole = (start: number, text: string) => {
    literal.push({ start, text })
    blank(start, start + text.length, HOLE + FILL.repeat(text.length - 1))
  }

  for (const m of input.matchAll(BANG)) {
    const text = m[2],
      start = (m.index ?? 0) + m[1].length,
      key = text.toLowerCase(),
      p = PRIORITY[m[3].toLowerCase()]
    if (!p) continue
    if (ignore.has(key) || priority) hole(start, text)
    else {
      priority = p
      tokens.push({
        kind: "priority",
        text,
        key,
        start,
        end: start + text.length,
      })
      blank(start, start + text.length, " ".repeat(text.length))
    }
  }
  if (opts.lists?.length)
    for (const m of input.matchAll(HASH)) {
      const text = m[2],
        start = (m.index ?? 0) + m[1].length,
        key = text.toLowerCase(),
        id = findList(m[3], opts.lists)
      if (!id) continue
      if (ignore.has(key) || listId) hole(start, text)
      else {
        listId = id
        tokens.push({
          kind: "list",
          text,
          key,
          start,
          end: start + text.length,
        })
        blank(start, start + text.length, " ".repeat(text.length))
      }
    }

  // Ignored date and time tokens: parse, hole out the first ignored match,
  // parse again, until what `parseTask` takes is all wanted.
  let parsed = parseTask(masked, tk)
  for (let guard = 0; guard < 20; guard++) {
    const spans = locate(masked, parsed.matched)
    const off = spans.find((s) => ignore.has(s.text.toLowerCase()))
    if (!off) {
      for (const s of spans)
        tokens.push({
          kind: kindOf(s.text, tk),
          text: s.text,
          key: s.text.toLowerCase(),
          start: s.start,
          end: s.start + s.text.length,
        })
      break
    }
    hole(off.start, off.text)
    parsed = parseTask(masked, tk)
  }

  literal.sort((a, b) => a.start - b.start)
  const nothingLeft =
    parsed.matched.length > 0 && parsed.title === masked.trim()
  let i = 0
  const title = (nothingLeft ? "" : parsed.title)
    .replace(HOLES, () => literal[i++]?.text ?? "")
    .replace(/\s+/g, " ")
    .trim()
  tokens.sort((a, b) => a.start - b.start)
  return {
    title,
    dueDate: parsed.dueDate,
    dueTime: parsed.dueTime,
    recurrence: parsed.recurrence,
    priority,
    listId,
    tokens,
  }
}

/** Where each string `parseTask` matched sits in `text`, replayed in the
 * order it took them (each match blanks its first occurrence). */
function locate(
  text: string,
  matched: string[],
): { start: number; text: string }[] {
  let work = text
  const out: { start: number; text: string }[] = []
  for (const m of matched) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
      "u",
    )
    const hit = re.exec(work)
    if (!hit) continue
    out.push({
      start: hit.index,
      text: text.slice(hit.index, hit.index + m.length),
    })
    work =
      work.slice(0, hit.index) +
      " ".repeat(m.length) +
      work.slice(hit.index + m.length)
  }
  return out
}
