// When a chat follows its newest message, and when it leaves the reader
// alone. Kai, 2026-11-03: scrolling up while Fern answers must not pull the
// page back down; it follows again only from the bottom, untouched for about
// three seconds, or on "jump to latest".

import { act, renderHook } from "@testing-library/react-native"
import {
  atBottom,
  FOLLOW_IDLE_MS,
  type FollowState,
  follow,
  initialFollow,
  jumpToLatest,
  shouldFollow,
  useFollowBottom,
} from "../follow"

const T = 10_000

const run = (...steps: Parameters<typeof follow>[1][]) =>
  steps.reduce<FollowState>((s, e) => follow(s, e), initialFollow)

test("a chat opens following its newest message", () => {
  expect(shouldFollow(initialFollow, T)).toBe(true)
})

test("bottom means within a few points of the end", () => {
  expect(atBottom({ y: 600, height: 400, content: 1000 })).toBe(true)
  expect(atBottom({ y: 590, height: 400, content: 1000 })).toBe(true)
  expect(atBottom({ y: 500, height: 400, content: 1000 })).toBe(false)
  // Shorter than the screen: always at the bottom.
  expect(atBottom({ y: 0, height: 400, content: 300 })).toBe(true)
})

test("touching the list stops following at once, even at the bottom", () => {
  const s = run({ type: "drag", at: T })
  expect(shouldFollow(s, T)).toBe(false)
  expect(shouldFollow(s, T + 60_000)).toBe(false)
})

test("scrolled up, the reply growing never pulls the reader down", () => {
  const s = run(
    { type: "drag", at: T },
    { type: "scroll", bottom: false },
    { type: "settle", at: T + 500 },
  )
  expect(shouldFollow(s, T + 60_000)).toBe(false)
  const grown = follow(s, { type: "grew" })
  expect(grown.unread).toBe(true)
  expect(shouldFollow(grown, T + 60_000)).toBe(false)
})

test("back at the bottom by hand, it follows again after three idle seconds", () => {
  const s = run(
    { type: "drag", at: T },
    { type: "scroll", bottom: false },
    { type: "scroll", bottom: true },
    { type: "settle", at: T + 1_000 },
  )
  expect(shouldFollow(s, T + 1_000 + FOLLOW_IDLE_MS - 1)).toBe(false)
  expect(shouldFollow(s, T + 1_000 + FOLLOW_IDLE_MS)).toBe(true)
})

test("a flick is still the reader's until its momentum ends", () => {
  const s = run(
    { type: "drag", at: T },
    { type: "settle", at: T + 200, momentum: true },
    { type: "scroll", bottom: true },
  )
  expect(shouldFollow(s, T + 60_000)).toBe(false)
  const done = follow(s, { type: "settle", at: T + 900 })
  expect(shouldFollow(done, T + 900 + FOLLOW_IDLE_MS)).toBe(true)
})

test("the chat's own scroll to the end does not count as the reader leaving", () => {
  // Content grew below: the last scroll event still says bottom.
  const s = run({ type: "grew" })
  expect(shouldFollow(s, T)).toBe(true)
  expect(s.unread).toBe(false)
})

test("jump to latest follows at once and clears the unread mark", () => {
  const s = run(
    { type: "drag", at: T },
    { type: "scroll", bottom: false },
    { type: "settle", at: T + 100 },
    { type: "grew" },
    { type: "jump" },
  )
  expect(s.unread).toBe(false)
  expect(shouldFollow(s, T + 101)).toBe(true)
})

test("reaching the bottom by hand clears the unread mark", () => {
  const s = run(
    { type: "drag", at: T },
    { type: "scroll", bottom: false },
    { type: "grew" },
    { type: "scroll", bottom: true },
  )
  expect(s.unread).toBe(false)
})

test("the jump button shows only away from the bottom", () => {
  expect(run().bottom).toBe(true)
  expect(run({ type: "scroll", bottom: false }).bottom).toBe(false)
})

// ---------------------------------------------------------------- the hook
// Driven the way a ScrollView drives it: drag, scroll, settle, content grown.

function setup(enabled = true) {
  let clock = T
  const scrollToEnd = jest.fn()
  const ref = { current: { scrollToEnd } } as never
  const hook = renderHook(() => useFollowBottom(ref, enabled, () => clock))
  const h = () => hook.result.current.handlers
  const scrollTo = (y: number) =>
    act(() =>
      h().onScroll({
        nativeEvent: {
          contentOffset: { y },
          layoutMeasurement: { height: 400 },
          contentSize: { height: 1000 },
        },
      } as never),
    )
  return {
    scrollToEnd,
    hook,
    h,
    scrollTo,
    tick: (ms: number) => {
      clock += ms
    },
  }
}

test("the list follows a reply that grows while the reader is at the bottom", () => {
  const { h, scrollToEnd } = setup()
  act(() => h().onContentSizeChange())
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false })
})

test("a reader who scrolled up mid-reply is never moved; the button shows", () => {
  const { h, hook, scrollTo, scrollToEnd, tick } = setup()
  act(() => h().onScrollBeginDrag())
  scrollTo(200)
  act(() => h().onScrollEndDrag({ nativeEvent: {} } as never))
  for (let i = 0; i < 20; i++) {
    tick(1_000)
    act(() => h().onContentSizeChange())
  }
  expect(scrollToEnd).not.toHaveBeenCalled()
  expect(hook.result.current.away).toBe(true)
  expect(hook.result.current.unread).toBe(true)
})

test("sending a message jumps a scrolled-up list to the latest", () => {
  const { h, hook, scrollTo, scrollToEnd } = setup()
  act(() => h().onScrollBeginDrag())
  scrollTo(200)
  act(() => jumpToLatest())
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: true })
  expect(hook.result.current.away).toBe(false)
  act(() => h().onContentSizeChange())
  expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: false })
})

test("a list that does not follow (a new chat's welcome) never scrolls itself", () => {
  const { h, scrollToEnd } = setup(false)
  act(() => h().onContentSizeChange())
  act(() => jumpToLatest())
  expect(scrollToEnd).not.toHaveBeenCalled()
})
