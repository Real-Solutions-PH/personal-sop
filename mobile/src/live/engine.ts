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
const DELETED_LIMIT = 500
const DEAD_LETTER_LIMIT = 200

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
  readonly rejected: OpResult[] = []

  constructor(private deps: EngineDeps) {
    let stored: Record<string, Record<string, unknown>> = {}
    try {
      this.snapshot = JSON.parse(deps.storage.getItem(SNAP_KEY) ?? "{}")
      this.cursor = Number(deps.storage.getItem(CURSOR_KEY) ?? 0) || 0
      this.deleted = JSON.parse(deps.storage.getItem(DELETED_KEY) ?? "{}")
      stored = JSON.parse(deps.storage.getItem(PREVIOUS_KEY) ?? "{}")
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
  }

  /** Coalesce a burst of edits into one diff. */
  schedule() {
    if (this.applying) return
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
    this.deps.outbox.add([{ op_id: newId(), kind: "action", name, data }])
    void this.sync()
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

  /** Diff every mapper into the outbox (synchronous; testable). */
  capture() {
    const ops: SyncOp[] = []
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
        )
          ops.push({
            op_id: newId(),
            kind: "upsert",
            name: m.entity,
            id: u.id,
            data: { deleted_at: null },
          })
        ops.push({
          op_id: newId(),
          kind: "upsert",
          name: m.entity,
          id: u.id,
          data: u.data,
        })
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
    ops.sort(
      (a, b) => Number(a.kind !== "action") - Number(b.kind !== "action"),
    )
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
      this.backoffMs = 0
      this.deps.onSynced?.()
    } catch (error) {
      if (!(error instanceof NetworkError))
        this.deps.log?.("sync_error", String(error))
      this.backoffMs = Math.min(
        60_000,
        this.backoffMs ? this.backoffMs * 2 : 2_000,
      )
      setTimeout(() => void this.sync(), this.backoffMs)
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
    const byId = new Map(ops.map((o) => [o.op_id, o]))
    const rows: Change[] = []
    for (const r of res.results) {
      const op = byId.get(r.op_id)
      if (r.status === "rejected") {
        this.rejected.push(r)
        this.deps.log?.("op_rejected", { name: op?.name, code: r.code })
      }
      if (r.row && op?.kind === "upsert" && op.id)
        rows.push({
          entity: op.name,
          id: op.id,
          version: 0,
          deleted: false,
          row: r.row,
        })
    }
    // The server's row is authoritative (derived fields, LWW outcome).
    this.apply(rows)
    this.deps.outbox.ack(res.results.map((r) => r.op_id))
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
      }>("GET", `/sync/pull?cursor=${this.cursor}&limit=500`)
      this.apply(page.changes)
      this.cursor = page.cursor
      this.persist()
      if (!page.truncated) return
    }
  }

  /** Merge server rows into the stores without echoing them back.
   *
   * A local edit is only diffed into the outbox once the debounce fires. A
   * server row landing inside that window used to overwrite the store and
   * reset the diff baseline, so the newer edit was never sent. So any
   * pending edit is captured into the outbox first; the server's row then
   * shows until that op's own push brings the edited row back. */
  apply(changes: Change[]) {
    if (!changes.length) return
    if (this.timer && !this.applying) {
      clearTimeout(this.timer)
      this.timer = null
      this.capture()
      void this.sync() // in flight: runs once more when this one finishes
    }
    const byEntity = new Map<string, Change[]>()
    for (const c of changes)
      byEntity.set(c.entity, [...(byEntity.get(c.entity) ?? []), c])
    this.applying = true
    try {
      for (const m of this.deps.mappers) {
        const list = byEntity.get(m.entity)
        if (!list) continue
        const state = m.store.get()
        const ups: unknown[] = []
        const dels: string[] = []
        for (const c of list) {
          if (c.deleted || !c.row) {
            dels.push(c.id)
            continue
          }
          const local = m.fromServer(c.row, state)
          if (local) ups.push(local)
        }
        const next = m.merge(state, ups, dels)
        m.store.set(next)
        const snap = this.snapshot[m.entity]
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
