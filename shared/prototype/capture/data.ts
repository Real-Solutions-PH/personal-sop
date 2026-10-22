import { at, dayOffset } from "../lib/day"
export type CaptureSource =
  | "text"
  | "voice"
  | "photo"
  | "file"
  | "quick_add"
  | "connector"
  /** Written by Fern during a chat turn; shown inside Fern's reply, not as a
   * capture of its own (ADR-0015). */
  | "chat"
export type CaptureStatus =
  | "queued"
  | "processing"
  | "needs_input"
  | "done"
  | "answered"
  | "failed"
export type PhotoHint =
  | "auto"
  | "meal"
  | "receipt"
  | "label"
  | "statement"
  | "whiteboard"
export type Target = "habits" | "tasks" | "fitness" | "finance" | "journal"
export type RecordKind =
  | "expense"
  | "income"
  | "transfer"
  | "planned"
  | "task"
  | "taskComplete"
  | "habitLog"
  | "habitCreate"
  | "routineStart"
  | "workout"
  | "weighIn"
  | "meal"
  | "journal"
  | "photo"
  | "command"
export type RuleKey =
  | "habit"
  | "task"
  | "reminder"
  | "workout"
  | "weighIn"
  | "meal"
  | "expense"
  | "income"
  | "transfer"
  | "journal"
  | "structure"
export type Tier = "auto" | "confirm"
export type RecordState =
  | "proposed"
  | "needs_input"
  | "saved"
  | "edited"
  | "undone"
  | "discarded"
export interface TaskDraft {
  title: string
  listId: string | null
  dueDate: string | null
  dueTime: string | null
  remind: boolean
}
export interface SetDraft {
  reps: number
  weight: number
}
export interface MealItemDraft {
  name: string
  qty: number
  unit: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  assumption?: string
}
export type Payload =
  | {
      kind: "expense"
      amount: number
      categoryId?: string
      accountId: string
      payee?: string
      note?: string
      currency?: string
      fromReceipt?: boolean
    }
  | {
      kind: "income"
      amount: number
      categoryId: string
      accountId?: string
      payee?: string
    }
  | {
      kind: "transfer"
      amount: number
      from?: string
      to?: string
    }
  | {
      kind: "planned"
      name: string
      amount: number
      day: number
      accountId: string
      categoryId?: string
    }
  | {
      kind: "task"
      tasks: TaskDraft[]
    }
  | {
      kind: "taskComplete"
      taskId?: string
      query: string
    }
  | {
      kind: "habitLog"
      habitId: string
      value?: number
      add?: boolean
    }
  | {
      kind: "habitCreate"
      name: string
      icon: string
      type: "check" | "duration" | "count"
      target?: number
      unit?: string
      days: number[]
      time?: string
      logToday?: boolean
    }
  | {
      kind: "routineStart"
      routineId?: string
      query: string
    }
  | {
      kind: "workout"
      name: string
      exercises: {
        exercise: string
        sets: SetDraft[]
      }[]
      cardio?: {
        km?: number
        min?: number
        activity: string
      }
      newExercises?: string[]
    }
  | {
      kind: "weighIn"
      kg: number
      prevKg?: number
    }
  | {
      kind: "meal"
      raw: string
      label?: "breakfast" | "lunch" | "dinner" | "snack"
      items: MealItemDraft[]
      confidence: number
      fromPhoto?: boolean
    }
  | {
      kind: "journal"
      body: string
      mood?: Mood
      area?: string
      tags: string[]
      transcript?: string
    }
  | {
      kind: "photo"
      caption: string
    }
  | {
      kind: "command"
      op: "edit" | "delete"
      recordId?: string
      amount?: number
    }
