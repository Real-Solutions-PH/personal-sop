// The local-first sync engine (ADR-0011, mobile side).
//
// Writes: every mapped store change is diffed (debounced) into ops that go
// to the outbox, then pushed in order. Reads: /sync/pull past the stored
// cursor, merged into the stores with diffing suppressed. Nothing here is
// visible in the UI: the screens keep reading their stores; offline, ops
// simply wait in the outbox.

import { newId } from "@domain/lib/ids"
import type { StorageAdapter } from "@domain/lib/store"
import { ApiError, type Http, NetworkError } from "./http"
import { type AnyMapper, diffEntity, type Payload } from "./mapper"
import type { Outbox, SyncOp } from "./outbox"

interface OpResult {
  op_id: string
  status: "applied" | "conflict" | "rejected"
  code?: string | null
  row?: Payload | null
  replayed?: boolean
}

interface Change {
  entity: string
  id: string
  version: number
  deleted: boolean
  row: Payload | null
}

export interface EngineDeps {
  http: Http
  storage: StorageAdapter
  outbox: Outbox
  mappers: AnyMapper[]
  online: () => boolean
  log?: (event: string, detail?: unknown) => void
  /** After every successful push + pull (server statistics refresh). */
  onSynced?: () => void
  /** An op the server refused (name and code only, for the person's toast). */
  onRejected?: (name: string, code: string | null | undefined) => void
  debounceMs?: number
  batch?: number
}

const SNAP_KEY = "sop-live:snapshot"
const CURSOR_KEY = "sop-live:cursor"
// The local rows as of the last capture, so a transition made while the
// engine was not running (before sign-in finished, on an offline launch)
// still becomes its action op when the engine starts.
export const PREVIOUS_KEY = "sop-live:previous"
export const DEAD_LETTER_KEY = "sop-live:dead-letter"
const DELETED_KEY = "sop-live:deleted"
const DEFERRED_KEY = "sop-live:deferred"
const DELETED_LIMIT = 500
const DEAD_LETTER_LIMIT = 200

// Sync requests run in the background and nothing waits on them, so a slow
// link gets longer than an interactive call before it counts as offline.
const SYNC_TIMEOUT_MS = 30_000

// The server refused the request itself (a malformed op fails validation for
// the whole batch, so no per-op receipt exists). Retrying the same batch can
// never succeed, and every op queued behind it would wait forever.
const MALFORMED = new Set([400, 413, 422])

export class SyncEngine {
  private snapshot: Record<string, Record<string, Payload>> = {}
  private previous: Record<string, Record<string, unknown>> = {}
  /** Ids this device deleted, per entity: re-creating one is an undo. */
  private deleted: Record<string, string[]> = {}
  private cursor = 0
  private applying = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private again = false
  private unsubscribe: (() => void)[] = []
  private backoffMs = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  /** Server rows held back while an op of this device's still speaks for
   * them, keyed entity:id: shown once the outbox no longer names the row. */
  private deferred: Record<string, Change> = {}
  /** When the latest local edit not yet captured was made (epoch ms). */
  private editedAt: number | null = null
  readonly rejected: OpResult[] = []

  constructor(private deps: EngineDeps) {
    let stored: Record<string, Record<string, unknown>> = {}
    try {
      this.snapshot = JSON.parse(deps.storage.getItem(SNAP_KEY) ?? "{}")
      this.cursor = Number(deps.storage.getItem(CURSOR_KEY) ?? 0) || 0
      this.deleted = JSON.parse(deps.storage.getItem(DELETED_KEY) ?? "{}")
      stored = JSON.parse(deps.storage.getItem(PREVIOUS_KEY) ?? "{}")
      this.deferred = JSON.parse(deps.storage.getItem(DEFERRED_KEY) ?? "{}")
    } catch {
      this.snapshot = {}
      this.cursor = 0
    }
    for (const m of deps.mappers) {
      this.snapshot[m.entity] ??= {}
      // No stored baseline (first run): the current rows are the baseline.
      this.previous[m.entity] = stored[m.entity] ?? this.index(m, m.store.get())
    }
  }

