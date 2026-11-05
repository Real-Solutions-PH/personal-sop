// "Say one thing from today" is held until the account exists, then goes
// through the ordinary capture path exactly once.
import { configureStorage } from "@domain/lib/store"
import {
  firstCaptureStore,
  forgetFirstCapture,
  holdFirstCapture,
  replayFirstCapture,
} from "../first-capture"

jest.mock("@domain/capture/engine", () => ({
  sendCapture: jest.fn(() => "cap-1"),
}))
const { sendCapture } = jest.requireMock("@domain/capture/engine") as {
  sendCapture: jest.Mock
}

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  sendCapture.mockClear()
  forgetFirstCapture()
})

test("nothing is sent while it is held, then once", () => {
  holdFirstCapture({ text: "  ran 5k  ", source: "voice" })
  expect(sendCapture).not.toHaveBeenCalled()
  expect(replayFirstCapture()).toBe("cap-1")
  expect(sendCapture).toHaveBeenCalledWith({ text: "ran 5k", source: "voice" })
  expect(firstCaptureStore.get()).toEqual({ pending: null, sentId: "cap-1" })
  expect(replayFirstCapture()).toBeNull()
  expect(sendCapture).toHaveBeenCalledTimes(1)
})

test("blank words hold nothing", () => {
  holdFirstCapture({ text: "   ", source: "text" })
  expect(firstCaptureStore.get().pending).toBeNull()
  expect(replayFirstCapture()).toBeNull()
})

test("a send that throws is not retried into a second capture", () => {
  holdFirstCapture({ text: "lunch 250", source: "text" })
  sendCapture.mockImplementationOnce(() => {
    throw new Error("boom")
  })
  expect(() => replayFirstCapture()).toThrow()
  expect(replayFirstCapture()).toBeNull()
  expect(sendCapture).toHaveBeenCalledTimes(1)
})
