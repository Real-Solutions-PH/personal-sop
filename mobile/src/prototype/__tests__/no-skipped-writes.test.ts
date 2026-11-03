// A store write passed as an argument to an optional call never runs when
// the callback is absent: `onAdded?.(A.addCategory(input).id)` skips the
// whole argument list, so the sheet closed and nothing was saved. Every
// write runs first, on its own line; the optional call only gets the result.
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const roots = [
  join(__dirname, "../.."),
  join(__dirname, "../../../../shared/prototype"),
]
function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sources(p))
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
      out.push(p)
  }
  return out
}

// A call that changes state: an actions namespace (A.addCategory; the
// language's own globals excepted), a store's set, or a verb-named function
// (createList, saveFood).
const WRITE =
  /\b(?!(?:JSON|Math|Object|Array|String|Number|Date|Promise|Intl)\.)[A-Z]\w*\.\w+\(|\b\w+Store\.set\(|\b(add|create|save|update|delete|remove|archive|restore|log|move|toggle|upsert|insert)[A-Z]\w*\(/

/** The argument text of every `?.(` call in ``code``, with its line. */
function optionalCallArgs(code: string) {
  const found: { line: number; args: string }[] = []
  let i = code.indexOf("?.(")
  while (i >= 0) {
    let depth = 1
    let j = i + 3
    while (j < code.length && depth) {
      if (code[j] === "(") depth++
      else if (code[j] === ")") depth--
      j++
    }
    found.push({
      line: code.slice(0, i).split("\n").length,
      args: code.slice(i + 3, j - 1),
    })
    i = code.indexOf("?.(", i + 3)
  }
  return found
}
const skipped = (code: string) =>
  optionalCallArgs(code).filter((c) => WRITE.test(c.args))

test("the check catches a write inside an optional call's arguments", () => {
  const caught = [
    "onAdded?.(A.addCategory(input).id)",
    "onCreated?.(A.createList(input))",
    "onDone?.(\n  habitsStore.set((s) => s),\n)",
    "cb?.(saveFood(f))",
  ]
  for (const c of caught) expect(skipped(c)).toHaveLength(1)
  const fine = [
    "const added = A.addCategory(input)\nonAdded?.(added.id)",
    "onClose?.()",
    "onPick?.(c.id)",
    "native?.reply?.(id, JSON.stringify(reply))",
  ]
  for (const c of fine) expect(skipped(c)).toEqual([])
})

test("no source passes a store write to an optional call", () => {
  const files = roots.flatMap(sources)
  expect(files.length).toBeGreaterThan(200)
  const hits = files.flatMap((f) =>
    skipped(readFileSync(f, "utf8")).map(
      (c) => `${relative(roots[0], f)}:${c.line}  ?.(${c.args.trim()})`,
    ),
  )
  expect(hits).toEqual([])
})
