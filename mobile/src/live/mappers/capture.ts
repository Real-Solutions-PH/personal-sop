// Live mappers for capture: the raw capture, the journal and the AI
// settings are field writes; the record cards, their write log and the other
// reply items are server-made rows the device only pulls, folded back into
// each capture's ``reply.items`` so the thread renders them unchanged.
//
// Shapes (device -> server):
// - card payloads are camelCase major units on the device and snake_case
//   hundredths on the server (``amount`` <-> ``amount_minor``); seeded finance
//   categories keep their slug ids on the device (see mappers/finance.ts);
// - a card's follow-up names its field the server's way (``category_id``),
//   the device's way on the phone (``categoryId``); category answers travel
//   as server ids;
// - answer cards carry money as hundredths (``money`` and, on a money card,
//   ``bars.data``); the device shows major units;
// - instants are ISO strings; journal days stay ``YYYY-MM-DD``.
//
// A capture the live path is streaming right now, or a photo/file capture
// whose media is not uploaded yet, is left out of the diff: the stream (or
// the upload, then the diff) creates it on the server. See live/capture.ts.

import type {
  AISettings,
  AnswerCard,
  Capture,
  CaptureState,
  Payload as CardPayload,
  FollowUp,
  InfoCard,
  JournalEntry,
  RecordCard,
  ReplyItem,
  RuleKey,
  Tier,
  WriteLogEntry,
} from "@domain/capture/data"
import { DEFAULT_RULES } from "@domain/capture/data"
import { captureStore } from "@domain/capture/store"
import { isUuid } from "@domain/lib/ids"
import type { Mapper, Payload } from "../mapper"
import { categoryIds, fromMinor, toMinor } from "./finance"
import { singleton } from "./helpers"

export type Cats = ReturnType<typeof categoryIds>

const str = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : String(v)
const num = (v: unknown): number | undefined =>
  v === null || v === undefined ? undefined : Number(v)
const instant = (v: unknown): string => new Date(String(v)).toISOString()

/** Live-only bookkeeping carried on store rows (persisted with them). */
export type LiveCard = RecordCard & { captureId?: string; position?: number }
export type LiveReply = (AnswerCard | InfoCard) & {
  captureId?: string
  position?: number
}
export type LiveItem = LiveCard | LiveReply
export type LiveLog = WriteLogEntry & { id?: string }
export type LiveCapture = Capture & {
  mediaId?: string
  /** Uploaded ids of ``photos`` (the extra photos), in order. */
  extraMediaIds?: string[]
  transcript?: string
  /** Statement captures: the finance account the file belongs to. */
  accountId?: string
}

// ---------------------------------------------------------------------------
// Card payloads
// ---------------------------------------------------------------------------

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

function rekey(v: unknown, f: (k: string) => string): unknown {
  if (Array.isArray(v)) return v.map((x) => rekey(x, f))
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined) continue
      out[f(k)] = rekey(x, f)
    }
    return out
  }
  return v
}

/** Device card payload -> the server's (``PayloadIn`` shape). */
export function payloadToServer(p: CardPayload, cats: Cats): Payload {
  const out = rekey(p, toSnake) as Payload
  if ("amount" in out) {
    if (out.amount !== undefined && out.amount !== null)
      out.amount_minor = toMinor(Number(out.amount))
    delete out.amount
  }
  if (typeof out.category_id === "string")
    out.category_id = cats.out(out.category_id)
  return out
}

/** Server card payload -> the device's. */
export function payloadFromServer(row: unknown, cats: Cats): CardPayload {
  const src = { ...((row ?? {}) as Record<string, unknown>) }
  const out = rekey(src, toCamel) as Record<string, unknown>
  if ("amountMinor" in out) {
    if (out.amountMinor !== null && out.amountMinor !== undefined)
      out.amount = fromMinor(out.amountMinor)
    delete out.amountMinor
  }
  if ("categoryId" in out) out.categoryId = cats.in(out.categoryId)
  return out as unknown as CardPayload
}

