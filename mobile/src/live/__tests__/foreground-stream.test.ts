// The live event stream is open only while the app is in the foreground:
// the server reads an open stream as "in the app" and pushes Fern's replies
// only to people who are not.
import { foregroundStream } from "../events"

const opener = () => {
  const opened: { stopped: boolean }[] = []
  const start = () => {
    const s = { stopped: false }
    opened.push(s)
    return {
      stop: async () => {
        s.stopped = true
      },
    }
  }
  return { opened, start }
}

it("closes in the background and opens again on return", () => {
  const { opened, start } = opener()
  const live = foregroundStream(start)
  expect(opened).toHaveLength(1)
  live.onAppState("background")
  expect(opened[0].stopped).toBe(true)
  live.onAppState("active")
  expect(opened).toHaveLength(2)
  expect(opened[1].stopped).toBe(false)
})

it("a glance at Control Center (inactive) keeps the stream, and one stream at a time", () => {
  const { opened, start } = opener()
  const live = foregroundStream(start)
  live.onAppState("inactive")
  live.onAppState("active")
  expect(opened).toHaveLength(1)
  expect(opened[0].stopped).toBe(false)
})

it("stop closes whatever is open", async () => {
  const { opened, start } = opener()
  const live = foregroundStream(start)
  await live.stop()
  expect(opened[0].stopped).toBe(true)
  live.onAppState("active")
  expect(opened).toHaveLength(1)
})
