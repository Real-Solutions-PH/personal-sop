// Opening a tab leaves that tab alone on the stack: the screens drilled into
// before are dismissed, not left mounted under it.

const mockCalls: string[] = []
let mockStacked = false
jest.mock("expo-router", () => ({
  router: {
    push: (p: string) => void mockCalls.push(`push ${p}`),
    replace: (p: string) => void mockCalls.push(`replace ${p}`),
    dismissAll: () => void mockCalls.push("dismissAll"),
    canDismiss: () => mockStacked,
    canGoBack: () => mockStacked,
    back: () => void mockCalls.push("back"),
  },
}))

import { go, switchTab } from "../navigation"

beforeEach(() => {
  mockCalls.length = 0
  mockStacked = false
})

test("a tab over a drilled-in screen dismisses it before replacing", () => {
  mockStacked = true
  switchTab("/today")
  expect(mockCalls).toEqual(["dismissAll", "replace /today"])
})

test("a tab from a tab's own page only replaces it", () => {
  switchTab("/plan")
  expect(mockCalls).toEqual(["replace /plan"])
})

test("going to a tab page switches tabs; any other page is pushed", () => {
  mockStacked = true
  go("/stats")
  go("/finance/records")
  expect(mockCalls).toEqual([
    "dismissAll",
    "replace /stats",
    "push /finance/records",
  ])
})
