import { FernSprite, type FernState } from "./fern-sprite"

/**
 * The companion's face where Fern acts (chat, the drawer, replies, Welcome):
 * the C1 wreath sprite. It breathes at rest and thinks while `active`; pass
 * `state` for any other mood.
 */
export function Orb({
  size = 32,
  active = false,
  state,
}: {
  size?: number
  active?: boolean
  state?: FernState
}) {
  return (
    <FernSprite size={size} state={state ?? (active ? "thinking" : "idle")} />
  )
}
