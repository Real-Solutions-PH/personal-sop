// The Unfurl Plus paywall: loading, the offers (yearly first with its
// monthly equivalent, then monthly), a purchase that fails or is called off,
// a purchase the server confirms, a restore, and a build with no store.
import { configureStorage } from "@domain/lib/store"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native"
import type { ReactNode } from "react"
import { Linking } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { type PurchasesApi, setPurchases } from "@/live/purchases"
import { planStore, setPlanRefresher } from "../plan"
import { Plus } from "../screens/plus"
import { sessionStore } from "../session"
import { setUsageSender, usageStore } from "../usage"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/me/plan",
}))
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))

const OFFERS = [
  { id: "plus_monthly" as const, price: "$7.99", perMonth: null },
  { id: "plus_yearly" as const, price: "$49.99", perMonth: "$4.17" },
]

function fake(over: Partial<PurchasesApi> = {}): PurchasesApi {
  return {
    offers: jest.fn(async () => OFFERS),
    buy: jest.fn(async () => "bought" as const),
    restore: jest.fn(async () => true),
    ...over,
  }
}

const sent: { kind: string; detail?: string }[] = []

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  planStore.set({
    plan: "free",
    plusUntil: null,
    willRenew: false,
    productId: null,
  })
  usageStore.set({ queue: [] })
  sent.length = 0
  sessionStore.set((s) => ({
    ...s,
    signedIn: true,
    user: { name: "A", username: "a", email: "a@example.com" },
  }))
  setUsageSender(async (_path, body) => {
    for (const e of (body as { events: { kind: string; detail?: string }[] })
      .events)
      sent.push({ kind: e.kind, detail: e.detail })
  })
  setPlanRefresher(async () => ({ plan: "free", plus_until: null }))
  ;(toast.error as jest.Mock).mockClear()
})
afterEach(() => {
  setPurchases(undefined)
  setUsageSender(null)
  setPlanRefresher(null)
})

const show = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <Plus />
    </SafeAreaProvider>,
  )

const kinds = () => [
  ...sent.map((e) => e.kind),
  ...usageStore.get().queue.map((q) => q.kind),
]

test("loading, then the offers with yearly first", async () => {
  let release: (v: typeof OFFERS) => void = () => {}
  setPurchases(
    fake({
      offers: jest.fn(
        () =>
          new Promise<typeof OFFERS>((r) => {
            release = r
          }),
      ),
    }),
  )
  show()
  expect(screen.getByTestId("plus-loading")).toBeTruthy()
  await act(async () => release(OFFERS))
  const yearly = screen.getByTestId("offer-plus_yearly")
  const monthly = screen.getByTestId("offer-plus_monthly")
  expect(yearly).toBeTruthy()
  expect(monthly).toBeTruthy()
  // Yearly sits above monthly whatever order the store lists them in.
  const order = screen
    .getAllByTestId(/^offer-/)
    .map((n) => n.props.testID as string)
  expect(order).toEqual(["offer-plus_yearly", "offer-plus_monthly"])
  expect(screen.getByText("$49.99 a year")).toBeTruthy()
  expect(screen.getByText("$4.17 a month, billed yearly")).toBeTruthy()
  expect(screen.getByText("$7.99 a month")).toBeTruthy()
  expect(screen.getByLabelText("Restore purchases")).toBeTruthy()
  expect(screen.getByLabelText("Close")).toBeTruthy()
  expect(kinds()).toContain("paywall_shown")
})

test("terms and privacy open the published pages", async () => {
  setPurchases(fake())
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined)
  show()
  await screen.findByTestId("offer-plus_yearly")
  fireEvent.press(screen.getByLabelText("Terms of use"))
  fireEvent.press(screen.getByLabelText("Privacy policy"))
  expect(open).toHaveBeenCalledWith("https://unfurl.realsolutionsph.com/terms")
  expect(open).toHaveBeenCalledWith(
    "https://unfurl.realsolutionsph.com/privacy",
  )
  open.mockRestore()
})

test("a failed purchase says so and keeps the offers", async () => {
  const api = fake({
    buy: jest.fn(async () => {
      throw new Error("store said no")
    }),
  })
  setPurchases(api)
  show()
  fireEvent.press(await screen.findByTestId("offer-plus_yearly"))
  await waitFor(() => expect(toast.error).toHaveBeenCalled())
  // No claim that nothing was charged: the store can finish it later.
  expect((toast.error as jest.Mock).mock.calls[0][0]).not.toMatch(/charged\./)
  expect((toast.error as jest.Mock).mock.calls[0][0]).toMatch(
    /purchase didn.t finish/i,
  )
  expect(api.buy).toHaveBeenCalledWith("plus_yearly")
  expect(screen.getByTestId("offer-plus_monthly")).toBeTruthy()
  expect(kinds()).toContain("purchase_started")
  expect(planStore.get().plan).toBe("free")
})

