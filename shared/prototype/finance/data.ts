import { at, dayKey } from "../lib/day"
export type AccountType = "cash" | "bank" | "ewallet" | "credit" | "investment"
export interface Account {
  id: string
  name: string
  type: AccountType
  opening: number
  openingDate: string
  limit?: number
  color: string
  inNetWorth: boolean
  inProjection: boolean
  archived: boolean
  lastReconciled?: string
  manual?: boolean
  order: number
  /** Interest, % p.a. (4.5 = 4.5%). */
  rate?: number
  /** A time deposit's maturity day. */
  maturesOn?: string
  /** Savings goal: target amount, and optionally the day to reach it by. */
  goal?: number
  goalBy?: string
}
export type RecordType = "expense" | "income" | "transfer"
export type RecordSource =
  | "chat"
  | "quick-add"
  | "photo"
  | "import"
  | "planned"
  | "manual"
  | "adjustment"
export interface FinRecord {
  id: string
  type: RecordType
  amount: number
  accountId: string
  toAccountId?: string
  categoryId?: string
  at: string
  payee?: string
  note?: string
  source: RecordSource
  receipt?: boolean
  plannedId?: string
  plannedOn?: string
  importId?: string
  isRefund?: boolean
  isAdjustment?: boolean
  feeOf?: string
  status: "cleared" | "pending"
  editedAt?: string
  /** Kept in another currency: the amount as spent (major units of
   * ``origCurrency``) and the rate it was converted at; ``amount`` is the
   * user's-currency amount every total uses. */
  origCurrency?: string
  origAmount?: number
  fxRate?: number
}
export interface Category {
  id: string
  name: string
  kind: "expense" | "income"
  parentId?: string
  icon: string
  discretionary: boolean
  archived: boolean
  system?: boolean
}
export interface Budget {
  id: string
  name: string
  categoryIds: string[] | null
  period: "monthly"
  limit: number
  rollover: boolean
  startDate: string
  archived: boolean
}
export type Schedule =
  | {
      kind: "once"
      date: string
    }
  | {
      kind: "monthly"
      day: number
    }
  | {
      kind: "semimonthly"
      days: [number, number]
    }
  | {
      kind: "weekly"
      every: number
      anchor: string
    }
export type EndRule =
  | {
      kind: "never"
    }
  | {
      kind: "date"
      date: string
    }
  | {
      kind: "count"
      n: number
    }
export interface PlannedItem {
  id: string
  name: string
  type: RecordType
  amount: number
  estimated: boolean
  accountId: string
  toAccountId?: string
  categoryId?: string
  schedule: Schedule
  start: string
  end: EndRule
  autoLog: boolean
  isWhatIf: boolean
  isInstallment?: boolean
  inProjection: boolean
  archived: boolean
  skipped: string[]
  snoozed: Record<string, string>
}
export type MatchState =
  | "matched"
  | "probable"
  | "new"
  | "duplicate"
  | "pending"
