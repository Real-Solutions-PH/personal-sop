// The Screen Time bridge: with no native module (Android, web, a build made
// without UNFURL_SCREEN_TIME=1) every call answers "unavailable" or empty
// and nothing throws; with the module, calls are forwarded and the events
// the monitor extension stored are parsed.

let mockEnv = "bare"
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get executionEnvironment() {
      return mockEnv
    },
  },
}))

import {
  authorizationStatus,
  hasSelection,
  pickApps,
  readEvents,
  requestScreenTime,
  screenTimeAvailable,
  startMonitoring,
  stopMonitoring,
} from "../screen-time"

type Modules = Record<string, unknown>
const g = globalThis as unknown as { expo?: { modules?: Modules } }

function install(native: unknown) {
  g.expo = g.expo ?? {}
  g.expo.modules = g.expo.modules ?? {}
  if (native === undefined) delete g.expo.modules.UnfurlScreenTime
  else g.expo.modules.UnfurlScreenTime = native
}

beforeEach(() => {
  mockEnv = "bare"
  install(undefined)
})

describe("without the native module", () => {
  it("reports unavailable and never throws", async () => {
    expect(screenTimeAvailable()).toBe(false)
    await expect(authorizationStatus()).resolves.toBe("unavailable")
    await expect(requestScreenTime()).resolves.toBe("unavailable")
    await expect(pickApps("g1")).resolves.toBe(false)
    await expect(hasSelection("g1")).resolves.toBe(false)
    await expect(
      startMonitoring([{ groupId: "g1", kind: "custom", rungs: [1, 5] }], 4),
    ).resolves.toBeUndefined()
    await expect(stopMonitoring()).resolves.toBeUndefined()
    await expect(readEvents()).resolves.toEqual([])
  })
})

describe("with the native module", () => {
  const native = {
    authorizationStatus: jest.fn(async () => "approved"),
    requestAuthorization: jest.fn(async () => "denied"),
    pickApps: jest.fn(async (_id: string) => true),
    hasSelection: jest.fn(async (_id: string) => true),
    startMonitoring: jest.fn(async (_p: unknown, _h: number) => {}),
    stopMonitoring: jest.fn(async () => {}),
    readEvents: jest.fn(
      async (): Promise<string[]> => [
        JSON.stringify({
          kind: "start",
          groupId: "g1",
          at: 1000,
          hasSelection: true,
        }),
        JSON.stringify({ kind: "rung", groupId: "g1", at: 2000, rungMin: 5 }),
        "not json",
        JSON.stringify({ kind: "rung", groupId: "g1", at: 3000 }),
        JSON.stringify({ kind: "end", groupId: "g1", at: 4000 }),
      ],
    ),
  }
  beforeEach(() => {
    for (const f of Object.values(native)) f.mockClear()
    install(native)
  })

  it("forwards calls", async () => {
    expect(screenTimeAvailable()).toBe(true)
    await expect(authorizationStatus()).resolves.toBe("approved")
    await expect(requestScreenTime()).resolves.toBe("denied")
    await expect(pickApps("g1")).resolves.toBe(true)
    expect(native.pickApps).toHaveBeenCalledWith("g1")
    await expect(hasSelection("g2")).resolves.toBe(true)
    expect(native.hasSelection).toHaveBeenCalledWith("g2")
    const plan = [{ groupId: "all", kind: "all" as const, rungs: [1, 61] }]
    await startMonitoring(plan, 4)
    expect(native.startMonitoring).toHaveBeenCalledWith(plan, 4)
    await stopMonitoring()
    expect(native.stopMonitoring).toHaveBeenCalled()
  })

  it("parses stored events and drops malformed lines", async () => {
    await expect(readEvents()).resolves.toEqual([
      { kind: "start", groupId: "g1", at: 1000, hasSelection: true },
      { kind: "rung", groupId: "g1", at: 2000, rungMin: 5 },
      { kind: "end", groupId: "g1", at: 4000 },
    ])
  })

  it("treats an unknown status as unavailable and a native error as empty", async () => {
    native.authorizationStatus.mockResolvedValueOnce("weird")
    await expect(authorizationStatus()).resolves.toBe("unavailable")
    native.readEvents.mockRejectedValueOnce(new Error("boom"))
    await expect(readEvents()).resolves.toEqual([])
    native.pickApps.mockRejectedValueOnce(new Error("boom"))
    await expect(pickApps("g1")).resolves.toBe(false)
  })
})

describe("in Expo Go", () => {
  it("can be tried with sample events for the monitored groups", async () => {
    mockEnv = "storeClient"
    expect(screenTimeAvailable()).toBe(true)
    await expect(requestScreenTime()).resolves.toBe("approved")
    await expect(pickApps("g1")).resolves.toBe(true)
    await expect(hasSelection("g1")).resolves.toBe(true)
    await startMonitoring(
      [{ groupId: "g1", kind: "custom", rungs: [1, 5, 10, 15, 30] }],
      4,
    )
    const events = await readEvents()
    expect(events.some((e) => e.kind === "start" && e.groupId === "g1")).toBe(
      true,
    )
    expect(events.some((e) => e.kind === "end")).toBe(true)
    expect(events.some((e) => e.kind === "rung")).toBe(true)
  })
})
