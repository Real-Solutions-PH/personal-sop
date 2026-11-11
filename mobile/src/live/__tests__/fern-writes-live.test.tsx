// What Fern records shows on the open screen at once: after its reply, after
// confirming its card, and gone again after an undo, with no refresh.
//
// Seen live 2026-11-03: the record showed only after a refresh or a page
// change. The server's pull holds back rows while an older transaction is
// open (a Fern turn, or its learning after the reply), and nothing asked for
// another pull. The reply and each card decision now carry the rows they
// wrote. Here the server's pull keeps answering "held, nothing yet", so only
// those rows can put the record on screen.
//
// The frames and rows are the real backend's, per record type
// (backend/tests/modules/sync/test_written_rows.py, RECORD_MOBILE_FIXTURES=1).

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { confirmCard, discardCard, undoCard } from "@domain/capture/engine"
import { captureStore } from "@domain/capture/store"
import { finStore } from "@domain/finance/store"
import { fitStore } from "@domain/fitness/store"
import { habitsStore } from "@domain/habits/store"
import { derivedId } from "@domain/lib/ids"
import { configureNotifications } from "@domain/lib/platform"
import type { StorageAdapter } from "@domain/lib/store"
import { tasksStore } from "@domain/tasks/store"
import { act, render, screen } from "@testing-library/react-native"
import { Text } from "react-native"
import { ask } from "@/prototype/companion/brain"
import { companionStore } from "@/prototype/companion/store"
import { installLiveCapture } from "../capture"
import { type Change, SyncEngine } from "../engine"
import type { Http } from "../http"
import type { AnyMapper } from "../mapper"
import { captureSyncMappers } from "../mappers/capture"
import { companionMappers } from "../mappers/companion"
import { categoryIds, financeMappers } from "../mappers/finance"
import { fitnessMappers } from "../mappers/fitness"
import { habitsMappers } from "../mappers/habits"
import { tasksMappers } from "../mappers/tasks"
import { createOutbox, type SyncOp } from "../outbox"

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }))
jest.mock("../events", () => ({
  ...jest.requireActual("../events"),
  runEventStream: () => ({ stop: async () => {} }),
}))

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"

type Row = Record<string, unknown>
interface Decision {
  op_id: string
  status: string
  changes: Change[]
}
interface Case {
  ask: { id: string; text: string }
  events: Row[]
  confirm?: Decision
  undo: Decision
}
const REC = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "fern-written.json"), "utf8"),
) as { seed: Change[]; cases: Record<string, Case> }

// The record type → the synced entity the screen shows it from.
const ENTITY: Record<string, string> = {
  transaction: "fin_record",
  meal: "meal",
  workout: "workout",
  habit: "habit_log",
  task: "task",
  weight: "weigh_in",
  journal: "journal_entry",
}

configureNotifications(() => {})

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

const flush = async () => {
  for (let i = 0; i < 40; i++)
    await act(() => new Promise<void>((r) => setImmediate(r)))
}

/** The finished reply's result: what ``RUN_FINISHED`` carried. */
function finished(c: Case): Row {
  const done = c.events.find((e) => e.type === "RUN_FINISHED")
  return (done?.result ?? {}) as Row
}

/** The recorded reply re-addressed to the question this device asked (the
 * server derives the reply's id from the question's). */
function replay(c: Case, meId: string): Row[] {
  const done = finished(c)
  const sol = (done.messages as Row[]).find((m) => m.role === "sol")
  let text = JSON.stringify(c.events)
  text = text.split(c.ask.id).join(meId)
  if (sol)
    text = text
      .split(String(sol.id))
      .join(derivedId("companion-reply", meId, "sol"))
  return JSON.parse(text) as Row[]
}

function sse(events: Row[]): Response {
  const enc = new TextEncoder()
  const chunks = events.map(
    (d) => `event: message\ndata: ${JSON.stringify(d)}\n\n`,
  )
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { value: enc.encode(chunks[i++]), done: false }
            : { value: undefined, done: true },
      }),
    },
    text: async () => chunks.join(""),
  } as unknown as Response
}

/** /sync as the server answers while an older transaction is still open:
 * pushes apply (a decision returns what it wrote), the pull hands out
 * nothing and says so. */
