// A step row never shows a tool's identifier (Kai, 2026-11-09: a step read
// "todo"). Unknown tools fail closed to a generic sentence, and a reply
// stored before the server wrote a sentence for every tool reads as words.
import {
  STEP_DONE,
  STEP_RUNNING,
  stepLabel,
  stepText,
} from "../companion/store"

test("a known tool says what it does while it runs", () => {
  expect(stepLabel("todo")).toBe("Planning the steps")
  expect(
    stepText({ id: "1", tool: "todo", label: "todo", running: true }),
  ).toBe("Planning the steps…")
})

test("an unknown tool reads as a generic step, running or finished", () => {
  expect(stepLabel("brand_new_tool")).toBe(STEP_RUNNING)
  expect(
    stepText({
      id: "1",
      tool: "brand_new_tool",
      label: "brand_new_tool",
      running: true,
    }),
  ).toBe(`${STEP_RUNNING}…`)
  expect(
    stepText({
      id: "1",
      tool: "brand_new_tool",
      label: "brand new tool",
      ok: true,
      summary: "brand new tool",
    }),
  ).toBe(STEP_DONE)
})

test("a stored step whose sentence is its tool name reads as words", () => {
  const shown = stepText({
    id: "1",
    tool: "todo",
    label: "Planning the steps",
    ok: true,
    summary: "todo",
  })
  expect(shown).toBe("Planning the steps")
  expect(shown).not.toMatch(/todo/)
})

test("the server's own sentence wins once the step finished", () => {
  expect(
    stepText({
      id: "1",
      tool: "query_records",
      label: "Reading your records",
      ok: true,
      summary: "Read your workouts records",
    }),
  ).toBe("Read your workouts records")
})
