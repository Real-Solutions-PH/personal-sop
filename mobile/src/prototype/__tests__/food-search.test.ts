// The food library's search: who each food came from, the meal history read
// as foods, every-word matching, the order results come in, and which parts
// of a name matched.
import type { Meal } from "@domain/fitness/data"
import type { LibraryFood } from "@/live/nutrition-foods"
import {
  type FoodEntry,
  highlight,
  historyEntries,
  matchRank,
  mealOrigin,
  originLabel,
  originOf,
  rank,
  words,
} from "../food-search"

const food = (over: Partial<LibraryFood>): LibraryFood => ({
  id: "f",
  name: "Food",
  aliases: [],
  basis: "100g",
  unit_grams: null,
  kcal: 100,
  protein: 1,
  carbs: 1,
  fat: 1,
  fiber: null,
  sat_fat: null,
  sugar: null,
  sodium: null,
  source: "label",
  verified: false,
  use_count: 0,
  last_used_at: null,
  ...over,
})

const meal = (
  id: string,
  at: string,
  source: Meal["source"],
  names: string[],
  status: Meal["status"] = "confirmed",
): Meal => ({
  id,
  eatenAt: at,
  label: "lunch",
  source,
  rawInput: "",
  status,
  items: names.map((name, i) => ({
    id: `${id}-${i}`,
    name,
    qty: 1,
    unit: "cup",
    kcal: 200,
    protein: 5,
    carbs: 40,
    fat: 2,
  })),
})

const entry = (over: Partial<FoodEntry>): FoodEntry => ({
  key: over.name ?? "x",
  name: "x",
  origin: "you",
  label: "You",
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  amount: "",
  at: null,
  uses: 0,
  aliases: [],
  ...over,
})

describe("where a food came from", () => {
  it("trusts the server's origin, else reads the source", () => {
    // A household row whose values were copied from USDA is still theirs.
    expect(originOf({ source: "usda", origin: "you" })).toBe("you")
    expect(originOf({ source: "usda" })).toBe("database")
    expect(originOf({ source: "off" })).toBe("database")
    expect(originOf({ source: "label" })).toBe("fern")
    expect(originOf({ source: "said" })).toBe("fern")
    expect(originOf({ source: "import" })).toBe("you")
    expect(originOf({ source: "recipe" })).toBe("you")
  })

  it("a meal logged by hand is the person's; from the chat, Fern's", () => {
    expect(mealOrigin("manual")).toBe("you")
    expect(mealOrigin("connector")).toBe("you")
    expect(mealOrigin("text")).toBe("fern")
    expect(mealOrigin("voice")).toBe("fern")
    expect(mealOrigin("photo")).toBe("fern")
  })

  it("names the database, never just the server", () => {
    expect(originLabel("database", "usda")).toBe("USDA")
    expect(originLabel("database", "off")).toBe("Open Food Facts")
    expect(originLabel("database", "philfct")).toBe("FNRI")
    expect(originLabel("you")).toBe("You")
    expect(originLabel("fern", "label")).toBe("Fern")
  })
})

describe("the meal history as foods", () => {
  it("one row per name, newest first, saved foods and estimates left out", () => {
    const rows = historyEntries(
      [
        meal("a", "2026-11-05T12:00:00Z", "manual", ["Sinangag", "Egg"]),
        meal("b", "2026-11-07T08:00:00Z", "text", ["egg ", "Coffee"]),
        meal(
          "c",
          "2026-11-07T09:00:00Z",
          "photo",
          ["Pancit"],
          "pending_estimate",
        ),
      ],
      [food({ name: "Coffee" })],
    )
    // Egg: last logged through Fern (text) on the 7th, twice in all.
    expect(rows.map((r) => [r.name, r.origin, r.uses])).toEqual([
      ["egg", "fern", 2],
      ["Sinangag", "you", 1],
    ])
    expect(rows[1].amount).toBe("1 cup")
  })
})

describe("matching", () => {
  it("needs every word, in any order, in the name or an alias", () => {
    const adobo = { name: "Chicken Adobo", aliases: ["manok"] }
    expect(matchRank(adobo, words("adobo chicken"))).not.toBeNull()
    expect(matchRank(adobo, words("manok"))).not.toBeNull()
    expect(matchRank(adobo, words("pork adobo"))).toBeNull()
  })

  it("ranks whole-word starts, then starts, then word starts, then inside", () => {
    expect(matchRank({ name: "Egg, boiled", aliases: [] }, ["egg"])).toBe(0)
    expect(matchRank({ name: "Eggplant", aliases: [] }, ["egg"])).toBe(1)
    expect(matchRank({ name: "Boiled egg", aliases: [] }, ["egg"])).toBe(2)
    expect(matchRank({ name: "Eggplant", aliases: [] }, ["plant"])).toBe(3)
  })
})

describe("order", () => {
  it("own and Fern's foods first, the most recently eaten leading", () => {
    const got = rank(
      [
        entry({ name: "Egg (USDA)", origin: "database", uses: 99 }),
        entry({ name: "Egg often", uses: 50 }),
        entry({ name: "Egg lately", origin: "fern", at: 2_000 }),
        entry({ name: "Egg before", at: 1_000 }),
      ],
      "egg",
    )
    expect(got.map((e) => e.name)).toEqual([
      "Egg lately",
      "Egg before",
      "Egg often",
      "Egg (USDA)",
    ])
  })

  it("database foods put the best match first; ties keep the server's order", () => {
    const got = rank(
      [
        entry({ name: "Rice, egg fried", origin: "database" }),
        entry({ name: "Eggplant", origin: "database" }),
        entry({ name: "Egg, whole", origin: "database" }),
      ],
      "egg",
    )
    expect(got.map((e) => e.name)).toEqual([
      "Egg, whole",
      "Eggplant",
      "Rice, egg fried",
    ])
  })

  it("drops what misses a word", () => {
    expect(rank([entry({ name: "Rice" })], "egg")).toEqual([])
  })
})

describe("highlight", () => {
  it("marks every matched part, keeping case, merging overlaps", () => {
    expect(highlight("Chicken Adobo", ["adobo", "chick"])).toEqual([
      { text: "Chick", hit: true },
      { text: "en ", hit: false },
      { text: "Adobo", hit: true },
    ])
    expect(highlight("Banana", ["ana", "nan"])).toEqual([
      { text: "B", hit: false },
      { text: "anana", hit: true },
    ])
    expect(highlight("Rice", [])).toEqual([{ text: "Rice", hit: false }])
  })
})
