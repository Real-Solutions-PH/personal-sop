import { derivedId } from "@domain/lib/ids"
import type { Store } from "@domain/lib/store"
import type { Mapper, Payload } from "../mapper"

/**
 * A one-row-per-user entity (settings, preferences) held as a slice of a
 * store. The server ignores the id for these, so the device uses a stable
 * per-user one: ``derivedId("singleton", userId, entity)``.
 */
export function singleton<S, V>(opts: {
  entity: string
  userId: string
  store: Store<S>
  read(state: S): V
  write(state: S, value: V): S
  toServer(value: V): Payload
  fromServer(row: Payload, current: V): V
}): Mapper<S, { id: string; value: V }> {
  const id = derivedId("singleton", opts.userId, opts.entity)
  return {
    entity: opts.entity,
    store: opts.store,
    list: (s) => [{ id, value: opts.read(s) }],
    id: (l) => l.id,
    toServer: (l) => opts.toServer(l.value),
    fromServer: (row, s) => ({ id, value: opts.fromServer(row, opts.read(s)) }),
    merge: (s, ups) =>
      ups.length ? opts.write(s, ups[ups.length - 1].value) : s,
  }
}
