// "Reminders are off → Fix" asks in place, or opens Settings when the system
// will not ask again; it never routes to onboarding.
import { dashStore } from "@domain/dash/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { enableReminders } from "../reminders"

jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))

const perms = (status: string, canAskAgain: boolean) => ({
  status,
  canAskAgain,
  granted: status === "granted",
})

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

test("asks the system and records a yes", async () => {
  const N = {
    getPermissionsAsync: jest.fn(async () => perms("undetermined", true)),
    requestPermissionsAsync: jest.fn(async () => perms("granted", false)),
  }
  const open = jest.fn(async () => {})
  await expect(enableReminders(() => N as never, open)).resolves.toBe("granted")
  expect(N.requestPermissionsAsync).toHaveBeenCalled()
  expect(dashStore.get().push.permission).toBe("granted")
  expect(open).not.toHaveBeenCalled()
})

test("when the system won't ask again, opens the app's Settings", async () => {
  const N = {
    getPermissionsAsync: jest.fn(async () => perms("denied", false)),
    requestPermissionsAsync: jest.fn(),
  }
  const open = jest.fn(async () => {})
  await expect(enableReminders(() => N as never, open)).resolves.toBe("denied")
  expect(N.requestPermissionsAsync).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalled()
  expect(dashStore.get().push.permission).toBe("denied")
})
