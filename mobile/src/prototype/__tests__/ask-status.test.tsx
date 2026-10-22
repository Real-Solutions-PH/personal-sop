// A question the server has not stored yet says so under its bubble: it
// waits for a connection, or it failed and Retry sends it again.
import { fireEvent, render, screen } from "@testing-library/react-native"
import { AskStatus } from "../companion/ask-status"
import { setRetryAsk } from "../companion/store"

const base = { id: "m1", role: "me" as const, at: 1, text: "how am I doing?" }

test("a queued question waits for a connection", () => {
  render(<AskStatus m={{ ...base, status: "queued" }} />)
  expect(screen.getByText("Waiting for a connection")).toBeTruthy()
})

test("a failed question offers Retry, wired to the live ask", () => {
  const retry = jest.fn()
  setRetryAsk(retry)
  render(<AskStatus m={{ ...base, status: "failed" }} />)
  fireEvent.press(screen.getByLabelText("Not sent. Retry"))
  expect(retry).toHaveBeenCalledWith("m1")
  setRetryAsk(null)
})

test("a stored question shows nothing", () => {
  render(<AskStatus m={base} />)
  expect(screen.queryByText(/Waiting|Not sent/)).toBeNull()
})
