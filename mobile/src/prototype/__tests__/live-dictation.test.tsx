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

const { composeDictation, useLiveDictation } =
  require("../live-dictation") as typeof import("../live-dictation")

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
