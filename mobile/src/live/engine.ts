// The local-first sync engine (ADR-0011, mobile side).
//
// Writes: every mapped store change is diffed (debounced) into ops that go
// to the outbox, then pushed in order. Reads: /sync/pull past the stored
// cursor, merged into the stores with diffing suppressed. Nothing here is
// visible in the UI: the screens keep reading their stores; offline, ops
// simply wait in the outbox.

import { newId } from "@domain/lib/ids"
import type { StorageAdapter } from "@domain/lib/store"
import { type Http, NetworkError } from "./http"
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
  debounceMs?: number
  batch?: number
}

const SNAP_KEY = "sop-live:snapshot"
const CURSOR_KEY = "sop-live:cursor"

export class SyncEngine {
  private snapshot: Record<string, Record<string, Payload>> = {}
  private previous: Record<string, Record<string, unknown>> = {}
  private cursor = 0
  private applying = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private unsubscribe: (() => void)[] = []
  private backoffMs = 0
  readonly rejected: OpResult[] = []

  constructor(private deps: EngineDeps) {
    try {
      this.snapshot = JSON.parse(deps.storage.getItem(SNAP_KEY) ?? "{}")
      this.cursor = Number(deps.storage.getItem(CURSOR_KEY) ?? 0) || 0
    } catch {
      this.snapshot = {}
      this.cursor = 0
    }
    for (const m of deps.mappers) {
      this.snapshot[m.entity] ??= {}
      this.previous[m.entity] = this.index(m, m.store.get())
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

  /** Diff every mapper into the outbox (synchronous; testable). */
  capture() {
    const ops: SyncOp[] = []
    for (const m of this.deps.mappers) {
      const state = m.store.get()
      const snap = this.snapshot[m.entity]
      const d = diffEntity(m, state, snap, this.previous[m.entity] ?? {})
      for (const a of d.actions)
        ops.push({ op_id: newId(), kind: "action", name: a.name, data: a.data })
      for (const u of d.upserts) {
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
      }
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
    if (!this.running)
      this.running = this.run().finally(() => {
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
    while (this.deps.outbox.size()) {
      const ops = this.deps.outbox.peek(batch)
      const res = await this.deps.http.request<{ results: OpResult[] }>(
        "POST",
        "/sync/push",
        { ops },
      )
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

  /** Merge server rows into the stores without echoing them back. */
  apply(changes: Change[]) {
    if (!changes.length) return
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
}