test("calling the purchase off shows nothing and changes nothing", async () => {
  let settle: (v: "cancelled") => void = () => {}
  const buy = jest.fn(
    () =>
      new Promise<"cancelled">((r) => {
        settle = r
      }),
  )
  const refresher = jest.fn(async () => ({ plan: "free", plus_until: null }))
  setPlanRefresher(refresher)
  setPurchases(fake({ buy }))
  show()
  fireEvent.press(await screen.findByTestId("offer-plus_monthly"))
  expect(buy).toHaveBeenCalledWith("plus_monthly")
  const asked = refresher.mock.calls.length
  await act(async () => settle("cancelled"))
  expect(toast.error).not.toHaveBeenCalled()
  expect(screen.queryByTestId("plus-confirming")).toBeNull()
  // Nothing was bought, so the server is not asked again.
  expect(refresher.mock.calls.length).toBe(asked)
  expect(planStore.get().plan).toBe("free")
})

test("a purchase waiting on approval says so", async () => {
  setPurchases(fake({ buy: jest.fn(async () => "pending" as const) }))
  show()
  fireEvent.press(await screen.findByTestId("offer-plus_yearly"))
  expect(await screen.findByText(/waiting for approval/i)).toBeTruthy()
  expect(toast.error).not.toHaveBeenCalled()
  expect(planStore.get().plan).toBe("free")
})

test("a quick second tap does not start a second purchase", async () => {
  let settle: (v: "cancelled") => void = () => {}
  const buy = jest.fn(
    () =>
      new Promise<"cancelled">((r) => {
        settle = r
      }),
  )
  setPurchases(fake({ buy }))
  show()
  const yearly = await screen.findByTestId("offer-plus_yearly")
  const monthly = screen.getByTestId("offer-plus_monthly")
  // Both taps land before the screen re-renders as busy.
  act(() => {
    fireEvent.press(yearly)
    fireEvent.press(monthly)
  })
  expect(buy).toHaveBeenCalledTimes(1)
  await act(async () => settle("cancelled"))
})

test("a purchase shows Plus once the server confirms it", async () => {
  setPurchases(fake())
  const refresher = jest
    .fn()
    .mockResolvedValueOnce({ plan: "free", plus_until: null })
    .mockResolvedValue({
      plan: "plus",
      plus_until: "2027-11-09T00:00:00Z",
      will_renew: true,
    })
  setPlanRefresher(refresher)
  show()
  fireEvent.press(await screen.findByTestId("offer-plus_yearly"))
  expect(
    await screen.findByTestId("plus-active", {}, { timeout: 4000 }),
  ).toBeTruthy()
  expect(planStore.get().plan).toBe("plus")
  // The phone only showed Plus after the server said so.
  expect(refresher.mock.calls.length).toBeGreaterThanOrEqual(2)
})

test("restore brings Plus back and is logged", async () => {
  setPurchases(fake())
  setPlanRefresher(
    jest
      .fn()
      .mockResolvedValueOnce({ plan: "free", plus_until: null })
      .mockResolvedValue({
        plan: "plus",
        plus_until: "2027-11-09T00:00:00Z",
        will_renew: true,
      }),
  )
  show()
  await screen.findByTestId("offer-plus_yearly")
  fireEvent.press(screen.getByLabelText("Restore purchases"))
  expect(await screen.findByTestId("plus-active")).toBeTruthy()
  expect(kinds()).toContain("restored")
})

test("restore with nothing to restore says so", async () => {
  setPurchases(fake({ restore: jest.fn(async () => false) }))
  show()
  await screen.findByTestId("offer-plus_yearly")
  fireEvent.press(screen.getByLabelText("Restore purchases"))
  expect(await screen.findByText(/No Unfurl Plus purchase found/i)).toBeTruthy()
  expect(kinds()).not.toContain("restored")
  expect(planStore.get().plan).toBe("free")
})

test("offers that cannot load say so and offer a retry", async () => {
  const offers = jest
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(OFFERS)
  setPurchases(fake({ offers }))
  show()
  expect(await screen.findByTestId("plus-load-error")).toBeTruthy()
  fireEvent.press(screen.getByText("Try again"))
  expect(await screen.findByTestId("offer-plus_yearly")).toBeTruthy()
})

test("a build with no store says purchases are unavailable", async () => {
  setPurchases(null)
  show()
  expect(await screen.findByTestId("plus-unavailable")).toBeTruthy()
})

test("an account already on Plus sees its plan, not the offers", async () => {
  planStore.set({
    plan: "plus",
    plusUntil: "2099-11-09T00:00:00Z",
    willRenew: true,
    productId: "plus_yearly",
  })
  setPlanRefresher(async () => ({
    plan: "plus",
    plus_until: "2099-11-09T00:00:00Z",
    will_renew: true,
  }))
  setPurchases(fake())
  show()
  expect(await screen.findByTestId("plus-active")).toBeTruthy()
  expect(screen.getByText(/Renews/)).toBeTruthy()
  // Seeing your own plan is not a paywall view.
  expect(kinds()).not.toContain("paywall_shown")
  expect(screen.queryByTestId("offer-plus_yearly")).toBeNull()
})
