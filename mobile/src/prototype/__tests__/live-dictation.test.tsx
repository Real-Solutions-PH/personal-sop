// Live dictation (ADR-0016): words reach the box while the person speaks,
// finished phrases are kept, and no recogniser means "fall back".
import { act, renderHook } from "@testing-library/react-native"

type Listener = (e: never) => void
const mockListeners: Record<string, Listener> = {}
const mockModule = {
  isRecognitionAvailable: jest.fn(() => true),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  start: jest.fn(),
  stop: jest.fn(),
  abort: jest.fn(),
  addListener: jest.fn((name: string, fn: Listener) => {
    mockListeners[name] = fn
    return { remove: jest.fn() }
  }),
}
jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: mockModule,
}))

jest.mock("expo-audio", () => ({}))
jest.mock("expo-file-system", () => ({}))

const { composeDictation, useLiveDictation } =
  require("../live-dictation") as typeof import("../live-dictation")
const { speaking } = require("@/live/speech") as typeof import("@/live/speech")
const { createWakeListener, wake } =
  require("../wake-word") as typeof import("../wake-word")

const fire = (name: string, e: unknown) =>
  act(() => mockListeners[name](e as never))

beforeEach(() => {
  jest.clearAllMocks()
  mockModule.isRecognitionAvailable.mockReturnValue(true)
  mockModule.requestPermissionsAsync.mockResolvedValue({ granted: true })
})

test("words appear as they are recognised, after what was typed", async () => {
  const setText = jest.fn()
  const { result } = renderHook(() => useLiveDictation(setText, jest.fn()))
  await act(async () => {
    expect(await result.current.start("Note:")).toBe(true)
  })
  expect(result.current.listening).toBe(true)
  expect(mockModule.start).toHaveBeenCalledWith(
    expect.objectContaining({ interimResults: true, continuous: true }),
  )
  fire("result", { isFinal: false, results: [{ transcript: "add a" }] })
  expect(setText).toHaveBeenLastCalledWith("Note: add a")
  fire("result", {
    isFinal: false,
    results: [{ transcript: "add a task to buy milk" }],
  })
  expect(setText).toHaveBeenLastCalledWith("Note: add a task to buy milk")
  fire("result", {
    isFinal: true,
    results: [{ transcript: "Add a task to buy milk." }],
  })
  fire("result", { isFinal: false, results: [{ transcript: "and eggs" }] })
  expect(setText).toHaveBeenLastCalledWith(
    "Note: Add a task to buy milk. and eggs",
  )
  fire("end", null)
  expect(result.current.listening).toBe(false)
})

test("no recogniser or no permission says so, so the caller can record instead", async () => {
  mockModule.isRecognitionAvailable.mockReturnValue(false)
  const { result } = renderHook(() => useLiveDictation(jest.fn(), jest.fn()))
  await act(async () => {
    expect(await result.current.start("")).toBe(false)
  })
  mockModule.isRecognitionAvailable.mockReturnValue(true)
  mockModule.requestPermissionsAsync.mockResolvedValue({ granted: false })
  await act(async () => {
    expect(await result.current.start("")).toBe(false)
  })
  expect(mockModule.start).not.toHaveBeenCalled()
})

test("a real failure is reported; stopping or silence is not", async () => {
  const onError = jest.fn()
  const { result } = renderHook(() => useLiveDictation(jest.fn(), onError))
  await act(async () => {
    await result.current.start("")
  })
  fire("error", { error: "aborted" })
  fire("error", { error: "no-speech" })
  expect(onError).not.toHaveBeenCalled()
  fire("error", { error: "network" })
  expect(onError).toHaveBeenCalledWith("network")
  result.current.stop()
  expect(mockModule.stop).toHaveBeenCalled()
})

test("spacing is joined once", () => {
  expect(composeDictation("hi  ", " there ", "")).toBe("hi there")
  expect(composeDictation("", "", "")).toBe("")
})