export interface FollowUp {
  question: string
  field: string
  options: {
    label: string
    value: string
  }[]
  free?: boolean
}
export interface WriteLogEntry {
  at: string
  action: "proposed" | "saved" | "edited" | "undone" | "redone" | "discarded"
  actor: "ai" | "user"
}
export interface RecordCard {
  t: "record"
  id: string
  kind: RecordKind
  target: Target
  tier: Tier
  state: RecordState
  payload: Payload
  refs: string[]
  ask?: FollowUp
  note?: string
  warn?: string
  confidence?: number
  dayOffset?: number
  prior?: unknown
  log: WriteLogEntry[]
}
export interface AnswerCard {
  t: "answer"
  id: string
  title: string
  value: string
  money?: number
  sub?: string
  accent: "hab" | "tsk" | "fit" | "fin" | "life" | "primary"
  bars?: {
    labels: string[]
    data: number[]
  }
  spark?: number[]
  list?: {
    label: string
    value: string
    href?: string
  }[]
  basis?: string
  links: {
    label: string
    href: string
  }[]
}
export interface InfoCard {
  t: "info"
  id: string
  tone: "fallback" | "error" | "journal-suggest" | "handoff" | "advice"
  title: string
  body?: string
  actions: {
    label: string
    do: "quickadd" | "retry" | "journal" | "link" | "prompt"
    href?: string
    prompt?: string
  }[]
}
export type ReplyItem = RecordCard | AnswerCard | InfoCard
export interface Capture {
  id: string
  at: string
  source: CaptureSource
  text: string
  durationSec?: number
  photo?: string
  /** More photos sent with ``photo`` as one capture. */
  photos?: string[]
  hint?: string
  fileName?: string
  status: CaptureStatus
  reply?: {
    text: string
    items: ReplyItem[]
  }
  error?: string
  clientUuid: string
  startedAt?: string
}
export type Mood = 1 | 2 | 3 | 4 | 5
export interface JournalEntry {
  id: string
  day: string
  createdAt: string
  body: string
  source: "voice" | "text" | "wrapup"
  captureId?: string
  mood?: Mood
  tags: string[]
  area?: string
  private: boolean
  transcript?: string
}
export interface AISettings {
  rules: Record<RuleKey, Tier>
  moneyThreshold: number
  language: "en-tl" | "en"
  transcription: "server" | "browser"
  sendPhotos: boolean
  journalInQA: boolean
  financeScope: "aggregates" | "records"
  model: string
  spendCap: number
  aiEnabled: boolean
  simulateOffline: boolean
  retentionDays: number
}
export interface CaptureState {
  captures: Capture[]
  journal: JournalEntry[]
  settings: AISettings
  spend: {
    month: string
    amount: number
    calls: number
  }
}
export const RULE_LABELS: {
  key: RuleKey
  label: string
  hint: string
}[] = [
  { key: "habit", label: "Habit check-ins", hint: "“did my meditation”" },
  { key: "task", label: "Tasks", hint: "“buy eggs, milk, rice”" },
  { key: "reminder", label: "Tasks with reminders", hint: "fire later" },
  { key: "workout", label: "Workouts (text)", hint: "“ran 5k in 32 min”" },
  { key: "weighIn", label: "Weigh-ins", hint: "confirm if ±3% off" },
  { key: "meal", label: "Meals (estimates)", hint: "macros are guesses" },
  { key: "expense", label: "Expenses", hint: "under the amount limit" },
  { key: "income", label: "Income", hint: "“got paid 35k”" },
  { key: "transfer", label: "Transfers", hint: "between your accounts" },
  { key: "journal", label: "Journal entries", hint: "private by default" },
  { key: "structure", label: "New habits / bills", hint: "always asks first" },
]
export const DEFAULT_RULES: Record<RuleKey, Tier> = {
  habit: "auto",
  task: "auto",
  reminder: "confirm",
  workout: "auto",
  weighIn: "auto",
  meal: "confirm",
  expense: "auto",
  income: "confirm",
  transfer: "confirm",
  journal: "auto",
  structure: "confirm",
}
export const AREAS = [
  { key: "identity", label: "Identity" },
  { key: "career", label: "Career" },
  { key: "health", label: "Health" },
  { key: "money", label: "Money" },
  { key: "relationships", label: "People" },
  { key: "growth", label: "Growth" },
] as const
export const MOODS: {
  v: Mood
  label: string
}[] = [
  { v: 1, label: "Rough" },
  { v: 2, label: "Meh" },
  { v: 3, label: "Okay" },
  { v: 4, label: "Good" },
  { v: 5, label: "Great" },
]
const JOURNAL_SEED: [
  number,
  number,
  Mood | undefined,
  string,
  string,
  string[],
][] = [
  [
    -1,
    22,
    4,
    "career",
    "Shipped the client deck a day early. Felt good to not be firefighting for once. Want to keep mornings for deep work — the 90-minute block before messages is where the real work happens.",
    ["deep-work", "win"],
  ],
  [
    -2,
    23,
    3,
    "health",
    "Legs day wrecked me. Slept at 1am again which is the thing I keep saying I'll fix. Phone out of the bedroom starting tomorrow.",
    ["sleep"],
  ],
  [
    -3,
    21,
    5,
    "relationships",
    "Dinner with Mama and Papa. Papa told the story about the jeepney route again and I actually listened this time. Grateful.",
    ["family", "gratitude"],
  ],
  [
    -5,
    22,
    2,
    "money",
    "Overspent on GrabFood this week, again. It's not the money, it's that I order when I'm tired. Prep lunch on Sundays.",
    ["spending"],
  ],
  [
    -6,
    20,
    4,
    "identity",
    "I'm someone who shows up even on low days. 20 pages read, gym done, didn't feel like either.",
    ["discipline"],
  ],
  [
    -8,
    23,
    3,
    "career",
    "Side job client asked for revisions for the third time. Need to write scope into the next quote.",
    ["job2"],
  ],
  [
    -9,
    22,
    4,
    "growth",
    "Finished Atomic Habits reread. The identity-first idea is why I built this app in the first place.",
    ["reading"],
  ],
  [
    -11,
    21,
    undefined,
    "health",
    "Weighed 72.8. Down 1.4 since the start of the month. Slow but it's moving.",
    ["cut"],
  ],
  [
    -12,
    22,
    3,
    "identity",
    "Long day. Not much to say. Did the wind-down routine anyway.",
    [],
  ],
  [
    -14,
    20,
    5,
    "career",
    "Got the raise confirmation. Moving 5k/month into the emergency fund from next payday.",
    ["win", "savings"],
  ],
  [
    -15,
    23,
    2,
    "health",
    "Skipped the gym, felt sluggish all day. Note to self: a bad workout still beats no workout.",
    ["gym"],
  ],
  [
    -17,
    21,
    4,
    "relationships",
    "Called Jessa for an hour. Need to do that more.",
    ["friends"],
  ],
  [
    -19,
    22,
    3,
    "money",
    "Paid off the phone installment. One less line on the card.",
    ["debt"],
  ],
  [
    -21,
    22,
    4,
    "growth",
    "Meditated 15 minutes instead of 10. The extra five is where it gets quiet.",
    ["meditation"],
  ],
  [
    -24,
    23,
    3,
    "identity",
    "Who I'm becoming: calm, strong, financially boring. Wrote it on a sticky note on the monitor.",
    ["values"],
  ],
  [
    -27,
    21,
    4,
    "health",
    "Bench 80×5 for the first time. Small thing but I've wanted that number for a year.",
    ["pr", "gym"],
  ],
  [
    -30,
    22,
    2,
    "career",
    "Three meetings that could have been messages. Blocking Thursday afternoons from now on.",
    ["meetings"],
  ],
  [
    -33,
    22,
    4,
    "growth",
    "Started the evening wrap-up habit. Two lines a night is enough.",
    [],
  ],
]
function seedJournal(): JournalEntry[] {
  return JOURNAL_SEED.map(([d, hh, mood, area, body, tags], i) => ({
    id: `j-seed-${i}`,
    day: dayOffset(d),
    createdAt: at(d, hh, 10 + ((i * 7) % 40)),
    body,
    source: i % 3 === 0 ? "voice" : "text",
    mood,
    area,
    tags,
    private: true,
  }))
}
const card = (
  id: string,
  kind: RecordKind,
  target: Target,
  payload: Payload,
  when: string,
): RecordCard => ({
  t: "record",
  id,
  kind,
  target,
  tier: "auto",
  state: "saved",
  payload,
  refs: [],
  log: [
    { at: when, action: "proposed", actor: "ai" },
    { at: when, action: "saved", actor: "ai" },
  ],
})
function seedCaptures(): Capture[] {
  const y1 = at(-1, 8, 12)
  const y2 = at(-1, 12, 40)
  const y3 = at(-1, 21, 5)
  return [
    {
      id: "c-seed-1",
      at: y1,
      source: "text",
      text: "weighed 72.6, coffee 165 at tims",
      status: "done",
      clientUuid: "seed-1",
      reply: {
        text: "Logged 2 things.",
        items: [
          card(
            "rc-seed-1",
            "weighIn",
            "fitness",
            { kind: "weighIn", kg: 72.6 },
            y1,
          ),
          card(
            "rc-seed-2",
            "expense",
            "finance",
            {
              kind: "expense",
              amount: 165,
              categoryId: "coffee",
              accountId: "gcash",
              payee: "Tim Hortons",
            },
            y1,
          ),
        ],
      },
    },
    {
      id: "c-seed-2",
      at: y2,
      source: "voice",
      durationSec: 7,
      text: "lunch was chicken inasal with one cup rice",
      status: "done",
      clientUuid: "seed-2",
      reply: {
        text: "Here's my estimate — confirmed.",
        items: [
          card(
            "rc-seed-3",
            "meal",
            "fitness",
            {
              kind: "meal",
              raw: "chicken inasal with one cup rice",
              label: "lunch",
              confidence: 0.84,
              items: [
                {
                  name: "Chicken inasal (paa)",
                  qty: 1,
                  unit: "pc",
                  kcal: 420,
                  protein: 38,
                  carbs: 4,
                  fat: 27,
                },
                {
                  name: "Rice",
                  qty: 1,
                  unit: "cup",
                  kcal: 205,
                  protein: 4,
                  carbs: 45,
                  fat: 0,
                },
              ],
            },
            y2,
          ),
        ],
      },
    },
    {
      id: "c-seed-3",
      at: y3,
      source: "text",
      text: "paid 1500",
      status: "needs_input",
      clientUuid: "seed-3",
      reply: {
        text: "One question first.",
        items: [
          {
            ...card(
              "rc-seed-4",
              "expense",
              "finance",
              { kind: "expense", amount: 1500, accountId: "gcash" },
              y3,
            ),
            state: "needs_input",
            log: [{ at: y3, action: "proposed", actor: "ai" }],
            ask: {
              question: "What was ₱1,500 for?",
              field: "categoryId",
              free: true,
              options: [
                { label: "💡 Electricity", value: "electricity" },
                { label: "📶 Internet", value: "internet" },
                { label: "🛒 Groceries", value: "groceries" },
                { label: "🍗 Dining out", value: "dining" },
                { label: "🎁 Gifts", value: "gifts" },
              ],
            },
          },
        ],
      },
    },
  ]
}
export function seed(): CaptureState {
  const now = new Date()
  return {
    captures: seedCaptures(),
    journal: seedJournal(),
    settings: {
      rules: { ...DEFAULT_RULES },
      moneyThreshold: 1000,
      language: "en-tl",
      transcription: "server",
      sendPhotos: true,
      journalInQA: false,
      financeScope: "aggregates",
      model: "anthropic/claude-sonnet (OpenRouter)",
      spendCap: 500,
      aiEnabled: true,
      simulateOffline: false,
      retentionDays: 30,
    },
    spend: {
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      amount: 142.6,
      calls: 388,
    },
  }
}
