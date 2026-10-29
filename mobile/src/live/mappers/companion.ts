// Live mappers for the companion (Fern by default): its name, the trackers (one per
// metric) and the memories are field writes; the conversation is pulled
// only, because a message exists only as one side of an ask the server
// answered (live/capture.ts streams the ask itself).
//
// Shapes: local times are epoch milliseconds, the server's are ISO
// instants (read-only ``created_at``). A tracker's metric is its natural
// key: a pulled tracker replaces a local one for the same metric.

import { isUuid } from "@domain/lib/ids"
import {
  type Block,
  COMPANION_NAME,
  type CompanionState,
  companionStore,
  type Memory,
  type Metric,
  type Msg,
  type Thread,
  type Tracker,
  untouched,
} from "@/prototype/companion/store"
import type { Mapper, Payload } from "../mapper"
import { singleton } from "./helpers"

const ms = (v: unknown): number => {
  const t = Date.parse(String(v))
  return Number.isNaN(t) ? Date.now() : t
}

const METRICS: readonly Metric[] = [
  "life",
  "habits",
  "tasks",
  "spend",
  "spendCats",
  "netWorth",
  "workouts",
  "weight",
  "nutrition",
]

/** Replace by id, drop deleted, append new (store order kept). */
function upsertList<T>(
  list: T[],
  ups: T[],
  dels: string[],
  idOf: (t: T) => string,
): T[] {
  const gone = new Set(dels)
  const byId = new Map(ups.map((u) => [idOf(u), u]))
  const out = list
    .filter((x) => !gone.has(idOf(x)))
    .map((x) => {
      const u = byId.get(idOf(x))
      if (u) byId.delete(idOf(x))
      return u ?? x
    })
  return [...out, ...byId.values()]
}

export function companionMapper(userId: string) {
  return singleton<CompanionState, string>({
    entity: "companion",
    userId,
    store: companionStore,
    read: (s) => s.name,
    write: (s, name) => ({ ...s, name }),
    toServer: (name) => ({ name }),
    fromServer: (row) => String(row.name ?? "").trim() || COMPANION_NAME,
  })
}

export function trackerToServer(t: Tracker): Payload {
  return {
    metric: t.metric,
    label: t.label,
    goal: t.goal ?? null,
    direction: t.direction ?? null,
  }
}

export function trackerFromServer(row: Payload): Tracker | null {
  const metric = row.metric as Metric
  if (!METRICS.includes(metric)) return null
  const t: Tracker = {
    id: String(row.id),
    metric,
    label: String(row.label),
    createdAt: ms(row.created_at),
  }
  if (row.goal !== null && row.goal !== undefined) t.goal = Number(row.goal)
  if (row.direction === "below" || row.direction === "above")
    t.direction = row.direction
  return t
}

export function trackerMapper(): Mapper<CompanionState, Tracker> {
  return {
    entity: "tracker",
    store: companionStore,
    list: (s) => s.trackers.filter((t) => isUuid(t.id)),
    id: (t) => t.id,
    toServer: trackerToServer,
    fromServer: trackerFromServer,
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      // Natural key: one tracker per metric. The server's row wins; a local
      // row for the same metric under another id is the device's duplicate.
      const pulled = new Map(ups.map((u) => [u.metric, u.id]))
      const kept = s.trackers.filter((t) => {
        const id = pulled.get(t.metric)
        return id === undefined || id === t.id
      })
      return { ...s, trackers: upsertList(kept, ups, dels, (t) => t.id) }
    },
  }
}

/** ``MemorySync``: a memory saved before the memory layer reads as a fact. */
export function memoryToServer(m: Memory): Payload {
  return {
    text: m.text,
    kind: m.kind ?? "fact",
    tags: m.tags ?? [],
    importance: m.importance ?? 3,
    always_on: m.alwaysOn ?? false,
  }
}

/** ``MemoryPublic`` -> a memory. An unknown kind or source is kept as sent
 * (memory-labels.ts shows it as itself). */
