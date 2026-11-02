import { CATEGORIES } from "@domain/finance/data"
import { ICONS, STARTERS } from "@domain/habits/data"
import {
  ALL_ICONS,
  findIcon,
  ICON_SECTIONS,
  iconKey,
  iconLabel,
} from "../icons/catalog"
import {
  closestIcons,
  recentIcons,
  rememberIcon,
  searchIcons,
  suggestIcons,
} from "../icons/search"

// Every icon the app, the web app, the server seeds or Fern ever offered or
// saved. Records keep these strings, so each must stay choosable and
// labelled. Written out by hand: never derived from the catalogue.
const EVER_SAVED = [
  // habit picker (shared/prototype/habits/data.ts ICONS, before 2026-11-02)
  "🏋️",
  "📖",
  "🧠",
  "🧘",
  "💧",
  "✍️",
  "📵",
  "🌙",
  "🏃",
  "🥗",
  "💊",
  "🎸",
  "🧹",
  "🙏",
  "🌅",
  "☀️",
  "💻",
  "🚶",
  "🦷",
  "🛏️",
  // category picker (mobile finance-categories EMOJI, web editors EMOJI)
  "🍽️",
  "☕",
  "🛒",
  "🚗",
  "🏠",
  "💡",
  "📶",
  "🎬",
  "🛍️",
  "🎟️",
  "🎁",
  "🐶",
  "📚",
  "✈️",
  "👶",
  "🏷️",
  // seeded categories (backend finance/repo.py DEFAULT_CATEGORIES)
  "🍗",
  "🚌",
  "🚇",
  "🧾",
  "📱",
  "💈",
  "🏦",
  "⚖️",
  "💼",
  "📈",
  "💰",
  // defaults and Fern's name → icon guesses (capture/parse.ts)
  "✅",
  "🤸",
  "🍪",
  "⏱️",
]

describe("icon catalogue", () => {
  it("offers several hundred icons across the life areas", () => {
    expect(ALL_ICONS.length).toBeGreaterThanOrEqual(400)
    expect(ICON_SECTIONS.map((s) => s.id)).toEqual([
      "health",
      "fitness",
      "food",
      "sleep",
      "mind",
      "learning",
      "work",
      "money",
      "home",
      "people",
      "travel",
      "hobbies",
      "nature",
      "faith",
      "tech",
      "misc",
    ])
    for (const s of ICON_SECTIONS) expect(s.icons.length).toBeGreaterThan(10)
  })
  it.each(EVER_SAVED)("keeps %s, saved before the catalogue", (e) => {
    expect(findIcon(e)?.emoji).toBeDefined()
    expect(iconLabel(e)).not.toBe(e)
  })
  it("keeps every icon the habit picker, starters and seeded categories use", () => {
    const used = [
      ...ICONS,
      ...STARTERS.map((s) => s.icon),
      ...CATEGORIES.map((c) => c.icon),
    ]
    expect(used.filter((e) => !findIcon(e))).toEqual([])
  })
  it("lists each icon once, with a name and words to find it by", () => {
    const keys = ALL_ICONS.map((i) => iconKey(i.emoji))
    expect(keys.filter((k, n) => keys.indexOf(k) !== n)).toEqual([])
    const names = ALL_ICONS.map((i) => i.name)
    expect(names.filter((k, n) => names.indexOf(k) !== n)).toEqual([])
    for (const i of ALL_ICONS) {
      expect(i.name).toMatch(/^[A-Z]/)
      expect(i.words.length).toBeGreaterThan(0)
    }
  })
  it("stores each icon in 8 code points or fewer, the limit Fern can save", () => {
    expect(ALL_ICONS.filter((i) => [...i.emoji].length > 8)).toEqual([])
    // A parse slip would leave letters or spaces in the emoji.
    expect(ALL_ICONS.filter((i) => /[\sA-Za-z|]/.test(i.emoji))).toEqual([])
  })
  it("finds an icon saved without its variation selector", () => {
    expect(findIcon("🏋")?.name).toBe("Weight lifter")
    expect(iconLabel("custom")).toBe("custom")
  })
})

const emojis = (list: { emoji: string }[]) => list.map((i) => i.emoji)
describe("icon search", () => {
  it("matches synonyms", () => {
    expect(emojis(searchIcons("gym"))).toEqual(
      expect.arrayContaining(["🏋️", "💪"]),
    )
    expect(emojis(searchIcons("coffee"))[0]).toBe("☕")
    expect(emojis(searchIcons("cup"))).toContain("☕")
    expect(emojis(searchIcons("Running"))[0]).toBe("🏃")
  })
  it("ranks a name match above a synonym", () => {
    expect(emojis(searchIcons("tea"))[0]).toBe("🍵")
    expect(emojis(searchIcons("tea"))).toContain("🫖")
  })
  it("needs every word to match", () => {
    expect(emojis(searchIcons("hot drink"))).toEqual(["☕"])
    expect(searchIcons("coffee zebra")).toEqual([])
    expect(searchIcons("   ")).toEqual([])
  })
  it("offers the closest icons when nothing matches", () => {
    expect(searchIcons("cofee")).toEqual([])
    expect(emojis(closestIcons("cofee"))).toContain("☕")
    expect(emojis(closestIcons("photograph"))).toContain("📷")
    expect(closestIcons("zz")).toEqual([])
  })
})

describe("suggested icons", () => {
  it("ranks by the name being typed", () => {
    expect(emojis(suggestIcons("Run", []))[0]).toBe("🏃")
    expect(emojis(suggestIcons("Morning run 5k", []))[0]).toBe("🏃")
    expect(emojis(suggestIcons("Read 20 pages", []))[0]).toBe("📖")
    expect(emojis(suggestIcons("Groceries", []))[0]).toBe("🛒")
    expect(emojis(suggestIcons("Drink water", []))[0]).toBe("💧")
    expect(emojis(suggestIcons("Wash the dishes", []))).toContain("🧽")
  })
  it("fills the row with the fallbacks, without repeats", () => {
    const out = emojis(suggestIcons("Run", ["🏃", "📖"], 30))
    expect(out.filter((e) => e === "🏃")).toHaveLength(1)
    expect(out).toContain("📖")
    expect(emojis(suggestIcons("", ["📖", "💧"]))).toEqual(["📖", "💧"])
    expect(emojis(suggestIcons("swimming laps", ["📖", "💧"], 2))).toEqual([
      "🏊",
      "📖",
    ])
  })
})

describe("recent icons", () => {
  beforeEach(() => recentIcons.reset())
  it("keeps the newest first, once each, capped", () => {
    rememberIcon("🏃")
    rememberIcon("📖")
    rememberIcon("🏃")
    expect(recentIcons.get().icons).toEqual(["🏃", "📖"])
    for (const i of ALL_ICONS.slice(0, 30)) rememberIcon(i.emoji)
    expect(recentIcons.get().icons).toHaveLength(16)
  })
})
