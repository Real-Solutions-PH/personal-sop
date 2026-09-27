"use client"

import { finStore } from "../finance/store"
import { parseMealText } from "../fitness/actions"
import { latestBodyweight } from "../fitness/calc"
import { fitStore } from "../fitness/store"
import { habitsStore } from "../habits/store"
import { dayKey } from "../lib/day"
import { splitCapture } from "../tasks/parse"
import { tasksStore } from "../tasks/store"
import type {
  FollowUp,
  InfoCard,
  MealItemDraft,
  Payload,
  RecordKind,
  RuleKey,
  Target,
} from "./data"

// Simulated AI (ADR-0009): a deterministic local parser for the IA §6 routing
// table and reasonable variants (English + Taglish). Splits multi-intent
// messages into drafts; the engine turns drafts into record cards with tiers.
// ponytail: replaced by the OpenRouter agent + tool layer (22-ai-module.md).

export interface RecordDraft {
  t: "record"
  kind: RecordKind
  target: Target
  rule: RuleKey
  payload: Payload
  /** Force Tier B regardless of the rule (photo, money over threshold, typo…). */
  confirm?: boolean
  ask?: FollowUp
  warn?: string
  confidence?: number
  /** Relative day offset resolved from "yesterday" etc. */
  dayOffset?: number
}

export type Draft =
  | RecordDraft
  | { t: "question"; text: string }
  | { t: "info"; card: Omit<InfoCard, "id" | "t"> }

export interface ParseCtx {
  hint?: string
  source: string
  photo?: boolean
  /** Capture time (records use it — J9). */
  at: string
}

// ---------------------------------------------------------------- lexicon

const MONEY_CATS: [RegExp, string, string?][] = [
  [/\bgrab ?food\b|\bfoodpanda\b/, "dining", "GrabFood"],
  [/\bgrab\b|\bangkas\b|\bjoyride\b|\btaxi\b/, "grab", "Grab"],
  [
    /\b(jeep(ney)?|mrt|lrt|tricycle|trike|bus|commute|pamasahe|fare|p2p)\b/,
    "commute",
    "Jeep / MRT",
  ],
  [/\b(gas|fuel|petron|shell|caltex|parking|toll)\b/, "transport"],
  [/\b(coffee|kape|starbucks|tims|tim hortons|latte|frappe)\b/, "coffee"],
  [
    /\b(groceries|grocery|puregold|sm supermarket|supermarket|palengke|market|savemore)\b/,
    "groceries",
  ],
  [/\b(meralco|electric(ity)?|kuryente)\b/, "electricity", "Meralco"],
  [/\b(internet|pldt|converge|wifi|fiber)\b/, "internet"],
  [/\b(load|globe|smart|dito|mobile plan|postpaid)\b/, "phone"],
  [/\b(rent|upa)\b/, "rent"],
  [/\b(netflix|spotify|youtube premium|icloud|subscription|disney)\b/, "subs"],
  [/\b(shopee|lazada|clothes|shirt|shoes|zalora|uniqlo)\b/, "shopping"],
  [/\b(movie|cinema|concert|games?|steam)\b/, "entertainment"],
  [
    /\b(medicine|gamot|mercury|watsons|doctor|checkup|dentist|vitamins)\b/,
    "health",
  ],
  [/\b(haircut|barber|salon|gupit)\b/, "personal"],
  [/\b(gift|regalo|birthday)\b/, "gifts"],
  [
    /\b(lunch|dinner|breakfast|merienda|food|jollibee|mcdo|mcdonald'?s|chowking|inasal|kfc|carinderia|samgyup|pizza|snack|ulam|burger|milk ?tea)\b/,
    "dining",
  ],
]

const PAYEES: [RegExp, string][] = [
  [/\bjollibee\b/, "Jollibee"],
  [/\bmcdo|mcdonald/, "McDonald's"],
  [/\bchowking\b/, "Chowking"],
  [/\binasal\b/, "Mang Inasal"],
  [/\bstarbucks\b/, "Starbucks"],
  [/\btims|tim hortons/, "Tim Hortons"],
  [/\bpuregold\b/, "Puregold"],
  [/\bsm\b/, "SM Supermarket"],
  [/\bshopee\b/, "Shopee"],
  [/\blazada\b/, "Lazada"],
  [/\bmercury\b/, "Mercury Drug"],
  [/\bnetflix\b/, "Netflix"],
  [/\bspotify\b/, "Spotify"],
  [/\bmeralco\b/, "Meralco"],
  [/\bpldt\b/, "PLDT"],
  [/\bgrab ?food\b/, "GrabFood"],
  [/\bgrab\b/, "Grab"],
]

const ACCOUNT_WORDS: [RegExp, string][] = [
  [/\bg-?cash\b/, "gcash"],
  [/\b(pay)?maya\b/, "maya"],
  [/\b(credit ?card|bpi ?card|cc|card)\b/, "bpicc"],
  [/\bbpi\b/, "bpi"],
  [/\bcol\b/, "col"],
  [/\bcash\b/, "cash"],
]

const EXERCISES: [RegExp, string][] = [
  [/\bincline\b/, "Incline Dumbbell Press"],
  [/\bbench\b/, "Barbell Bench Press"],
  [/\b(ohp|overhead|military)\b/, "Overhead Press"],
  [/\blateral/, "Lateral Raise"],
  [/\bpush ?downs?\b|\btricep/, "Triceps Pushdown"],
  [/\brows?\b/, "Barbell Row"],
  [/\bpull ?downs?\b|\blat\b/, "Lat Pulldown"],
  [/\bpull ?-?ups?\b|\bchin ?-?ups?\b/, "Pull-up"],
  [/\bface ?pulls?\b/, "Face Pull"],
  [/\bcurls?\b/, "Dumbbell Curl"],
  [/\brdl\b|\bromanian\b/, "Romanian Deadlift"],
  [/\bleg ?press\b/, "Leg Press"],
  [/\bsquats?\b/, "Back Squat"],
  [/\bdeadlifts?\b/, "Deadlift"],
  [/\bdips?\b/, "Dips"],
  [/\blunges?\b/, "Lunge"],
  [/\bplank\b/, "Plank"],
]

const pad = (n: number) => String(n).padStart(2, "0")

export const title = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase()).trim()