/** Server follow-up -> the device's (field name and category values). */
export function askFromServer(ask: unknown, cats: Cats): FollowUp | undefined {
  if (!ask || typeof ask !== "object") return undefined
  const a = ask as Record<string, unknown>
  const field = toCamel(String(a.field ?? ""))
  const options = Array.isArray(a.options) ? a.options : []
  return {
    question: String(a.question ?? ""),
    field,
    options: options.map((o) => {
      const x = o as { label?: unknown; value?: unknown }
      const value = String(x.value ?? "")
      return {
        label: String(x.label ?? value),
        value: field === "categoryId" ? (cats.in(value) ?? value) : value,
      }
    }),
    ...(a.free ? { free: true } : {}),
  }
}

/** A chip or free answer -> the value the server expects. */
export function answerToServer(
  card: RecordCard | undefined,
  value: string,
  cats: Cats,
): string {
  return card?.ask?.field === "categoryId" ? (cats.out(value) ?? value) : value
}

// ---------------------------------------------------------------------------
// Cards and reply items
// ---------------------------------------------------------------------------

export function logFromServer(row: Payload): LiveLog {
  return {
    id: str(row.id),
    at: instant(row.at),
    action: String(row.action) as WriteLogEntry["action"],
    actor: row.actor === "ai" ? "ai" : "user",
  }
}

/** ``CardPublic`` (REST, stream) or ``CardSyncPublic`` (pull) -> device. */
export function cardFromServer(
  row: Payload,
  cats: Cats,
  current?: RecordCard,
): LiveCard {
  const log = Array.isArray(row.log)
    ? (row.log as Payload[]).map(logFromServer)
    : (current?.log ?? [])
  const card: LiveCard = {
    t: "record",
    id: String(row.id),
    kind: String(row.kind) as RecordCard["kind"],
    target: String(row.target) as RecordCard["target"],
    tier: row.tier === "auto" ? "auto" : "confirm",
    state: String(row.state) as RecordCard["state"],
    payload: payloadFromServer(row.payload, cats),
    refs: Array.isArray(row.refs) ? row.refs.map(String) : [],
    log,
    captureId: String(row.capture_id),
    position: Number(row.position ?? 0),
  }
  const ask = askFromServer(row.ask, cats)
  if (ask) card.ask = ask
  if (row.note) card.note = String(row.note)
  if (row.warn) card.warn = String(row.warn)
  if (row.confidence !== null && row.confidence !== undefined)
    card.confidence = Number(row.confidence)
  if (row.day_offset !== null && row.day_offset !== undefined)
    card.dayOffset = Number(row.day_offset)
  return card
}

/** ``ReplyPublic`` (an answer or info card) -> device. */
export function replyFromServer(row: Payload): LiveReply {
  const body = { ...((row.body ?? {}) as Record<string, unknown>) }
  const kind = row.kind === "answer" ? "answer" : "info"
  if (kind === "answer" && typeof body.money === "number") {
    body.money = fromMinor(body.money)
    const bars = body.bars as { labels: string[]; data: number[] } | undefined
    if (bars)
      body.bars = { labels: bars.labels, data: bars.data.map(fromMinor) }
  }
  if (kind === "info" && !Array.isArray(body.actions)) body.actions = []
  if (kind === "answer" && !Array.isArray(body.links)) body.links = []
  return {
    ...(body as object),
    t: kind,
    id: String(row.id),
    captureId: String(row.capture_id),
    position: Number(row.position ?? 0),
  } as LiveReply
}

const position = (i: ReplyItem) => (i as LiveItem).position ?? 1e9

/** Insert or replace items by id, ordered by the server's position. */
export function withItems(
  items: ReplyItem[],
  ups: ReplyItem[],
  drop: Iterable<string> = [],
): ReplyItem[] {
  const gone = new Set(drop)
  const map = new Map(
    items.filter((i) => !gone.has(i.id)).map((i) => [i.id, i]),
  )
  for (const u of ups) {
    const prev = map.get(u.id)
    // A pulled card row has no write log; keep the one already folded in.
    if (prev?.t === "record" && u.t === "record" && !u.log.length)
      map.set(u.id, { ...u, log: prev.log })
    else map.set(u.id, u)
  }
  return [...map.values()].sort((a, b) => position(a) - position(b))
}

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------

