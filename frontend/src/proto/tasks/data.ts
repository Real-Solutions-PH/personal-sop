import { at, dayOffset } from "../lib/day"

// M2 Tasks — provisional contract (ADR-0009). Mirrors docs/ia/02-tasks.md §2.
// Day values are logical day keys (YYYY-MM-DD, 04:00 boundary); instants are ISO.

export type ListKind = "standard" | "shopping"
export type ListColor = "tsk" | "fin" | "hab" | "fit" | "life" | "warn"
export type ListIcon =
  | "briefcase"
  | "laptop"
  | "home"
  | "cart"
  | "heart"
  | "book"
  | "plane"
  | "gift"
  | "list"

export interface TaskList {
  id: string
  name: string
  kind: ListKind
  color: ListColor
  icon: ListIcon
  sortOrder: number
  archivedAt: string | null
  isDefault: boolean
}

export type RepeatRule =
  | { kind: "daily" }
  | { kind: "weekdays" }
  | { kind: "weekly"; days: number[] } // 0=Sun … 6=Sat
  | { kind: "monthly"; day: number }
  | { kind: "everyN"; n: number }

export interface Recurrence {
  rule: RepeatRule
  /** fixed = next scheduled date; after = completion + interval. */
  mode: "fixed" | "after"
}

export type TaskStatus = "open" | "done" | "deleted"
export type TaskSource =
  | "manual"
  | "capture-text"
  | "capture-voice"
  | "capture-photo"

export interface Task {
  id: string
  title: string
  /** null → virtual Inbox. */
  listId: string | null
  dueDate: string | null
  dueTime: string | null // HH:mm
  remindAt: string | null // ISO
  recurrence: Recurrence | null
  notes: string | null
  starred: boolean
  status: TaskStatus
  completedAt: string | null
  deletedAt: string | null
  /** Shopping lists: "Clear checked" hides done items from the In-cart section. */
  clearedAt: string | null
  createdAt: string
  source: TaskSource
  parseState: "parsed" | "pending"
  /** First due date ever set — lateness is measured against it (IA §7). */
  originalDue: string | null
  rescheduleCount: number
  /** Manual sort position within its list. */
  order: number
}

export type TaskEventType =
  | "created"
  | "completed"
  | "uncompleted"
  | "rescheduled"
  | "snoozed"
  | "deleted"
  | "restored"

/** Append-only; feeds Stats. */
export interface TaskEvent {
  id: string
  taskId: string
  type: TaskEventType
  fromDue?: string | null
  toDue?: string | null
  at: string
}

export interface TaskSettings {
  defaultRemindTime: string // HH:mm for date-only tasks
  digestOn: boolean
  digestTime: string
  quietStart: string
  quietEnd: string
  countGroceries: boolean
  weekStart: 0 | 1
}

/** Mocked PushSubscription / permission state for this device (TSK-12). */
export interface NotifState {
  platform: "ios" | "android" | "desktop"
  installed: boolean
  permission: "default" | "granted" | "denied"
  remindLaterAt: string | null
  testSentAt: string | null
}

export interface TasksState {
  lists: TaskList[]
  tasks: Task[]
  events: TaskEvent[]
  settings: TaskSettings
  notif: NotifState
}

// ---------------------------------------------------------------- seed

