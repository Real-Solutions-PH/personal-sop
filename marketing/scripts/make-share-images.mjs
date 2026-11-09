// Renders the Open Graph image (public/og.png, 1200×630) and the Apple touch
// icon (public/apple-icon.png, 180×180) with headless Chrome, from brand
// tokens, Geist and the C1 Fern sprite. Run after changing the tagline:
//   node scripts/make-share-images.mjs
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import vm from "node:vm"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const ctx = { window: {}, Math }
vm.createContext(ctx)
vm.runInContext(readFileSync(join(root, "vendor/fern/fern.js"), "utf8"), ctx)
const fern = ctx.window.fernC("sprite", 200, "celebrating", { still: true })
const fernCss = readFileSync(join(root, "vendor/fern/fern.css"), "utf8")
const font = pathToFileURL(join(root, "src/fonts/Geist-Variable.woff2")).href
const mono = pathToFileURL(
  join(root, "src/fonts/GeistMono-Variable.woff2"),
).href
const mark = `<svg viewBox="0 0 24 24" fill="none" stroke="#1f5a43" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 21.5 C7.5 16.5 8.6 12.6 11.6 10.1 C14.2 7.9 18.7 8.4 18.9 12.1 C19.1 15 16 16.4 14 14.9 C12.5 13.8 12.9 11.4 14.8 11.2 C16.1 11.1 16.9 12.3 16.2 13.2"/><path d="M8 18 C6.3 17 4.6 17.2 3.6 18.5"/><path d="M8.9 14.4 C7.5 13.2 5.8 13 4.7 13.9"/></svg>`

const og = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Geist;src:url(${font})}@font-face{font-family:GeistMono;src:url(${mono})}
${fernCss}
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px}
body{background:#f6f5f1;color:#1b1f1c;font-family:Geist;display:grid;grid-template-columns:1fr 360px;align-items:center;padding:72px 80px;gap:40px}
.logo{display:flex;align-items:center;gap:12px;font-size:34px;font-weight:500;letter-spacing:-.03em}
.logo svg{width:40px;height:40px}
h1{margin-top:40px;font-size:96px;line-height:1;letter-spacing:-.045em;font-weight:600}
h1 em{font-style:normal;color:#1f5a43}
p{margin-top:28px;font-size:30px;color:#5c625d;line-height:1.3}
.rec{margin-top:36px;display:flex;gap:10px;flex-wrap:wrap}
.rec span{font-family:GeistMono;font-size:20px;padding:8px 14px;border-radius:999px;background:#fff;border:1px solid #e3e1da}
.fern{width:360px;height:360px;display:block}.fern svg{width:100%;height:100%}
</style></head><body>
<div><div class="logo">${mark}<span>unfurl</span></div>
<h1>Say it.<br><em>It's tracked.</em></h1>
<p>One sentence becomes habits, tasks, workouts, meals and money.</p>
<div class="rec"><span>$12.00 · Food</span><span>3 × 8 @ 60 kg</span><span>Task · 17:00</span></div></div>
<span class="fern">${fern}</span></body></html>`

const icon = `<!doctype html><html><head><style>*{margin:0}html,body{width:180px;height:180px;background:#1f5a43;display:grid;place-items:center}svg{width:120px;height:120px}svg *{stroke:#fff}</style></head><body>${mark}</body></html>`

const chrome =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const tmp = mkdtempSync(join(tmpdir(), "unfurl-og-"))
function shot(html, out, w, h) {
  const f = join(tmp, `${w}.html`)
  writeFileSync(f, html)
  execFileSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${w},${h}`,
    "--virtual-time-budget=2000",
    `--screenshot=${out}`,
    pathToFileURL(f).href,
  ])
  console.log("wrote", out)
}
shot(og, join(root, "public/og.png"), 1200, 630)
shot(icon, join(root, "public/apple-icon.png"), 180, 180)