const ERRORS: Record<string, string> = {
  ai_disabled: "AI is switched off (kill switch in AI settings).",
  ai_spend_cap_reached: "Monthly AI spend cap reached.",
  interpret_failed: "The AI couldn't read that.",
  transcript_required: "Send the transcript with the recording.",
  transcription_unavailable: "No transcription model is set up.",
  transcript_empty: "I couldn't hear anything in that recording.",
  audio_required: "Attach the recording.",
}
export const errorText = (code: unknown): string | undefined =>
  code ? (ERRORS[String(code)] ?? "Couldn't process that.") : undefined

const PARSER_HINTS = new Set([
  "auto",
  "meal",
  "receipt",
  "label",
  "statement",
  "whiteboard",
  "journal",
  "expense",
  "task",
  "weigh-in",
])
/** Hints the server accepts; a statement's hint is its account, not a hint. */
export const hintToServer = (hint: string | undefined) =>
  hint && PARSER_HINTS.has(hint) ? hint : undefined

/** ``CapturePublic`` -> device; reply items stay the device's own. */
export function captureFromServer(row: Payload, current?: Capture): Capture {
  const cur = current as LiveCapture | undefined
  const replyText = str(row.reply_text)
  const out: LiveCapture = {
    ...(cur ?? {}),
    id: String(row.id),
    at: instant(row.at),
    source: String(row.source) as Capture["source"],
    text: String(row.text ?? ""),
    status: String(row.status) as Capture["status"],
    clientUuid: String(row.client_uuid),
  }
  if (row.duration_sec !== null && row.duration_sec !== undefined)
    out.durationSec = Number(row.duration_sec)
  if (row.hint) out.hint = cur?.hint ?? String(row.hint)
  if (row.file_name) out.fileName = String(row.file_name)
  if (row.transcript) out.transcript = String(row.transcript)
  if (row.started_at) out.startedAt = instant(row.started_at)
  const error = errorText(row.error_code)
  if (error) out.error = error
  else delete out.error
  if (replyText !== undefined || cur?.reply)
    out.reply = {
      text: replyText ?? cur?.reply?.text ?? "",
      items: cur?.reply?.items ?? [],
    }
  return out
}

/** ``CaptureDetail`` -> device: the capture with all its reply items. */
export function captureFromDetail(
  d: Payload,
  cats: Cats,
  current?: Capture,
): Capture {
  const base = captureFromServer(d, current)
  const old = new Map(
    (current?.reply?.items ?? []).map((i) => [i.id, i] as const),
  )
  const cards = ((d.cards ?? []) as Payload[]).map((c) =>
    cardFromServer(c, cats, old.get(String(c.id)) as RecordCard | undefined),
  )
  const replies = ((d.replies ?? []) as Payload[]).map(replyFromServer)
  return {
    ...base,
    reply: {
      text: str(d.reply_text) ?? current?.reply?.text ?? "",
      items: withItems([], [...cards, ...replies]),
    },
  }
}

/** Device capture -> ``CaptureSync`` (the raw input only). */
export function captureToServer(c: Capture): Payload {
  const cap = c as LiveCapture
  const out: Payload = {
    client_uuid: isUuid(c.clientUuid) ? c.clientUuid : c.id,
    at: c.at,
    source: c.source,
    text: c.text,
  }
  if (c.source === "voice") out.transcript = cap.transcript ?? c.text
  if (c.durationSec !== undefined) out.duration_sec = Math.round(c.durationSec)
  const hint = hintToServer(c.hint)
  if (hint) out.hint = hint
  if (c.fileName) out.file_name = c.fileName.slice(0, 255)
  if (cap.mediaId) out.media_id = cap.mediaId
  if (cap.extraMediaIds?.length) out.extra_media_ids = cap.extraMediaIds
  if (cap.accountId) out.account_id = cap.accountId
  return out
}

