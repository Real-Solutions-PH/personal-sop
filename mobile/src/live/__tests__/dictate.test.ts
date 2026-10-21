// Dictation upload (ADR-0015): the recording goes to /capture/dictate and
// the words come back; failures carry the server's code.
const mockCurrent = jest.fn()
const mockRefresh = jest.fn()
jest.mock("../auth", () => ({
  tokens: { current: () => mockCurrent(), refresh: () => mockRefresh() },
}))
jest.mock("../config", () => ({
  API_URL: "http://api.test",
  API_PREFIX: "/api/v1",
}))

const { dictate, dictationMessage, DictationError } =
  require("../dictate") as typeof import("../dictate")

const reply = (status: number, body: unknown) =>
  ({ status, ok: status < 400, json: async () => body }) as Response

beforeEach(() => {
  mockCurrent.mockReset().mockResolvedValue("t1")
  mockRefresh.mockReset().mockResolvedValue("t2")
})

test("the recording goes up as a file and the words come back", async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValue(reply(200, { text: "add a task to buy milk" }))
  global.fetch = fetchMock as unknown as typeof fetch
  await expect(dictate("file:///rec.m4a", 4.4)).resolves.toBe(
    "add a task to buy milk",
  )
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe("http://api.test/api/v1/capture/dictate")
  expect(init.method).toBe("POST")
  expect(init.headers).toEqual({ Authorization: "Bearer t1" })
  const form = init.body as FormData
  expect(form.get("duration_sec")).toBe("4")
})

test("an expired token is refreshed once", async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce(reply(401, {}))
    .mockResolvedValueOnce(reply(200, { text: "hello" }))
  global.fetch = fetchMock as unknown as typeof fetch
  await expect(dictate("file:///rec.m4a", 2)).resolves.toBe("hello")
  expect(fetchMock.mock.calls[1][1].headers).toEqual({
    Authorization: "Bearer t2",
  })
})

test("a refusal carries the server's code, and reads as a sentence", async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      reply(503, { code: "speech_unavailable" }),
    ) as unknown as typeof fetch
  const err = await dictate("file:///rec.m4a", 2).catch((e) => e)
  expect(err).toBeInstanceOf(DictationError)
  expect(err.code).toBe("speech_unavailable")
  expect(dictationMessage(err.code)).toMatch(/isn't set up/)
  expect(dictationMessage("transcript_empty")).toMatch(/couldn't hear/i)
})

test("no connection is reported as such", async () => {
  global.fetch = jest
    .fn()
    .mockRejectedValue(
      new TypeError("Network request failed"),
    ) as unknown as typeof fetch
  const err = await dictate("file:///rec.m4a", 2).catch((e) => e)
  expect(err.code).toBe("network")
  expect(dictationMessage(err.code)).toMatch(/connection/)
})
