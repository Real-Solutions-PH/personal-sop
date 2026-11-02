// Server-read lists (React Query, not synced rows) refetch when the server
// writes them on its own: a food Fern saves shows in the library at once.
import { QueryClient } from "@tanstack/react-query"
import { foodsKey } from "../nutrition-foods"
import { installQueryRefresh, refreshQueries } from "../query-refresh"

let mockEmit: (e: { type: string }) => void = () => {}
jest.mock("../runtime", () => ({
  onServerEvent: (l: (e: { type: string }) => void) => {
    mockEmit = l
    return () => {}
  },
}))
jest.mock("../auth", () => ({ http: {} }))

function setup() {
  // No garbage-collection timer, so jest exits when the tests do.
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Number.POSITIVE_INFINITY } },
  })
  client.setQueryData(foodsKey(""), [])
  client.setQueryData(foodsKey("adobo"), [])
  client.setQueryData(["ai", "server-models"], [])
  installQueryRefresh(client)
  const stale = () =>
    client
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.isInvalidated)
      .map((q) => JSON.stringify(q.queryKey))
  return { stale }
}

test.each([
  "companion.reply",
  "sync.changed",
])("a %s event refetches every food list, and only those", (type) => {
  const { stale } = setup()
  mockEmit({ type })
  expect(stale().sort()).toEqual(
    [foodsKey(""), foodsKey("adobo")].map((k) => JSON.stringify(k)).sort(),
  )
})

test("a capture's reply ending refetches the food lists", () => {
  const { stale } = setup()
  refreshQueries("capture.done")
  expect(stale()).toHaveLength(2)
})

test("an unrelated event refetches nothing", () => {
  const { stale } = setup()
  mockEmit({ type: "social.comment" })
  expect(stale()).toEqual([])
})
