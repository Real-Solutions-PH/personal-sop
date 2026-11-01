import { sendFeedback } from "../feedback"

test("a thumb is a PUT on the reply, null clears it", async () => {
  const calls: unknown[][] = []
  const http = {
    request: async <T>(...args: unknown[]): Promise<T> => {
      calls.push(args)
      return null as T
    },
  }
  await sendFeedback(http, "r1", { rating: "down", reason: "too_long" })
  await sendFeedback(http, "r1", { rating: null })
  expect(calls).toEqual([
    [
      "PUT",
      "/companion/messages/r1/feedback",
      { rating: "down", reason: "too_long" },
    ],
    ["PUT", "/companion/messages/r1/feedback", { rating: null }],
  ])
})
