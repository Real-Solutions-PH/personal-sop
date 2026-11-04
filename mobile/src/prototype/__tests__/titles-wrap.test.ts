// A task or habit title is never cut short: it wraps and its row grows.
// Each entry names the file and the exact expression a title is drawn from;
// the Copy or Text that holds it must carry no `lines` or `numberOfLines`.
// Fixed-size surfaces (the iOS widgets and Live Activity, share-card
// exports, the social progress card, the focus timeline's time-scaled
// blocks) keep their clamp and are deliberately not listed here.
import { readFileSync } from "node:fs"
import { join } from "node:path"

const TITLES: [file: string, child: string][] = [
  ["focus-kit.tsx", "{c.label}"],
  ["screens/today.tsx", "{i.title}"],
  ["screens/today.tsx", "{habit.icon} {habit.name}"],
  ["screens/plan.tsx", "{i.title}"],
  ["screens/dash-day.tsx", "{n.title}"],
  ["screens/dash-day.tsx", "{i.title}"],
  ["screens/dash-day.tsx", "{m.title}"],
  ["screens/dash-metric.tsx", "{x.title}"],
  ["screens/dash-reviews.tsx", "{x.title}"],
  ["screens/dash-reviews.tsx", "{m.title}"],
  ["screens/focus-day.tsx", '{x.item?.title ?? "Nothing in particular"}'],
  ["screens/focus-stats.tsx", '{x.item?.title ?? "Nothing in particular"}'],
  ["screens/habits-home.tsx", "{h.name}"],
  ["screens/habit-secondary.tsx", "{h.name}"],
  ["screens/habit-list.tsx", "{h.name}"],
  ["screens/routines.tsx", "{h.name}"],
  ["screens/routines.tsx", '{h?.name ?? "Deleted habit"}'],
  ["screens/routine-player.tsx", "{h?.name}"],
  ["screens/task-stats.tsx", "{task.title}"],
  ["screens/capture-summary.tsx", "{x.title}"],
  ["screens/calendar-card.tsx", "{e.title}"],
  ["live-bar.tsx", "{r.title}"],
  ["companion/blocks.tsx", "{x.title}"],
  ["companion/blocks.tsx", "{c.label}"],
  ["social/kit.tsx", "{progress.title}\n        <Text"],
]

const CLAMP = /\b(?:numberOfLines|lines)=\{/

/** The opening tag of every Copy/Text whose body starts with ``child``. */
function holders(code: string, child: string): string[] {
  const tags: string[] = []
  let at = code.indexOf(child)
  while (at >= 0) {
    const start = Math.max(
      code.lastIndexOf("<Copy", at),
      code.lastIndexOf("<Text", at),
    )
    const end = code.indexOf(">", start)
    if (start >= 0 && end < at && !code.slice(end + 1, at).trim())
      tags.push(code.slice(start, end + 1))
    at = code.indexOf(child, at + child.length)
  }
  return tags
}

describe("task and habit titles wrap", () => {
  it.each(TITLES)("%s draws %s unclamped", (file, child) => {
    const code = readFileSync(join(__dirname, "..", file), "utf8")
    const tags = holders(code, child)
    // A renamed expression would otherwise pass by finding nothing.
    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) expect(tag).not.toMatch(CLAMP)
  })

  it("catches a clamp put back", () => {
    for (const tag of [
      '<Copy weight="medium" lines={1}>',
      "<Text\n  numberOfLines={2}\n  style={{ flex: 1 }}\n>",
    ]) {
      const [held] = holders(`${tag}\n{c.label}\n</Copy>`, "{c.label}")
      expect(held).toMatch(CLAMP)
    }
  })
})
