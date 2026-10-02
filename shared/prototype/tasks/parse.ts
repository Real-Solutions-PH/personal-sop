import { weekday } from "../lib/day"
import type { Recurrence, TaskSource } from "./data"
import { addDays, today } from "./logic"
export interface Parsed {
  title: string
  dueDate: string | null
  dueTime: string | null
  recurrence: Recurrence | null
  matched: string[]
}
const DAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
}
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
]
const pad = (n: number) => String(n).padStart(2, "0")
function nextWeekday(from: string, wd: number, allowToday = false): string {
  for (let i = allowToday ? 0 : 1; i < 8; i++) {
    const k = addDays(from, i)
    if (weekday(k) === wd) return k
  }
  return addDays(from, 7)
}
function nthOfMonth(from: string, n: number): string {
  const [y, m, d] = from.split("-").map(Number)
  const date = n > d ? new Date(y, m - 1, n) : new Date(y, m, n)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
export function parseTask(input: string, tk = today()): Parsed {
  let text = ` ${input} `
  const matched: string[] = []
  const o: {
    dueDate: string | null
    dueTime: string | null
    recurrence: Recurrence | null
  } = { dueDate: null, dueTime: null, recurrence: null }
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = text.match(re)
    if (!m) return
    matched.push(m[0].trim())
    fn(m)
    text = text.replace(m[0], " ")
  }
  take(/\b(every ?day|daily)\b/i, () => {
    o.recurrence = { rule: { kind: "daily" }, mode: "fixed" }
  })
  take(/\bevery weekday\b|\bweekdays\b/i, () => {
    o.recurrence = { rule: { kind: "weekdays" }, mode: "fixed" }
  })
  take(/\bevery (\d+) days\b/i, (m) => {
    o.recurrence = { rule: { kind: "everyN", n: Number(m[1]) }, mode: "fixed" }
  })
  take(/\b(every month|monthly)\b/i, () => {
    o.recurrence = { rule: { kind: "monthly", day: 1 }, mode: "fixed" }
  })
  take(
    /\bevery (sun|mon|tue|wed|thu|fri|sat)(?:day|nesday|rsday|urday|sday)?s?\b/i,
    (m) => {
      const wd = DAYS[m[1].toLowerCase()]
      o.recurrence = { rule: { kind: "weekly", days: [wd] }, mode: "fixed" }
      o.dueDate = nextWeekday(tk, wd, true)
    },
  )
  take(/\bweekly\b|\bevery week\b/i, () => {
    o.recurrence = {
      rule: { kind: "weekly", days: [weekday(tk)] },
      mode: "fixed",
    }
  })
  take(/\b(?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)\b/i, (m) => {
    let h = Number(m[1]) % 12
    if (m[3].toLowerCase() === "pm") h += 12
    o.dueTime = `${pad(h)}:${pad(Number(m[2] ?? 0))}`
  })
  if (!o.dueTime)
    take(/\b(?:at )?([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => {
      o.dueTime = `${pad(Number(m[1]))}:${m[2]}`
    })
  take(/\bnoon\b/i, () => {
    o.dueTime = "12:00"
  })
  take(/\btonight\b/i, () => {
    o.dueDate = tk
    o.dueTime = o.dueTime ?? "20:00"
  })
  take(/\b(today|tdy|mamaya)\b/i, () => {
    o.dueDate = tk
  })
  take(/\b(tomorrow|tmr|tmrw|bukas)\b/i, () => {
    o.dueDate = addDays(tk, 1)
  })
  take(/\bnext week\b/i, () => {
    o.dueDate = nextWeekday(tk, 1)
  })
  take(/\bthis weekend\b|\bweekend\b/i, () => {
    o.dueDate = nextWeekday(tk, 6, true)
  })
  take(/\bin (\d+) days?\b/i, (m) => {
    o.dueDate = addDays(tk, Number(m[1]))
  })
  take(
    /\b(?:by |on |this |next )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?\b/i,
    (m) => {
      o.dueDate = nextWeekday(tk, DAYS[m[1].toLowerCase()])
    },
  )
  take(
    /\b(?:on )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})\b/i,
    (m) => {
      const mo = MONTHS.indexOf(m[1].toLowerCase())
      const y = Number(tk.slice(0, 4))
      let k = `${y}-${pad(mo + 1)}-${pad(Number(m[2]))}`
      if (k < tk) k = `${y + 1}-${pad(mo + 1)}-${pad(Number(m[2]))}`
      o.dueDate = k
    },
  )
  take(/\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)\b/i, (m) => {
    const n = Number(m[1])
    o.dueDate = nthOfMonth(tk, n)
    const r = o.recurrence
    if (r?.rule.kind === "monthly") r.rule = { kind: "monthly", day: n }
  })
  const r = o.recurrence
  if (r?.rule.kind === "monthly" && o.dueDate)
    r.rule = { kind: "monthly", day: Number(o.dueDate.slice(8)) }
  if (o.recurrence && !o.dueDate) o.dueDate = tk
  if (o.dueTime && !o.dueDate) o.dueDate = tk
  const title = text
    .replace(/\b(remind me to|remind me|by|on|at)\s*$/i, "")
    .replace(/^\s*(remind me to|remind me)\b/i, "")
    .replace(/\s+/g, " ")
    .trim()
  return {
    title: title ? title[0].toUpperCase() + title.slice(1) : input.trim(),
    ...o,
    matched,
  }
}
const GROCERY =
  /\b(eggs?|rice|milk|bread|pandesal|coffee|chicken|pork|beef|fish|tuna|sardines|garlic|onions?|tomato(es)?|bananas?|apples?|vegetables?|veggies|soy sauce|vinegar|sugar|salt|oil|detergent|soap|shampoo|tissue|noodles|pasta|cheese|butter|protein|oats|water)\b/i