// ---------------------------------------------------------------------------
// Live path hooks: what the diff must leave alone
// ---------------------------------------------------------------------------

const streaming = new Set<string>()
/** The live path marks a capture while its stream creates it. */
export const streamingCaptures = {
  add: (id: string) => void streaming.add(id),
  delete: (id: string) => void streaming.delete(id),
  has: (id: string) => streaming.has(id),
}

const needsMedia = (c: Capture) =>
  ((c.source === "photo" || c.source === "file") &&
    !(c as LiveCapture).mediaId) ||
  (!!c.photos?.length && !(c as LiveCapture).extraMediaIds)

/** Rows the diff may see: server-safe ids, not mid-stream, media ready. */
const pushable = (c: Capture) =>
  isUuid(c.id) && !streaming.has(c.id) && !needsMedia(c)

// Cards, replies and log rows can arrive before their parent (a later pull
// page). They wait here and are folded in when the parent lands.
const heldItems = new Map<string, ReplyItem[]>()
const heldLogs = new Map<string, LiveLog[]>()

function hold<T>(map: Map<string, T[]>, key: string, v: T) {
  map.set(key, [...(map.get(key) ?? []), v])
}

const allCards = (s: CaptureState): LiveCard[] =>
  s.captures.flatMap((c) =>
    (c.reply?.items ?? []).filter((i): i is LiveCard => i.t === "record"),
  )

function foldLogs(card: RecordCard, logs: LiveLog[]): RecordCard {
  const byKey = new Map<string, LiveLog>()
  for (const l of [...(card.log as LiveLog[]), ...logs])
    byKey.set(l.id ?? `${l.at}|${l.action}|${l.actor}`, l)
  // Server rows replace the stream-time entries they duplicate.
  const ids = [...byKey.values()].filter((l) => l.id)
  const keep = [...byKey.values()].filter(
    (l) =>
      l.id || !ids.some((x) => x.action === l.action && x.actor === l.actor),
  )
  return { ...card, log: keep.sort((a, b) => a.at.localeCompare(b.at)) }
}

/** A held card picks up the log rows that were waiting for it. */
function withHeldLogs<T extends ReplyItem>(i: T): T {
  if (i.t !== "record") return i
  const logs = heldLogs.get(i.id)
  if (!logs) return i
  heldLogs.delete(i.id)
  return foldLogs(i, logs) as T
}

function attachHeld(c: Capture): Capture {
  const held = heldItems.get(c.id)
  if (!held) return c
  heldItems.delete(c.id)
  const items = held.map(withHeldLogs)
  return {
    ...c,
    reply: {
      text: c.reply?.text ?? "",
      items: withItems(c.reply?.items ?? [], items),
    },
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function captureMapper(): Mapper<CaptureState, Capture> {
  return {
    entity: "capture",
    store: captureStore,
    list: (s) => s.captures.filter(pushable),
    id: (c) => c.id,
    toServer: (c) => captureToServer(c),
    fromServer: (row, s) =>
      captureFromServer(
        row,
        s.captures.find((c) => c.id === String(row.id)),
      ),
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const gone = new Set(dels)
      const byId = new Map(ups.map((u) => [u.id, u]))
      // The server has the row now: the stream's guard is no longer needed.
      for (const u of ups) streaming.delete(u.id)
      const captures = s.captures
        .filter((c) => !gone.has(c.id))
        .map((c) => {
          const u = byId.get(c.id)
          if (!u) return c
          byId.delete(c.id)
          return attachHeld(u)
        })
      for (const u of byId.values()) captures.push(attachHeld(u))
      captures.sort((a, b) => a.at.localeCompare(b.at))
      return { ...s, captures }
    },
  }
}

/** Shared shape of the two reply-item entities (cards and answer/info). */
function itemMapper<L extends LiveItem>(opts: {
  entity: string
  pick(i: ReplyItem): boolean
  fromServer(row: Payload, s: CaptureState): L
}): Mapper<CaptureState, L> {
  return {
    entity: opts.entity,
    store: captureStore,
    readOnly: true,
    list: (s) =>
      s.captures.flatMap((c) =>
        (c.reply?.items ?? []).filter(opts.pick),
      ) as L[],
    id: (i) => i.id,
    toServer: () => ({}),
    fromServer: opts.fromServer,
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const byCap = new Map<string, L[]>()
      for (const u of ups) {
        const key = u.captureId ?? ""
        byCap.set(key, [...(byCap.get(key) ?? []), u])
      }
      const known = new Set(s.captures.map((c) => c.id))
      for (const [cap, list] of byCap)
        if (!known.has(cap)) for (const l of list) hold(heldItems, cap, l)
      const captures = s.captures.map((c) => {
        const mine = byCap.get(c.id) ?? []
        const items = c.reply?.items ?? []
        if (!mine.length && !items.some((i) => dels.includes(i.id))) return c
        const withLogs = mine.map(withHeldLogs)
        return {
          ...c,
          reply: {
            text: c.reply?.text ?? "",
            items: withItems(items, withLogs, dels),
          },
        }
      })
      return { ...s, captures }
    },
  }
}

