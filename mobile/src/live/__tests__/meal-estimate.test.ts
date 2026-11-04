// "Describe your meal" signed in live: the server's estimate lands in the
// store as pulled rows; a refusal and an outage are told apart, so only an
// outage falls back to the device's food table.

import { ApiError, NetworkError } from "../http"
import { estimateMealLive } from "../meal-estimate"

const mockRequest = jest.fn()
const mockApply = jest.fn()
let mockEngine: { apply: jest.Mock } | null = null
jest.mock("../auth", () => ({ http: { request: mockRequest } }))
jest.mock("../runtime", () => ({ engine: () => mockEngine }))

const input = {
  id: "0b5c4e8a-1f2d-4c3b-9a8e-7d6c5b4a3f21",
  text: "1 cup rice and fried chicken",
  eatenAt: "2026-11-04T04:30:00.000Z",
  label: "lunch",
}

beforeEach(() => {
  mockRequest.mockReset()
  mockApply.mockReset()
  mockEngine = { apply: mockApply }
})

test("the estimated meal and its items merge as server rows", async () => {
  const item = { id: "i1", version: 1, meal_id: input.id, name: "Rice" }
  mockRequest.mockResolvedValue({
    id: input.id,
    version: 1,
    status: "estimated",
    items: [item],
    totals: { kcal: 205 },
  })
  await expect(estimateMealLive(input)).resolves.toEqual({
    ok: true,
    id: input.id,
  })
  const [method, path, body] = mockRequest.mock.calls[0]
  expect([method, path]).toEqual(["POST", "/fitness/meals/estimate"])
  expect(body).toEqual({
    id: input.id,
    text: input.text,
    eaten_at: input.eatenAt,
    label: "lunch",
    source: "text",
  })
  expect(mockApply).toHaveBeenCalledWith([
    {
      entity: "meal",
      id: input.id,
      version: 1,
      deleted: false,
      row: { id: input.id, version: 1, status: "estimated" },
    },
    { entity: "meal_item", id: "i1", version: 1, deleted: false, row: item },
  ])
})

test("no food read in the words is not an outage", async () => {
  mockRequest.mockRejectedValue(
    new ApiError(422, "meal_not_recognised", "Couldn't estimate"),
  )
  await expect(estimateMealLive(input)).resolves.toEqual({
    ok: false,
    reason: "unrecognised",
  })
})

test.each([
  new NetworkError("timeout"),
  new ApiError(402, "ai_spend_cap_reached", "cap"),
  new ApiError(500, "internal", "boom"),
])("%s falls back to the device", async (error) => {
  mockRequest.mockRejectedValue(error)
  await expect(estimateMealLive(input)).resolves.toEqual({
    ok: false,
    reason: "unavailable",
  })
  expect(mockApply).not.toHaveBeenCalled()
})

test("signed out of live sync, nothing is called", async () => {
  mockEngine = null
  await expect(estimateMealLive(input)).resolves.toEqual({
    ok: false,
    reason: "unavailable",
  })
  expect(mockRequest).not.toHaveBeenCalled()
})
