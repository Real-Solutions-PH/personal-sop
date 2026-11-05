// Which hidden part Today reintroduces: from day 14 after sign-up, the
// first hidden part in the person's order that they haven't turned down,
// and none on the day they last said "Not for me".
import { type IntroInput, introCandidate } from "../module-intro"

const base: IntroInput = {
  since: "2026-11-01",
  today: "2026-11-15",
  order: ["habits", "tasks", "fitness", "nutrition", "focus", "finance"],
  enabled: { finance: false, focus: false },
  shown: { journal: false, social: true },
  dismissed: [],
}

test("nothing before day 14", () => {
  expect(introCandidate({ ...base, today: "2026-11-14" })).toBeNull()
  expect(introCandidate(base)).toBe("focus")
})

test("the first hidden part in the person's order", () => {
  expect(
    introCandidate({
      ...base,
      order: ["finance", "focus", "habits", "tasks", "fitness", "nutrition"],
    }),
  ).toBe("finance")
})

test("a part turned down is skipped for good; extras come after modules", () => {
  expect(introCandidate({ ...base, dismissed: ["focus"] })).toBe("finance")
  expect(introCandidate({ ...base, dismissed: ["focus", "finance"] })).toBe(
    "journal",
  )
  expect(
    introCandidate({ ...base, dismissed: ["focus", "finance", "journal"] }),
  ).toBeNull()
})

test("the day of a Not for me shows nothing; the next day shows the next", () => {
  expect(
    introCandidate({ ...base, dismissed: ["focus"], pausedOn: base.today }),
  ).toBeNull()
  expect(
    introCandidate({ ...base, dismissed: ["focus"], pausedOn: "2026-11-14" }),
  ).toBe("finance")
})

test("everything on: nothing to reintroduce", () => {
  expect(
    introCandidate({
      ...base,
      enabled: {},
      shown: { journal: true, social: true },
    }),
  ).toBeNull()
})

test("no sign-up day known: nothing", () => {
  expect(introCandidate({ ...base, since: "" })).toBeNull()
})

test("Screen time is never previewed: it has no Today card", () => {
  expect(
    introCandidate({
      ...base,
      order: ["screen", ...base.order],
      enabled: { screen: false },
      shown: { journal: true, social: true },
    }),
  ).toBeNull()
})
