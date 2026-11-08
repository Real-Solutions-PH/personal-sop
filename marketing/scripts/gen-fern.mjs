// Renders Fern (the C1 wreath sprite Kai approved on 2026-11-03) into one
// standalone SVG file per mood in public/fern/, each carrying its own
// keyframes, colours, dark-mode colours and reduced-motion rule. The page
// loads them as lazy <img> files, so no drawing code or path data reaches the
// HTML or the JavaScript bundle. Source: vendor/fern/fern.js and fern.css,
// copied unchanged from the Unfurl card library via the unfurl-marketing kit.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = readFileSync(join(root, "vendor/fern/fern.js"), "utf8")
const css = readFileSync(join(root, "vendor/fern/fern.css"), "utf8")
const ctx = { window: {}, Math }
vm.createContext(ctx)
vm.runInContext(src, ctx)
const { fernC } = ctx.window

// `still` freezes the colour-changing parts of the miss (the wilt), so only
// transform and opacity animations remain.
const moods = {
  idle: ["idle", {}],
  listening: ["listening", {}],
  thinking: ["thinking", {}],
  speaking: ["speaking", {}],
  celebrating: ["celebrating", {}],
  consoling: ["consoling", { still: true }],
  "celebrating-still": ["celebrating", { still: true }],
}

// Colour and stroke-drawing animations are not composited; drop them so
// Fern animates transform and opacity only.
const clean = (svg) =>
  svg
    .replace(/animation:(drain\d|wiltLeaf|draw)[^;"]*;?/g, "")
    .replace(/\s+/g, " ")

// fern.css scopes dark colours to a `.dark` ancestor, which an SVG file
// never has; swap that rule for a prefers-color-scheme query.
const baseCss = css.replace(/\.dark \.fern,\.dark \.fern \.av\{[^}]*\}/, "")
const style = `<style>${baseCss}
@media (prefers-color-scheme: dark){.fern{--mist:#18211b;--moss:#2c7a5a;--frond:#6bbf8a;--sprout:#b7e08a;--fern-ink:#b7e08a;--fern-leaf:#24503b}}
@media (prefers-reduced-motion: reduce){*{animation-play-state:paused!important;animation-delay:0s!important;animation-fill-mode:both!important}}</style>`

mkdirSync(join(root, "public/fern"), { recursive: true })
for (const [name, [state, opts]] of Object.entries(moods)) {
  const svg = clean(fernC("sprite", 200, state, opts))
    .replace(
      /^<svg (?:class="([^"]*)" )?/,
      (_, c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" class="fern ${c ?? ""}" `,
    )
    .replace(/^(<svg[^>]*>)/, `$1${style}`)
  // End with a newline: the repo's end-of-file-fixer hook requires one.
  writeFileSync(join(root, `public/fern/${name}.svg`), `${svg}\n`)
}
console.log("fern: wrote", Object.keys(moods).length, "SVG files")