class HeldServer implements Http {
  pulls = 0
  decisions: Record<string, Decision> = {}
  pending: Change[] = []
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (path === "/sync/push") {
      const ops = (body as { ops: SyncOp[] }).ops
      return {
        results: ops.map((op) => {
          const d = op.kind === "action" ? this.decisions[op.name] : undefined
          return d
            ? { ...d, op_id: op.op_id }
            : { op_id: op.op_id, status: "applied" }
        }),
        cursor: 1,
      } as T
    }
    if (path.startsWith("/sync/pull")) {
      this.pulls++
      const changes = this.pending
      this.pending = []
      return {
        changes,
        cursor: 1,
        truncated: false,
        held: !changes.length,
      } as T
    }
    void method
    return {} as T
  }
  async raw(): Promise<Response> {
    throw new Error("unused")
  }
}

let engine: SyncEngine
let server: HeldServer
let mappers: AnyMapper[]

beforeEach(() => {
  for (const s of [
    finStore,
    fitStore,
    habitsStore,
    tasksStore,
    captureStore,
    companionStore,
  ])
    s.reset()
  server = new HeldServer()
  const storage = memoryStorage()
  mappers = [
    ...financeMappers(USER),
    ...fitnessMappers(USER),
    ...habitsMappers(USER),
    ...tasksMappers(USER),
    ...captureSyncMappers(USER),
    ...companionMappers(USER),
  ]
  engine = new SyncEngine({
    http: server,
    storage,
    outbox: createOutbox(storage),
    mappers,
    online: () => true,
    debounceMs: 0,
  })
  engine.start((m, onChange) => m.store.subscribe(onChange))
  // What the device held before Fern wrote: accounts, categories, habits.
  engine.apply(REC.seed)
})

afterEach(() => engine.stop())

function install(c: Case) {
  installLiveCapture({
    http: server,
    post: async (_path, body) => sse(replay(c, String((body as Row).id))),
    fetch: async () => {
      throw new Error("no fetch expected")
    },
    online: () => true,
    act: (name, data) => {
      engine.act(name, data)
      return true
    },
    kick: () => void engine.sync(),
    applyRows: (changes) => engine.apply(changes),
    cats: categoryIds(USER),
  })
}

/** Renders like a screen does: subscribed to the store the row lives in. */
function Shows({ entity, id }: { entity: string; id: string }) {
  const m = mappers.find((x) => x.entity === entity) as AnyMapper
  const here = m.store.use((s) =>
    m.list(s).some((r: unknown) => m.id(r) === id),
  )
  return <Text>{here ? "shown" : "absent"}</Text>
}

const finishedOf = (c: Case) => finished(c).changes as Change[]

describe.each(Object.keys(ENTITY))("%s Fern records", (kind) => {
  const c = REC.cases[kind]
  const entity = ENTITY[kind]
  const card = finishedOf(c).find((x) => x.entity === "record_card") as Change
  const written = [...finishedOf(c), ...(c.confirm?.changes ?? [])].find(
    (x) => x.entity === entity && !x.deleted,
  ) as Change

  test("shows on the open screen after the reply, the confirm and gone after the undo, with the pull held", async () => {
    server.decisions = {
      ...(c.confirm ? { "capture.confirm": c.confirm } : {}),
      "capture.undo": c.undo,
    }
    install(c)
    render(<Shows entity={entity} id={written.id} />)
    expect(screen.getByText("absent")).toBeTruthy()

    await act(async () => ask(c.ask.text))
    await flush()
    if (c.confirm) {
      // Waiting for the person's OK: nothing recorded yet.
      expect(screen.getByText("absent")).toBeTruthy()
      await act(async () => confirmCard(card.id))
      await flush()
    }
    expect(screen.getByText("shown")).toBeTruthy()

    await act(async () => undoCard(card.id))
    await flush()
    expect(screen.getByText("absent")).toBeTruthy()
    // Every pull came back held: the rows came with the answers.
    expect(server.pulls).toBeGreaterThan(0)
  })
})

/** The reply streamed up to its end, the stream still open: Fern is still
 * writing (the model's next call), so ``RUN_FINISHED`` has not come. */
