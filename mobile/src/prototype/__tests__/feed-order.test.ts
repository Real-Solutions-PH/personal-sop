import { forYouOrder } from "../social/feed-order"
import type { Post } from "../social/store"

const post = (id: string, likes: number, at: number) =>
  ({ id, likes, at, liked: false }) as Post

test("liking a post never moves it above its neighbour", () => {
  const rank = new Map<string, number>()
  const top = post("top", 3, 2)
  const below = post("below", 3, 1)
  expect(forYouOrder([top, below], rank).map((p) => p.id)).toEqual([
    "top",
    "below",
  ])
  // The person likes the lower post: its count goes up, its place does not.
  const liked = { ...below, likes: 4, liked: true }
  expect(forYouOrder([top, liked], rank).map((p) => p.id)).toEqual([
    "top",
    "below",
  ])
})

test("a fresh rank orders by likes, newest first among equals", () => {
  const order = forYouOrder(
    [post("a", 1, 3), post("b", 5, 1), post("c", 1, 4)],
    new Map(),
  )
  expect(order.map((p) => p.id)).toEqual(["b", "c", "a"])
})

test("a post the rank has not seen joins by its current likes", () => {
  const rank = new Map<string, number>()
  forYouOrder([post("a", 2, 1)], rank)
  const order = forYouOrder([post("a", 2, 1), post("new", 9, 2)], rank)
  expect(order.map((p) => p.id)).toEqual(["new", "a"])
})