/** "35k" → 35000, "1.5k" → 1500, "1,500" → 1500, "₱250" → 250. */
export function parseAmount(
  s: string,
): { amount: number; usd?: boolean } | null {
  const usd = /\$\s?\d|\b\d+(\.\d+)?\s?(usd|dollars?)\b/i.test(s)
  const re =
    /(?:₱|php|p|\$)?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k\b)?(?!\s?(?:min|mins|minutes|km|kg|kilos?|x\b|x\d|pcs?|pages?|glasses?|cups?|reps?|sets?|am\b|pm\b|th\b|st\b|nd\b|rd\b|hours?|hrs?|steps?|servings?|%|:\d))/gi
  for (const m of s.matchAll(re)) {
    const raw = m[1].replace(/,/g, "")
    let n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) continue
    if (m[2]) n *= 1000
    // skip "x" set notations like 3x5 that slipped through
    const after = s.slice(
      (m.index ?? 0) + m[0].length,
      (m.index ?? 0) + m[0].length + 1,
    )
    if (after === "x") continue
    return { amount: Math.round(n), usd }
  }
  return null
}

function moneyCategory(s: string): { cat?: string; payee?: string } {
  const low = s.toLowerCase()
  let payee: string | undefined
  for (const [re, p] of PAYEES)
    if (re.test(low)) {
      payee = p
      break
    }
  for (const [re, cat, p] of MONEY_CATS)
    if (re.test(low)) return { cat, payee: payee ?? p }
  return { payee }
}

function accountIn(s: string): string | undefined {
  const low = s.toLowerCase()
  for (const [re, id] of ACCOUNT_WORDS) if (re.test(low)) return id
  return undefined
}

function accountsIn(s: string): string[] {
  const low = s.toLowerCase()
  const hits: { id: string; i: number }[] = []
  for (const [re, id] of ACCOUNT_WORDS) {
    const m = low.match(re)
    if (m?.index !== undefined && !hits.some((h) => h.id === id))
      hits.push({ id, i: m.index })
  }
  return hits.sort((a, b) => a.i - b.i).map((h) => h.id)
}

export const defaultAccount = () => {
  const st = finStore.get().settings
  return st.lastAccountId ?? st.defaultAccountId
}

function relDay(s: string): number {
  if (/\b(yesterday|kahapon|last night)\b/i.test(s)) return -1
  return 0
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "my",
  "with",
  "done",
  "did",
  "finished",
  "completed",
  "na",
  "yung",
  "ang",
  "for",
  "to",
  "of",
  "and",
  "today",
  "already",
])

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))

const stem = (w: string) => w.replace(/(ation|ing|ed|es|s|e)$/, "").slice(0, 5)

