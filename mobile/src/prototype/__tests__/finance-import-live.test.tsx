// The statement-import screens in live mode: every step goes to the server
// (fake HTTP layer), rows are matched against the user's real accounts, and
// the commit is the server's. The last test flips to prototype mode and
// checks the screens still run the local pipeline without any request.

import type { Account } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import {
  createImportClient,
  createLiveImport,
  type LiveImport,
  type WImport,
  type WRow,
} from "@/live/finance-import"
import { ApiError, type Http } from "@/live/http"
import { ImportStatement } from "../screens/finance-import"

let mockLiveMode = true
let mockImport: LiveImport
let mockParams: Record<string, string> = {}
const mockPush = jest.fn()
// A live getter: babel's object-spread helper would read a getter once, at
// mock time, so it is defined on the finished object.
jest.mock("@/live/config", () =>
  Object.defineProperty(
    { __esModule: true, ...jest.requireActual("@/live/config") },
    "liveMode",
    { get: () => mockLiveMode },
  ),
)
jest.mock("@/live/finance-import", () => ({
  ...jest.requireActual("@/live/finance-import"),
  liveImport: () => mockImport,
}))
jest.mock("expo-router", () => ({
  router: {
    push: (p: string) => mockPush(p),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => mockParams,
  usePathname: () => "/",
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
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

const USER = "11111111-1111-4111-8111-111111111111"
const BDO = "22222222-2222-4222-8222-222222222222"
const WALLET = "33333333-3333-4333-8333-333333333333"
const ROW1 = "44444444-4444-4444-8444-444444444444"
const ROW2 = "55555555-5555-4555-8555-555555555555"

type Call = { method: string; path: string; body?: unknown }
const calls: Call[] = []
let routes: Record<string, (c: Call) => unknown> = {}
const http: Http = {
  async request<T>(method: string, path: string, body?: unknown) {
    const call = { method, path, body }
    calls.push(call)
    const key = `${method} ${path.split("?")[0].replace(/[0-9a-f-]{36}/, ":id")}`
    const route = routes[key]
    if (!route) throw new ApiError(404, "not_found", key)
    return route(call) as T
  },
  raw: () => Promise.reject(new Error("unused")),
}

const account = (id: string, name: string, type: Account["type"]): Account => ({
  id,
  name,
  type,
  opening: 1000,
  openingDate: "2026-01-01",
  color: "var(--acct-blue)",
  inNetWorth: true,
  inProjection: true,
  archived: false,
  order: 0,
})
const wImport = (id: string, over: Partial<WImport> = {}): WImport => ({
  id,
  account_id: WALLET,
  file_name: "GCash_Transaction_History.csv",
  file_type: "csv",
  period_from: "2026-10-01",
  period_to: "2026-10-05",
  closing_minor: 100000,
  status: "review",
  counts: null,
  created_ids: [],
  file_kept: true,
  error_code: null,
  created_at: "2026-10-06T01:02:03Z",
  ...over,
})
const wRow = (id: string, over: Partial<WRow> = {}): WRow => ({
  id,
  position: 0,
  ref: "R1",
  on_date: "2026-10-02",
  time: "09:30",
  raw: "JOLLIBEE MAKATI",
  amount_minor: 25000,
  direction: "out",
  pending: false,
  payee: "Jollibee",
  suggested_category_id: null,
  state: "new",
  reason: null,
  match_id: null,
  confidence: 0.9,
  decision: "accept",
  category_id: null,
  is_transfer: false,
  ...over,
})

const sync = jest.fn(async () => {})
beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockLiveMode = true
  mockParams = {}
  mockPush.mockReset()
  ;(toast as unknown as jest.Mock).mockClear()
  calls.length = 0
  routes = {}
  sync.mockClear()
  mockImport = createLiveImport({
    client: createImportClient(http),
    userId: async () => USER,
    sync,
  })
  finStore.set((s) => ({
    ...s,
    accounts: [
      account(BDO, "BDO", "bank"),
      account(WALLET, "GCash", "ewallet"),
    ],
    records: [],
    imports: [],
    settings: { ...s.settings, defaultAccountId: BDO },
  }))
})

test("live: start → wrong account → use detected → review → apply commits on the server", async () => {
  let committed = false
  const serverRows = [
    wRow(ROW1),
    wRow(ROW2, {
      position: 1,
      raw: "CASH-IN VIA INSTAPAY",
      payee: "Cash-in",
      direction: "in",
      is_transfer: true,
      amount_minor: 100000,
    }),
  ]
  routes = {
    "POST /finance/imports": (c) =>
      wImport((c.body as { id: string }).id, {
        status: "parsing",
        account_id: (c.body as { account_id: string }).account_id,
      }),
    "POST /finance/imports/:id/csv": (c) => {
      const id = c.path.split("/")[3]
      // The server's layout check: a GCash export on a bank account.
      if (finStore.get().imports.find((i) => i.id === id)?.accountId === BDO)
        throw new ApiError(409, "wrong_account", "another account")
      return wImport(id)
    },
    "GET /finance/imports/:id": (c) => {
      const id = c.path.split("/")[3]
      return {
        import: wImport(
          id,
          committed
            ? {
                status: "done",
                created_ids: ["a"],
                counts: { matched: 0, created: 1, updated: 0, ignored: 1 },
              }
            : {},
        ),
        rows: serverRows,
        app_balance_minor: 0,
      }
    },
    "PATCH /finance/imports/:id/rows": (c) => {
      const ids = (c.body as { row_ids: string[] }).row_ids
      return serverRows
        .filter((r) => ids.includes(r.id))
        .map((r) => ({ ...r, decision: "accept" }))
    },
    "POST /finance/imports/:id/commit": () => {
      committed = true
      return { gap_minor: 0, created: 2, updated: 0, matched: 0, ignored: 0 }
    },
  }

  // Start: the real accounts are offered; the default (BDO) is selected.
  const start = render(<ImportStatement />, { wrapper })
  expect(screen.getByText("BDO")).toBeTruthy()
  expect(
    screen.queryByText("Prototype: pick one of these sample files."),
  ).toBeNull()
  fireEvent.press(screen.getByText("GCash_Transaction_History.csv"))
  fireEvent.press(screen.getByRole("button", { name: "Upload & read" }))
  const imp = finStore.get().imports[0]
  expect(imp).toMatchObject({ accountId: BDO, status: "parsing" })
  expect(mockPush).toHaveBeenCalledWith(`/finance/import/${imp.id}`)
  start.unmount()

  // Parsing: the server refuses the bank account; the prompt names the
  // user's own GCash account, not a demo id.
  const view = render(<ImportStatement id={imp.id} />, { wrapper })
  await screen.findByText("This looks like a different account")
  expect(screen.getByText(/the file looks like GCash\./)).toBeTruthy()
  fireEvent.press(screen.getByRole("button", { name: "Use detected account" }))
  await screen.findByText("Match with statement")
  const starts = calls.filter(
    (c) => c.method === "POST" && c.path === "/finance/imports",
  )
  expect(
    starts.map((c) => (c.body as { account_id: string }).account_id),
  ).toEqual([BDO, WALLET])

  // Review: "Accept all new" is a server row patch.
  fireEvent.press(screen.getByRole("tab", { name: "New 2" }))
  fireEvent.press(screen.getByRole("button", { name: "Accept all new" }))
  await waitFor(() =>
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
      row_ids: [ROW1, ROW2],
      decision: "accept",
    }),
  )

  // Apply: a transfer row asks for its other account, then commits there.
  fireEvent.press(screen.getByRole("button", { name: "Apply 2 changes" }))
  // The sheet mounts on its open effect.
  await screen.findByText("Transfers came from")
  expect(screen.queryByText("Use detected account")).toBeNull()
  await act(async () => {
    fireEvent.press(screen.getAllByText("BDO").at(-1) as never)
  })
  await waitFor(() =>
    expect(calls.some((c) => c.path.endsWith("/commit"))).toBe(true),
  )
  // The committed rows show on screen: no success toast.
  expect(toast).not.toHaveBeenCalledWith("Imported — 2 added, 0 updated")
  const commit = calls.find((c) => c.path.endsWith("/commit"))
  expect(commit?.body).toEqual({ transfer_account_id: BDO })
  // The records came from the server: pulled, never created on the device.
  expect(sync).toHaveBeenCalled()
  expect(finStore.get().records).toEqual([])
  await screen.findByText("GCash matched with statement")
  view.unmount()
}, 30_000)

