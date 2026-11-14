// The phone recogniser's hints: "Fern" first, the person's own names, then
// local words; as said, deduplicated and capped.
import { dictationVocabulary, sayable } from "../dictation-vocabulary"

test("names are trimmed to what a person says", () => {
  expect(sayable("Betagro Garlic Butter Tender Chicken (90 g)")).toBe(
    "Betagro Garlic Butter Tender",
  )
  expect(sayable("Run, 5 km")).toBe("Run")
  expect(sayable("(x)")).toBeNull()
})

test("Fern first, own names before the fixed list, no repeats", () => {
  const words = dictationVocabulary(["Morning run", "gcash", "BPI Savings"])
  expect(words.slice(0, 4)).toEqual([
    "Fern",
    "Morning run",
    "gcash",
    "BPI Savings",
  ])
  expect(words.filter((w) => w.toLowerCase() === "gcash")).toHaveLength(1)
  expect(words).toContain("whey protein")
})

test("a long list is capped", () => {
  const own = Array.from({ length: 300 }, (_, i) => `Habit number ${i}`)
  expect(dictationVocabulary(own)).toHaveLength(100)
})
