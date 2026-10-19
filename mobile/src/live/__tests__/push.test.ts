import { dashStore, setPush } from "@domain/dash/store"
import type { Http } from "../http"
import { registerPushDevice } from "../push"

function setup(opts: {
  env?: string
  projectId?: string
  status?: string
  afterPrompt?: string
}) {
  const posted: unknown[] = []
  const http: Http = {
    request: async <T>(_m: string, _p: string, body?: unknown): Promise<T> => {
      posted.push(body)
      return {} as T
    },
    raw: async () => {
      throw new Error("unused")
    },
  }
  const requestPermissionsAsync = jest.fn(async () => ({
    status: opts.afterPrompt ?? "denied",
  }))
  const load = () =>
    ({
      notifications: {
        getPermissionsAsync: async () => ({ status: opts.status ?? "granted" }),
        requestPermissionsAsync,
        getExpoPushTokenAsync: async () => ({
          data: "ExponentPushToken[abc123]",
        }),
      },
      constants: {
        default: {
          executionEnvironment: opts.env ?? "standalone",
          expoConfig: { extra: { eas: { projectId: opts.projectId } } },
        },
      },
    }) as never
  return { http, posted, load, requestPermissionsAsync }
}

beforeEach(() => setPush({ permission: "default" }))

test("registers the token where push can work", async () => {
  const s = setup({ projectId: "p1" })
  await expect(
    registerPushDevice({ http: s.http, load: s.load, platform: "ios" }),
  ).resolves.toBe("ExponentPushToken[abc123]")
  expect(s.posted).toEqual([
    { token: "ExponentPushToken[abc123]", platform: "ios" },
  ])
})

test("skips web, Expo Go, a missing project id and a missing module", async () => {
  const s = setup({ projectId: "p1" })
  expect(
    await registerPushDevice({ http: s.http, load: s.load, platform: "web" }),
  ).toBeNull()
  const go = setup({ projectId: "p1", env: "storeClient" })
  expect(
    await registerPushDevice({ http: go.http, load: go.load, platform: "ios" }),
  ).toBeNull()
  const noId = setup({})
  expect(
    await registerPushDevice({
      http: noId.http,
      load: noId.load,
      platform: "android",
    }),
  ).toBeNull()
  const missing = () => {
    throw new Error("Cannot find native module")
  }
  expect(
    await registerPushDevice({ http: s.http, load: missing, platform: "ios" }),
  ).toBeNull()
  expect([...s.posted, ...go.posted, ...noId.posted]).toEqual([])
})

test("prompts only when the person said yes in the app", async () => {
  const no = setup({ projectId: "p1", status: "undetermined" })
  expect(
    await registerPushDevice({ http: no.http, load: no.load, platform: "ios" }),
  ).toBeNull()
  expect(no.requestPermissionsAsync).not.toHaveBeenCalled()
  setPush({ permission: "granted" })
  expect(dashStore.get().push.permission).toBe("granted")
  const yes = setup({
    projectId: "p1",
    status: "undetermined",
    afterPrompt: "granted",
  })
  expect(
    await registerPushDevice({
      http: yes.http,
      load: yes.load,
      platform: "ios",
    }),
  ).toBe("ExponentPushToken[abc123]")
  expect(yes.requestPermissionsAsync).toHaveBeenCalledTimes(1)
})
