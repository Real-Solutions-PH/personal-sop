// How one server entity maps onto a local store.
//
// The UI keeps writing the prototype stores exactly as before. The engine
// diffs each mapped collection against the last state both sides agreed on
// (the snapshot) and turns the difference into sync ops:
//   - a row the snapshot lacks  -> upsert with every field (a create)
//   - changed fields            -> upsert with ONLY those fields (field LWW)
//   - a row that disappeared    -> delete
//   - a domain transition       -> an action op (mapper.actions), with the
//     fields that transition owns (actionFields) left out of the upsert
// Pulled rows are merged back through ``merge`` with diffing suppressed.

import type { Store } from "@domain/lib/store"

export type Payload = Record<string, unknown>

export interface ActionOp {
  name: string
  data: Record<string, unknown>
}

export interface Mapper<S = unknown, L = unknown> {
  /** Server entity name (``/sync`` registry). */
  entity: string
  store: Store<S>
  /** The local rows this entity covers. */
  list(state: S): L[]
  id(local: L): string
  /** Local row -> server payload fields (snake_case, centavos, ISO dates). */
  toServer(local: L, state: S): Payload
  /** Server row -> local row; null drops a row the device cannot show. */
  fromServer(row: Payload, state: S): L | null
  /** Apply pulled upserts and deletes to the store state. */
  merge(state: S, upserts: L[], deleted: string[]): S
  /** Fields only an action may change (never sent as a field write). */
  actionFields?: readonly string[]
  /** Action ops for a transition of one row (prev undefined: created). */
  actions?(prev: L | undefined, next: L | undefined, state: S): ActionOp[]
  /** Pull-only entity (server-derived rows). */
  readOnly?: boolean
}

export type AnyMapper = Mapper<any, any>

const stable = (v: unknown): string => JSON.stringify(v ?? null)

export interface RowDiff {
  upserts: { id: string; data: Payload; create: boolean }[]
  deletes: string[]
  actions: ActionOp[]
}

/** Pure diff of one entity: what to send so the server matches ``locals``. */
export function diffEntity(
  mapper: AnyMapper,
  state: unknown,
  snapshot: Record<string, Payload>,
  previous: Record<string, unknown>,
): RowDiff {
  const out: RowDiff = { upserts: [], deletes: [], actions: [] }
  if (mapper.readOnly) return out
  const owned = new Set(mapper.actionFields ?? [])
  const seen = new Set<string>()
  for (const local of mapper.list(state)) {
    const id = mapper.id(local)
    seen.add(id)
    const next = mapper.toServer(local, state)
    const prev = snapshot[id]
    if (mapper.actions)
      out.actions.push(...mapper.actions(previous[id], local, state))
    if (!prev) {
      const data: Payload = {}
      for (const [k, v] of Object.entries(next)) if (!owned.has(k)) data[k] = v
      out.upserts.push({ id, data, create: true })
      continue
    }
    const changed: Payload = {}
    for (const [k, v] of Object.entries(next)) {
      if (owned.has(k)) continue
      if (stable(v) !== stable(prev[k])) changed[k] = v
    }
    if (Object.keys(changed).length)
      out.upserts.push({ id, data: changed, create: false })
  }
  for (const id of Object.keys(snapshot)) {
    if (seen.has(id)) continue
    if (mapper.actions)
      out.actions.push(...mapper.actions(previous[id], undefined, state))
    out.deletes.push(id)
  }
  return out
}
