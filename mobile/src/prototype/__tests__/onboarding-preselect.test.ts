// "What do you want to track?" starts from "Who are you becoming?": a module
// is ticked only when its identity statement was picked (Tasks also for a
// student), until the person ticks or unticks something themself.
import { configureStorage } from "@domain/lib/store"

jest.mock("../storage", () => ({
  prototypeStorage: () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }),
}))
const D = require("../onboarding-draft") as typeof import("../onboarding-draft")

const ticked = () =>
  Object.entries(D.getDraft()!.enabled)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .sort()

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  D.discardDraft()
  D.ensureDraft()
})

test("a fresh draft ticks nothing but has Capture", () => {
  expect(ticked()).toEqual([])
  expect(D.extrasOf(D.getDraft()!)).toEqual({ journal: false, social: false })
})

test("identity picks tick their modules", () => {
  D.editDraft({
    identities: ["I'm someone who trains", "I eat to fuel my goals"],
  })
  expect(ticked()).toEqual(["fitness", "nutrition"])
  D.editDraft({ identities: ["I eat to fuel my goals"] })
  expect(ticked()).toEqual(["nutrition"])
})

test("a statement with no module ticks nothing", () => {
  D.editDraft({ identities: ["I keep the promises I make to myself"] })
  expect(ticked()).toEqual([])
})

test("a student also gets Tasks", () => {
  D.editDraft({ identities: ["I do deep work every day"] })
  D.editDraft({ occupation: "student" })
  expect(ticked()).toEqual(["focus", "tasks"])
  D.editDraft({ occupation: "employed" })
  expect(ticked()).toEqual(["focus"])
})

test("once the person changes the module step, picks no longer overwrite it", () => {
  D.editDraft({ identities: ["I'm someone who trains"] })
  D.editDraft({ enabled: { ...D.getDraft()!.enabled, finance: true } })
  D.editDraft({ identities: ["I show up every day"] })
  expect(ticked()).toEqual(["finance", "fitness"])
})

test("priority follows the order the statements were picked", () => {
  D.editDraft({
    identities: ["I'm in control of my money", "I show up every day"],
    occupation: "student",
  })
  expect(D.priorityOf(D.getDraft()!)).toEqual(["finance", "habits", "tasks"])
  // A module ticked by hand comes after the picked ones.
  D.editDraft({ enabled: { ...D.getDraft()!.enabled, focus: true } })
  expect(D.priorityOf(D.getDraft()!)).toEqual([
    "finance",
    "habits",
    "tasks",
    "focus",
  ])
  // An unticked one drops out.
  D.editDraft({ enabled: { ...D.getDraft()!.enabled, finance: false } })
  expect(D.priorityOf(D.getDraft()!)).toEqual(["habits", "tasks", "focus"])
})
