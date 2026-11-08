const mockRequest = jest.fn()
jest.mock("../auth", () => ({ http: { request: mockRequest } }))

import { fetchReview } from "../review"

test("posts the range, kind and recent dismissals with a long timeout", async () => {
  mockRequest.mockResolvedValue({ wins: [], gaps: [], source: "rules" })
  const titles = Array.from({ length: 60 }, (_, i) => `t${i}`)
  await fetchReview({
    kind: "way_back",
    fromDay: "2026-11-03",
    toDay: "2026-11-07",
    dismissed: titles,
  })
  const [method, path, body, opts] = mockRequest.mock.calls[0]
  expect([method, path]).toEqual(["POST", "/companion/review"])
  expect(body).toMatchObject({
    kind: "way_back",
    from_day: "2026-11-03",
    to_day: "2026-11-07",
  })
  expect(body.dismissed).toHaveLength(50)
  expect(body.dismissed.at(-1)).toBe("t59")
  expect(opts.timeoutMs).toBeGreaterThanOrEqual(30_000)
})
