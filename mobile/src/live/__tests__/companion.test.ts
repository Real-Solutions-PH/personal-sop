import { readFileSync } from "node:fs"
import { join } from "node:path"
import { seed as captureSeed } from "@domain/capture/data"
import { captureStore } from "@domain/capture/store"
import { derivedId } from "@domain/lib/ids"
import { configureNotifications } from "@domain/lib/platform"
import type { StorageAdapter } from "@domain/lib/store"
import { ask } from "@/prototype/companion/brain"
import {
  addTracker,
  answering,
  COMPANION_NAME,
  type CompanionState,
  companionStore,
  currentThread,
  editMemory,
  forget,
  remember,
  removeTracker,
  renameCompanion,
  retryAsk,
  thinking,
} from "@/prototype/companion/store"
import { installLiveCapture, type LiveCaptureDeps } from "../capture"
import { SyncEngine } from "../engine"
import { type Http, NetworkError } from "../http"
import {
  companionMappers,
  memoryFromServer,
  memoryToServer,
  messageFromServer,
  trackerFromServer,
  trackerToServer,
} from "../mappers/companion"
import { categoryIds } from "../mappers/finance"
import { createOutbox } from "../outbox"
import { writeWireFixture } from "./wire-format"

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }))
jest.mock("../events", () => ({
  ...jest.requireActual("../events"),
  runEventStream: () => ({ stop: async () => {} }),
}))

type Row = Record<string, unknown>
type Frame = [string, Row]
interface Recorded {
  request: Row
  status: number
  frames: Frame[]
}
const REC = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "capture-recorded.json"), "utf8"),
) as Record<string, Recorded>

function swap<T>(value: T, ids: Record<string, string>): T {
  let text = JSON.stringify(value)
  for (const [from, to] of Object.entries(ids)) text = text.split(from).join(to)
  return JSON.parse(text) as T
}

/** The whole answer: the result of the closing AG-UI ``RUN_FINISHED``. */
function finalOf(rec: Recorded): { messages: Row[]; capture?: Row } {
  const last = rec.frames.at(-1)?.[1] as Row
  return last.result as { messages: Row[]; capture?: Row }
}

/** Recorded companion frames re-addressed to the question the device asked: the
 * server derives the reply's id from the question's, so both move. */
function replayAsk(rec: Recorded, body: Row): Frame[] {
  const done = finalOf(rec)
  const sol = done.messages.find((m) => m.role === "sol")
  const meId = String(body.id)
  return swap(rec.frames, {
    [String(rec.request.id)]: meId,
    ...(sol
      ? { [String(sol.id)]: derivedId("companion-reply", meId, "sol") }
      : {}),
  })
}