export function recordCardMapper(cats: Cats) {
  return itemMapper<LiveCard>({
    entity: "record_card",
    pick: (i) => i.t === "record",
    fromServer: (row, s) =>
      cardFromServer(
        row,
        cats,
        allCards(s).find((c) => c.id === String(row.id)),
      ),
  })
}

export function replyItemMapper() {
  return itemMapper<LiveReply>({
    entity: "reply_item",
    pick: (i) => i.t !== "record",
    fromServer: (row) => replyFromServer(row),
  })
}

interface LogRow extends LiveLog {
  id: string
  cardId: string
}

/** Each card's write log (one row per proposed/saved/undone/...). */
export function cardWriteLogMapper(): Mapper<CaptureState, LogRow> {
  return {
    entity: "card_write_log",
    store: captureStore,
    readOnly: true,
    list: (s) =>
      allCards(s).flatMap((c) =>
        (c.log as LiveLog[])
          .filter((l) => l.id)
          .map((l) => ({ ...l, id: l.id as string, cardId: c.id })),
      ),
    id: (l) => l.id,
    toServer: () => ({}),
    fromServer: (row) => ({
      ...logFromServer(row),
      id: String(row.id),
      cardId: String(row.card_id),
    }),
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const byCard = new Map<string, LiveLog[]>()
      for (const { cardId, ...l } of ups)
        byCard.set(cardId, [...(byCard.get(cardId) ?? []), l])
      const known = new Set(allCards(s).map((c) => c.id))
      for (const [card, list] of byCard)
        if (!known.has(card)) for (const l of list) hold(heldLogs, card, l)
      const gone = new Set(dels)
      const captures = s.captures.map((c) => {
        const items = c.reply?.items ?? []
        let changed = false
        const next = items.map((i) => {
          if (i.t !== "record") return i
          const add = byCard.get(i.id)
          const dropped = (i.log as LiveLog[]).some(
            (l) => l.id && gone.has(l.id),
          )
          if (!add && !dropped) return i
          changed = true
          const kept = {
            ...i,
            log: (i.log as LiveLog[]).filter((l) => !(l.id && gone.has(l.id))),
          }
          return add ? foldLogs(kept, add) : kept
        })
        return changed
          ? { ...c, reply: { text: c.reply?.text ?? "", items: next } }
          : c
      })
      return { ...s, captures }
    },
  }
}

export function journalToServer(j: JournalEntry): Payload {
  return {
    day: j.day,
    body: j.body,
    source: j.source,
    mood: j.mood ?? null,
    tags: j.tags,
    area: j.area ?? null,
    private: j.private,
    transcript: j.transcript ?? null,
  }
}

