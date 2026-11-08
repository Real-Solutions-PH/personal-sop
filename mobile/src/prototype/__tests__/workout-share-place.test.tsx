// The workout share cards: "Every set" lists every exercise and every set,
// "All PRs" every exercise that set a record, and a workout can carry where
// it was trained, typed or picked from the places near the phone.
import * as A from "@domain/fitness/actions"
import type { Workout, WorkoutSet } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { Text } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { fitnessMappers } from "../../live/mappers/fitness"
import {
  fetchNearby,
  fmtDistance,
  kindOf,
  nearbyUrls,
  parseNearby,
} from "../nearby-places"
import { FitnessShare, setTokens, WorkoutCard } from "../screens/fitness-share"
import { CardFrame, type CardLook, Dense } from "../share-kit"
import * as F from "./share-fixtures"

const mockFindNearby = jest.fn()
jest.mock("../nearby-places", () => ({
  ...jest.requireActual("../nearby-places"),
  findNearby: () => mockFindNearby(),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: unknown }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("react-native-view-shot", () => ({ captureRef: jest.fn() }))
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}))
jest.mock("../media", () => ({ copyText: jest.fn(), pickPhoto: jest.fn() }))

const look: CardLook = { format: "9:16", backdrop: "fern", photo: null }
const flags = {
  exercises: true,
  prs: true,
  week: true,
  bodyweight: false,
  macros: false,
}
const SAFE = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const words = (r: ReturnType<typeof render>) =>
  r
    .UNSAFE_getAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).join(""))
    .join(" | ")

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockFindNearby.mockReset()
})

const set = (reps: number, weight: number, extra: Partial<WorkoutSet> = {}) =>
  ({
    id: `s${reps}-${weight}-${extra.kind ?? "w"}`,
    reps,
    weight,
    kind: "working",
    completedAt: "2026-11-08T10:00:00Z",
    ...extra,
  }) as WorkoutSet

describe("setTokens", () => {
  test("alike sets run together, in order; warm-ups and undone sets apart", () => {
    expect(
      setTokens({ loadType: "weight" }, [
        set(10, 40, { kind: "warmup" }),
        set(8, 60),
        set(8, 60),
        set(7, 60),
        set(5, 70),
        set(6, 60, { completedAt: undefined }),
      ]),
    ).toEqual([
      { load: "40 kg", reps: ["10"], warmup: true },
      { load: "60 kg", reps: ["8", "8", "7"], warmup: false },
      { load: "70 kg", reps: ["5"], warmup: false },
    ])
  })
  test("bodyweight, reps-only and timed sets say their own load", () => {
    expect(
      setTokens({ loadType: "bodyweight" }, [set(12, 0), set(8, 10)]),
    ).toEqual([
      { load: "BW", reps: ["12"], warmup: false },
      { load: "BW +10 kg", reps: ["8"], warmup: false },
    ])
    expect(setTokens({ loadType: "reps" }, [set(20, 0)])).toEqual([
      { load: "", reps: ["20"], warmup: false },
    ])
    expect(
      setTokens({ loadType: "time" }, [
        set(0, 0, { durationSec: 1200, speedKmh: 6 }),
      ]),
    ).toEqual([{ load: "6 km/h", reps: ["20 min"], warmup: false }])
  })
})

describe("Every set", () => {
  test("lists every exercise and every set, none left out", () => {
    const d = F.workoutData()
    const r = render(
      <WorkoutCard
        kind="sets"
        width={300}
        look={look}
        data={d}
        flags={flags}
      />,
    )
    expect(r.getAllByTestId("card-exercise")).toHaveLength(d.detail.length)
    const runs = d.detail.flatMap((x) => x.tokens)
    expect(r.getAllByTestId("card-set-run")).toHaveLength(runs.length)
    const all = words(r)
    for (const x of d.detail) expect(all).toContain(x.name)
    // Each run is the load (muted, nested) then its reps.
    const runText = r.getAllByTestId("card-set-run").map((t) =>
      [t.props.children]
        .flat(Infinity)
        .map((c) =>
          typeof c === "string" ? c : [c?.props?.children].flat().join(""),
        )
        .join(""),
    )
    expect(runText).toContain("Warm-up 40 kg  10")
    expect(runText).toContain("60 kg  8 · 8 · 7")
    expect(all).not.toMatch(/more/)
  })
  test("on a photo too", () => {
    const d = F.workoutData()
    const r = render(
      <WorkoutCard
        kind="sets"
        width={300}
        look={{ format: "9:16", backdrop: "photo", photo: "file:///p.jpg" }}
        data={d}
        flags={flags}
      />,
    )
    expect(r.getAllByTestId("card-exercise")).toHaveLength(d.detail.length)
  })
})

