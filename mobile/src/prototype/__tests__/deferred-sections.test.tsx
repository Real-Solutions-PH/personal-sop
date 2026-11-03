// A screen's heavy sections render after its first paint, one at a time,
// each as soon as its own turn comes; read-only summaries follow a store
// change in a commit of their own, after the tap's; and derived statistics
// survive a remount.

import { clearSharedMemo, sharedMemo } from "@domain/lib/memo"
import { createStore, LaggingReads } from "@domain/lib/store"
import { act, render, screen } from "@testing-library/react-native"
import { Profiler, useEffect } from "react"
import { Text } from "react-native"
import { Deferred } from "../deferred"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withTiming: (value: unknown) => value,
  useReducedMotion: () => true,
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  usePathname: () => "/",
}))

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const frame = () => act(() => jest.advanceTimersByTime(20))

test("sections show their placeholder at once and fill in one per frame, in order", () => {
  const order: string[] = []
  const Section = ({ name }: { name: string }) => {
    useEffect(() => void order.push(name), [name])
    return <Text>{name}</Text>
  }
  render(
    <>
      <Text>shell</Text>
      {["a", "b", "c"].map((n) => (
        <Deferred key={n} fallback={<Text>{`${n} loading`}</Text>}>
          <Section name={n} />
        </Deferred>
      ))}
    </>,
  )
  expect(screen.getByText("shell")).toBeTruthy()
  expect(screen.getByText("a loading")).toBeTruthy()
  expect(screen.getByText("c loading")).toBeTruthy()
  frame()
  expect(screen.getByText("a")).toBeTruthy()
  expect(screen.getByText("b loading")).toBeTruthy()
  frame()
  frame()
  expect(screen.getByText("c")).toBeTruthy()
  expect(order).toEqual(["a", "b", "c"])
})

test("a section that leaves while it is rendering does not hold up the rest", () => {
  const view = (first: boolean) => (
    <>
      {first && (
        <Deferred fallback={<Text>first loading</Text>}>
          <Text>first</Text>
        </Deferred>
      )}
      <Deferred fallback={<Text>second loading</Text>}>
        <Text>second</Text>
      </Deferred>
    </>
  )
  const { rerender } = render(view(true))
  // The first is the one rendering (its frame is pending); it goes away.
  rerender(view(false))
  frame()
  frame()
  expect(screen.getByText("second")).toBeTruthy()
})

test("a lagging reader follows a change in a commit after the urgent one", () => {
  const store = createStore<{ n: number }>("deferred-lag", () => ({ n: 0 }), {
    persist: false,
  })
  const Reader = ({ id }: { id: string }) => (
    <Text>{`${id} ${store.use((s) => s.n)}`}</Text>
  )
  const commits: string[][] = []
  let current: string[] = []
  const tree = (
    <Profiler
      id="root"
      onRender={() => {
        commits.push(current)
        current = []
      }}
    >
      <Profiler id="urgent" onRender={() => void current.push("urgent")}>
        <Reader id="urgent" />
      </Profiler>
      <LaggingReads.Provider value>
        <Profiler id="summary" onRender={() => void current.push("summary")}>
          <Reader id="summary" />
        </Profiler>
      </LaggingReads.Provider>
    </Profiler>
  )
  render(tree)
  commits.length = 0
  act(() => store.set({ n: 1 }))
  expect(screen.getByText("urgent 1")).toBeTruthy()
  expect(screen.getByText("summary 1")).toBeTruthy()
  // Two commits: the urgent reader's, then the summary's on its own.
  expect(commits).toEqual([["urgent"], ["summary"]])
})

describe("shared memo", () => {
  beforeEach(() => clearSharedMemo())

  test("the same inputs reuse the result after the component is gone", () => {
    const state = { rows: [1, 2, 3] }
    const work = jest.fn(() => state.rows.length)
    expect(sharedMemo("t.count", work, [state, 30])).toBe(3)
    expect(sharedMemo("t.count", work, [state, 30])).toBe(3)
    expect(work).toHaveBeenCalledTimes(1)
    // Another range of the same state is its own entry.
    sharedMemo("t.count", work, [state, 7])
    expect(work).toHaveBeenCalledTimes(2)
  })

  test("a new state recomputes and drops the results of the old one", () => {
    const old = { rows: [1] }
    const next = { rows: [1, 2] }
    const work = jest.fn((s: { rows: number[] }) => s.rows.length)
    sharedMemo("t.n", () => work(old), [old, 7])
    expect(sharedMemo("t.n", () => work(next), [next, 7])).toBe(2)
    // The old state's entry is gone: asking again recomputes it.
    sharedMemo("t.n", () => work(old), [old, 7])
    expect(work).toHaveBeenCalledTimes(3)
  })

  test("a result is not reused on another day", () => {
    const state = {}
    const work = jest.fn(() => 1)
    jest.setSystemTime(new Date("2026-11-03T12:00:00"))
    sharedMemo("t.day", work, [state])
    jest.setSystemTime(new Date("2026-11-04T12:00:00"))
    sharedMemo("t.day", work, [state])
    expect(work).toHaveBeenCalledTimes(2)
  })
})