test("live: a failed read shows the server's reason and retries on the server", async () => {
  routes = {
    "POST /finance/imports": (c) =>
      wImport((c.body as { id: string }).id, {
        status: "parsing",
        file_type: "image",
      }),
    "POST /finance/imports/:id/fail": (c) =>
      wImport(c.path.split("/")[3], {
        status: "failed",
        error_code: "unreadable",
        file_type: "image",
      }),
  }
  const start = render(<ImportStatement />, { wrapper })
  fireEvent.press(screen.getByText("IMG_5520.jpg"))
  fireEvent.press(screen.getByRole("button", { name: "Upload & read" }))
  const id = finStore.get().imports[0].id
  start.unmount()
  const view = render(<ImportStatement id={id} />, { wrapper })
  await screen.findByText("Couldn't read this statement")
  expect(screen.getByText("Couldn't read this file.")).toBeTruthy()
  fireEvent.press(screen.getByRole("button", { name: "Retry" }))
  expect(mockPush).toHaveBeenLastCalledWith(`/finance/import/${id}`)
  view.unmount()
})

test("live: an import opened by id is loaded from the server", async () => {
  const id = "66666666-6666-4666-8666-666666666666"
  routes = {
    "GET /finance/imports/:id": () => ({
      import: wImport(id, {
        status: "done",
        counts: { matched: 3, created: 2, updated: 1, ignored: 0 },
        created_ids: ["a", "b"],
      }),
      rows: [],
      app_balance_minor: 0,
    }),
    "POST /finance/imports/:id/undo": () => wImport(id, { status: "undone" }),
  }
  const view = render(<ImportStatement id={id} />, { wrapper })
  await screen.findByText("GCash matched with statement")
  const ui = require("../ui") as typeof import("../ui")
  const spy = jest
    .spyOn(ui, "confirm")
    .mockImplementation((_t, message, ok) => {
      // Matched + updated records come back on undo (the server's counts).
      expect(message).toMatch(
        /removes 2 added transactions and restores 4 edited/,
      )
      ok()
    })
  fireEvent.press(screen.getByRole("button", { name: "Undo import" }))
  await screen.findByText("Import undone")
  expect(calls.at(-1)?.path).toBe(`/finance/imports/${id}/undo`)
  spy.mockRestore()
  view.unmount()
})

test("prototype mode: the local sample pipeline runs with no request", async () => {
  mockLiveMode = false
  resetAll()
  jest.useFakeTimers()
  try {
    const start = render(<ImportStatement />, { wrapper })
    expect(
      screen.getByText("Prototype: pick one of these sample files."),
    ).toBeTruthy()
    fireEvent.press(screen.getByText("GCash_Transaction_History.pdf"))
    fireEvent.press(screen.getByRole("button", { name: "Upload & read" }))
    const imp = finStore.get().imports[0]
    expect(imp.id.startsWith("imp-")).toBe(true)
    expect(mockPush).toHaveBeenCalledWith(
      `/finance/import/${imp.id}?file=gcash-pdf`,
    )
    start.unmount()
    mockParams = { file: "gcash-pdf" }
    const view = render(<ImportStatement id={imp.id} />, { wrapper })
    act(() => void jest.advanceTimersByTime(1600))
    expect(screen.getByText("Match with statement")).toBeTruthy()
    view.unmount()
  } finally {
    jest.useRealTimers()
  }
  expect(calls).toEqual([])
})
