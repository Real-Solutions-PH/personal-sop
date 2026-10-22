// "Hey Fern": the phrase is recognised in what the phone hears, the
// listener hands the recogniser over only once it has let go, and the
// composer on screen starts dictating.
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render } from "@testing-library/react-native"

type Listener = (e: never) => void
const mockListeners: Record<string, Listener | undefined> = {}
const mockModule = {
  isRecognitionAvailable: jest.fn(() => true),
  supportsOnDeviceRecognition: jest.fn(() => true),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  start: jest.fn(),
  stop: jest.fn(),
  abort: jest.fn(),
  addListener: jest.fn((name: string, fn: Listener) => {
    mockListeners[name] = fn
    return {
      remove: () => {
        if (mockListeners[name] === fn) mockListeners[name] = undefined
      },
    }
  }),
}
jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: mockModule,
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
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({
  AudioModule: { requestRecordingPermissionsAsync: jest.fn() },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: () => ({}),
  useAudioRecorderState: () => ({}),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { wakeCommand, createWakeListener, wake } =
  require("../wake-word") as typeof import("../wake-word")
const { dictating } =
  require("../live-dictation") as typeof import("../live-dictation")
const { ThreadComposer } =
  require("../screens/capture-thread") as typeof import("../screens/capture-thread")

const fire = (name: string, e: unknown) => mockListeners[name]?.(e as never)
const said = (transcript: string) =>
  fire("result", { isFinal: false, results: [{ transcript }] })

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  for (const k of Object.keys(mockListeners)) mockListeners[k] = undefined
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  wake.setState({ armed: false, listening: false, pending: null })
  dictating.setState({ on: false })
})
afterEach(() => jest.useRealTimers())

describe("wakeCommand", () => {
  test.each([
    ["Hey Fern", ""],
    ["hey, fern.", ""],
    ["Hay Vern", ""],
    ["okay fern", ""],
    ["so um hey Fern log lunch 200", "log lunch 200"],
    ["Hey Fern, Spent 250 on Lunch", "Spent 250 on Lunch"],
  ])("hears %j", (text, rest) => {
    expect(wakeCommand(text)).toBe(rest)
  })
  test.each([
    "I bought a fern today",
    "they fern",
    "hey ferny",
    "hey there",
    "",
  ])("ignores %j", (text) => {
    expect(wakeCommand(text)).toBeNull()
  })
  test("a renamed companion answers to its own name only", () => {
    expect(wakeCommand("hey sage", "Sage")).toBe("")
    expect(wakeCommand("hey fern", "Sage")).toBeNull()
    expect(wakeCommand("hey vern", "Sage")).toBeNull()
  })
})

describe("the listener", () => {
  const make = () => {
    const onWake = jest.fn()
    const l = createWakeListener({ onWake, getName: () => "Fern" })
    return { l, onWake }
  }

  test("does nothing until wanted, then listens on the device", () => {
    const { l } = make()
    expect(mockModule.start).not.toHaveBeenCalled()
    l.setWanted(true)
    expect(mockModule.start).toHaveBeenCalledWith(
      expect.objectContaining({
        continuous: true,
        interimResults: true,
        requiresOnDeviceRecognition: true,
        contextualStrings: ["Hey Fern", "Fern"],
      }),
    )
    expect(wake.getState()).toMatchObject({ armed: true, listening: true })
    l.dispose()
  })

  test("the phrase stops listening and wakes only once the recogniser let go", () => {
    const { l, onWake } = make()
    l.setWanted(true)
    said("what was that")
    expect(mockModule.abort).not.toHaveBeenCalled()
    said("hey fern add milk")
    expect(mockModule.abort).toHaveBeenCalledTimes(1)
    said("hey fern add milk to the list")
    expect(mockModule.abort).toHaveBeenCalledTimes(1)
    expect(onWake).not.toHaveBeenCalled()
    fire("end", null)
    expect(onWake).toHaveBeenCalledWith("add milk")
    // It leaves the recogniser to dictation instead of starting again.
    jest.advanceTimersByTime(1_000)
    expect(mockModule.start).toHaveBeenCalledTimes(1)
    l.dispose()
  })

  test("listens again once dictation is done, or after the handoff if it never started", () => {
    const { l } = make()
    l.setWanted(true)
    said("hey fern")
    fire("end", null)
    l.setWanted(false) // dictation took over
    l.setWanted(true) // and finished
    expect(mockModule.start).toHaveBeenCalledTimes(2)
    said("hey fern")
    fire("end", null)
    jest.advanceTimersByTime(4_000)
    expect(mockModule.start).toHaveBeenCalledTimes(3)
    l.dispose()
  })

  test("standing down aborts and does not come back by itself", () => {
    const { l, onWake } = make()
    l.setWanted(true)
    l.setWanted(false)
    expect(mockModule.abort).toHaveBeenCalled()
    fire("end", null)
    jest.advanceTimersByTime(60_000)
    expect(mockModule.start).toHaveBeenCalledTimes(1)
    expect(onWake).not.toHaveBeenCalled()
    expect(wake.getState()).toMatchObject({ armed: false, listening: false })
  })

  test("each task is recycled before a minute and the next one starts", () => {
    const { l } = make()
    l.setWanted(true)
    jest.advanceTimersByTime(50_000)
    expect(mockModule.abort).toHaveBeenCalledTimes(1)
    fire("end", null)
    jest.advanceTimersByTime(200)
    expect(mockModule.start).toHaveBeenCalledTimes(2)
    l.dispose()
  })

  test("a recogniser that keeps failing at once is retried with growing waits", () => {
    const { l } = make()
    l.setWanted(true)
    fire("end", null) // failed straight away
    jest.advanceTimersByTime(999)
    expect(mockModule.start).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1)
    expect(mockModule.start).toHaveBeenCalledTimes(2)
    fire("end", null)
    jest.advanceTimersByTime(1_999)
    expect(mockModule.start).toHaveBeenCalledTimes(2)
    jest.advanceTimersByTime(1)
    expect(mockModule.start).toHaveBeenCalledTimes(3)
    l.dispose()
  })
})

describe("the composer", () => {
  test("the composer on screen starts dictating, with what followed the name", async () => {
    render(<ThreadComposer onText={jest.fn()} hints={false} wakeTarget />)
    await act(async () => {
      wake.setState({ pending: { at: Date.now(), rest: "log lunch" } })
    })
    expect(mockModule.start).toHaveBeenCalledWith(
      expect.objectContaining({ continuous: true, addsPunctuation: true }),
    )
    expect(dictating.getState().on).toBe(true)
    expect(wake.getState().pending).toBeNull()
  })

  test("a composer that is not on screen leaves the wake alone", async () => {
    render(<ThreadComposer onText={jest.fn()} hints={false} />)
    const pending = { at: Date.now(), rest: "" }
    await act(async () => {
      wake.setState({ pending })
    })
    expect(mockModule.start).not.toHaveBeenCalled()
    expect(wake.getState().pending).toBe(pending)
  })

  test("a stale wake does not start dictation", async () => {
    render(<ThreadComposer onText={jest.fn()} hints={false} wakeTarget />)
    await act(async () => {
      wake.setState({ pending: { at: Date.now() - 10_000, rest: "" } })
    })
    expect(mockModule.start).not.toHaveBeenCalled()
  })
})
