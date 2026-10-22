// The "For you" feed ranks posts by likes. Ranking from live counts made a
// liked post jump above its neighbour while the person's finger was still
// there, so the next tap liked the wrong post. The rank is frozen per feed
// visit: a like changes the count shown, never the order.
import type { Post } from "./store"

export type FrozenRank = Map<string, number>

/** ``posts`` newest first, then most liked first by ``rank``. Posts the
 * rank hasn't seen yet are ranked by their current likes and added to it. */
export function forYouOrder(posts: readonly Post[], rank: FrozenRank): Post[] {
  for (const p of posts) if (!rank.has(p.id)) rank.set(p.id, p.likes)
  return [...posts]
    .sort((a, b) => b.at - a.at)
    .sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0))
}
