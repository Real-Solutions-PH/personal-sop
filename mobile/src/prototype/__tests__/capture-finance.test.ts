import type { RecordCard } from "@domain/capture/data"
import {
  processQueue,
  redoCard,
  sendCapture,
  undoCard,
} from "@domain/capture/engine"
import { captureStore } from "@domain/capture/store"
import {
  commitImport,
  parseImport,
  startImport,
  undoImport,
} from "@domain/finance/actions"
import { finStore } from "@domain/finance/store"
import { setConnectivity } from "@domain/lib/platform"
import { configureStorage, resetAll } from "@domain/lib/store"

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  setConnectivity(true)
})
afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})
test("offline capture replays once and its finance write supports undo and redo", () => {
  setConnectivity(false)
  const before = finStore.get().records.length
  const id = sendCapture({ text: "spent 120 on coffee from gcash" })
  expect(captureStore.get().captures.find((c) => c.id === id)?.status).toBe(
    "queued",
  )
  expect(finStore.get().records).toHaveLength(before)
  setConnectivity(true)
  processQueue()
  processQueue()
  jest.runAllTimers()
  const capture = captureStore.get().captures.find((c) => c.id === id)!
  const card = capture.reply?.items.find((i) => i.t === "record") as RecordCard
  expect(card).toBeDefined()
  expect(card.state).toBe("saved")
  expect(finStore.get().records).toHaveLength(before + 1)
  undoCard(card.id)
  expect(finStore.get().records).toHaveLength(before)
  redoCard(card.id)
  expect(finStore.get().records).toHaveLength(before + 1)
})
test("statement commit is idempotent and undo restores existing records", () => {
  const original = JSON.stringify(
    [...finStore.get().records].sort((a, b) => a.id.localeCompare(b.id)),
  )
  const id = startImport("gcash", "gcash-pdf")
  expect(parseImport(id, "gcash-pdf")).toBe("ok")
  commitImport(id)
  const count = finStore.get().records.length
  commitImport(id)
  expect(finStore.get().records).toHaveLength(count)
  undoImport(id)
  expect(
    JSON.stringify(
      [...finStore.get().records].sort((a, b) => a.id.localeCompare(b.id)),
    ),
  ).toBe(original)
})
