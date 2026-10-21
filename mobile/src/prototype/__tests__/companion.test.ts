import { ask, route } from "../companion/brain"
import { companionStore, setAskBackend } from "../companion/store"

beforeEach(() => companionStore.reset())
afterEach(() => setAskBackend(null))

const blocks = (q: string) => {
  const r = route(q)
  return r.kind === "reply" ? (r.blocks ?? []).map((b) => b.t) : r.kind
}

test("routes each kind of request to the right answer", () => {
  expect(blocks("How am I doing?")).toContain("insights")
  expect(blocks("coach me")).toContain("coach")
  expect(blocks("plan my day")).toContain("plan")
  expect(blocks("I'm so stressed today")).toContain("coach")
  // Logging and specific money questions go to the capture engine.
  expect(blocks("spent 180 on lunch gcash")).toBe("capture")
  expect(blocks("how much did I spend on food this month?")).toBe("capture")
})

test("charts pick the metric and range from the wording", () => {
  const r = route("show my weight this year")
  expect(r.kind === "reply" && r.blocks?.[0]).toEqual({
    t: "chart",
    metric: "weight",
    days: 365,
  })
  const s = route("chart my spending by category")
  expect(s.kind === "reply" && s.blocks?.[0]).toMatchObject({
    metric: "spendCats",
    days: 30,
  })
})

test("tracking a metric records a goal; remember stores a fact", () => {
  route("track spending under 1,200 a day")
  const t = companionStore.get().trackers.find((x) => x.metric === "spend")
  expect(t).toMatchObject({ goal: 1200, direction: "below" })
  route("remember that I'm vegetarian on Mondays")
  expect(companionStore.get().memories.at(-1)?.text).toBe(
    "I'm vegetarian on Mondays",
  )
})

test("live mode: the server records memories and trackers, the phone does not", () => {
  const before = companionStore.get()
  const calls: [string, boolean][] = []
  setAskBackend((text, _hint, toCapture) => calls.push([text, toCapture]))
  ask("remember that I swim on Sundays")
  ask("track weight below 80")
  ask("spent 180 on lunch")
  expect(calls).toEqual([
    ["remember that I swim on Sundays", false],
    ["track weight below 80", false],
    ["spent 180 on lunch", true],
  ])
  // A local copy would sync up as a second row next to the server's own.
  expect(companionStore.get().memories).toEqual(before.memories)
  expect(companionStore.get().trackers).toEqual(before.trackers)
})