export type RowDecision = "accept" | "ignore" | "keep" | "take" | "merge"
export interface StatementRow {
  ref: string
  date: string
  time: string
  raw: string
  amount: number
  direction: "in" | "out"
  pending?: boolean
}
export interface ImportRow extends StatementRow {
  id: string
  payee: string
  suggestedCategoryId?: string
  state: MatchState
  reason?: string
  matchId?: string
  confidence: number
  decision: RowDecision
  categoryId?: string
  isTransfer?: boolean
}
export interface StatementImport {
  id: string
  accountId: string
  fileName: string
  fileType: "pdf" | "csv" | "image"
  from: string
  to: string
  closing: number
  status: "parsing" | "review" | "done" | "failed" | "undone"
  createdAt: string
  rows: ImportRow[]
  counts?: {
    matched: number
    created: number
    updated: number
    ignored: number
  }
  createdIds: string[]
  changed: {
    id: string
    before: FinRecord
  }[]
  fileKept: boolean
  error?: string
}
export interface LookBack {
  id: string
  period: string
  note: string
  savedAt: string
  snapshot: {
    savingsRate: number
    income: number
    spend: number
  }
}
export type AdvisorScope = "aggregates" | "records"
export interface AdvisorMsg {
  id: string
  role: "user" | "ai"
  text: string
  at: string
  answer?: string
  scope: AdvisorScope
}
export interface AdvisorThread {
  id: string
  title: string
  createdAt: string
  messages: AdvisorMsg[]
}
export interface FinSettings {
  defaultAccountId: string
  lastAccountId?: string
  lastCategoryId?: string
  monthStartDay: number
  horizon: 6 | 12 | 24
  includeUnplanned: boolean
  safetyFloor: number
  aiScope: AdvisorScope
  disclaimerAck: boolean
  nudgeDays: number
  projExcludedPlanned: string[]
}
export interface FinState {
  accounts: Account[]
  categories: Category[]
  records: FinRecord[]
  budgets: Budget[]
  planned: PlannedItem[]
  imports: StatementImport[]
  lookbacks: LookBack[]
  threads: AdvisorThread[]
  settings: FinSettings
}
export const CATEGORIES: Category[] = [
  c("food", "Food", "🍽️", true),
  c("dining", "Dining out", "🍗", true, "food"),
  c("coffee", "Coffee", "☕", true, "food"),
  c("groceries", "Groceries", "🛒", false, "food"),
  c("transport", "Transport", "🚌", false),
  c("grab", "Grab rides", "🚗", false, "transport"),
  c("commute", "Commute", "🚇", false, "transport"),
  c("bills", "Bills", "🧾", false),
  c("electricity", "Electricity", "💡", false, "bills"),
  c("internet", "Internet", "📶", false, "bills"),
  c("phone", "Mobile plan", "📱", false, "bills"),
  c("rent", "Rent", "🏠", false),
  c("subs", "Subscriptions", "🎬", true),
  c("shopping", "Shopping", "🛍️", true),
  c("entertainment", "Entertainment", "🎟️", true),
  c("health", "Health", "💊", false),
  c("personal", "Personal care", "💈", true),
  c("gifts", "Gifts", "🎁", true),
  c("fees", "Fees", "🏦", false),
  {
    ...c("adjust", "Balance adjustment", "⚖️", false),
    system: true,
  },
  c("salary", "Salary", "💼", false, undefined, "income"),
  c("freelance", "Side income", "💻", false, undefined, "income"),
  c("interest", "Interest", "📈", false, undefined, "income"),
  c("other-in", "Other income", "💰", false, undefined, "income"),
]
function c(
  id: string,
  name: string,
  icon: string,
  discretionary: boolean,
  parentId?: string,
  kind: "expense" | "income" = "expense",
): Category {
  return { id, name, icon, discretionary, parentId, kind, archived: false }
}
interface Merchant {
  payee: string
  raw: string
  cat: string
  min: number
  max: number
  accounts: string[]
}
const MERCH: Record<string, Merchant> = {
  jollibee: m("Jollibee", "JOLLIBEE FOODS CORP", "dining", 169, 289),
  inasal: m("Mang Inasal", "MANG INASAL PHILS INC", "dining", 179, 249),
  chowking: m("Chowking", "CHOWKING FOOD CORP", "dining", 199, 259),
  seven: m("7-Eleven", "PHILIPPINE SEVEN CORP", "dining", 95, 165),
  carinderia: m("Carinderia", "", "dining", 90, 130, ["cash"]),
  starbucks: m("Starbucks", "STARBUCKS COFFEE PH", "coffee", 185, 245, [
    "maya",
    "gcash",
  ]),
  tims: m("Tim Hortons", "TIM HORTONS PH", "coffee", 150, 190, [
    "maya",
    "gcash",
  ]),
  grab: m("Grab", "GRAB PHILIPPINES", "grab", 180, 420, ["gcash"]),
  grabfood: m("GrabFood", "GRABFOOD PH", "dining", 320, 580, ["gcash"]),
  sm: m("SM Supermarket", "SM SUPERMARKET", "groceries", 1800, 3400, ["bpicc"]),
  puregold: m("Puregold", "PUREGOLD PRICE CLUB", "groceries", 900, 2200, [
    "gcash",
  ]),
  shopee: m("Shopee", "SHOPEEPAY PHILIPPINES", "shopping", 299, 2499, ["maya"]),
  lazada: m("Lazada", "LAZADA E-SERVICES PH", "shopping", 299, 1899, ["maya"]),
  mercury: m("Mercury Drug", "MERCURY DRUG CORP", "health", 180, 850, [
    "cash",
    "gcash",
  ]),
  cinema: m("SM Cinema", "SM CINEMA", "entertainment", 350, 420, ["gcash"]),
  samgyup: m("Romantic Baboy", "ROMANTIC BABOY", "dining", 900, 1600, [
    "bpicc",
    "gcash",
  ]),
  commute: m("Jeep / MRT", "", "commute", 28, 60, ["cash"]),
}
function m(
  payee: string,
  raw: string,
  cat: string,
  min: number,
  max: number,
  accounts = ["gcash", "cash", "maya"],
): Merchant {
  return { payee, raw, cat, min, max, accounts }
}
export const RAW_HINTS: {
  match: RegExp
  payee: string
  cat?: string
}[] = [
  ...Object.values(MERCH)
    .filter((x) => x.raw)
    .map((x) => ({
      match: new RegExp(x.raw.split(" ")[0], "i"),
      payee: x.payee,
      cat: x.cat,
    })),
  { match: /MERALCO/i, payee: "Meralco", cat: "electricity" },
  { match: /SMART/i, payee: "Smart", cat: "phone" },
  { match: /LUMEN/i, payee: "Lumen Studio", cat: "freelance" },
  { match: /INTEREST/i, payee: "BPI", cat: "interest" },
  { match: /TAX/i, payee: "BPI", cat: "fees" },
  { match: /SEND MONEY/i, payee: "Send Money", cat: "gifts" },
  { match: /FOODPANDA/i, payee: "foodpanda", cat: "dining" },
]
function prng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const SEED_DAYS = 90
const TARGET: Record<string, number> = {
  cash: 3240,
  gcash: 8415,
  maya: 2130,
  bpi: 68250,
  bpicc: -11860,
  col: 92400,
}
const ACCOUNTS: Omit<Account, "opening" | "openingDate">[] = [
  a("cash", "Cash", "cash", "var(--acct-green)", 0),
  a("gcash", "GCash", "ewallet", "var(--acct-blue)", 1),
  a("maya", "Maya", "ewallet", "var(--acct-emerald)", 2),
  a("bpi", "BPI Savings", "bank", "var(--acct-red)", 3),
  {
    ...a("bpicc", "BPI Credit Card", "credit", "var(--acct-rose)", 4),
    limit: 80000,
  },
  {
    ...a("col", "COL Financial", "investment", "var(--acct-violet)", 5),
    manual: true,
    inProjection: false,
  },
]
function a(
  id: string,
  name: string,
  type: AccountType,
  color: string,
  order: number,
): Omit<Account, "opening" | "openingDate"> {
  return {
    id,
    name,
    type,
    color,
    order,
    inNetWorth: true,
    inProjection: type !== "credit" && type !== "investment",
    archived: false,
  }
}
const pad = (n: number) => String(n).padStart(2, "0")
export interface Seed {
  state: FinState
  statements: Record<"gcash" | "bpi", StatementRow[]>
}
let cached: {
  key: string
  seed: Seed
} | null = null
export function buildSeed(): Seed {
  const k = dayKey()
  if (cached?.key === k) return structuredClone(cached.seed)
  const seed = generate()
  cached = { key: k, seed }
  return structuredClone(seed)
}
function generate(): Seed {
  const rnd = prng(20260926)
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]
  const amt = (min: number, max: number, step = 1) =>
    Math.round((min + rnd() * (max - min)) / step) * step
  const records: FinRecord[] = []
  const nowHour = new Date().getHours()
  const startKey = dayKey(new Date(Date.now() - (SEED_DAYS - 1) * 86400000))
  let seq = 0
  const push = (
    n: number,
    hh: number,
    r: Omit<FinRecord, "id" | "at" | "status" | "source"> &
      Partial<Pick<FinRecord, "source" | "status">>,
  ) => {
    if (n === 0 && hh >= nowHour) return
    const mm = Math.floor(rnd() * 59)
    records.push({
      id: `r${n + 100}-${seq++}`,
      at: at(n, hh, mm),
      status: "cleared",
      source:
        r.source ?? pick(["chat", "chat", "quick-add", "quick-add", "manual"]),
      ...r,
    })
  }
  const spend = (n: number, hh: number, key: string, acct?: string) => {
    const x = MERCH[key]
    push(n, hh, {
      type: "expense",
      amount: amt(x.min, x.max, x.max > 1000 ? 10 : 1),
      accountId: acct ?? pick(x.accounts),
      categoryId: x.cat,
      payee: x.payee,
    })
  }
  let phoneBought = false
  let atmToggle = false
  for (let n = -(SEED_DAYS - 1); n <= 0; n++) {
    const d = new Date()
    d.setDate(d.getDate() + n)
    const dom = d.getDate()
    const wd = d.getDay()
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    const key = dayKey(new Date(at(n, 12)))
    const weekend = wd === 0 || wd === 6
    if (dom === 15 || dom === Math.min(30, last)) {
      push(n, 9, {
        type: "income",
        amount: 27500,
        accountId: "bpi",
        categoryId: "salary",
        payee: "Northwind PH (payroll)",
        source: "planned",
        plannedId: "pl-sal1",
        plannedOn: key,
      })
      push(n, 17, {
        type: "income",
        amount: 9000,
        accountId: "gcash",
        categoryId: "freelance",
        payee: "Lumen Studio",
        source: "planned",
        plannedId: "pl-sal2",
        plannedOn: key,
      })
      if (rnd() < 0.8) spend(n, 20, "samgyup")
    }
    const bill = (
      day: number,
      id: string,
      amount: number,
      acct: string,
      cat: string,
      payee: string,
    ) => {
      if (dom !== Math.min(day, last)) return
      push(n, 10, {
        type: "expense",
        amount,
        accountId: acct,
        categoryId: cat,
        payee,
        source: "planned",
        plannedId: id,
        plannedOn: key,
      })
    }
    bill(5, "pl-rent", 12000, "bpi", "rent", "Rent — Mrs. Santos")
    bill(3, "pl-spotify", 149, "bpicc", "subs", "Spotify")
    bill(5, "pl-netflix", 549, "bpicc", "subs", "Netflix")
    bill(18, "pl-icloud", 49, "bpicc", "subs", "iCloud+")
    bill(12, "pl-pldt", 1699, "bpicc", "internet", "PLDT Fibr")
    bill(20, "pl-meralco", amt(2480, 3150), "gcash", "electricity", "Meralco")
    if (n < -3) bill(25, "pl-smart", 999, "gcash", "phone", "Smart Postpaid")
    if (dom === 8) {
      push(n, 11, {
        type: "transfer",
        amount: amt(5200, 8800, 10),
        accountId: "bpi",
        toAccountId: "bpicc",
        payee: "BPI card — pay in full",
        source: "planned",
        plannedId: "pl-ccpay",
        plannedOn: key,
      })
      if (phoneBought)
        push(n, 11, {
          type: "transfer",
          amount: 2083,
          accountId: "bpi",
          toAccountId: "bpicc",
          payee: "Galaxy A55 installment",
          source: "planned",
          plannedId: "pl-inst",
          plannedOn: key,
        })
    }
    if (dom === 16)
      push(n, 9, {
        type: "transfer",
        amount: 3000,
        accountId: "bpi",
        toAccountId: "col",
        payee: "Monthly index fund",
        source: "planned",
        plannedId: "pl-invest",
        plannedOn: key,
      })
    if (n === -70) {
      push(n, 15, {
        type: "expense",
        amount: 24990,
        accountId: "bpicc",
        categoryId: "shopping",
        payee: "Abenson — Galaxy A55",
        note: "BPI 0% installment, 12 × ₱2,083",
        source: "manual",
      })
      phoneBought = true
    }
    if (n === -40)
      push(n, 13, {
        type: "income",
        amount: 899,
        accountId: "maya",
        categoryId: "shopping",
        payee: "Lazada refund",
        isRefund: true,
        note: "Returned earbuds",
      })
    if (wd === 1)
      push(n, 8, {
        type: "transfer",
        amount: pick([3000, 3000, 4000, 5000]),
        accountId: "bpi",
        toAccountId: "gcash",
        payee: "Cash-in via InstaPay",
      })
    if (wd === 4) {
      atmToggle = !atmToggle
      if (atmToggle)
        push(n, 18, {
          type: "transfer",
          amount: 2000,
          accountId: "bpi",
          toAccountId: "cash",
          payee: "BPI ATM withdrawal",
        })
    }
    if (!weekend) {
      if (rnd() < 0.9) spend(n, 7, "commute")
      if (rnd() < 0.9) spend(n, 19, "commute")
      if (rnd() < 0.45) spend(n, 8, pick(["starbucks", "starbucks", "tims"]))
      if (rnd() < 0.7)
        spend(
          n,
          12,
          pick([
            "jollibee",
            "inasal",
            "chowking",
            "seven",
            "seven",
            "carinderia",
          ]),
        )
      if (rnd() < 0.35) spend(n, 18, "grab")
      if (rnd() < 0.2) spend(n, 20, "grabfood")
    } else {
      if (wd === 6)
        spend(n, 10, Math.floor((n + 200) / 7) % 3 === 0 ? "puregold" : "sm")
      if (rnd() < 0.55) spend(n, 13, pick(["jollibee", "samgyup", "grabfood"]))
      if (rnd() < 0.18) spend(n, 21, pick(["shopee", "lazada"]))
      if (rnd() < 0.12) spend(n, 16, "cinema")
      if (rnd() < 0.3) spend(n, 15, "grab")
    }
    if ((n + 200) % 12 === 0) spend(n, 17, "mercury")
    if ((n + 200) % 29 === 0)
      push(n, 16, {
        type: "expense",
        amount: 250,
        accountId: "cash",
        categoryId: "personal",
        payee: "Barbershop",
      })
  }
  push(-17, 18, {
    type: "expense",
    amount: 18,
    accountId: "bpi",
    categoryId: "fees",
    payee: "BancNet ATM fee",
  })
  push(-1, 19, {
    type: "expense",
    amount: 412,
    accountId: "gcash",
    categoryId: "health",
    payee: "Mercury Drug",
    source: "photo",
    receipt: true,
    status: "pending",
    note: "Read from receipt — total looked smudged",
  })
  push(0, Math.min(nowHour - 1, 9), {
    type: "expense",
    amount: 160,
    accountId: "maya",
    categoryId: "coffee",
    payee: "Coffee",
    source: "chat",
    status: "pending",
    note: "“coffee 160 maya” — which shop?",
  })
  records.sort((x, y) => x.at.localeCompare(y.at))
  const rk = (r: FinRecord) => dayKey(new Date(r.at))
  const today = dayKey()
  const offsetKey = (n: number) => dayKey(new Date(at(n, 12)))
  const stmtFrom = offsetKey(-32)
  const stmtTo = offsetKey(-1)
  const pastImportFrom = offsetKey(-62)
  const pastImportTo = offsetKey(-31)
  const gcashAll = records.filter(
    (r) =>
      (r.accountId === "gcash" || r.toAccountId === "gcash") &&
      r.status === "cleared",
  )
  const inStmt = gcashAll.filter((r) => rk(r) >= stmtFrom && rk(r) <= stmtTo)
  const gaps = new Set<string>()
  let gi = 0
  for (const r of inStmt) {
    const k = rk(r)
    if (
      r.type === "expense" &&
      !r.plannedId &&
      k >= offsetKey(-28) &&
      k <= offsetKey(-3)
    ) {
      if (gi % 6 === 2) gaps.add(r.id)
      gi++
    }
  }
  const plainGcash = inStmt.filter(
    (r) =>
      r.type === "expense" &&
      !r.plannedId &&
      !gaps.has(r.id) &&
      rk(r) >= offsetKey(-25) &&
      rk(r) <= offsetKey(-6),
  )
  const tipped = plainGcash[1]?.id
  const shifted = plainGcash[5]?.id
  const rawFor = (r: FinRecord, acct: string) => {
    if (r.type === "transfer")
      return r.toAccountId === acct
        ? r.accountId === "bpi"
          ? "Cash-in via InstaPay from BPI"
          : `Transfer from ${r.accountId.toUpperCase()}`
        : `Transfer to ${r.toAccountId?.toUpperCase()}`
    if (r.type === "income")
      return r.plannedId === "pl-sal2"
        ? "Received money from LUMEN STUDIO INC"
        : `Received money — ${r.payee?.toUpperCase()}`
    if (r.plannedId === "pl-meralco") return "Bills Payment — MERALCO"
    if (r.plannedId === "pl-smart")
      return "Bills Payment — SMART COMMUNICATIONS"
    const mer = Object.values(MERCH).find((x) => x.payee === r.payee)
    return `Payment to ${mer?.raw || r.payee?.toUpperCase()}`
  }
  let refN = 7001234000
  const toRow = (r: FinRecord, acct: string): StatementRow => {
    const d = new Date(r.at)
    const direction =
      r.type === "income" || (r.type === "transfer" && r.toAccountId === acct)
        ? "in"
        : "out"
    let date = rk(r)
    let amount = r.amount
    if (r.id === tipped) amount = r.amount + 20
    if (r.id === shifted) {
      const dd = new Date(`${date}T12:00:00`)
      dd.setDate(dd.getDate() - 2)
      date = `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}-${pad(dd.getDate())}`
    }
    refN += 7919
    return {
      ref: String(refN),
      date,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      raw: rawFor(r, acct),
      amount,
      direction,
    }
  }
  const gcashRows = inStmt.map((r) => toRow(r, "gcash"))
  const extra: StatementRow[] = [
    {
      ref: "7001299871",
      date: offsetKey(-19),
      time: "21:14",
      raw: "Send Money to J** D*** C***",
      amount: 500,
      direction: "out",
    },
    {
      ref: "7001301144",
      date: offsetKey(-11),
      time: "12:40",
      raw: "Payment to FOODPANDA PHILIPPINES",
      amount: 386,
      direction: "out",
    },
  ]
  const dupe = gcashRows.find((r) => r.date === offsetKey(-9))
  const pendingRow: StatementRow = {
    ref: "7001309990",
    date: stmtTo,
    time: "22:02",
    raw: "PENDING — Payment to SHOPEEPAY PHILIPPINES",
    amount: 749,
    direction: "out",
    pending: true,
  }
  const gcashStatement = [
    ...gcashRows,
    ...extra,
    ...(dupe ? [{ ...dupe }] : []),
    pendingRow,
  ].sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time))
  const bpiRows = records
    .filter(
      (r) =>
        (r.accountId === "bpi" || r.toAccountId === "bpi") &&
        rk(r) >= stmtFrom &&
        rk(r) <= stmtTo,
    )
    .map((r) => toRow(r, "bpi"))
  bpiRows.push(
    {
      ref: "INT-0925",
      date: stmtTo,
      time: "23:59",
      raw: "INTEREST EARNED",
      amount: 14,
      direction: "in",
    },
    {
      ref: "TAX-0925",
      date: stmtTo,
      time: "23:59",
      raw: "WITHHOLDING TAX ON INTEREST",
      amount: 3,
      direction: "out",
    },
  )
  const effect = (acct: string, rs: FinRecord[]) =>
    rs.reduce((s, r) => s + signedFor(r, acct), 0)
  const extraGcash = extra.reduce((s, r) => s - r.amount, 0)
  const tippedExtra = tipped ? -20 : 0
  const pastImportId = "imp-gcash-prev"
  const appRecords = records.filter((r) => !gaps.has(r.id))
  for (const r of appRecords) {
    const k = rk(r)
    if (
      (r.accountId === "gcash" || r.toAccountId === "gcash") &&
      k >= pastImportFrom &&
      k <= pastImportTo
    )
      r.importId = pastImportId
  }
  appRecords.push({
    id: "r-colmv",
    type: "income",
    amount: 2140,
    accountId: "col",
    categoryId: "adjust",
    at: at(-30, 20),
    payee: "Market value update",
    source: "adjustment",
    isAdjustment: true,
    status: "cleared",
  })
  appRecords.sort((x, y) => x.at.localeCompare(y.at))
  const accounts: Account[] = ACCOUNTS.map((acc) => {
    let target = TARGET[acc.id]
    let eff = effect(acc.id, records)
    if (acc.id === "gcash") eff += extraGcash + tippedExtra
    if (acc.id === "bpi") eff += 14 - 3
    if (acc.id === "col") eff += 2140
    target = Math.round(target)
    return {
      ...acc,
      opening: target - eff,
      openingDate: startKey,
      lastReconciled:
        acc.id === "gcash"
          ? pastImportTo
          : acc.id === "bpi"
            ? offsetKey(-33)
            : acc.id === "maya"
              ? offsetKey(-58)
              : undefined,
    }
  })
  const planned: PlannedItem[] = [
    p("pl-sal1", "Salary — Northwind PH", "income", 27500, "bpi", "salary", {
      kind: "semimonthly",
      days: [15, 30],
    }),
    p(
      "pl-sal2",
      "Salary — Lumen Studio (part-time)",
      "income",
      9000,
      "gcash",
      "freelance",
      {
        kind: "semimonthly",
        days: [15, 30],
      },
    ),
    p("pl-rent", "Rent", "expense", 12000, "bpi", "rent", {
      kind: "monthly",
      day: 5,
    }),
    {
      ...p("pl-meralco", "Meralco", "expense", 2800, "gcash", "electricity", {
        kind: "monthly",
        day: 20,
      }),
      estimated: true,
    },
    p("pl-pldt", "PLDT Fibr", "expense", 1699, "bpicc", "internet", {
      kind: "monthly",
      day: 12,
    }),
    p("pl-smart", "Smart Postpaid", "expense", 999, "gcash", "phone", {
      kind: "monthly",
      day: 25,
    }),
    p("pl-netflix", "Netflix", "expense", 549, "bpicc", "subs", {
      kind: "monthly",
      day: 5,
    }),
    p("pl-spotify", "Spotify", "expense", 149, "bpicc", "subs", {
      kind: "monthly",
      day: 3,
    }),
    p("pl-icloud", "iCloud+", "expense", 49, "bpicc", "subs", {
      kind: "monthly",
      day: 18,
    }),
    {
      ...p(
        "pl-ccpay",
        "BPI card — pay in full",
        "transfer",
        6500,
        "bpi",
        undefined,
        {
          kind: "monthly",
          day: 8,
        },
      ),
      toAccountId: "bpicc",
      estimated: true,
      inProjection: false,
    },
    {
      ...p(
        "pl-inst",
        "Galaxy A55 — 0% installment",
        "transfer",
        2083,
        "bpi",
        undefined,
        {
          kind: "monthly",
          day: 8,
        },
      ),
      toAccountId: "bpicc",
      isInstallment: true,
      start: firstDomAfter(-70, 8),
      end: { kind: "count", n: 12 },
    },
    {
      ...p(
        "pl-invest",
        "Monthly index fund",
        "transfer",
        3000,
        "bpi",
        undefined,
        {
          kind: "monthly",
          day: 16,
        },
      ),
      toAccountId: "col",
    },
    {
      ...p("pl-13th", "13th month pay", "income", 27500, "bpi", "salary", {
        kind: "once",
        date: nextDate(12, 18),
      }),
      estimated: true,
    },
    {
      ...p(
        "pl-xmas",
        "Christmas gifts & Noche Buena",
        "expense",
        15000,
        "gcash",
        "gifts",
        {
          kind: "once",
          date: nextDate(12, 20),
        },
      ),
      estimated: true,
    },
    {
      ...p(
        "pl-wi-trip",
        "Siargao trip (draft)",
        "expense",
        28000,
        "bpicc",
        "entertainment",
        {
          kind: "once",
          date: nextDate(4, 10),
        },
      ),
      isWhatIf: true,
      inProjection: false,
    },
  ]
  const budgets: Budget[] = [
    b("bg-all", "Monthly spend", null, 50000),
    b("bg-food", "Food", ["food"], 18000),
    b("bg-transport", "Transport", ["transport"], 6500),
    b("bg-fun", "Fun & shopping", ["shopping", "entertainment", "subs"], 4000),
  ].map((x) => ({ ...x, startDate: startKey }))
  const pastImport: StatementImport = {
    id: pastImportId,
    accountId: "gcash",
    fileName: "GCash_Transaction_History_prev.pdf",
    fileType: "pdf",
    from: pastImportFrom,
    to: pastImportTo,
    closing: 0,
    status: "done",
    createdAt: at(-30, 21),
    rows: [],
    counts: { matched: 41, created: 4, updated: 3, ignored: 1 },
    createdIds: [],
    changed: [],
    fileKept: false,
  }
  const failedImport: StatementImport = {
    id: "imp-maya-fail",
    accountId: "maya",
    fileName: "IMG_4471.jpg",
    fileType: "image",
    from: offsetKey(-60),
    to: offsetKey(-45),
    closing: 0,
    status: "failed",
    createdAt: at(-44, 22),
    rows: [],
    createdIds: [],
    changed: [],
    fileKept: false,
    error: "Couldn't read the screenshot — too blurry.",
  }
  return {
    state: {
      accounts,
      categories: structuredClone(CATEGORIES),
      records: appRecords,
      budgets,
      planned,
      imports: [pastImport, failedImport],
      lookbacks: [],
      threads: [],
      settings: {
        defaultAccountId: "gcash",
        monthStartDay: 1,
        horizon: 12,
        includeUnplanned: true,
        safetyFloor: 30000,
        aiScope: "aggregates",
        disclaimerAck: false,
        nudgeDays: 21,
        projExcludedPlanned: [],
      },
    },
    statements: { gcash: gcashStatement, bpi: bpiRows },
  }
  function p(
    id: string,
    name: string,
    type: RecordType,
    amount: number,
    accountId: string,
    categoryId: string | undefined,
    schedule: Schedule,
  ): PlannedItem {
    return {
      id,
      name,
      type,
      amount,
      estimated: false,
      accountId,
      categoryId,
      schedule,
      start: startKey,
      end: { kind: "never" },
      autoLog: type === "income",
      isWhatIf: false,
      inProjection: true,
      archived: false,
      skipped: [],
      snoozed: {},
    }
  }
  function b(
    id: string,
    name: string,
    categoryIds: string[] | null,
    limit: number,
  ): Budget {
    return {
      id,
      name,
      categoryIds,
      limit,
      period: "monthly",
      rollover: false,
      startDate: startKey,
      archived: false,
    }
  }
  function firstDomAfter(n: number, dom: number) {
    const d = new Date(at(n, 12))
    if (d.getDate() >= dom) d.setMonth(d.getMonth() + 1)
    d.setDate(dom)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  function nextDate(month: number, dom: number) {
    const now = new Date(`${today}T12:00:00`)
    let y = now.getFullYear()
    if (
      month - 1 < now.getMonth() ||
      (month - 1 === now.getMonth() && dom < now.getDate())
    )
      y++
    return `${y}-${pad(month)}-${pad(dom)}`
  }
}
export function signedFor(r: FinRecord, acct: string): number {
  if (r.type === "transfer") {
    if (r.accountId === acct) return -r.amount
    if (r.toAccountId === acct) return r.amount
    return 0
  }
  if (r.accountId !== acct) return 0
  return r.type === "income" ? r.amount : -r.amount
}
export function emptyState(settings: FinSettings): FinState {
  return {
    accounts: [],
    categories: structuredClone(CATEGORIES),
    records: [],
    budgets: [],
    planned: [],
    imports: [],
    lookbacks: [],
    threads: [],
    settings: { ...settings, disclaimerAck: false },
  }
}