/** Deterministic PRNG so every walkthrough sees the same history. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const SEED_LISTS: TaskList[] = [
  {
    id: "work",
    name: "Work",
    kind: "standard",
    color: "tsk",
    icon: "briefcase",
    sortOrder: 0,
    archivedAt: null,
    isDefault: true,
  },
  {
    id: "job2",
    name: "Job 2",
    kind: "standard",
    color: "fin",
    icon: "laptop",
    sortOrder: 1,
    archivedAt: null,
    isDefault: false,
  },
  {
    id: "life",
    name: "Life",
    kind: "standard",
    color: "hab",
    icon: "home",
    sortOrder: 2,
    archivedAt: null,
    isDefault: true,
  },
  {
    id: "groceries",
    name: "Groceries",
    kind: "shopping",
    color: "fit",
    icon: "cart",
    sortOrder: 3,
    archivedAt: null,
    isDefault: true,
  },
]

interface Spec {
  t: string
  l: string | null
  d?: number // due offset (days from today)
  tm?: string
  od?: number // original due offset (if rescheduled)
  rs?: number // reschedule count
  rep?: Recurrence
  star?: boolean
  note?: string
  src?: TaskSource
  rem?: boolean // reminder at due time
  done?: number // completed N days ago (0 = today)
  cart?: boolean // grocery already checked (in cart)
}

// ~40 live tasks: today, upcoming, overdue (some pushed repeatedly), groceries.
const LIVE: Spec[] = [
  // Work
  {
    t: "Reply to Anna re: vendor contract",
    l: "work",
    d: 0,
    tm: "10:00",
    rem: true,
  },
  { t: "Sprint planning notes", l: "work", d: 0 },
  { t: "Review PR #214 (payments refactor)", l: "work", d: -2, od: -4, rs: 1 },
  {
    t: "Submit timesheet",
    l: "work",
    d: -1,
    rep: { rule: { kind: "weekly", days: [5] }, mode: "fixed" },
  },
  {
    t: "Expense report — Cebu trip",
    l: "work",
    d: -5,
    od: -12,
    rs: 3,
    star: true,
  },
  { t: "1:1 prep with Jomar", l: "work", d: 1, tm: "09:30", rem: true },
  {
    t: "Finish Q4 deck",
    l: "work",
    d: 6,
    od: 2,
    rs: 2,
    star: true,
    note: "Slides 8–14 still need the revenue bridge.",
  },
  { t: "Update Jira board before standup", l: "work", d: 3 },
  { t: "Draft hiring rubric for QA role", l: "work" },
  {
    t: "Book meeting room for Oct offsite",
    l: "work",
    d: 2,
    src: "capture-voice",
  },
  // Job 2
  {
    t: "Deliver logo revisions to client",
    l: "job2",
    d: 2,
    tm: "14:00",
    rem: true,
    star: true,
  },
  {
    t: "Invoice Tita Baby's Bakery (₱8,500)",
    l: "job2",
    d: 0,
    tm: "17:00",
    rem: true,
  },
  { t: "Fix mobile nav bug on client site", l: "job2", d: -3, od: -6, rs: 2 },
  { t: "Call with Marco re: scope", l: "job2", d: 4, tm: "16:00", rem: true },
  { t: "Update portfolio case study", l: "job2" },
  {
    t: "Back up client files to drive",
    l: "job2",
    d: 1,
    rep: { rule: { kind: "weekly", days: [0] }, mode: "fixed" },
  },
  // Life
  {
    t: "Pay Meralco bill",
    l: "life",
    d: 9,
    rep: { rule: { kind: "monthly", day: 5 }, mode: "fixed" },
    src: "capture-text",
  },
  { t: "Renew NBI clearance", l: "life", d: 12 },
  {
    t: "Call Mama",
    l: "life",
    d: 0,
    tm: "19:00",
    rem: true,
    rep: { rule: { kind: "weekly", days: [6] }, mode: "fixed" },
  },
  { t: "Dentist — cleaning", l: "life", d: 5, tm: "10:00", rem: true },
  { t: "Laundry", l: "life", d: 0, done: 0 },
  { t: "Pick up package at LBC", l: "life", d: -1 },
  {
    t: "Book flights to Iloilo for Christmas",
    l: "life",
    d: 14,
    star: true,
    note: "Check Cebu Pac seat sale first.",
  },
  {
    t: "Water the plants",
    l: "life",
    d: 0,
    rep: { rule: { kind: "everyN", n: 3 }, mode: "after" },
  },
  { t: "Renew car registration (LTO)", l: "life", d: -8, od: -30, rs: 4 },
  { t: "Clean aircon filter", l: "life", d: 20 },
  // Inbox
  { t: "Call Mark", l: null, src: "capture-voice" },
  { t: "Look into BPI time deposit rates", l: null },
  { t: "Gift for Jessa's birthday", l: null, d: 3, src: "capture-text" },
  // Groceries (shopping — no dates)
  { t: "Eggs (1 tray)", l: "groceries" },
  { t: "Rice 5kg", l: "groceries" },
  { t: "Chicken breast 1kg", l: "groceries" },
  { t: "Garlic & onions", l: "groceries", src: "capture-photo" },
  { t: "Barako coffee", l: "groceries" },
  { t: "Soy sauce", l: "groceries" },
  { t: "Bananas (lakatan)", l: "groceries" },
  { t: "Pandesal", l: "groceries", cart: true },
  { t: "Canned tuna ×4", l: "groceries", cart: true },
  { t: "Dish soap", l: "groceries" },
]

// History pools (completed over the last 90 days → analytics).
const POOL: Record<string, string[]> = {
  work: [
    "Weekly report to Ma'am Liza",
    "Review PR",
    "Standup notes",
    "Update test cases",
    "Client status email",
    "Fix staging deploy",
    "Write release notes",
    "Prep sprint demo",
    "Code review backlog",
    "Reply to HR re: benefits",
  ],
  job2: [
    "Send revised mockups",
    "Invoice client",
    "Fix contact form",
    "Upload assets to Drive",
    "Call with Marco",
    "Update website copy",
  ],
  life: [
    "Pay PLDT",
    "Grocery run",
    "Laundry",
    "Call Mama",
    "Water the plants",
    "Buy load",
    "Clean room",
    "Pay credit card",
    "Haircut",
    "Change bedsheets",
  ],
  groceries: [
    "Eggs",
    "Rice 5kg",
    "Milk",
    "Bread",
    "Coffee",
    "Chicken",
    "Vegetables",
    "Bananas",
  ],
}

export function seedTasks(): TasksState {
  const rand = mulberry32(20260926)
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)]
  const tasks: Task[] = []
  const events: TaskEvent[] = []
  let n = 0
  const ev = (
    taskId: string,
    type: TaskEventType,
    atIso: string,
    fromDue?: string | null,
    toDue?: string | null,
  ) =>
    events.push({
      id: `e${events.length}`,
      taskId,
      type,
      at: atIso,
      fromDue,
      toDue,
    })

  const base = (id: string, title: string, listId: string | null): Task => ({
    id,
    title,
    listId,
    dueDate: null,
    dueTime: null,
    remindAt: null,
    recurrence: null,
    notes: null,
    starred: false,
    status: "open",
    completedAt: null,
    deletedAt: null,
    clearedAt: null,
    createdAt: at(-1, 9),
    source: "manual",
    parseState: "parsed",
    originalDue: null,
    rescheduleCount: 0,
    order: n++,
  })

  // History: days -89..-1. Streak run for the last 9 days; a gap on day -10.
  for (let d = -89; d <= -1; d++) {
    const gap = d === -10 || (d < -10 && rand() < 0.12)
    if (gap) continue
    const count = 1 + Math.floor(rand() * 3)
    for (let k = 0; k < count; k++) {
      const listId = pick(["work", "work", "job2", "life", "life"])
      const id = `h${d}_${k}`
      const t = base(id, pick(POOL[listId]), listId)
      // due date: mostly same day; some late (completed after original due).
      const r = rand()
      const late = r < 0.3 ? 1 + Math.floor(rand() * 4) : 0
      const pushed = r < 0.12 ? 1 + Math.floor(rand() * 2) : 0
      const orig = d - late
      const due = pushed ? d : orig
      t.originalDue = dayOffset(orig)
      t.dueDate = dayOffset(due)
      t.rescheduleCount = pushed
      t.createdAt = at(orig - 2, 8, 30)
      t.status = "done"
      t.completedAt = at(
        d,
        8 + Math.floor(rand() * 13),
        Math.floor(rand() * 60),
      )
      t.source =
        rand() < 0.35
          ? pick(["capture-text", "capture-voice"] as const)
          : "manual"
      tasks.push(t)
      ev(id, "created", t.createdAt)
      for (let p = 0; p < pushed; p++)
        ev(
          id,
          "rescheduled",
          at(orig + p, 21),
          dayOffset(orig + p),
          dayOffset(orig + p + 1),
        )
      ev(id, "completed", t.completedAt)
    }
    // A weekly grocery run (checked + cleared).
    if (d % 7 === -3) {
      for (let k = 0; k < 4; k++) {
        const id = `g${d}_${k}`
        const g = base(
          id,
          POOL.groceries[(k + d * 3 + 90) % POOL.groceries.length],
          "groceries",
        )
        g.status = "done"
        g.createdAt = at(d - 2, 20)
        g.completedAt = at(d, 10, k * 3)
        g.clearedAt = at(d, 11)
        tasks.push(g)
        ev(id, "completed", g.completedAt)
      }
    }
    // A few deleted ones (Recently deleted, TSK-10).
    if (d > -20 && rand() < 0.12) {
      const id = `x${d}`
      const x = base(
        id,
        pick(["Follow up Globe billing", "Try new gym", "Watch webinar"]),
        "life",
      )
      x.status = "deleted"
      x.deletedAt = at(d, 22)
      x.dueDate = dayOffset(d)
      x.originalDue = x.dueDate
      tasks.push(x)
      ev(id, "deleted", x.deletedAt)
    }
  }

  // Live tasks.
  LIVE.forEach((s, i) => {
    const id = `t${i}`
    const t = base(id, s.t, s.l)
    t.order = i
    if (s.d !== undefined) {
      t.dueDate = dayOffset(s.d)
      t.originalDue = dayOffset(s.od ?? s.d)
    }
    t.dueTime = s.tm ?? null
    if (s.rem && s.d !== undefined && s.tm) {
      const [hh, mm] = s.tm.split(":").map(Number)
      t.remindAt = at(s.d, hh, mm)
    }
    t.recurrence = s.rep ?? null
    t.starred = !!s.star
    t.notes = s.note ?? null
    t.source = s.src ?? "manual"
    t.rescheduleCount = s.rs ?? 0
    t.createdAt = at(Math.min(-1, (s.od ?? s.d ?? -3) - 3), 8 + (i % 10), 15)
    ev(id, "created", t.createdAt)
    for (let p = 0; p < t.rescheduleCount; p++) {
      const from = (s.od ?? 0) + p * 2
      ev(
        id,
        "rescheduled",
        at(Math.min(from, 0), 21, p),
        dayOffset(from),
        dayOffset(p === t.rescheduleCount - 1 ? (s.d ?? 0) : from + 2),
      )
    }
    if (s.done !== undefined) {
      t.status = "done"
      t.completedAt = at(-s.done, 8, 10 + i)
      ev(id, "completed", t.completedAt)
    }
    if (s.cart) {
      t.status = "done"
      t.completedAt = at(0, 9, i)
      ev(id, "completed", t.completedAt)
    }
    tasks.push(t)
  })

  // Today: a couple more wins already logged this morning.
  for (const [k, title, listId] of [
    [0, "Standup notes", "work"],
    [1, "Reply to client feedback", "job2"],
  ] as const) {
    const id = `d0_${k}`
    const t = base(id, title, listId)
    t.dueDate = dayOffset(0)
    t.originalDue = t.dueDate
    t.status = "done"
    t.completedAt = at(0, 9 + k, 5)
    tasks.push(t)
    ev(id, "completed", t.completedAt)
  }

  return {
    lists: SEED_LISTS,
    tasks,
    events,
    settings: {
      defaultRemindTime: "09:00",
      digestOn: false,
      digestTime: "07:30",
      quietStart: "22:00",
      quietEnd: "07:00",
      countGroceries: true,
      weekStart: 1,
    },
    notif: {
      platform: "ios",
      installed: false,
      permission: "default",
      remindLaterAt: null,
      testSentAt: null,
    },
  }
}