test("one tap: Fern stops talking and Hey Fern lets go before dictation starts", async () => {
  speaking.setState({ id: "reply", state: "playing" })
  const wakeListener = createWakeListener({
    onWake: jest.fn(),
    getName: () => "Fern",
  })
  wakeListener.setWanted(true)
  expect(mockModule.start).toHaveBeenCalledTimes(1) // Hey Fern listening
  const { result } = renderHook(() => useLiveDictation(jest.fn(), jest.fn()))
  let started: Promise<boolean> = Promise.resolve(false)
  await act(async () => {
    started = result.current.start("")
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(speaking.getState().state).toBe("idle")
  expect(mockModule.abort).toHaveBeenCalledTimes(1)
  // Dictation waits for Hey Fern's task to end before taking the recogniser.
  expect(mockModule.start).toHaveBeenCalledTimes(1)
  await act(async () => {
    mockListeners.end(null as never)
    expect(await started).toBe(true)
  })
  expect(mockModule.start).toHaveBeenCalledTimes(2)
  expect(result.current.listening).toBe(true)
  expect(wake.getState().armed).toBe(false)
  wakeListener.dispose()
})

/** A text box: ``setText`` as React's state setter takes it. */
function box() {
  const b = {
    text: "",
    set: (v: string | ((cur: string) => string)) => {
      b.text = typeof v === "function" ? v(b.text) : v
    },
  }
  return b
}

async function dictateWith(
  refine: (uri: string, s: number) => Promise<string>,
) {
  const b = box()
  const { result } = renderHook(() =>
    useLiveDictation(b.set, jest.fn(), "en-US", refine),
  )
  await act(async () => {
    await result.current.start("Note:")
  })
  fire("result", {
    isFinal: true,
    results: [{ transcript: "friend log my weight protein" }],
  })
  return b
}

test("the server's words replace the phone's when the person stops", async () => {
  let answer: (t: string) => void = () => {}
  const refine = jest.fn(
    () =>
      new Promise<string>((ok) => {
        answer = ok
      }),
  )
  const b = await dictateWith(refine)
  expect(mockModule.start).toHaveBeenCalledWith(
    expect.objectContaining({
      recordingOptions: {
        persist: true,
        outputSampleRate: 16000,
        outputEncoding: "pcmFormatInt16",
      },
    }),
  )
  expect(b.text).toBe("Note: friend log my weight protein")
  fire("audioend", { uri: "file:///cache/rec.wav", timestamp: 1 })
  expect(refine).toHaveBeenCalledWith(
    "file:///cache/rec.wav",
    expect.any(Number),
  )
  await act(async () => answer("Fern, log my whey protein."))
  expect(b.text).toBe("Note: Fern, log my whey protein.")
  // A late phone result does not undo it.
  fire("result", { isFinal: true, results: [{ transcript: "friend" }] })
  expect(b.text).toBe("Note: Fern, log my whey protein.")
})

test("an edit made while the server works is kept", async () => {
  let answer: (t: string) => void = () => {}
  const b = await dictateWith(
    () =>
      new Promise<string>((ok) => {
        answer = ok
      }),
  )
  fire("audioend", { uri: "file:///cache/rec.wav", timestamp: 1 })
  b.text = "my own words"
  await act(async () => answer("Fern, log my whey protein."))
  expect(b.text).toBe("my own words")
})

test("a server failure keeps the phone's words", async () => {
  const b = await dictateWith(() => Promise.reject(new Error("network")))
  await act(async () => {
    mockListeners.audioend({ uri: "file:///cache/rec.wav" } as never)
  })
  expect(b.text).toBe("Note: friend log my weight protein")
})

test("without a server nothing is recorded", async () => {
  const { result } = renderHook(() =>
    useLiveDictation(jest.fn(), jest.fn(), "en-US", null),
  )
  await act(async () => {
    await result.current.start("")
  })
  expect(mockModule.start.mock.calls[0][0]).not.toHaveProperty(
    "recordingOptions",
  )
})
