// Widget and control links land on the route they name, in every form iOS
// and Android hand them over, and leave every other link alone.

import { widgetRoute } from "../links"

it("Fern links open the chat with the action to start", () => {
  for (const url of [
    "personalsop:///fern?mode=dictate",
    "personalsop://fern?mode=dictate",
    "/fern?mode=dictate",
  ])
    expect(widgetRoute(url, 5)).toBe("/capture?launch=dictate&at=5")
  expect(widgetRoute("personalsop:///fern?mode=camera", 5)).toBe(
    "/capture?launch=camera&at=5",
  )
  // No mode, or one this build does not know, still opens the chat.
  expect(widgetRoute("personalsop:///fern", 5)).toBe(
    "/capture?launch=chat&at=5",
  )
  expect(widgetRoute("personalsop:///fern?mode=video", 5)).toBe(
    "/capture?launch=chat&at=5",
  )
})

it("feature links open that app, and an unknown one opens Today", () => {
  expect(widgetRoute("personalsop:///feature/finance")).toBe("/finance")
  expect(widgetRoute("personalsop://feature/journal")).toBe("/journal")
  expect(widgetRoute("personalsop:///feature/screen")).toBe("/screen")
  expect(widgetRoute("personalsop:///feature/nope")).toBe("/today")
})

it("other links pass through", () => {
  expect(widgetRoute("personalsop:///today")).toBeNull()
  expect(widgetRoute("personalsop:///habits/abc")).toBeNull()
  expect(widgetRoute("personalsop://reset-password#access_token=x")).toBeNull()
  expect(widgetRoute("personalsop:///fernando")).toBeNull()
})