describe("All PRs", () => {
  test("names every exercise that set a record, with its gain", () => {
    const d = F.workoutData()
    const r = render(
      <WorkoutCard
        kind="records"
        width={300}
        look={look}
        data={d}
        flags={flags}
      />,
    )
    expect(r.getAllByTestId("card-record")).toHaveLength(4)
    const all = words(r)
    for (const x of d.records) expect(all).toContain(x.name)
    expect(all).toContain("Est. 1-rep max · Heaviest")
    expect(all).toContain("2.5 kg vs best")
    // A first-ever lift has no best before to beat.
    expect(all).toContain("First time logged")
  })
  test("a session with none says so as a miss", () => {
    const r = render(
      <WorkoutCard
        kind="records"
        width={300}
        look={look}
        data={{ ...F.workoutData(), records: [] }}
        flags={flags}
      />,
    )
    expect(r.getByTestId("card-miss")).toBeTruthy()
  })
})

describe("where you trained", () => {
  test("the place is on every workout card, and can be turned off", () => {
    for (const kind of ["summary", "sets", "pr", "records", "photo"] as const) {
      const r = render(
        <WorkoutCard
          kind={kind}
          width={300}
          look={look}
          data={F.workoutData()}
          flags={flags}
        />,
      )
      expect(words(r)).toContain("Anytime Fitness BGC")
      r.unmount()
    }
    const off = render(
      <WorkoutCard
        kind="summary"
        width={300}
        look={look}
        data={F.workoutData()}
        flags={{ ...flags, place: false }}
      />,
    )
    expect(off.queryByTestId("card-place")).toBeNull()
  })

  const workout = (): Workout => {
    const w: Workout = {
      id: "w1",
      name: "Push day",
      startedAt: "2026-11-08T09:00:00Z",
      endedAt: "2026-11-08T10:00:00Z",
      status: "finished",
      exercises: [],
      clientId: "w1",
    }
    fitStore.set((s) => ({ ...s, workouts: [w] }))
    return w
  }
  test("setWorkoutPlace trims, caps and clears", () => {
    workout()
    A.setWorkoutPlace("w1", { name: "  Gold's   Gym  ", lat: 14.5, lon: 121 })
    expect(fitStore.get().workouts[0].place).toEqual({
      name: "Gold's Gym",
      lat: 14.5,
      lon: 121,
    })
    A.setWorkoutPlace("w1", { name: "x".repeat(200) })
    expect(fitStore.get().workouts[0].place?.name).toHaveLength(A.PLACE_MAX)
    A.setWorkoutPlace("w1", { name: "   " })
    expect(fitStore.get().workouts[0].place).toBeUndefined()
  })
  test("a pull from the server keeps the place on this phone", () => {
    workout()
    A.setWorkoutPlace("w1", { name: "Gold's Gym" })
    const m = fitnessMappers("u1").find(
      (x) => x.entity === "workout",
    ) as unknown as {
      fromServer: (row: Record<string, unknown>, s: unknown) => unknown
      toServer: (w: Workout, s: unknown) => unknown
    }
    const row = m.fromServer(
      {
        id: "w1",
        name: "Push day",
        started_at: "2026-11-08T09:00:00Z",
        ended_at: "2026-11-08T10:00:00Z",
        status: "finished",
        source: "live",
      },
      fitStore.get(),
    ) as Workout
    expect(row.place).toEqual({ name: "Gold's Gym" })
    // It is never sent: the server has no place column.
    expect(JSON.stringify(m.toServer(row, fitStore.get()))).not.toMatch(/Gold/)
  })
})

describe("nearby places", () => {
  const reply = {
    features: [
      feat("Bonifacio High Street", "highway", "pedestrian", 121.0501, 14.551),
      feat("Pound", "amenity", "restaurant", 121.05036, 14.55106),
      feat("Gold's Gym", "leisure", "fitness_centre", 121.0513, 14.5517),
      feat("Gold's Gym", "leisure", "fitness_centre", 121.06, 14.56),
      feat("BHS Central", "leisure", "park", 121.0505, 14.5512),
      feat("Power Up", "leisure", "sports_centre", 121.0509, 14.5509),
      feat("", "shop", "shoes", 121.0503, 14.551),
    ],
  }
  test("gyms first by distance, then the rest by distance; no roads, no repeats", () => {
    const got = parseNearby([reply], 14.5509, 121.0503)
    expect(got.map((p) => [p.name, p.kind])).toEqual([
      ["Power Up", "Sports centre"],
      ["Gold's Gym", "Gym"],
      ["Pound", "Restaurant"],
      ["BHS Central", "Park"],
    ])
    expect(got[0].distanceM).toBeGreaterThan(50)
    expect(got[0].distanceM).toBeLessThan(80)
    expect(got[0].area).toBe("Bonifacio Global City")
  })
  test("kinds read as words", () => {
    expect(kindOf({ amenity: "gym" })).toEqual({ kind: "Gym", fitness: true })
    expect(kindOf({ shop: "mall" })).toEqual({ kind: "Mall", fitness: false })
    expect(kindOf({ building: "yes" })).toEqual({
      kind: "Building",
      fitness: false,
    })
    expect(fmtDistance(78)).toBe("80 m")
    expect(fmtDistance(1240)).toBe("1.2 km")
  })
  test("asks for training places and for what is right here", () => {
    const [train, here] = nearbyUrls(14.5509, 121.0503)
    expect(train).toContain("osm_tag=leisure:fitness_centre")
    expect(train).toContain("radius=0.5")
    expect(here).not.toContain("osm_tag")
    expect(here).toContain("radius=0.15")
  })
  test("one lookup failing still lists the other; both failing is null", async () => {
    const ok = { ok: true, json: async () => reply } as Response
    const half = jest
      .fn()
      .mockResolvedValueOnce(ok)
      .mockRejectedValueOnce(new Error("offline"))
    expect((await fetchNearby(14.5509, 121.0503, half))?.length).toBe(4)
    const none = jest.fn().mockRejectedValue(new Error("offline"))
    expect(await fetchNearby(14.5509, 121.0503, none)).toBeNull()
  })
})

