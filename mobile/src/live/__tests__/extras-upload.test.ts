import type { StorageAdapter } from "@domain/lib/store"
import { extrasStore } from "@/prototype/extras"
import { extrasUploadKey, settleDeviceExtras } from "../extras-upload"
import { extrasFromServer, extrasToServer } from "../mappers/dash"

const ALL = { journal: true, social: true, weather: true, calendar: true }

function memory(): StorageAdapter & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

function server(enabled: string[] | null, fail = false) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  return {
    calls,
    request: async <T>(method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body })
      if (fail) throw new Error("offline")
      return (method === "GET"
        ? { profile: { enabled_extras: enabled } }
        : {}) as unknown as T
    },
  }
}

beforeEach(() => extrasStore.set(ALL))

test("an account that never chose takes this phone's switches, once", async () => {
  extrasStore.set({ ...ALL, social: false, weather: false })
  const storage = memory()
  const http = server(null)
  expect(await settleDeviceExtras("u1", storage, http)).toBe(true)
  expect(http.calls.at(-1)).toEqual({
    method: "PATCH",
    path: "/profile",
    body: { enabled_extras: ["journal", "calendar"] },
  })
  expect(storage.getItem(extrasUploadKey("u1"))).toBe("1")
  await settleDeviceExtras("u1", storage, http)
  expect(http.calls).toHaveLength(2)
})

test("an account's own choice overrides the phone's", async () => {
  const http = server(["social"])
  expect(await settleDeviceExtras("u2", memory(), http)).toBe(true)
  expect(extrasStore.get()).toEqual({
    journal: false,
    social: true,
    weather: false,
    calendar: false,
  })
  expect(http.calls.map((c) => c.method)).toEqual(["GET"])
})

test("a failed call leaves it for the next sync", async () => {
  const storage = memory()
  expect(await settleDeviceExtras("u3", storage, server(null, true))).toBe(
    false,
  )
  expect(storage.getItem(extrasUploadKey("u3"))).toBeNull()
})

test("the mapper keeps the phone's switches until the account chose", () => {
  const cur = { ...ALL, journal: false }
  expect(extrasFromServer(null, cur)).toBe(cur)
  expect(extrasFromServer(undefined, cur)).toBe(cur)
  expect(extrasFromServer([], cur)).toEqual({
    journal: false,
    social: false,
    weather: false,
    calendar: false,
  })
  expect(extrasToServer(cur)).toEqual(["social", "weather", "calendar"])
})
