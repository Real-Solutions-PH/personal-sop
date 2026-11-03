// A chat that follows its newest message only while the reader lets it.
//
// Kai, 2026-11-03: while Fern answers, scrolling up to read earlier messages
// must never be undone by the reply growing. The list follows the newest
// message only from the bottom, untouched for FOLLOW_IDLE_MS; touching it
// stops following at once; "jump to latest" (or sending a message) follows
// again straight away. The decision is pure (``follow``, ``shouldFollow``);
// ``useFollowBottom`` wires it to a ScrollView.

import { useCallback, useEffect, useRef, useState } from "react"
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewInstance,
} from "react-native"

/** How long the reader leaves the list alone at the bottom before it
 * follows the reply again. */
export const FOLLOW_IDLE_MS = 3_000
/** Within this many points of the end counts as at the bottom. */
const BOTTOM_SLOP = 24

export interface FollowState {
  /** The last scroll position seen was at the end. */
  bottom: boolean
  /** A finger (or the flick it started) is moving the list. */
  touching: boolean
  /** When the reader last let go of the list (ms); 0 = never touched. */
  released: number
  /** Content arrived while the list was not following. */
  unread: boolean
}

export type FollowEvent =
  | { type: "drag"; at: number }
  /** The finger lifted (``momentum``: a flick is still moving it), or the
   * flick came to rest. */
  | { type: "settle"; at: number; momentum?: boolean }
  | { type: "scroll"; bottom: boolean }
  | { type: "grew" }
  | { type: "jump" }

export const initialFollow: FollowState = {
  bottom: true,
  touching: false,
  released: 0,
  unread: false,
}

export function atBottom(m: {
  y: number
  height: number
  content: number
}): boolean {
  return m.y + m.height >= m.content - BOTTOM_SLOP
}

export function follow(s: FollowState, e: FollowEvent): FollowState {
  switch (e.type) {
    case "drag":
      return { ...s, touching: true, released: e.at }
    case "settle":
      return e.momentum
        ? { ...s, released: e.at }
        : { ...s, touching: false, released: e.at }
    case "scroll":
      return {
        ...s,
        bottom: e.bottom,
        // Reaching the end by hand shows everything that arrived.
        unread: e.bottom ? false : s.unread,
      }
    case "grew":
      return s.bottom && !s.touching ? s : { ...s, unread: true }
    case "jump":
      return { ...s, bottom: true, touching: false, released: 0, unread: false }
  }
}

/** Whether new content should scroll the list to its end now. */
export function shouldFollow(s: FollowState, now: number): boolean {
  return (
    s.bottom &&
    !s.touching &&
    (s.released === 0 || now - s.released >= FOLLOW_IDLE_MS)
  )
}

// "Follow the newest message": sending one asks every following list on
// screen to jump to it.
const jumpers = new Set<() => void>()
export function jumpToLatest() {
  for (const j of jumpers) j()
}

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>

/** The follow behaviour for one ScrollView. Spread ``handlers`` onto it
 * (calling the list's own ``onScroll`` from yours if it has one) and render
 * a jump button while ``away``. ``enabled`` false: never scrolls itself. */
export function useFollowBottom(
  scroller: React.RefObject<ScrollViewInstance | null>,
  enabled = true,
  now: () => number = Date.now,
) {
  const state = useRef(initialFollow)
  const [shown, setShown] = useState({ away: false, unread: false })
  const send = useCallback((e: FollowEvent) => {
    const next = follow(state.current, e)
    state.current = next
    setShown((v) =>
      v.away === !next.bottom && v.unread === next.unread
        ? v
        : { away: !next.bottom, unread: next.unread },
    )
  }, [])
  const jump = useCallback(() => {
    send({ type: "jump" })
    scroller.current?.scrollToEnd({ animated: true })
  }, [scroller, send])
  useEffect(() => {
    if (!enabled) return
    jumpers.add(jump)
    return () => void jumpers.delete(jump)
  }, [enabled, jump])
  const handlers = {
    onScrollBeginDrag: () => send({ type: "drag", at: now() }),
    onScrollEndDrag: (e: ScrollEvent) => {
      // A flick keeps moving after the finger lifts; its momentum events
      // say when it rests.
      const v = e.nativeEvent.velocity
      send({
        type: "settle",
        at: now(),
        momentum: !!v && Math.abs(v.y) > 0.05,
      })
    },
    onMomentumScrollEnd: () => send({ type: "settle", at: now() }),
    onScroll: (e: ScrollEvent) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
      send({
        type: "scroll",
        bottom: atBottom({
          y: contentOffset.y,
          height: layoutMeasurement.height,
          content: contentSize.height,
        }),
      })
    },
    onContentSizeChange: () => {
      if (!enabled) return
      if (shouldFollow(state.current, now()))
        // Not animated: an animation in flight reads as "not at the bottom"
        // to the next growth, and a streamed reply grows many times a second.
        scroller.current?.scrollToEnd({ animated: false })
      else send({ type: "grew" })
    },
  }
  return { handlers, away: shown.away, unread: shown.unread, jump }
}
