// First-run setup asks about the top one or two modules; every other one is
// offered once, the first time its screen opens.
import type { ModuleKey } from "@domain/contract"
import {
  firstRunSteps,
  markOffered,
  setSetupFirst,
  setupFirstStore,
  shouldOfferSetup,
} from "../setup-first"

const ORDER: ModuleKey[] = [
  "finance",
  "habits",
  "fitness",
  "nutrition",
  "tasks",
]

test("the priority list's first two, in its order, not setup's", () => {
  expect(firstRunSteps(ORDER, ["nutrition", "habits", "finance"])).toEqual([
    "nutrition",
    "habits",
  ])
})

test("a priority module setup has no step for is passed over", () => {
  expect(firstRunSteps(["habits", "tasks"], ["screen", "tasks"])).toEqual([
    "tasks",
    "habits",
  ])
})

test("without a priority list, setup's own order", () => {
  expect(firstRunSteps(ORDER, [])).toEqual(["finance", "habits"])
  expect(firstRunSteps(["focus"], [])).toEqual(["focus"])
})

const base = {
  enabled: {
    habits: true,
    tasks: true,
    fitness: true,
    nutrition: false,
    focus: true,
    finance: true,
    screen: true,
  },
  onboarded: true,
  skipped: [] as ModuleKey[],
  offered: [] as ModuleKey[],
  has: {
    habits: false,
    tasks: true,
    fitness: false,
    nutrition: false,
    focus: false,
    finance: false,
    screen: false,
  },
}

test("offered on first open only when on, onboarded, empty, not skipped or offered", () => {
  expect(shouldOfferSetup("habits", base)).toBe(true)
  expect(shouldOfferSetup("tasks", base)).toBe(false) // has data
  expect(shouldOfferSetup("nutrition", base)).toBe(false) // switched off
  expect(shouldOfferSetup("screen", base)).toBe(false) // its screen is setup
  expect(shouldOfferSetup("habits", { ...base, onboarded: false })).toBe(false)
  expect(shouldOfferSetup("habits", { ...base, skipped: ["habits"] })).toBe(
    false,
  )
  expect(shouldOfferSetup("habits", { ...base, offered: ["habits"] })).toBe(
    false,
  )
})

test("offering is remembered; a new sign-up starts over", () => {
  setSetupFirst(["fitness"])
  markOffered("habits")
  markOffered("habits")
  expect(setupFirstStore.get()).toEqual({
    first: ["fitness"],
    offered: ["habits"],
  })
  setSetupFirst(["finance"])
  expect(setupFirstStore.get().offered).toEqual([])
})