describe("the place picker", () => {
  const seed = () => {
    const w: Workout = {
      id: "w1",
      name: "Push day",
      startedAt: "2026-11-08T09:00:00Z",
      endedAt: "2026-11-08T10:00:00Z",
      status: "finished",
      exercises: [],
      clientId: "w1",
    }
    fitStore.set((s) => ({ ...s, workouts: [w] }))
  }
  test("location is asked only on tap; a picked place is saved", async () => {
    seed()
    mockFindNearby.mockResolvedValue({
      ok: true,
      lat: 14.55,
      lon: 121.05,
      places: [
        {
          id: "N1",
          name: "Gold's Gym",
          kind: "Gym",
          fitness: true,
          distanceM: 160,
          lat: 14.5517,
          lon: 121.0513,
        },
      ],
    })
    render(
      <SafeAreaProvider initialMetrics={SAFE}>
        <FitnessShare id="w1" />
      </SafeAreaProvider>,
    )
    expect(mockFindNearby).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.press(screen.getByText("Find places near me"))
    })
    expect(mockFindNearby).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Places © OpenStreetMap contributors")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Gold's Gym, Gym, 160 m away"))
    expect(fitStore.get().workouts[0].place).toEqual({
      name: "Gold's Gym",
      lat: 14.5517,
      lon: 121.0513,
    })
    expect(screen.getByTestId("place-input").props.value).toBe("Gold's Gym")
  })
  test("typed by hand, and a refusal is said with the typed way out", async () => {
    seed()
    mockFindNearby.mockResolvedValue({
      ok: false,
      reason:
        "Location is off for Unfurl. Type the place, or allow location in Settings.",
    })
    render(
      <SafeAreaProvider initialMetrics={SAFE}>
        <FitnessShare id="w1" />
      </SafeAreaProvider>,
    )
    fireEvent.changeText(screen.getByTestId("place-input"), "Home garage")
    expect(fitStore.get().workouts[0].place).toEqual({ name: "Home garage" })
    await act(async () => {
      fireEvent.press(screen.getByText("Find places near me"))
    })
    expect(screen.getByRole("alert")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Clear the place"))
    expect(fitStore.get().workouts[0].place).toBeUndefined()
  })
})

function feat(
  name: string,
  key: string,
  value: string,
  lon: number,
  lat: number,
) {
  return {
    geometry: { coordinates: [lon, lat] },
    properties: {
      osm_type: "N",
      osm_id: Math.round(lon * lat),
      osm_key: key,
      osm_value: value,
      name,
      locality: "Bonifacio Global City",
    },
  }
}

describe("Dense", () => {
  // Layout events are fed by hand: the room is 100 tall, and the content
  // reports a height that follows the scale it was drawn at.
  const layout = (h: number) => ({ nativeEvent: { layout: { height: h } } })
  function setup(natural: (scale: number, over: boolean) => number) {
    const seen: { scale: number; over: boolean }[] = []
    const r = render(
      <CardFrame width={300} look={look}>
        <Dense min={0.6}>
          {(st) => {
            seen.push(st)
            return <Text>rows</Text>
          }}
        </Dense>
      </CardFrame>,
    )
    const box = r.getByTestId("card-dense")
    const inner = () =>
      box.children[0] as unknown as Parameters<typeof fireEvent>[0]
    const last = () => seen[seen.length - 1]
    // Room first, then the content: the order the platform does not promise.
    act(() => fireEvent(box, "layout", layout(100)))
    for (let i = 0; i < 12; i++) {
      const { scale, over } = last()
      act(() => fireEvent(inner(), "layout", layout(natural(scale, over))))
    }
    return last()
  }
  test("shrinks until the content fits", () => {
    const end = setup((s) => 150 * s)
    expect(end.over).toBe(false)
    expect(150 * end.scale).toBeLessThanOrEqual(100.5)
    expect(end.scale).toBeGreaterThan(0.6)
  })
  test("at the floor in one column, goes to two from full size", () => {
    const end = setup((s, over) => (over ? 120 : 400) * s)
    expect(end.over).toBe(true)
    expect(120 * end.scale).toBeLessThanOrEqual(100.5)
  })
  test("content that fits stays full size", () => {
    expect(setup(() => 80)).toEqual({ scale: 1, over: false })
  })
})
