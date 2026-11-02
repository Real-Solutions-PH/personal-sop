// The day's fiber by kind, worked by hand. Items logged before the split
// was tracked carry only total fiber: they count as "not split", never as
// a guessed share of each kind.
import { fiberSplit } from "@domain/fitness/limits"

test("adds each kind from the items that carry it", () => {
  expect(
    fiberSplit([
      { fiber: 4, fiberSoluble: 2, fiberInsoluble: 2 }, // oatmeal
      { fiber: 3, fiberSoluble: 0.5, fiberInsoluble: 2.5 }, // apple with skin
    ]),
  ).toEqual({ soluble: 2.5, insoluble: 4.5, unsplit: 0 })
})

test("total fiber with no split is counted apart", () => {
  expect(
    fiberSplit([
      { fiber: 4, fiberSoluble: 2, fiberInsoluble: 2 },
      { fiber: 6 }, // logged before the split existed
      {}, // no fiber value at all: adds nothing
    ]),
  ).toEqual({ soluble: 2, insoluble: 2, unsplit: 6 })
})

test("an item with one part known leaves the rest of its fiber unsplit", () => {
  // 5 g fiber, 1 g soluble known, insoluble unknown: 4 g not split.
  expect(fiberSplit([{ fiber: 5, fiberSoluble: 1 }])).toEqual({
    soluble: 1,
    unsplit: 4,
  })
})

test("nothing split: no kind totals, only what is unsplit", () => {
  expect(fiberSplit([{ fiber: 6 }])).toEqual({ unsplit: 6 })
  expect(fiberSplit([])).toEqual({ unsplit: 0 })
})