  private index(m: AnyMapper, state: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const l of m.list(state)) out[m.id(l)] = l
    return out
  }

  private persist() {
    this.deps.storage.setItem(SNAP_KEY, JSON.stringify(this.snapshot))
    this.deps.storage.setItem(CURSOR_KEY, String(this.cursor))
    this.deps.storage.setItem(DELETED_KEY, JSON.stringify(this.deleted))
    this.deps.storage.setItem(PREVIOUS_KEY, JSON.stringify(this.previous))
    this.deps.storage.setItem(DEFERRED_KEY, JSON.stringify(this.deferred))
  }

  /** Watch the mapped stores. Call once at app start (after sign-in). */
  start(subscribe: (m: AnyMapper, onChange: () => void) => () => void) {
    for (const m of this.deps.mappers)
      this.unsubscribe.push(subscribe(m, () => this.schedule()))
  }

  stop() {
    for (const u of this.unsubscribe) u()
    this.unsubscribe = []
    if (this.timer) clearTimeout(this.timer)
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
  }

  /** Coalesce a burst of edits into one diff. */
  schedule() {
    if (this.applying) return
    this.editedAt = Date.now()
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.capture()
      void this.sync()
    }, this.deps.debounceMs ?? 400)
  }

  /** Capture an edit still inside the debounce window, now. The outbox is
   * persisted synchronously, so an edit made just before the app is
   * backgrounded or the page reloads survives and is pushed on next start. */
  flush() {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
    this.capture()
    void this.sync()
  }

  /** Queue a domain action no store diff stands for (a capture card
   * decision). An edit still in the debounce window is captured first, so
   * the outbox keeps the order things happened in; offline it waits there
   * like every other op. */
  act(name: string, data: Record<string, unknown>) {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      this.capture()
    }
    this.deps.outbox.add([
      {
        op_id: newId(),
        kind: "action",
        name,
        data,
        at: new Date().toISOString(),
      },
    ])
    void this.sync()
  }

  /** Take the current local value of these rows as what the server holds,
   * without queuing ops: for rows a server action changes the same way (a
   * merge's repointed references), so the local change stays optimistic and
   * is never pushed as field writes of its own. */
  adopt(entity: string, ids: string[]) {
    const m = this.deps.mappers.find((x) => x.entity === entity)
    if (!m || !ids.length) return
    const state = m.store.get()
    const snap = this.snapshot[m.entity]
    this.previous[m.entity] ??= {}
    const prev = this.previous[m.entity]
    for (const id of ids) {
      const local = this.find(m, state, id)
      if (local === undefined || !snap[id]) continue
      snap[id] = m.toServer(local, state)
      prev[id] = local
    }
    this.persist()
  }

  /** Send every row this device holds to the server as new: for a server
   * that lost them (a wiped database). Forgets what it believed the server
   * had, so the next diff upserts every local row; ``previous`` is kept, so
   * no state-change actions are replayed. Returns the ops queued. */
  reupload(): number {
    for (const m of this.deps.mappers) this.snapshot[m.entity] = {}
    this.deleted = {}
    const ops = this.capture()
    void this.sync()
    return ops.length
  }

  /** Diff every mapper into the outbox (synchronous; testable). Every op
   * carries the time of the edit it stands for (the last one inside the
   * debounce window), so the server applies it as of then however long it
   * waits in the outbox. */
  capture() {
    const at = new Date(this.editedAt ?? Date.now()).toISOString()
    this.editedAt = null
    const ops: SyncOp[] = []
    const early = new Set<SyncOp>()
    for (const m of this.deps.mappers) {
      const state = m.store.get()
      const snap = this.snapshot[m.entity]
      const d = diffEntity(m, state, snap, this.previous[m.entity] ?? {})
      for (const a of d.actions)
        ops.push({ op_id: newId(), kind: "action", name: a.name, data: a.data })
      const gone = new Set(this.deleted[m.entity] ?? [])
      // Rows a mapper action already names (e.g. tasks.restore {task_id}).
      const acted = new Set(
        d.actions.flatMap((a) => Object.values(a.data ?? {}).map(String)),
      )
      for (const u of d.upserts) {
        // Undo of this device's own delete: the server keeps the tombstone
        // and refuses a plain upsert onto it (so another device's stale edit
        // cannot revive a row), so restore it explicitly first, unless the
        // mapper's own action already restores it or the create carries no
        // fields (an action-owned row, e.g. a habit timer).
        if (
          u.create &&
          gone.delete(u.id) &&
          !acted.has(u.id) &&
          Object.keys(u.data).length
        ) {
          const restore: SyncOp = {
            op_id: newId(),
            kind: "upsert",
            name: m.entity,
            id: u.id,
            data: { deleted_at: null },
          }
          ops.push(restore)
          if (m.createsFirst) early.add(restore)
        }
        const op: SyncOp = {
          op_id: newId(),
          kind: "upsert",
          name: m.entity,
          id: u.id,
          data: u.data,
        }
        ops.push(op)
        if (u.create && m.createsFirst) early.add(op)
        snap[u.id] = {
          ...(snap[u.id] ?? {}),
          ...m.toServer(this.find(m, state, u.id), state),
        }
      }
      for (const id of d.deletes) {
        ops.push({ op_id: newId(), kind: "delete", name: m.entity, id })
        delete snap[id]
        gone.add(id)
      }
      this.deleted[m.entity] = [...gone].slice(-DELETED_LIMIT)
      this.previous[m.entity] = this.index(m, state)
    }
    // Actions run first in the batch only within one capture: a create of a
    // row the action derives must not precede the action that derives it.
    // Then the creates other rows point at (mapper.createsFirst).
    const rank = (o: SyncOp) => (o.kind === "action" ? 0 : early.has(o) ? 1 : 2)
    ops.sort((a, b) => rank(a) - rank(b))
    for (const op of ops) op.at = at
    this.deps.outbox.add(ops)
    this.persist()
    return ops
  }

  private find(m: AnyMapper, state: unknown, id: string) {
    return m.list(state).find((l: unknown) => m.id(l) === id)
  }

  /** Push the outbox, then pull until caught up. Single-flight. */
  sync(): Promise<void> {
    if (this.running) {
      // A sync is in flight: edits captured after its push began would
      // otherwise wait for the next trigger (up to a minute). Run once more
      // as soon as this one finishes.
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        await this.run()
      } while (this.again && this.deps.online())
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run() {
    if (!this.deps.online()) return
    try {
      await this.push()
      await this.pull()
      this.showDeferred()
      this.backoffMs = 0
      this.deps.onSynced?.()
    } catch (error) {
      if (!(error instanceof NetworkError))
        this.deps.log?.("sync_error", String(error))
      this.backoffMs = Math.min(
        60_000,
        this.backoffMs ? this.backoffMs * 2 : 2_000,
      )
      // One retry pending at a time, however many triggers failed.
      if (this.retry) clearTimeout(this.retry)
      this.retry = setTimeout(() => {
        this.retry = null
        void this.sync()
      }, this.backoffMs)
    }
  }

  private async push() {
    const batch = this.deps.batch ?? 100
    while (this.deps.outbox.size())
      await this.pushOps(this.deps.outbox.peek(batch))
  }

  /** Push ``ops`` in order. A batch the server refuses as malformed is split
   * in half until the offending op stands alone; that op is set aside in the
   * dead-letter list and the rest go through. */
  private async pushOps(ops: SyncOp[]): Promise<void> {
    let res: { results: OpResult[] }
    try {
      res = await this.deps.http.request<{ results: OpResult[] }>(
        "POST",
        "/sync/push",
        { ops },
        { timeoutMs: SYNC_TIMEOUT_MS },
      )
    } catch (error) {
      if (!(error instanceof ApiError) || !MALFORMED.has(error.status))
        throw error
      if (ops.length > 1) {
        const mid = Math.ceil(ops.length / 2)
        await this.pushOps(ops.slice(0, mid))
        await this.pushOps(ops.slice(mid))
        return
      }
      this.quarantine(ops[0], error)
      return
    }
    const at = new Map(ops.map((o, i) => [o.op_id, i]))
    const rows: Change[] = []
    const after = new Map<Change, SyncOp[]>()
    const resync = new Set(
      this.deps.mappers.flatMap((m) => m.resyncOnReject ?? []),
    )
    for (const r of res.results) {
      const i = at.get(r.op_id)
      const op = i === undefined ? undefined : ops[i]
      if (r.status === "rejected") {
        this.rejected.push(r)
        this.deps.log?.("op_rejected", { name: op?.name, code: r.code })
        if (op) this.deps.onRejected?.(op.name, r.code)
        // The pull after this push then brings every server row back.
        if (op?.kind === "action" && resync.has(op.name)) this.cursor = 0
      }
      if (r.row && op?.kind === "upsert" && op.id && i !== undefined) {
        const c: Change = {
          entity: op.name,
          id: op.id,
          version: 0,
          deleted: false,
          row: r.row,
        }
        rows.push(c)
        after.set(c, ops.slice(i + 1))
      }
    }
    this.deps.outbox.ack(res.results.map((r) => r.op_id))
    // The server's row is authoritative (derived fields, LWW outcome), but
    // it is the row as of ITS op: the ops after it in this batch and the
    // ones still queued are not in it yet, so they are laid over it.
    const queued = this.queued()
    this.apply(rows, (c) => [...(after.get(c) ?? []), ...queued])
  }

  private quarantine(op: SyncOp, error: ApiError) {
    const dead = this.deadLetters()
    dead.push({ op, status: error.status, code: error.code })
    this.deps.storage.setItem(
      DEAD_LETTER_KEY,
      JSON.stringify(dead.slice(-DEAD_LETTER_LIMIT)),
    )
    this.rejected.push({
      op_id: op.op_id,
      status: "rejected",
      code: error.code,
    })
    // Name and code only: the op's data is the user's content.
    this.deps.log?.("op_dead_lettered", { name: op.name, code: error.code })
    this.deps.outbox.ack([op.op_id])
  }

  /** Ops the server refused as malformed, kept for diagnosis (bounded). */
  deadLetters(): { op: SyncOp; status: number; code: string }[] {
    try {
      return JSON.parse(this.deps.storage.getItem(DEAD_LETTER_KEY) ?? "[]")
    } catch {
      return []
    }
  }

  private async pull() {
    for (;;) {
      const page = await this.deps.http.request<{
        changes: Change[]
        cursor: number
        truncated: boolean
      }>("GET", `/sync/pull?cursor=${this.cursor}&limit=500`, undefined, {
        timeoutMs: SYNC_TIMEOUT_MS,
      })
      this.apply(page.changes)
      this.cursor = page.cursor
      this.persist()
      if (!page.truncated) return
    }
  }

  private queued(): SyncOp[] {
    return this.deps.outbox.peek(this.deps.outbox.size())
  }

  /** Merge server rows into the stores without echoing them back.
   *
   * A local edit is only diffed into the outbox once the debounce fires. A
   * server row landing inside that window used to overwrite the store and
   * reset the diff baseline, so the newer edit was never sent. So any
   * pending edit is captured into the outbox first.
   *
   * A server row never undoes what this device did and has not yet heard
   * back about (on a slow link a ticked set used to untick when the reply
   * to an earlier edit of it landed, then tick again once its own push
   * came back). Each row is rebased onto the ops still waiting for it
   * (``pending``, by default the whole outbox): the fields its queued
   * upserts write are laid over the server's, and a row a queued delete or
   * action names is held back whole (an action's effect cannot be computed
   * here) until the outbox no longer names it. Other fields of a rebased
   * row still take the server's value, so another device's edit shows. */
  apply(changes: Change[], pending?: (c: Change) => SyncOp[]) {
    if (!changes.length) return
    if (this.timer && !this.applying) {
      clearTimeout(this.timer)
      this.timer = null
      this.capture()
      void this.sync() // in flight: runs once more when this one finishes
    }
    const queued = pending ? null : this.queued()
    const shown: Change[] = []
    for (const c of changes) {
      const key = `${c.entity}:${c.id}`
      const r = rebase(c, pending ? pending(c) : (queued as SyncOp[]))
      if (r) {
        delete this.deferred[key]
        shown.push(r)
      } else this.deferred[key] = c
    }
    this.merge(shown)
  }

  /** Show the server rows held back for ops that have since been answered
   * (a row the pull did not bring again: the op changed nothing there). */
  private showDeferred() {
    const held = Object.values(this.deferred)
    if (held.length) this.apply(held)
  }

  private merge(changes: Change[]) {
    const byEntity = new Map<string, Change[]>()
    for (const c of changes)
      byEntity.set(c.entity, [...(byEntity.get(c.entity) ?? []), c])
    this.applying = true
    try {
      for (const m of this.deps.mappers) {
        const list = byEntity.get(m.entity)
        if (!list) continue
        const state = m.store.get()
        const shown = this.index(m, state)
        const snap = this.snapshot[m.entity]
        const ups: unknown[] = []
        const dels: string[] = []
        let echo = true
        for (const c of list) {
          if (c.deleted || !c.row) {
            dels.push(c.id)
            echo = false
            continue
          }
          const local = m.fromServer(c.row, state)
          if (!local) continue
          const id = m.id(local)
          if (!Object.hasOwn(shown, id) || !same(shown[id], local)) echo = false
          ups.push(local)
        }
        if (!ups.length && !dels.length) continue
        // The mapper still merges an echo: it can keep bookkeeping beside
        // the rows (a workout's highest exercise position).
        const next = m.merge(state, ups, dels)
        // The server's copy of what this device already shows (the echo of
        // its own write) is not written back, so the screen is not
        // re-rendered when a slow reply lands mid-typing.
        if (!echo || !same(next, state)) m.store.set(next)
        for (const id of dels) delete snap[id]
        for (const l of ups) snap[m.id(l)] = m.toServer(l, next)
        this.previous[m.entity] = this.index(m, next)
      }
    } finally {
      this.applying = false
    }
    this.persist()
  }

  pending() {
    return this.deps.outbox.size()
  }

  /** Every edit made on this device has reached the server: none is
   * waiting out the debounce, and the outbox is empty. A statistic fetched
   * before this holds can predate the edit it is shown after. */
  settled() {
    return !this.timer && this.deps.outbox.size() === 0
  }
}

/** Equal as rows: same fields and values, key order and fields left
 * undefined aside. */
function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}

const canonical = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x)
            .filter(([, y]) => y !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : x,
  )

/** ``c`` as it will be once ``ops`` reach the server, or null while one of
 * them makes the server's row meaningless to show (a delete, an action on
 * the row, an undo of a delete the server's tombstone predates). */
function rebase(c: Change, ops: SyncOp[]): Change | null {
  let fields: Payload | null = null
  for (const op of ops) {
    if (op.kind === "action") {
      // An id the action names, alone or in a list (tasks.remove task_ids).
      if (
        Object.values(op.data ?? {})
          .flat()
          .includes(c.id)
      )
        return null
      continue
    }
    if (op.name !== c.entity || op.id !== c.id) continue
    if (op.kind === "delete") return null
    if (c.deleted && op.data?.deleted_at === null) return null
    fields = { ...(fields ?? {}), ...op.data }
  }
  // A delete from the server wins over a queued edit, as the server rules
  // (the edit's push comes back a conflict), so it shows now.
  if (!fields || c.deleted || !c.row) return c
  return { ...c, row: { ...c.row, ...fields } }
}