/** Fuzzy habit match: stems of habit-name words found in the text. Best first. */
export function matchHabits(text: string) {
  const qs = words(text).map(stem)
  return habitsStore
    .get()
    .habits.filter((h) => h.status !== "archived")
    .map((h) => {
      const hw = words(h.name.replace(/[×x]\d+|\d+m\b|\d+/g, "")).map(stem)
      const score = hw.filter((w) => w.length >= 3 && qs.includes(w)).length
      return { h, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.h)
}

/** Open tasks whose title shares words with the query. */
export function matchTasks(text: string) {
  const qs = words(text).map(stem)
  if (!qs.length) return []
  return tasksStore
    .get()
    .tasks.filter((t) => t.status === "open")
    .map((t) => {
      const tw = words(t.title).map(stem)
      const score = tw.filter((w) => qs.includes(w)).length
      return { t, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t)
}

const mealLabel = (
  s: string,
): "breakfast" | "lunch" | "dinner" | "snack" | undefined => {
  if (/\b(breakfast|almusal)\b/i.test(s)) return "breakfast"
  if (/\b(lunch|tanghalian)\b/i.test(s)) return "lunch"
  if (/\b(dinner|hapunan|supper)\b/i.test(s)) return "dinner"
  if (/\b(snack|merienda)\b/i.test(s)) return "snack"
  return undefined
}

export function mealDraft(
  raw: string,
  opts: { photo?: boolean; defaultPlate?: boolean } = {},
): RecordDraft | null {
  const parsed =
    parseMealText(raw) ??
    (opts.defaultPlate ? parseMealText("chicken adobo, rice") : null)
  if (!parsed) return null
  const items: MealItemDraft[] = parsed.items.map(
    ({ id: _id, ...rest }) => rest,
  )
  const ask: FollowUp | undefined = parsed.followUp
    ? {
        question: parsed.followUp.question,
        field: "rice",
        options: parsed.followUp.options.map((o) => ({ label: o, value: o })),
      }
    : undefined
  return {
    t: "record",
    kind: "meal",
    target: "fitness",
    rule: "meal",
    confirm: opts.photo || parsed.confidence < 0.7,
    confidence: opts.photo ? parsed.confidence - 0.08 : parsed.confidence,
    ask,
    payload: {
      kind: "meal",
      raw,
      label: mealLabel(raw),
      items,
      confidence: parsed.confidence,
      fromPhoto: opts.photo,
    },
  }
}

const HABIT_ICONS: [RegExp, string][] = [
  [/read/, "📖"],
  [/run|jog/, "🏃"],
  [/meditat|breath/, "🧘"],
  [/water|drink/, "💧"],
  [/stretch|yoga|mobility/, "🤸"],
  [/journal|write/, "✍️"],
  [/sleep|bed/, "🛏️"],
  [/walk|steps/, "🚶"],
  [/floss|teeth/, "🦷"],
  [/gym|workout|lift/, "🏋️"],
]

function parseTime(s: string): string | undefined {
  const m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i)
  if (m) {
    let h = Number(m[1]) % 12
    if (m[3].toLowerCase() === "pm") h += 12
    return `${pad(h)}:${m[2] ?? "00"}`
  }
  const m24 = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  return m24 ? `${pad(Number(m24[1]))}:${m24[2]}` : undefined
}

function parseDays(s: string): number[] {
  const low = s.toLowerCase()
  if (/\bweekdays?\b/.test(low)) return [1, 2, 3, 4, 5]
  if (/\bweekends?\b/.test(low)) return [0, 6]
  const map: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  }
  const hits = Object.entries(map)
    .filter(([k]) => new RegExp(`\\b${k}`).test(low))
    .map(([, v]) => v)
  return hits.length ? hits : [0, 1, 2, 3, 4, 5, 6]
}

export function habitCreateDraft(spec: string, logToday = false): RecordDraft {
  const low = spec.toLowerCase()
  const nameRaw =
    spec
      .replace(/\b(every|each|daily|weekdays?|weekends?|at|on)\b.*$/i, "")
      .replace(/\d+\s?(min|mins|minutes|pages|glasses|x)\b.*$/i, "")
      .trim() || spec
  const min = low.match(/(\d+)\s?(min|mins|minutes)\b/)
  const cnt = low.match(/(\d+)\s?(pages|glasses|cups|reps|times)\b/)
  const icon = HABIT_ICONS.find(([re]) => re.test(low))?.[1] ?? "✅"
  return {
    t: "record",
    kind: "habitCreate",
    target: "habits",
    rule: "structure",
    confirm: true,
    payload: {
      kind: "habitCreate",
      name: title(nameRaw),
      icon,
      type: min ? "duration" : cnt ? "count" : "check",
      target: min ? Number(min[1]) : cnt ? Number(cnt[1]) : undefined,
      unit: cnt ? cnt[2] : undefined,
      days: parseDays(spec),
      time: parseTime(spec),
      logToday,
    },
  }
}

function strengthExercises(s: string) {
  // "bench 80x5x3" (kg x reps x sets) · "squat 3x5 100" / "3x5 @100" (sets x reps kg) · "rdl 3x8 80kg"
  const parts = s.split(/,|;|\band\b/i)
  const out: { exercise: string; sets: { reps: number; weight: number }[] }[] =
    []
  const unknown: string[] = []
  for (const p of parts) {
    const low = p.toLowerCase()
    const ex = EXERCISES.find(([re]) => re.test(low))?.[1]
    let sets: { reps: number; weight: number }[] = []
    const wrs = low.match(/(\d+(?:\.\d+)?)\s?(?:kg)?\s?x\s?(\d+)\s?x\s?(\d+)/)
    const srw = low.match(
      /(\d+)\s?x\s?(\d+)\s*(?:@|at)?\s*(\d+(?:\.\d+)?)?\s?(?:kg)?/,
    )
    if (wrs) {
      const w = Number(wrs[1])
      const reps = Number(wrs[2])
      const n = Number(wrs[3])
      // Heuristic: first number > 20 → it's the weight (80x5x3)
      if (w > 20) sets = Array.from({ length: n }, () => ({ reps, weight: w }))
      else sets = Array.from({ length: w }, () => ({ reps, weight: n }))
    } else if (srw) {
      const n = Number(srw[1])
      const reps = Number(srw[2])
      const w = srw[3] ? Number(srw[3]) : 0
      sets = Array.from({ length: Math.min(n, 10) }, () => ({
        reps,
        weight: w,
      }))
    }
    if (!sets.length) continue
    const name =
      ex ??
      title(
        p
          .replace(/(\d+(?:\.\d+)?)\s?(kg)?\s?x.*$/i, "")
          .replace(/^\s*(did( legs| push| pull)?:?)\s*/i, "")
          .trim() || "Exercise",
      )
    if (!ex) unknown.push(name)
    out.push({ exercise: name, sets })
  }
  return { out, unknown }
}

// ---------------------------------------------------------------- classify

type Kind =
  | "journal"
  | "question"
  | "advice"
  | "command"
  | "habitCreate"
  | "routine"
  | "planned"
  | "transfer"
  | "income"
  | "task"
  | "cardio"
  | "strength"
  | "weighIn"
  | "expense"
  | "taskComplete"
  | "habit"
  | "meal"
  | "feel"
  | "unknown"

const FEEL =
  /\b(ugh|tired|pagod|long day|stressed|stress|happy|sad|grateful|anxious|burn(ed|t)? out|frustrated|excited|proud|lonely|masaya|malungkot|nakakapagod)\b/i

const HAS_EX = (s: string) => EXERCISES.some(([re]) => re.test(s))

export function classify(seg: string, hint?: string): Kind {
  const s = seg.toLowerCase().trim()
  if (/^(journal|dear diary|diary|reflection)\s*[:\-–]/.test(s))
    return "journal"
  if (/^(should i|can i afford|is it worth|worth it)\b/.test(s)) return "advice"
  if (
    /\?\s*$/.test(s) ||
    /^(how|what|what's|whats|when|which|who|where|did i|do i|have i|am i|is my|are my|show me|magkano|ilan|gaano)\b/.test(
      s,
    )
  )
    return "question"
  if (
    /^(change|make|set) (that|it|the last( one)?|last one)\b/.test(s) ||
    /^(delete|remove|undo|cancel|scratch) (that|it|the last( one)?|last one)\b/.test(
      s,
    )
  )
    return "command"
  if (/^(new habit|add (a )?habit|create (a )?habit|start a habit)\b/.test(s))
    return "habitCreate"
  if (
    /\broutine\b/.test(s) &&
    /\b(start|started|starting|begin|play)\b/.test(s)
  )
    return "routine"
  if (hint === "journal") return "journal"
  const amt = parseAmount(s)
  if (amt && /\bevery (month|\d{1,2}(st|nd|rd|th))\b|\bmonthly\b/.test(s))
    return "planned"
  if (
    amt &&
    /\b(moved|move|transfer(red)?|sent|send|lipat|top ?up|topped up|cash ?in|withdr[ae]w)\b/.test(
      s,
    ) &&
    accountsIn(s).length >= 1 &&
    /\b(to|into|sa|from)\b/.test(s)
  )
    return "transfer"
  if (
    amt &&
    /\b(got paid|salary|sweldo|payday|received|income|client paid|paid me|refund|bonus|commission)\b/.test(
      s,
    )
  )
    return "income"
  if (
    /^(remind me|reminder|todo|to do|to-do|need to|i need to|gotta|must|don'?t forget|buy|call|email|book|schedule|pick up|reply|clean|submit|renew|text)\b/.test(
      s,
    ) ||
    (/^pay\b/.test(s) && !amt)
  )
    return "task"
  if (
    /\b(ran|run|jog(ged)?|walk(ed)?|biked?|cycled?|cycling|swam|swim|hiked?|treadmill)\b/.test(
      s,
    ) &&
    /\d\s?(k\b|km|min|mins|minutes|hr|hour)/.test(s)
  )
    return "cardio"
  if (HAS_EX(s) && /\d\s?x\s?\d/.test(s)) return "strength"
  if (
    (/\b(weigh(ed|t|ing)?|timbang|scale)\b/.test(s) &&
      /\d{2,3}(\.\d)?/.test(s)) ||
    (hint === "weigh-in" && /\d{2,3}(\.\d)?/.test(s)) ||
    /^\d{2,3}(\.\d)?\s?kg$/.test(s)
  )
    return "weighIn"
  if (
    amt &&
    (hint === "expense" ||
      /\b(spent|spend|paid|bought|gastos|gumastos|bayad|binayad|cost|₱|php)\b/.test(
        s,
      ) ||
      /[₱$]/.test(s) ||
      moneyCategory(s).cat ||
      accountIn(s))
  ) {
    if (hint === "meal" && !/\b(spent|paid|₱|php)\b/.test(s)) return "meal"
    return "expense"
  }
  if (
    /^(done with|finished|completed|tapos na|natapos|sent the|submitted|did the)\b/.test(
      s,
    )
  ) {
    if (matchHabits(s).length && !matchTasks(s).length) return "habit"
    return "taskComplete"
  }
  if (
    /^(did|done|finished|completed|meditated|read|drank|journaled|slept|stretched|walked|flossed)\b/.test(
      s,
    ) &&
    (matchHabits(s).length || /^did my\b/.test(s))
  )
    return "habit"
  if (
    matchHabits(s).length &&
    /\d+\s?(min|mins|minutes|pages|glasses|cups)\b/.test(s)
  )
    return "habit"
  if (hint === "task") return "task"
  if (
    hint === "meal" ||
    /\b(ate|eat|had|kumain|breakfast|lunch|dinner|snack|merienda|almusal|tanghalian|hapunan)\b/.test(
      s,
    ) ||
    parseMealText(s)
  )
    return parseMealText(s) || hint === "meal" ? "meal" : "unknown"
  if (s.length > 160) return "journal"
  if (FEEL.test(s)) return "feel"
  return "unknown"
}

/** Split a message into segments; re-merge list continuations ("buy eggs, milk"). */
export function segment(
  text: string,
  hint?: string,
): { seg: string; kind: Kind }[] {
  const t = text.trim()
  const whole = classify(t, hint)
  // A trailing "?" makes the whole message look like a question; only treat it
  // as one when it also *starts* like one ("paid 1500, how much…?" splits).
  const first = t.split(/,|;|\n|\s+and\s+/)[0]
  const wholeQuestion =
    whole === "question" && classify(first, hint) === "question"
  // Whole-message intents never split.
  if (
    whole === "journal" ||
    wholeQuestion ||
    whole === "advice" ||
    whole === "habitCreate" ||
    t.length > 220
  )
    return [
      {
        seg: t,
        kind: t.length > 220 && whole !== "question" ? "journal" : whole,
      },
    ]
  const raw = t
    .split(
      /\n|;|\s+then\s+|,\s*(?:and\s+)?|\s+(?:and|tapos|pati)\s+(?=(?:i\s+)?(?:how|what|what's|whats|spent|paid|ran|jogged|walked|remind|bought|weighed|did|meditated|read|got|moved|transferred|sent|had|ate|buy|call|pay|bench|squat|log|gastos|kumain|started|finished|done)\b)/i,
    )
    .map((x) => x.trim())
    .filter(Boolean)
  const out: { seg: string; kind: Kind }[] = []
  for (const seg of raw) {
    const kind = classify(seg, hint)
    const prev = out.at(-1)
    const bare = !/\d/.test(seg) && seg.split(/\s+/).length <= 3
    if (
      prev &&
      ((prev.kind === "task" &&
        /^buy\b/i.test(prev.seg) &&
        (kind === "unknown" || kind === "meal") &&
        bare) ||
        (prev.kind === "strength" &&
          (kind === "strength" || kind === "unknown")) ||
        (prev.kind === "meal" &&
          (kind === "meal" || (kind === "unknown" && bare))) ||
        (prev.kind === "habitCreate" && kind === "unknown"))
    ) {
      prev.seg = `${prev.seg}, ${seg}`
      continue
    }
    out.push({ seg, kind })
  }
  return out
}

// ---------------------------------------------------------------- build drafts

function expenseDraft(seg: string, ctx: ParseCtx): RecordDraft | null {
  const a = parseAmount(seg)
  if (!a) return null
  const { cat, payee } = moneyCategory(seg)
  const acct = accountIn(seg)
  const amount = a.usd ? a.amount * 56 : a.amount
  const noteMatch = seg.match(/\b(?:on|for|at|sa)\s+([a-z][\w' ]{1,30})$/i)
  const d: RecordDraft = {
    t: "record",
    kind: "expense",
    target: "finance",
    rule: "expense",
    dayOffset: relDay(seg),
    payload: {
      kind: "expense",
      amount,
      categoryId: cat,
      accountId: acct ?? defaultAccount(),
      payee: payee ?? (noteMatch ? title(noteMatch[1]) : undefined),
      currency: a.usd ? "USD" : undefined,
      fromReceipt: ctx.photo,
    },
  }
  if (a.usd) {
    d.confirm = true
    d.warn = `Foreign currency: $${a.amount} ≈ ₱${amount.toLocaleString()} at ₱56/$ (FX rules are an open question in Finance).`
  }
  if (!cat) {
    const recent = recentExpenseCats()
    d.ask = {
      question: `What was ₱${amount.toLocaleString()} for?`,
      field: "categoryId",
      free: true,
      options: recent,
    }
  }
  return d
}

export function recentExpenseCats(): { label: string; value: string }[] {
  const s = finStore.get()
  const since = Date.now() - 30 * 86_400_000
  const count = new Map<string, number>()
  for (const r of s.records)
    if (
      r.type === "expense" &&
      r.categoryId &&
      !r.isAdjustment &&
      new Date(r.at).getTime() > since
    )
      count.set(r.categoryId, (count.get(r.categoryId) ?? 0) + 1)
  const ranked = [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((x) => x[0])
  for (const extra of ["electricity", "internet", "groceries", "gifts"])
    if (!ranked.includes(extra)) ranked.push(extra)
  return ranked.slice(0, 6).map((id) => {
    const c = s.categories.find((x) => x.id === id)
    return { label: c ? `${c.icon} ${c.name}` : id, value: id }
  })
}

export function accountOptions() {
  return finStore
    .get()
    .accounts.filter((a) => !a.archived && a.type !== "investment")
    .map((a) => ({ label: a.name, value: a.id }))
}

function taskDraft(seg: string, source: string): RecordDraft {
  const remindMe = /^(remind me( to)?|reminder( to)?|don'?t forget( to)?)\s*/i
  const reminder = remindMe.test(seg)
  const clean = seg
    .replace(remindMe, "")
    .replace(/^(todo|to do|to-do|need to|i need to|gotta|must)\s*:?\s*/i, "")
  const drafts = splitCapture(
    clean,
    source === "voice" ? "capture-voice" : "capture-text",
  )
  const tasks = drafts.map((d) => ({
    title: title(d.title.charAt(0)) + d.title.slice(1),
    listId: d.listId,
    dueDate: d.dueDate,
    dueTime: d.dueTime,
    remind:
      reminder || (!!d.dueDate && !!d.dueTime && d.listId !== "groceries"),
  }))
  const needsTime = reminder && tasks.some((t) => !t.dueDate)
  return {
    t: "record",
    kind: "task",
    target: "tasks",
    rule: tasks.some((t) => t.remind) ? "reminder" : "task",
    payload: { kind: "task", tasks },
    ask: needsTime
      ? {
          question: "When should I remind you?",
          field: "due",
          options: [
            { label: "Tonight 8 PM", value: "0|20:00" },
            { label: "Tomorrow 9 AM", value: "1|09:00" },
            { label: "Sat 10 AM", value: "sat|10:00" },
          ],
        }
      : undefined,
  }
}

function cardioDraft(seg: string): RecordDraft {
  const low = seg.toLowerCase()
  const km = low.match(/(\d+(?:\.\d+)?)\s?(?:k\b|km)/)
  const min = low.match(/(\d+)\s?(?:min|mins|minutes)\b/)
  const hr = low.match(/(\d+(?:\.\d+)?)\s?(?:hr|hour)/)
  const mmss = low.match(/\b(\d{1,3}):(\d{2})\b/)
  const minutes = min
    ? Number(min[1])
    : hr
      ? Math.round(Number(hr[1]) * 60)
      : mmss
        ? Number(mmss[1])
        : undefined
  const activity = /walk/.test(low)
    ? "Walk"
    : /bik|cycl/.test(low)
      ? "Ride"
      : /swam|swim/.test(low)
        ? "Swim"
        : /hike/.test(low)
          ? "Hike"
          : "Run"
  const kmN = km ? Number(km[1]) : undefined
  return {
    t: "record",
    kind: "workout",
    target: "fitness",
    rule: "workout",
    dayOffset: relDay(seg),
    payload: {
      kind: "workout",
      name: `${kmN ? `${kmN} km ` : ""}${activity.toLowerCase()}`.replace(
        /^./,
        (c) => c.toUpperCase(),
      ),
      exercises: [],
      cardio: { km: kmN, min: minutes, activity },
    },
  }
}

function weighDraft(seg: string): RecordDraft | null {
  const m = seg.match(/(\d{2,3}(?:\.\d)?)/)
  if (!m) return null
  let kg = Number(m[1])
  if (/\b(lb|lbs|pounds?)\b/i.test(seg))
    kg = Math.round((kg / 2.2046) * 10) / 10
  const prev = latestBodyweight(fitStore.get())
  const off = prev ? Math.abs(kg - prev) / prev : 0
  return {
    t: "record",
    kind: "weighIn",
    target: "fitness",
    rule: "weighIn",
    confirm: off > 0.03,
    warn:
      off > 0.03
        ? `That's ${(off * 100).toFixed(1)}% off your last weigh-in (${prev} kg) — typo?`
        : undefined,
    payload: { kind: "weighIn", kg, prevKg: prev },
  }
}

function habitDraft(seg: string): RecordDraft {
  const hs = matchHabits(seg)
  const low = seg.toLowerCase()
  const min = low.match(/(\d+)\s?(min|mins|minutes)\b/)
  const cnt = low.match(/(\d+)\s?(pages|glasses|cups|x|times)\b/)
  if (!hs.length) {
    const name = seg
      .replace(/^(did|done|finished|completed)\s+(my|the)?\s*/i, "")
      .replace(/\b(today|already|na)\b/gi, "")
      .trim()
    const d = habitCreateDraft(name || seg, true)
    d.warn = `No habit called “${title(name)}” yet — create it and check today?`
    return d
  }
  const h = hs[0]
  const value =
    h.type === "duration"
      ? min
        ? Number(min[1])
        : h.target
      : h.type === "count"
        ? cnt
          ? Number(cnt[1])
          : h.target
        : undefined
  return {
    t: "record",
    kind: "habitLog",
    target: "habits",
    rule: "habit",
    dayOffset: relDay(seg),
    payload: {
      kind: "habitLog",
      habitId: h.id,
      value,
      add: h.type === "count" && !!cnt,
    },
  }
}

function incomeDraft(seg: string): RecordDraft | null {
  const a = parseAmount(seg)
  if (!a) return null
  const low = seg.toLowerCase()
  const cat = /\b(salary|sweldo|payday|got paid|bonus)\b/.test(low)
    ? "salary"
    : /\b(client|freelance|commission|side)\b/.test(low)
      ? "freelance"
      : "other-in"
  const acct = accountIn(seg)
  return {
    t: "record",
    kind: "income",
    target: "finance",
    rule: "income",
    payload: {
      kind: "income",
      amount: a.amount,
      categoryId: cat,
      accountId: acct,
      payee: cat === "salary" ? "Employer" : undefined,
    },
    ask: acct
      ? undefined
      : {
          question: `Which account did the ₱${a.amount.toLocaleString()} land in?`,
          field: "accountId",
          options: accountOptions(),
        },
  }
}

function transferDraft(seg: string): RecordDraft | null {
  const a = parseAmount(seg)
  if (!a) return null
  const low = seg.toLowerCase()
  const accts = accountsIn(seg)
  let from: string | undefined
  let to: string | undefined
  const toM = low.match(/\b(?:to|into|sa)\s+(\w[\w-]*)/)
  const fromM = low.match(/\bfrom\s+(\w[\w-]*)/)
  if (toM) to = accountIn(toM[1])
  if (fromM) from = accountIn(fromM[1])
  if (!from && accts.length === 2) from = accts.find((x) => x !== to)
  if (!to && accts.length === 2) to = accts.find((x) => x !== from)
  if (/top ?up|topped up|cash ?in/.test(low) && !from) from = undefined
  return {
    t: "record",
    kind: "transfer",
    target: "finance",
    rule: "transfer",
    payload: { kind: "transfer", amount: a.amount, from, to },
    ask: !from
      ? {
          question: `Moved ₱${a.amount.toLocaleString()} from which account?`,
          field: "from",
          options: accountOptions().filter((o) => o.value !== to),
        }
      : !to
        ? {
            question: "To which account?",
            field: "to",
            options: accountOptions().filter((o) => o.value !== from),
          }
        : undefined,
  }
}

function plannedDraft(seg: string): RecordDraft | null {
  const a = parseAmount(seg)
  if (!a) return null
  const dm = seg.match(/every\s+(\d{1,2})(?:st|nd|rd|th)/i)
  const { cat, payee } = moneyCategory(seg)
  const name =
    payee ??
    title(
      seg
        .replace(/(₱|php)?\s?\d[\d,.]*k?/gi, "")
        .replace(/\bevery.*$/i, "")
        .trim() || "Bill",
    )
  return {
    t: "record",
    kind: "planned",
    target: "finance",
    rule: "structure",
    confirm: true,
    payload: {
      kind: "planned",
      name,
      amount: a.amount,
      day: dm ? Number(dm[1]) : new Date().getDate(),
      accountId: accountIn(seg) ?? defaultAccount(),
      categoryId: cat,
    },
  }
}

function taskCompleteDraft(seg: string): RecordDraft | Draft {
  const q = seg.replace(
    /^(done with|finished|completed|tapos na( yung)?|natapos( ko)?( na)?( yung)?|did the)\s*/i,
    "",
  )
  const ts = matchTasks(q)
  if (!ts.length)
    return {
      t: "info",
      card: {
        tone: "fallback",
        title: `No open task matches “${q.trim()}”`,
        body: "Want to add it as done, or check your list?",
        actions: [
          { label: "Open tasks", do: "link", href: "/tasks" },
          { label: "Quick add", do: "quickadd" },
        ],
      },
    }
  return {
    t: "record",
    kind: "taskComplete",
    target: "tasks",
    rule: "task",
    payload: {
      kind: "taskComplete",
      taskId: ts.length === 1 ? ts[0].id : undefined,
      query: q,
    },
    ask:
      ts.length > 1
        ? {
            question: "Which one did you finish?",
            field: "taskId",
            options: ts
              .slice(0, 5)
              .map((t) => ({ label: t.title, value: t.id })),
          }
        : undefined,
  }
}

function routineDraft(seg: string): RecordDraft {
  const rs = habitsStore.get().routines.filter((r) => r.status === "active")
  const qs = words(seg).map(stem)
  const hit = rs.find((r) =>
    words(r.name)
      .map(stem)
      .some((w) => qs.includes(w) && w !== "routi"),
  )
  return {
    t: "record",
    kind: "routineStart",
    target: "habits",
    rule: "structure",
    confirm: true,
    payload: { kind: "routineStart", routineId: hit?.id, query: seg },
    ask: hit
      ? undefined
      : {
          question: "Which routine?",
          field: "routineId",
          options: rs.map((r) => ({
            label: `${r.icon} ${r.name}`,
            value: r.id,
          })),
        },
  }
}

function strengthDraft(seg: string): RecordDraft | null {
  const { out, unknown } = strengthExercises(seg)
  if (!out.length) return null
  const low = seg.toLowerCase()
  const day = low.match(
    /\b(legs|push|pull|chest|back|arms|upper|lower|shoulders?)\b/,
  )
  return {
    t: "record",
    kind: "workout",
    target: "fitness",
    rule: "workout",
    confirm: unknown.length > 0,
    dayOffset: relDay(seg),
    warn: unknown.length
      ? `New exercise${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")} — I'll add ${unknown.length > 1 ? "them" : "it"} to your library.`
      : undefined,
    payload: {
      kind: "workout",
      name: day
        ? `${title(day[1])} day`
        : out.length === 1
          ? out[0].exercise
          : "Workout",
      exercises: out,
      newExercises: unknown,
    },
  }
}

export function journalDraft(text: string, source: string): RecordDraft {
  const body = text
    .replace(/^(journal|dear diary|diary|reflection)\s*[:\-–]\s*/i, "")
    .trim()
  const low = body.toLowerCase()
  const mood = /\b(great|amazing|proud|grateful|happy|win|masaya)\b/.test(low)
    ? 5
    : /\b(good|nice|calm|productive)\b/.test(low)
      ? 4
      : /\b(tired|pagod|meh|long day|ugh)\b/.test(low)
        ? 2
        : /\b(sad|awful|terrible|anxious|stressed|malungkot)\b/.test(low)
          ? 1
          : undefined
  const area = /\b(work|client|boss|career|deck|meeting|job)\b/.test(low)
    ? "career"
    : /\b(gym|sleep|ate|workout|run|health|weight)\b/.test(low)
      ? "health"
      : /\b(money|spent|budget|save|savings|paid)\b/.test(low)
        ? "money"
        : /\b(mama|papa|family|friend|jessa|partner|date)\b/.test(low)
          ? "relationships"
          : /\b(who i am|becoming|identity|values)\b/.test(low)
            ? "identity"
            : undefined
  // "Clean up": capitalise sentences, strip filler words from the transcript.
  const cleaned =
    source === "voice"
      ? body
          .replace(/\b(um+|uh+|like,|you know,)\s*/gi, "")
          .replace(/(^|[.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase())
      : body.charAt(0).toUpperCase() + body.slice(1)
  const tags = [
    ...new Set(
      [
        /\bsleep|slept\b/.test(low) && "sleep",
        /\bgym|workout|lift/.test(low) && "gym",
        /\bgrateful|thankful\b/.test(low) && "gratitude",
        /\bwin|shipped|proud\b/.test(low) && "win",
      ].filter(Boolean) as string[],
    ),
  ]
  return {
    t: "record",
    kind: "journal",
    target: "journal",
    rule: "journal",
    payload: {
      kind: "journal",
      body: cleaned,
      mood,
      area,
      tags,
      transcript: source === "voice" ? body : undefined,
    },
  }
}

/** Loggable facts inside a journal entry → always Tier B (J8). */
function factsInJournal(text: string, ctx: ParseCtx): RecordDraft[] {
  const out: RecordDraft[] = []
  const low = text.toLowerCase()
  const sleep = low.match(/slept (?:at )?(\d{1,2})\s?(am|pm)?/)
  if (sleep) {
    const h = matchHabits("sleep")[0]
    if (h)
      out.push({
        t: "record",
        kind: "habitLog",
        target: "habits",
        rule: "habit",
        confirm: true,
        warn: "From your journal — I won't save it unless you confirm.",
        payload: { kind: "habitLog", habitId: h.id },
      })
  }
  const spent = text.match(
    /\bspent\s+(?:₱|php)?\s?(\d[\d,]*k?)\s+on\s+([a-z ]{2,20})/i,
  )
  if (spent) {
    const d = expenseDraft(spent[0], ctx)
    if (d) {
      d.confirm = true
      d.warn = "From your journal — confirm to log it."
      out.push(d)
    }
  }
  return out
}

/** Main entry: text → drafts (records, questions, info). */
export function parseCapture(text: string, ctx: ParseCtx): Draft[] {
  const segs = segment(text, ctx.hint)
  const out: Draft[] = []
  for (const { seg, kind } of segs) {
    switch (kind) {
      case "journal":
        out.push(journalDraft(seg, ctx.source), ...factsInJournal(seg, ctx))
        break
      case "question":
        out.push({ t: "question", text: seg })
        break
      case "advice":
        out.push({ t: "question", text: seg })
        break
      case "command":
        out.push({
          t: "record",
          kind: "command",
          target: "finance",
          rule: "structure",
          confirm: true,
          payload: {
            kind: "command",
            op: /^(delete|remove|undo|cancel|scratch)/i.test(seg)
              ? "delete"
              : "edit",
            amount: parseAmount(seg)?.amount,
          },
        })
        break
      case "habitCreate":
        out.push(
          habitCreateDraft(
            seg.replace(
              /^(new habit|add (a )?habit|create (a )?habit|start a habit)\s*:?\s*/i,
              "",
            ),
          ),
        )
        break
      case "routine":
        out.push(routineDraft(seg))
        break
      case "planned": {
        const d = plannedDraft(seg)
        if (d) out.push(d)
        break
      }
      case "transfer": {
        const d = transferDraft(seg)
        if (d) out.push(d)
        break
      }
      case "income": {
        const d = incomeDraft(seg)
        if (d) out.push(d)
        break
      }
      case "task":
        out.push(taskDraft(seg, ctx.source))
        break
      case "cardio":
        out.push(cardioDraft(seg))
        break
      case "strength": {
        const d = strengthDraft(seg)
        if (d) out.push(d)
        break
      }
      case "weighIn": {
        const d = weighDraft(seg)
        if (d) out.push(d)
        break
      }
      case "expense": {
        const d = expenseDraft(seg, ctx)
        if (d) out.push(d)
        break
      }
      case "taskComplete":
        out.push(taskCompleteDraft(seg))
        break
      case "habit":
        out.push(habitDraft(seg))
        break
      case "meal": {
        const d = mealDraft(seg, { photo: ctx.photo })
        if (d) {
          d.dayOffset = relDay(seg)
          out.push(d)
        } else
          out.push({
            t: "info",
            card: {
              tone: "fallback",
              title: "I couldn't tell what you ate",
              body: "Name the dishes (e.g. “adobo, 1 cup rice”) or log it by hand.",
              actions: [
                { label: "Quick add meal", do: "quickadd" },
                {
                  label: "Try: adobo with rice",
                  do: "prompt",
                  prompt: "lunch adobo with 1 cup rice",
                },
              ],
            },
          })
        break
      }
      case "feel":
        out.push({
          t: "info",
          card: {
            tone: "journal-suggest",
            title: "Nothing to log — want to keep it?",
            body: `“${seg}”`,
            actions: [
              { label: "Save as journal", do: "journal", prompt: seg },
              { label: "Just venting", do: "link", href: "" },
            ],
          },
        })
        break
      default:
        out.push({
          t: "info",
          card: {
            tone: "fallback",
            title: `Not sure what to do with “${seg.length > 40 ? `${seg.slice(0, 40)}…` : seg}”`,
            body: "Try saying it like you'd text a friend, or add it by hand.",
            actions: [
              { label: "Quick add", do: "quickadd" },
              { label: "Save as journal", do: "journal", prompt: seg },
              { label: "Make it a task", do: "prompt", prompt: `todo ${seg}` },
            ],
          },
        })
    }
  }
  return out
}

/** Day key for a draft resolved against the capture time. */
export function draftDay(atIso: string, offset = 0): string {
  const d = new Date(atIso)
  d.setDate(d.getDate() + offset)
  return dayKey(d)
}