export function journalFromServer(row: Payload): JournalEntry {
  const j: JournalEntry = {
    id: String(row.id),
    day: String(row.day),
    createdAt: instant(row.created_at),
    body: String(row.body),
    source:
      row.source === "voice" || row.source === "wrapup" ? row.source : "text",
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    private: row.private !== false,
  }
  if (row.mood !== null && row.mood !== undefined)
    j.mood = Number(row.mood) as JournalEntry["mood"]
  if (row.area) j.area = String(row.area)
  if (row.transcript) j.transcript = String(row.transcript)
  if (row.capture_id) j.captureId = String(row.capture_id)
  return j
}

export function journalMapper(): Mapper<CaptureState, JournalEntry> {
  return {
    entity: "journal_entry",
    store: captureStore,
    // A voice entry still waiting for its words stays on the device.
    list: (s) => s.journal.filter((j) => isUuid(j.id) && !j.transcription),
    id: (j) => j.id,
    toServer: journalToServer,
    fromServer: journalFromServer,
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const gone = new Set(dels)
      const byId = new Map(ups.map((u) => [u.id, u]))
      const journal = s.journal
        .filter((j) => !gone.has(j.id))
        .map((j) => {
          const u = byId.get(j.id)
          if (u) byId.delete(j.id)
          return u ?? j
        })
      return { ...s, journal: [...journal, ...byId.values()] }
    },
  }
}

type SettingsWire = Pick<
  AISettings,
  | "rules"
  | "moneyThreshold"
  | "language"
  | "transcription"
  | "sendPhotos"
  | "journalInQA"
  | "financeScope"
  | "spendCap"
  | "aiEnabled"
  | "retentionDays"
  | "model"
>

export function settingsToServer(v: SettingsWire): Payload {
  return {
    rules: { ...v.rules },
    money_threshold_minor: toMinor(v.moneyThreshold),
    language: v.language,
    transcription: v.transcription,
    send_photos: v.sendPhotos,
    journal_in_qa: v.journalInQA,
    finance_scope: v.financeScope,
    spend_cap_minor: toMinor(v.spendCap),
    ai_enabled: v.aiEnabled,
    retention_days: v.retentionDays,
    // "" on the device: the server's default model. Older devices still hold
    // the prototype's demo label ("… (OpenRouter)"), which the server would
    // refuse along with the rest of the row; ids never contain spaces.
    model: v.model && !/\s/.test(v.model) ? v.model : null,
  }
}

export function settingsFromServer(row: Payload, cur: AISettings): AISettings {
  const rules = { ...DEFAULT_RULES }
  for (const [k, v] of Object.entries(
    (row.rules ?? {}) as Record<string, string>,
  ))
    if (k in rules && (v === "auto" || v === "confirm"))
      rules[k as RuleKey] = v as Tier
  return {
    ...cur,
    rules,
    moneyThreshold: fromMinor(row.money_threshold_minor),
    language: row.language === "en" ? "en" : "en-tl",
    transcription: row.transcription === "browser" ? "browser" : "server",
    sendPhotos: Boolean(row.send_photos),
    journalInQA: Boolean(row.journal_in_qa),
    financeScope: row.finance_scope === "records" ? "records" : "aggregates",
    spendCap: fromMinor(row.spend_cap_minor),
    aiEnabled: Boolean(row.ai_enabled),
    retentionDays: num(row.retention_days) ?? cur.retentionDays,
    model: typeof row.model === "string" ? row.model : "",
  }
}

/** One row per user. ``simulateOffline`` stays on the device; ``model`` is
 * the pick for the server's own key ("" = its default);
 * the spend meter is a REST read (``GET /capture/settings``). */
export function aiSettingsMapper(userId: string) {
  return singleton<CaptureState, AISettings>({
    entity: "ai_settings",
    userId,
    store: captureStore,
    read: (s) => s.settings,
    write: (s, v) => ({ ...s, settings: v }),
    toServer: settingsToServer,
    fromServer: settingsFromServer,
  })
}

/** Push and merge order: a capture lands before the cards folded into it. */
export function captureSyncMappers(userId: string) {
  const cats = categoryIds(userId)
  return [
    captureMapper(),
    recordCardMapper(cats),
    replyItemMapper(),
    cardWriteLogMapper(),
    journalMapper(),
    aiSettingsMapper(userId),
  ]
}
