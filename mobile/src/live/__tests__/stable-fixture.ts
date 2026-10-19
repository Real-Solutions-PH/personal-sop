// Wire fixtures are written by the jest tests and read by the backend's
// schema tests. Ids, instants and business days vary per run, so before
// writing, every UUID becomes a stable placeholder numbered by first
// appearance (references between rows survive), every ISO instant becomes a
// fixed one, and every bare YYYY-MM-DD string becomes a fixed day (the tests
// build days from today, and the backend only checks that each is a date).
// The file is only rewritten when its content actually changes.

import { existsSync, readFileSync, writeFileSync } from "node:fs"

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const INSTANT =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g
// A whole JSON string that is a business day, never part of a longer value.
const DAY = /"\d{4}-\d{2}-\d{2}"/g

export function stabilize(json: string): string {
  const ids = new Map<string, string>()
  return json
    .replace(UUID, (u) => {
      const key = u.toLowerCase()
      if (!ids.has(key)) {
        const n = (ids.size + 1).toString(16).padStart(12, "0")
        ids.set(key, `00000000-0000-4000-8000-${n}`)
      }
      return ids.get(key) as string
    })
    .replace(INSTANT, "2026-10-19T04:00:00.000Z")
    .replace(DAY, '"2026-10-19"')
}

export function writeStableFixture(path: string, data: unknown) {
  const next = `${stabilize(JSON.stringify(data, null, 2))}\n`
  if (existsSync(path) && readFileSync(path, "utf8") === next) return
  writeFileSync(path, next)
}
