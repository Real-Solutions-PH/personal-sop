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
const file = {
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
} as unknown as Response

beforeEach(() => {
  mockCurrent.mockReset().mockResolvedValue("t1")
  mockRefresh.mockReset().mockResolvedValue("t2")
})

test("the recording's bytes go up as the body and the words come back", async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce(file)
    .mockResolvedValueOnce(reply(200, { text: "add a task to buy milk" }))
  await expect(
    dictate("file:///rec.m4a", 4.4, fetchMock as unknown as typeof fetch),
  ).resolves.toBe("add a task to buy milk")
  expect(fetchMock.mock.calls[0][0]).toBe("file:///rec.m4a")
  const [url, init] = fetchMock.mock.calls[1]
  expect(url).toBe("http://api.test/api/v1/capture/dictate?duration_sec=4")
  expect(init.method).toBe("POST")
  expect(init.headers).toEqual({
    "Content-Type": "application/octet-stream",
    Authorization: "Bearer t1",
  })
  expect(Array.from(init.body as Uint8Array)).toEqual([1, 2, 3])
})

test("an expired token is refreshed once", async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce(file)
    .mockResolvedValueOnce(reply(401, {}))
    .mockResolvedValueOnce(reply(200, { text: "hello" }))
  await expect(
    dictate("file:///rec.m4a", 2, fetchMock as unknown as typeof fetch),
  ).resolves.toBe("hello")
  expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer t2")
})

test("a refusal carries the server's code, and reads as a sentence", async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce(file)
    .mockResolvedValueOnce(reply(503, { code: "speech_unavailable" }))
  const err = await dictate(
    "file:///rec.m4a",
    2,
    fetchMock as unknown as typeof fetch,
  ).catch((e) => e)
  expect(err).toBeInstanceOf(DictationError)
  expect(err.code).toBe("speech_unavailable")
  expect(dictationMessage(err.code)).toMatch(/isn't set up/)
  expect(dictationMessage("transcript_empty")).toMatch(/couldn't hear/i)
})

test("no connection is reported as such", async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce(file)
    .mockRejectedValueOnce(new TypeError("Network request failed"))
  const err = await dictate(
    "file:///rec.m4a",
    2,
    fetchMock as unknown as typeof fetch,
  ).catch((e) => e)
  expect(err.code).toBe("network")
  expect(dictationMessage(err.code)).toMatch(/connection/)
})