export function memoryFromServer(row: Payload): Memory {
  return {
    id: String(row.id),
    text: String(row.text),
    at: ms(row.created_at),
    kind: typeof row.kind === "string" ? row.kind : "fact",
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    importance: typeof row.importance === "number" ? row.importance : 3,
    alwaysOn: row.always_on === true,
    source: typeof row.source === "string" ? row.source : "said",
  }
}

export function memoryMapper(): Mapper<CompanionState, Memory> {
  return {
    entity: "memory",
    store: companionStore,
    list: (s) => s.memories.filter((m) => isUuid(m.id)),
    id: (m) => m.id,
    toServer: memoryToServer,
    fromServer: memoryFromServer,
    merge: (s, ups, dels) =>
      ups.length || dels.length
        ? { ...s, memories: upsertList(s.memories, ups, dels, (m) => m.id) }
        : s,
  }
}

/** ``MessagePublic`` -> a chat message. */
export function messageFromServer(row: Payload): Msg {
  const m: Msg = {
    id: String(row.id),
    role: row.role === "me" ? "me" : "sol",
    at: ms(row.created_at),
  }
  if (row.text) m.text = String(row.text)
  const blocks = Array.isArray(row.blocks) ? (row.blocks as Block[]) : []
  if (blocks.length) m.blocks = blocks
  if (row.thread_id) m.threadId = String(row.thread_id)
  return m
}

/** ``ThreadPublic`` -> a chat; a chat is made and renamed on the phone. */
export function threadFromServer(row: Payload): Thread {
  return {
    id: String(row.id),
    title: row.title ? String(row.title) : null,
    lastAt: row.last_at ? ms(row.last_at) : null,
    createdAt: ms(row.created_at),
  }
}

export function threadMapper(): Mapper<CompanionState, Thread> {
  return {
    entity: "companion_thread",
    store: companionStore,
    // A chat nobody has written in stays on the phone: opening Fern's
    // drawer makes one every time, and the server should not keep them.
    list: (s) =>
      (s.threads ?? []).filter((t) => isUuid(t.id) && !untouched(s, t)),
    id: (t) => t.id,
    // Only the title is the phone's to write; a new chat's first message
    // also makes it on the server.
    toServer: (t) => ({ title: t.title }),
    fromServer: threadFromServer,
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const local = new Map((s.threads ?? []).map((t) => [t.id, t]))
      // The phone's title wins over a pulled null (named before the server
      // stored the first message); its last activity keeps the later time.
      const merged = ups.map((u) => {
        const mine = local.get(u.id)
        return mine
          ? {
              ...u,
              title: u.title ?? mine.title,
              lastAt: Math.max(u.lastAt ?? 0, mine.lastAt ?? 0) || null,
            }
          : u
      })
      return {
        ...s,
        threads: upsertList(s.threads ?? [], merged, dels, (t) => t.id),
        messages: dels.length
          ? s.messages.filter((m) => !m.threadId || !dels.includes(m.threadId))
          : s.messages,
        activeThread:
          s.activeThread && dels.includes(s.activeThread)
            ? null
            : s.activeThread,
      }
    },
  }
}

/** Fold messages into the conversation, in time order. */
export function withMessages(
  list: Msg[],
  ups: Msg[],
  dels: string[] = [],
): Msg[] {
  return upsertList(list, ups, dels, (m) => m.id).sort((a, b) => a.at - b.at)
}

export function messageMapper(): Mapper<CompanionState, Msg> {
  return {
    entity: "companion_message",
    store: companionStore,
    readOnly: true,
    list: (s) => s.messages,
    id: (m) => m.id,
    toServer: () => ({}),
    fromServer: messageFromServer,
    merge: (s, ups, dels) =>
      ups.length || dels.length
        ? { ...s, messages: withMessages(s.messages, ups, dels) }
        : s,
  }
}

export function companionMappers(userId: string) {
  return [
    companionMapper(userId),
    trackerMapper(),
    memoryMapper(),
    threadMapper(),
    messageMapper(),
  ]
}
