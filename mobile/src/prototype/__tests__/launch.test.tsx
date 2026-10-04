import { act, render, renderHook } from "@testing-library/react-native"
import type { ComponentType } from "react"

jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require("react-native")
    return <Text>{href}</Text>
  },
}))
jest.mock("../mode", () => ({ prototypeMode: true }))
jest.mock("sonner-native", () => ({ toast: jest.fn() }))
jest.mock("@/stores/network-store", () => {
  throw new Error("Connected storage loaded in prototype mode")
})
jest.mock("@/stores/auth-store", () => {
  throw new Error("Connected auth loaded in prototype mode")
})
jest.mock("@/lib/supabase", () => {
  throw new Error("Connected Supabase loaded in prototype mode")
})

test.each([
  ["root", () => require("../../app/index")],
  ["app layout", () => require("../../app/(app)/_layout")],
  ["app home", () => require("../../app/(app)/index")],
  ["items", () => require("../../app/(app)/items")],
  ["settings", () => require("../../app/(app)/settings")],
  ["login", () => require("../../app/login")],
  ["signup", () => require("../../app/signup")],
  ["recover password", () => require("../../app/recover-password")],
  ["reset password", () => require("../../app/reset-password")],
])("%s loads in Expo Go without connected services", (_name, load) => {
  const Page = (load as () => { default: ComponentType })().default
  const view = render(<Page />)
  expect(view.getByText("/today")).toBeTruthy()
})

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
)
afterEach(() => {
  for (const [key, descriptor] of [
    ["window", originalWindow],
    ["navigator", originalNavigator],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
function loadPlatform() {
  let platform!: typeof import("@domain/lib/platform")
  // Keep the renderer's React instance while resetting the module's connectivity.
  const react = require("react")
  jest.isolateModules(() => {
    jest.doMock("react", () => react)
    platform = require("@domain/lib/platform")
  })
  return platform
}
test("native connectivity works with a window alias but no browser events", () => {
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true })
  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
  })
  const platform = loadPlatform()
  const hook = renderHook(() => platform.useConnectivity())
  expect(hook.result.current).toBe(true)
  act(() => platform.setConnectivity(false))
  expect(hook.result.current).toBe(false)
  act(() => platform.setConnectivity(true))
  expect(hook.result.current).toBe(true)
  expect(() => hook.unmount()).not.toThrow()
})
test("browser connectivity observes online events and cleans up listeners", () => {
  const callbacks = new Map<string, () => void>()
  const addEventListener = jest.fn((name: string, cb: () => void) =>
    callbacks.set(name, cb),
  )
  const removeEventListener = jest.fn()
  const navigator = { onLine: false }
  Object.defineProperty(globalThis, "window", {
    value: { addEventListener, removeEventListener },
    configurable: true,
  })
  Object.defineProperty(globalThis, "navigator", {
    value: navigator,
    configurable: true,
  })
  const platform = loadPlatform()
  const hook = renderHook(() => platform.useConnectivity())
  expect(hook.result.current).toBe(false)
  act(() => {
    navigator.onLine = true
    callbacks.get("online")!()
  })
  expect(hook.result.current).toBe(true)
  hook.unmount()
  expect(removeEventListener).toHaveBeenCalledWith(
    "online",
    callbacks.get("online"),
  )
  expect(removeEventListener).toHaveBeenCalledWith(
    "offline",
    callbacks.get("offline"),
  )
})
