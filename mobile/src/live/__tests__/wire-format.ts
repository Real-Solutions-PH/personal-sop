// Writes a wire fixture the way Biome formats JSON, so the stable fixture is
// also lint-clean: ``stabilize`` (stable-fixture.ts) fixes ids and instants,
// then every array of plain values that fits on its line (80 columns) is
// put on one line, as Biome does. Rewritten only when the content changes.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { stabilize } from "./stable-fixture"

const SCALAR = String.raw`(?:"(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*|true|false|null)`
const ARRAY = new RegExp(
  String.raw`\[\n\s+(${SCALAR}(?:,\n\s+${SCALAR})*)\n\s*\]`,
  "g",
)

export function biomeJson(data: unknown): string {
  const text = stabilize(JSON.stringify(data, null, 2))
  const out = text.replace(ARRAY, (whole, items: string, offset: number) => {
    const one = `[${items.split(/,\n\s+/).join(", ")}]`
    const lineStart = text.lastIndexOf("\n", offset) + 1
    const after = text.slice(offset + whole.length).match(/^[^\n]*/)?.[0] ?? ""
    const width = offset - lineStart + one.length + after.length
    return width <= 80 ? one : whole
  })
  return `${out}\n`
}

export function writeWireFixture(path: string, data: unknown) {
  const next = biomeJson(data)
  if (existsSync(path) && readFileSync(path, "utf8") === next) return
  writeFileSync(path, next)
}