const WORK =
  /\b(deck|client|meeting|report|email|pr\b|jira|sprint|invoice|slides|standup|boss|work)\b/i
export interface CaptureDraft extends Parsed {
  listId: string | null
  source: TaskSource
  vague: boolean
}
const VAGUE = /\b(after lunch|this afternoon|later today|later|after work)\b/i
export function splitCapture(
  text: string,
  source: TaskSource = "capture-text",
  listIds: string[] = ["work", "job2", "life", "groceries"],
): CaptureDraft[] {
  const parts = text
    .split(
      /,|;|\n| and (?=(?:buy|call|email|finish|pay|send|book|pick|reply|clean)\b)/i,
    )
    .flatMap((p) => (/^\s*buy\b/i.test(p) ? p.split(/ and /i) : [p]))
    .map((p) => p.trim())
    .filter(Boolean)
  return parts.map((p) => {
    const buy = /^\s*buy\s+/i.test(p)
    const vague = VAGUE.test(p)
    const clean = p
      .replace(/^\s*buy\s+/i, "")
      .replace(/\bfor work\b/i, "")
      .replace(VAGUE, "")
    const parsed = parseTask(clean)
    if (vague && !parsed.dueTime) parsed.dueDate = parsed.dueDate ?? today()
    const has = (id: string) => listIds.includes(id)
    let listId: string | null = null
    if ((buy || GROCERY.test(clean)) && !parsed.dueDate && has("groceries"))
      listId = "groceries"
    else if ((WORK.test(p) || /\bfor work\b/i.test(p)) && has("work"))
      listId = "work"
    else if (/\b(job ?2|side ?job|freelance)\b/i.test(p) && has("job2"))
      listId = "job2"
    else if (
      /\b(pay|bill|meralco|pldt|mama|papa|dentist|doctor|laundry|clean)\b/i.test(
        p,
      ) &&
      has("life")
    )
      listId = "life"
    return { ...parsed, listId, source, vague: vague && !parsed.dueTime }
  })
}
