import { parseQuickAdd } from "@domain/tasks/quick-syntax"

// Thursday 12 Nov 2026. Expected dates are read off a calendar by hand.
const TK = "2026-11-12"
const LISTS = [
  { id: "l-work", name: "Work" },
  { id: "l-side", name: "Side hustle" },
]
const q = (s: string, ignore?: string[]) =>
  parseQuickAdd(s, { today: TK, lists: LISTS, ignore: new Set(ignore) })

describe("parseQuickAdd", () => {
  it("parses date, time and priority and strips them from the title", () => {
    const p = q("Reply SOW tomorrow 3pm !high")
    expect(p.title).toBe("Reply SOW")
    expect(p.dueDate).toBe("2026-11-13")
    expect(p.dueTime).toBe("15:00")
    expect(p.priority).toBe("high")
  })

  it.each([
    ["Pay rent today", "2026-11-12"],
    ["Pay rent tmr", "2026-11-13"],
    ["Pay rent mon", "2026-11-16"],
    ["Pay rent next fri", "2026-11-13"],
    ["Pay rent nov 20", "2026-11-20"],
    ["Pay rent oct 1", "2027-10-01"],
    ["Pay rent in 3 days", "2026-11-15"],
  ])("%s → %s", (s, day) => {
    const p = q(s)
    expect(p.title).toBe("Pay rent")
    expect(p.dueDate).toBe(day)
  })

  it.each([
    ["Call mom at 9am", "09:00"],
    ["Call mom 9:30pm", "21:30"],
    ["Call mom at 18:15", "18:15"],
  ])("%s sets the time and implies today", (s, time) => {
    const p = q(s)
    expect(p.title).toBe("Call mom")
    expect(p.dueTime).toBe(time)
    expect(p.dueDate).toBe(TK)
  })

  it.each([
    ["!high", "high"],
    ["!HI", "high"],
    ["!1", "high"],
    ["!med", "medium"],
    ["!medium", "medium"],
    ["!2", "medium"],
    ["!low", "low"],
    ["!3", "low"],
  ])("priority %s → %s", (tok, pr) => {
    const p = q(`Ship it ${tok}`)
    expect(p.priority).toBe(pr)
    expect(p.title).toBe("Ship it")
  })

  it("leaves an unknown bang and a bang inside a word alone", () => {
    expect(q("Wow!high five").priority).toBeNull()
    expect(q("Ship it !urgent").priority).toBeNull()
    expect(q("Ship it !urgent").title).toBe("Ship it !urgent")
  })

  it("routes #list to a list by name, ignoring case and spaces", () => {
    expect(q("Invoice #work").listId).toBe("l-work")
    expect(q("Invoice #work").title).toBe("Invoice")
    expect(q("Invoice #SideHustle").listId).toBe("l-side")
    expect(q("Invoice #side").listId).toBe("l-side")
  })

  it("keeps an unknown #tag as text", () => {
    const p = q("Invoice #nope")
    expect(p.listId).toBeNull()
    expect(p.title).toBe("Invoice #nope")
    expect(p.tokens).toEqual([])
  })

  it("matches #list only when lists are given", () => {
    const p = parseQuickAdd("Invoice #work", { today: TK })
    expect(p.listId).toBeNull()
    expect(p.title).toBe("Invoice #work")
  })

  it("reports each recognised token with its span in the input", () => {
    const s = "Reply SOW tomorrow 3pm !high #work"
    const p = q(s)
    const spans = p.tokens.map((t) => [t.kind, s.slice(t.start, t.end)])
    expect(spans).toEqual([
      ["date", "tomorrow"],
      ["time", "3pm"],
      ["priority", "!high"],
      ["list", "#work"],
    ])
    for (const t of p.tokens) expect(s.slice(t.start, t.end)).toBe(t.text)
  })

  it("classifies tonight as date and time, every-day as repeat", () => {
    expect(q("Read tonight").tokens.map((t) => t.kind)).toEqual(["when"])
    expect(q("Read tonight").dueTime).toBe("20:00")
    const r = q("Stretch every day")
    expect(r.tokens.map((t) => t.kind)).toEqual(["repeat"])
    expect(r.recurrence?.rule.kind).toBe("daily")
  })

  it("an ignored token stays literal in the title and sets nothing", () => {
    const p = q("Reply SOW tomorrow 3pm !high", ["tomorrow"])
    expect(p.title).toBe("Reply SOW tomorrow")
    // The time still applies and implies today, as it would alone.
    expect(p.dueDate).toBe(TK)
    expect(p.dueTime).toBe("15:00")
    expect(p.tokens.map((t) => t.text)).toEqual(["3pm", "!high"])
  })

  it("ignoring every token gives the input back unchanged", () => {
    const s = "Meet at the mall on mon 3pm !low"
    // A token's key is its whole match, lead word included ("on mon").
    expect(q(s).tokens.map((t) => t.key)).toEqual(["on mon", "3pm", "!low"])
    const p = q(s, ["on mon", "3pm", "!low"])
    expect(p.title).toBe("Meet at the mall on mon 3pm !low")
    expect(p.dueDate).toBeNull()
    expect(p.dueTime).toBeNull()
    expect(p.priority).toBeNull()
  })

  it("ignored priority and list tokens stay in the title", () => {
    const p = q("Invoice #work !high", ["#work", "!high"])
    expect(p.title).toBe("Invoice #work !high")
    expect(p.listId).toBeNull()
    expect(p.priority).toBeNull()
  })

  it("a title that is only tokens comes back empty", () => {
    expect(q("tomorrow !high").title).toBe("")
    expect(q("!high").title).toBe("")
  })

  it("plain text is untouched", () => {
    const p = q("buy milk")
    expect(p.title).toBe("Buy milk")
    expect(p.tokens).toEqual([])
    expect(p.dueDate).toBeNull()
  })

  it("uses the local calendar across a month end", () => {
    const p = parseQuickAdd("Pay tomorrow", { today: "2026-12-31" })
    expect(p.dueDate).toBe("2027-01-01")
  })
})

describe("parseQuickAdd — review fixes", () => {
  it("keeps a typed inner capital and capitalises a kept first word", () => {
    expect(q("iPhone setup tomorrow").title).toBe("iPhone setup")
    expect(q("macOS update").title).toBe("macOS update")
    expect(q("tomorrow buy milk", ["tomorrow"]).title).toBe("Tomorrow buy milk")
  })

  it("a chip value is what its own word sets, not the final value", () => {
    const p = q("next fri ship nov 20")
    expect(p.dueDate).toBe("2026-11-20")
    expect(p.tokens.map((t) => t.dueDate)).toEqual(["2026-11-13", "2026-11-20"])
  })

  it("skipped kinds stay literal and set nothing", () => {
    const skip = new Set(["date", "when", "repeat", "priority"] as const)
    const p = parseQuickAdd("Call mom tomorrow 3pm !high every day", {
      today: TK,
      skip,
    })
    expect(p.title).toBe("Call mom tomorrow !high every day")
    expect(p.priority).toBeNull()
    expect(p.recurrence).toBeNull()
    expect(p.dueTime).toBe("15:00")
    expect(p.tokens.map((t) => t.kind)).toEqual(["time"])
  })
})