function sseResponse(frames: Frame[], onRead?: () => void): Response {
  const enc = new TextEncoder()
  const chunks = frames.map(
    ([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`,
  )
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          onRead?.()
          return i < chunks.length
            ? { value: enc.encode(chunks[i++]), done: false }
            : { value: undefined, done: true }
        },
      }),
    },
    text: async () => chunks.join(""),
  } as unknown as Response
}

let reconnect: () => void = () => {}
function install(
  post: (path: string, body: Row) => Promise<Response>,
  online = () => true,
) {
  const kick = jest.fn()
  const spy = jest.fn(post)
  const deps: LiveCaptureDeps = {
    http: {
      request: async () => {
        throw new Error("no REST call expected")
      },
      raw: async () => {
        throw new Error("unused")
      },
    },
    post: spy as LiveCaptureDeps["post"],
    fetch: async () => {
      throw new Error("no fetch expected")
    },
    online,
    kick,
    cats: categoryIds(USER),
    watch: (onChange) => {
      reconnect = onChange
      return () => {}
    },
  }
  installLiveCapture(deps)
  return { post: spy, kick }
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
}
const toasts: string[] = []
configureNotifications((m) => {
  toasts.push(m)
})

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

const quiet: Http = {
  request: async <T>(method: string, path: string): Promise<T> => {
    if (method === "POST" && path === "/sync/push") return { results: [] } as T
    return { changes: [], cursor: 0, truncated: false } as T
  },
  raw: async () => {
    throw new Error("unused")
  },
}

function engine() {
  const storage = memoryStorage()
  return new SyncEngine({
    http: quiet,
    storage,
    outbox: createOutbox(storage),
    mappers: companionMappers(USER),
    online: () => false,
  })
}

const blank = (): CompanionState => ({
  name: COMPANION_NAME,
  messages: [],
  trackers: [],
  memories: [],
})

beforeEach(() => {
  companionStore.set(blank())
  captureStore.set({ ...captureSeed(), captures: [], journal: [] })
  thinking.setState({ on: false })
  toasts.length = 0
})

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

test("round trip: trackers, memories and messages", () => {
  const t = {
    id: "3c2b1a09-8f7e-4d6c-9b5a-493827160514",
    metric: "spend" as const,
    label: "Daily spending",
    goal: 1500,
    direction: "below" as const,
    createdAt: Date.parse("2026-10-14T04:00:00.000Z"),
  }
  expect(
    trackerFromServer({
      ...trackerToServer(t),
      id: t.id,
      created_at: "2026-10-14T04:00:00.000Z",
    }),
  ).toEqual(t)
  expect(trackerFromServer({ id: t.id, metric: "mood", label: "x" })).toBeNull()
  const sol = finalOf(REC.ask_reply).messages[1]
  expect(messageFromServer(sol)).toEqual({
    id: sol.id,
    role: "sol",
    at: Date.parse("2026-10-19T04:00:00.000Z"),
    text: "Here's what stands out from your records:",
    blocks: [
      { t: "insights" },
      {
        t: "chips",
        prompts: ["Coach me on this", "Show my life score this month"],
      },
    ],
  })
})

test("memories carry kind, tags, importance, always-on and source", () => {
  const row = {
    id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a",
    text: "Prefers short answers",
    kind: "response_style",
    tags: ["answers"],
    importance: 4,
    always_on: true,
    source: "inferred",
    created_at: "2026-10-14T04:00:00.000Z",
    version: 1,
  }
  const m = memoryFromServer(row)
  expect(m).toEqual({
    id: row.id,
    text: "Prefers short answers",
    at: Date.parse(row.created_at),
    kind: "response_style",
    tags: ["answers"],
    importance: 4,
    alwaysOn: true,
    source: "inferred",
  })
  expect(memoryToServer(m)).toEqual({
    text: "Prefers short answers",
    kind: "response_style",
    tags: ["answers"],
    importance: 4,
    always_on: true,
  })
  // A row from before the memory layer reads as a fact the person said.
  expect(memoryFromServer({ id: row.id, text: "x", created_at: 0 })).toEqual(
    expect.objectContaining({
      kind: "fact",
      tags: [],
      alwaysOn: false,
      source: "said",
    }),
  )
  // A kind this app does not know is kept, not folded into "fact".
  expect(memoryFromServer({ ...row, kind: "dream" }).kind).toBe("dream")
})

test("diff: rename, tracker create/edit/delete and memory create/delete", () => {
  const e = engine()
  e.capture() // the companion singleton's first write
  renameCompanion("Luna")
  expect(e.capture().map((o) => [o.name, o.data])).toEqual([
    ["companion", { name: "Luna" }],
  ])
  const tid = addTracker({
    metric: "workouts",
    label: "Workouts",
    goal: 4,
    direction: "above",
  })
  remember("Training for a 10K")
  const created = e.capture()
  expect(created.map((o) => [o.kind, o.name, o.data])).toEqual([
    [
      "upsert",
      "tracker",
      { metric: "workouts", label: "Workouts", goal: 4, direction: "above" },
    ],
    [
      "upsert",
      "memory",
      {
        text: "Training for a 10K",
        kind: "fact",
        tags: [],
        importance: 3,
        always_on: false,
      },
    ],
  ])
  addTracker({ metric: "workouts", label: "Workouts", goal: 5 })
  expect(e.capture().map((o) => [o.name, o.data])).toEqual([
    ["tracker", { goal: 5 }],
  ])
  const mid = companionStore.get().memories[0].id
  // A toggle or a retag sends only what changed.
  editMemory(mid, { alwaysOn: true, tags: ["running"] })
  expect(e.capture().map((o) => [o.name, o.id, o.data])).toEqual([
    ["memory", mid, { tags: ["running"], always_on: true }],
  ])
  removeTracker(tid)
  forget(mid)
  expect(e.capture().map((o) => [o.kind, o.name, o.id])).toEqual([
    ["delete", "tracker", tid],
    ["delete", "memory", mid],
  ])
  // messages are the server's: a local one is never pushed
  companionStore.set((s) => ({
    ...s,
    messages: [
      { id: derivedId("x", USER, "1"), role: "me", at: 1, text: "hi" },
    ],
  }))
  expect(e.capture()).toEqual([])
})

test("a pulled tracker replaces the device's tracker for the same metric", () => {
  const e = engine()
  const local = addTracker({ metric: "spend", label: "Daily spending" })
  const server = "7d6c5b4a-3928-4170-8f6e-5d4c3b2a1908"
  e.apply([
    {
      entity: "tracker",
      id: server,
      version: 3,
      deleted: false,
      row: {
        id: server,
        metric: "spend",
        label: "Daily spending",
        goal: 800,
        direction: "below",
        created_at: "2026-10-10T04:00:00.000Z",
      },
    },
  ])
  const ts = companionStore.get().trackers
  expect(ts.map((t) => [t.id, t.goal])).toEqual([[server, 800]])
  expect(ts.some((t) => t.id === local)).toBe(false)
})

// ---------------------------------------------------------------------------
// The companion's streaming ask
// ---------------------------------------------------------------------------

test("companion (rules): the question and the reply arrive as server messages", async () => {
  const { post, kick } = install(async (_p, body) =>
    sseResponse(replayAsk(REC.ask_reply, body)),
  )
  ask("how am I doing?")
  expect(thinking.getState().on).toBe(true)
  await flush()
  const [path, body] = post.mock.calls[0]
  expect(path).toBe("/companion/ask/stream")
  // Asked in the chat on screen (one was made for the first question).
  expect(body).toEqual({
    text: "how am I doing?",
    id: expect.any(String),
    thread_id: currentThread(companionStore.get()),
  })
  const msgs = companionStore.get().messages
  expect(msgs.map((m) => [m.role, m.text])).toEqual([
    ["me", "how am I doing?"],
    ["sol", "Here's what stands out from your records:"],
  ])
  expect(msgs[0].id).toBe(body.id)
  expect(msgs[1].id).toBe(derivedId("companion-reply", String(body.id), "sol"))
  expect(msgs[1].blocks?.map((b) => b.t)).toEqual(["insights", "chips"])
  expect(thinking.getState().on).toBe(false)
  expect(kick).toHaveBeenCalled()
})

test("companion (AI): steps while it works, a direct write, then the streamed text", async () => {
  const solTexts: string[] = []
  const running: string[] = []
  let solId = ""
  install(async (_p, body) => {
    solId = derivedId("companion-reply", String(body.id), "sol")
    return sseResponse(replayAsk(REC.ask_ai, body), () => {
      const sol = companionStore.get().messages.find((m) => m.id === solId)
      if (sol?.text) solTexts.push(sol.text)
      const steps = sol?.blocks?.find((b) => b.t === "steps")
      if (steps?.t === "steps")
        for (const it of steps.items) if (it.running) running.push(it.tool)
    })
  })
  ask("ran 5k today, how's my training?")
  await flush()
  const msgs = companionStore.get().messages
  expect(msgs.map((m) => m.role)).toEqual(["me", "sol"])
  const sol = msgs[1]
  expect(sol.text).toBe(
    "Nice run. Here's your month and I'll watch your sessions.",
  )
  expect(sol.blocks?.map((b) => b.t)).toEqual(["steps", "chart", "tracker"])
  const steps = sol.blocks?.[0]
  expect(steps?.t === "steps" && steps.items.map((i) => i.tool)).toEqual([
    "show_chart",
    "track",
    "log_workout",
  ])
  expect(steps?.t === "steps" && steps.items.every((i) => i.ok)).toBe(true)
  // each tool showed as running before its result arrived
  expect(running).toEqual(
    expect.arrayContaining(["show_chart", "track", "log_workout"]),
  )
  // the text grew delta by delta before the final message landed
  expect(solTexts.length).toBeGreaterThan(3)
  expect(solTexts[0].length).toBeLessThan(solTexts.at(-1)?.length ?? 0)
  // the workout was written by Fern's own tool, on the turn's chat capture
  const [cap] = captureStore.get().captures
  expect(cap.source).toBe("chat")
  expect(cap.reply?.items.filter((i) => i.t === "record")).toEqual([
    expect.objectContaining({ kind: "workout" }),
  ])
  const workout = steps?.t === "steps" ? steps.items[2] : undefined
  expect(workout?.card_id).toBe(
    cap.reply?.items.find((i) => i.t === "record")?.id,
  )
})

test("companion (rules) hands a log to capture: no messages, one capture", async () => {
  install(async (_p, body) => sseResponse(replayAsk(REC.ask_capture, body)))
  ask("spent 120 on lunch")
  await flush()
  expect(companionStore.get().messages).toEqual([])
  const [cap] = captureStore.get().captures
  expect(cap).toMatchObject({ text: "spent 120 on lunch", status: "done" })
  expect(cap.reply?.items.find((i) => i.t === "record")).toMatchObject({
    kind: "expense",
    payload: { amount: 120 },
  })
})

test("companion offline: a log is queued as a capture, a question waits in the thread", async () => {
  const { post } = install(
    async () => {
      throw new Error("no stream offline")
    },
    () => false,
  )
  ask("spent 200 on lunch")
  ask("how am I doing?")
  await flush()
  expect(post).not.toHaveBeenCalled()
  expect(captureStore.get().captures.map((c) => [c.text, c.status])).toEqual([
    ["spent 200 on lunch", "queued"],
  ])
  expect(toasts).toContain(
    `${COMPANION_NAME} will answer when you're back online.`,
  )
  expect(
    companionStore.get().messages.map((m) => [m.role, m.text, m.status]),
  ).toEqual([["me", "how am I doing?", "queued"]])
})

test("a queued question is sent on reconnect, with its id, and answered", async () => {
  let online = false
  const { post } = install(
    async (_p, body) => sseResponse(replayAsk(REC.ask_reply, body)),
    () => online,
  )
  ask("how am I doing?")
  await flush()
  const queued = companionStore.get().messages[0]
  expect(queued.status).toBe("queued")
  online = true
  reconnect()
  await flush()
  expect(post).toHaveBeenCalledTimes(1)
  expect(post.mock.calls[0][1]).toMatchObject({
    text: "how am I doing?",
    id: queued.id,
  })
  const msgs = companionStore.get().messages
  expect(msgs.map((m) => [m.role, m.status])).toEqual([
    ["me", undefined],
    ["sol", undefined],
  ])
  // a second reconnect has nothing left to send
  reconnect()
  await flush()
  expect(post).toHaveBeenCalledTimes(1)
})

test("an online question shows before the server answers", async () => {
  let answer: (r: Response) => void = () => {}
  install(
    () =>
      new Promise<Response>((done) => {
        answer = done
      }),
  )
  ask("how am I doing?")
  await flush()
  expect(
    companionStore.get().messages.map((m) => [m.role, m.text, m.status]),
  ).toEqual([["me", "how am I doing?", "sending"]])
  answer(sseResponse([]))
  await flush()
})

test("a refused ask is kept as failed and Retry sends it again", async () => {
  let refuse = true
  const { post } = install(async (_p, body) =>
    refuse
      ? ({ ok: false, status: 503 } as Response)
      : sseResponse(replayAsk(REC.ask_reply, body)),
  )
  ask("how am I doing?")
  await flush()
  const [failed] = companionStore.get().messages
  expect(failed).toMatchObject({ text: "how am I doing?", status: "failed" })
  refuse = false
  retryAsk(failed.id)
  await flush()
  expect(post).toHaveBeenCalledTimes(2)
  expect(post.mock.calls[1][1]).toMatchObject({ id: failed.id })
  expect(companionStore.get().messages.map((m) => m.status)).toEqual([
    undefined,
    undefined,
  ])
})

test("a network failure mid-ask keeps the question to retry", async () => {
  install(async () => {
    throw new NetworkError("Network request failed")
  })
  ask("how am I doing?")
  await flush()
  expect(companionStore.get().messages).toEqual([
    expect.objectContaining({ text: "how am I doing?", status: "failed" }),
  ])
})

test("a renamed companion speaks in its own name", async () => {
  companionStore.set((s) => ({ ...s, name: "Juniper" }))
  install(
    async () => {
      throw new Error("no stream offline")
    },
    () => false,
  )
  ask("how am I doing?")
  await flush()
  expect(toasts).toContain("Juniper will answer when you're back online.")
})

// ---------------------------------------------------------------------------
// Wire fixture (validated by backend/tests/modules/companion/test_mobile_wire.py)
// ---------------------------------------------------------------------------

test("wire: the companion ops and the ask body", () => {
  const e = engine()
  const ops = e.capture()
  companionStore.set({
    name: "Luna",
    messages: [],
    trackers: [
      {
        id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        metric: "spend",
        label: "Daily spending",
        goal: 1500,
        direction: "below",
        createdAt: 0,
      },
      {
        id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
        metric: "workouts",
        label: "Workouts",
        createdAt: 0,
      },
    ],
    memories: [
      {
        id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
        text: "Training for a 10K",
        at: 0,
      },
    ],
  })
  ops.push(...e.capture())
  const wire = {
    ops: ops.map(({ kind, name, id, data }) => ({ kind, name, id, data })),
    rest: [
      {
        model: "AskIn",
        data: {
          text: "how am I doing?",
          id: "4d5e6f7a-8b9c-4d0e-8f2a-3b4c5d6e7f80",
        },
      },
    ],
  }
  expect(wire.ops.map((o) => `${o.kind}:${o.name}`)).toEqual([
    "upsert:companion",
    "upsert:companion",
    "upsert:tracker",
    "upsert:tracker",
    "upsert:memory",
  ])
  writeWireFixture(join(__dirname, "fixtures", "companion-wire.json"), wire)
})

test("photos sent with a message upload first, show at once, and go as media_ids", async () => {
  const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
  const uploads: string[] = []
  const post = jest.fn(async () => ({ ok: false }) as unknown as Response)
  installLiveCapture({
    http: {
      request: async <T>(method: string, path: string, body?: unknown) => {
        if (method === "POST" && path === "/media/uploads") {
          uploads.push(String((body as Row).id))
          return {
            id: (body as Row).id,
            upload_url: "https://store.example/put",
            expires_in: 600,
            headers: {},
          } as T
        }
        const done = /^\/media\/(.+)\/complete$/.exec(path)
        if (method === "POST" && done)
          return { id: done[1], kind: "image", state: "ready", url: null } as T
        throw new Error(`unexpected ${method} ${path}`)
      },
      raw: async () => {
        throw new Error("unused")
      },
    },
    post: post as LiveCaptureDeps["post"],
    fetch: async () => new Response("{}", { status: 200 }),
    online: () => true,
    kick: jest.fn(),
    cats: categoryIds(USER),
  })
  ask("log this receipt", undefined, [photo, photo])
  const shown = companionStore.get().messages.at(-1)
  expect(shown?.role).toBe("me")
  expect(shown?.blocks).toEqual([{ t: "photos", urls: [photo, photo] }])
  await flush()
  expect(uploads).toHaveLength(2)
  const [path, body] = post.mock.calls[0] as unknown as [string, Row]
  expect(path).toBe("/companion/ask/stream")
  expect(body).toMatchObject({ text: "log this receipt", media_ids: uploads })
})

test("narration before a tool call streams, then gives way to the answer", async () => {
  const seen: string[] = []
  const writing: boolean[] = []
  let solId = ""
  install(async (_p, body) => {
    const meId = String(body.id)
    solId = derivedId("companion-reply", meId, "sol")
    const at = new Date().toISOString()
    const f = (d: Row): Frame => [String(d.type), d]
    return sseResponse(
      [
        f({
          type: "CUSTOM",
          name: "message",
          value: {
            id: meId,
            role: "me",
            text: body.text,
            blocks: [],
            created_at: at,
          },
        }),
        f({ type: "TEXT_MESSAGE_START", messageId: "a", role: "assistant" }),
        f({
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "a",
          delta: "Let me check.",
        }),
        f({ type: "TEXT_MESSAGE_END", messageId: "a" }),
        f({ type: "CUSTOM", name: "text.discard", value: { message_id: "a" } }),
        f({ type: "TEXT_MESSAGE_START", messageId: "b", role: "assistant" }),
        f({ type: "TEXT_MESSAGE_CONTENT", messageId: "b", delta: "You have " }),
        f({
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "b",
          delta: "39 g left.",
        }),
        f({ type: "TEXT_MESSAGE_END", messageId: "b" }),
      ],
      () => {
        const t = companionStore
          .get()
          .messages.find((m) => m.id === solId)?.text
        if (t) seen.push(t)
        if (t) writing.push(answering.getState().id === solId)
      },
    )
  })
  ask("how much protein is left?")
  await flush()
  // While it was written the reply was marked as still being written; once
  // the stream ended, nothing is.
  expect(writing.length).toBeGreaterThan(0)
  expect(writing.every(Boolean)).toBe(true)
  expect(answering.getState().id).toBeNull()
  // It streamed as written, then only the answer stayed.
  expect(seen).toContain("Let me check.")
  expect(seen).toContain("You have")
  const sol = companionStore.get().messages.find((m) => m.id === solId)
  expect(sol?.text).toBe("You have 39 g left.")
})
