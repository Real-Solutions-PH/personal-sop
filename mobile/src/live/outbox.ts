// Ops waiting to reach the server, persisted next to the stores so they
// survive an app kill. Ordered; each op carries its own op_id so a retry
// after a lost response is a no-op on the server (sync receipts).

import type { StorageAdapter } from "@domain/lib/store"

export interface SyncOp {
  op_id: string
  kind: "upsert" | "delete" | "action"
  name: string
  id?: string | null
  data?: Record<string, unknown>
  base_version?: number | null
}

export interface Outbox {
  add(ops: SyncOp[]): void
  peek(n: number): SyncOp[]
  ack(opIds: string[]): void
  size(): number
}

const KEY = "sop-live:outbox"
// Bounded: a device offline for weeks keeps its newest edits; the oldest
// field writes are the least likely to still matter (and the server state
// they would overwrite has since moved on).
export const OUTBOX_LIMIT = 5000

export function createOutbox(storage: StorageAdapter): Outbox {
  let ops: SyncOp[] = []
  try {
    const raw = storage.getItem(KEY)
    ops = raw ? (JSON.parse(raw) as SyncOp[]) : []
  } catch {
    ops = []
  }
  const save = () => storage.setItem(KEY, JSON.stringify(ops))
  return {
    add(next) {
      if (!next.length) return
      ops = [...ops, ...next].slice(-OUTBOX_LIMIT)
      save()
    },
    peek: (n) => ops.slice(0, n),
    ack(ids) {
      const done = new Set(ids)
      ops = ops.filter((o) => !done.has(o.op_id))
      save()
    },
    size: () => ops.length,
  }
}