function openReply(events: Row[]): { res: Response; end: () => void } {
  const enc = new TextEncoder()
  const shown = events.filter((e) => e.type !== "RUN_FINISHED")
  const rest = events.filter((e) => e.type === "RUN_FINISHED")
  const chunk = (d: Row) => `event: message\ndata: ${JSON.stringify(d)}\n\n`
  let i = 0
  let release: () => void = () => {}
  const ended = new Promise<void>((r) => {
    release = r
  })
  return {
    end: () => release(),
    res: {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (i < shown.length)
              return { value: enc.encode(chunk(shown[i++])), done: false }
            await ended
            const last = rest.shift()
            return last
              ? { value: enc.encode(chunk(last)), done: false }
              : { value: undefined, done: true }
          },
        }),
      },
      text: async () => "",
    } as unknown as Response,
  }
}

// Kai, 2026-11-12: a meal Fern logged showed as saved in the chat and
// reached the Nutrition screen only once the reply ended (1-12 s later on the
// real model). A saved record's rows now come right after its tool's result.
describe.each(
  Object.keys(ENTITY).filter((kind) => !REC.cases[kind].confirm),
)("%s Fern saves on its own", (kind) => {
  const c = REC.cases[kind]
  const entity = ENTITY[kind]
  const written = finishedOf(c).find(
    (x) => x.entity === entity && !x.deleted,
  ) as Change

  test("shows on the open screen while Fern is still writing its reply", async () => {
    let reply: ReturnType<typeof openReply> | undefined
    installLiveCapture({
      http: server,
      post: async (_path, body) => {
        reply = openReply(replay(c, String((body as Row).id)))
        return reply.res
      },
      fetch: async () => {
        throw new Error("no fetch expected")
      },
      online: () => true,
      act: (name, data) => {
        engine.act(name, data)
        return true
      },
      kick: () => void engine.sync(),
      applyRows: (changes) => engine.apply(changes),
      cats: categoryIds(USER),
    })
    render(<Shows entity={entity} id={written.id} />)
    expect(screen.getByText("absent")).toBeTruthy()

    // Not inside act: the reply is still being written, so ask() is too.
    const asking = ask(c.ask.text)
    try {
      await flush()
      expect(screen.getByText("shown")).toBeTruthy()
    } finally {
      // Ended even on a failure: a reply left open leaks into later tests.
      reply?.end()
      await act(async () => {
        await asking
      })
    }
    await flush()
    expect(screen.getByText("shown")).toBeTruthy()
  })
})

test("a discarded proposal leaves the screen as it was and the card says so", async () => {
  const c = REC.cases.meal
  const card = finishedOf(c).find((x) => x.entity === "record_card") as Change
  server.decisions = {
    "capture.discard": {
      op_id: "",
      status: "applied",
      changes: [{ ...card, row: { ...(card.row as Row), state: "discarded" } }],
    },
  }
  install(c)
  const before = fitStore.get().meals
  await act(async () => ask(c.ask.text))
  await flush()
  await act(async () => discardCard(card.id))
  await flush()
  const items = captureStore.get().captures.flatMap((x) => x.reply?.items ?? [])
  expect(items.find((i) => i.t === "record" && i.id === card.id)).toEqual(
    expect.objectContaining({ state: "discarded" }),
  )
  expect(fitStore.get().meals).toEqual(before)
})

test("a held pull is asked again until the rows arrive", async () => {
  jest.useFakeTimers()
  try {
    const c = REC.cases.task
    const task = finishedOf(c).find((x) => x.entity === "task") as Change
    await engine.sync()
    expect(server.pulls).toBe(1)
    const ids = () => tasksStore.get().tasks.map((t) => t.id)
    expect(ids()).not.toContain(task.id)
    server.pending = [task]
    await jest.advanceTimersByTimeAsync(1_000)
    expect(server.pulls).toBe(2)
    expect(ids()).toContain(task.id)
    // Nothing held any more: no further pulls of its own.
    await jest.advanceTimersByTimeAsync(30_000)
    expect(server.pulls).toBe(2)
  } finally {
    jest.useRealTimers()
  }
})
