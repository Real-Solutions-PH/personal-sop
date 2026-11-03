// Steps for a session's window from the iPhone's own step counter, which
// answers while the phone is locked (Health does not); null when the
// device has none or refuses.
const mockAvailable = jest.fn(async () => true)
const mockCount = jest.fn(async (_a: Date, _b: Date) => ({ steps: 1834 }))
jest.mock("expo-sensors", () => ({
  Pedometer: {
    isAvailableAsync: () => mockAvailable(),
    getStepCountAsync: (a: Date, b: Date) => mockCount(a, b),
  },
}))

import { readSteps } from "../pedometer"

beforeEach(() => jest.clearAllMocks())

const a = new Date(2026, 10, 3, 7, 0),
  b = new Date(2026, 10, 3, 7, 20)

test("counts the window's steps", async () => {
  expect(await readSteps(a, b)).toBe(1834)
  expect(mockCount).toHaveBeenCalledWith(a, b)
})

test("no step counter: null, nothing asked", async () => {
  mockAvailable.mockResolvedValueOnce(false)
  expect(await readSteps(a, b)).toBeNull()
  expect(mockCount).not.toHaveBeenCalled()
})

test("a refusal or an error reads as null", async () => {
  mockCount.mockRejectedValueOnce(new Error("not authorized"))
  expect(await readSteps(a, b)).toBeNull()
})
