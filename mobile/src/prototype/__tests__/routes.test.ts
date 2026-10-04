import { readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"

function routes(root: string, leaf: string): string[] {
  const found: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name === leaf)
        found.push(`/${relative(root, dir).split("\\").join("/")}`)
    }
  }
  visit(root)
  return found.sort()
}
test("every web prototype route has a native Expo route (native may add more)", () => {
  const root = resolve(__dirname, "../../../..")
  const native = routes(join(root, "mobile/src/app/(sop)"), "index.tsx")
  const web = routes(join(root, "frontend/src/app/(sop)"), "page.tsx")
  expect(native).toEqual(expect.arrayContaining(web))
})
