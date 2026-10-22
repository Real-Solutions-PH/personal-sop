import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  answerCard,
  confirmAll,
  confirmCard,
  discardCard,
  editCard,
  logQuickAdd,
  processQueue,
  redoCard,
  rerunCapture,
  retryCapture,
  sendCapture,
  skipAsk,
  undoCard,
} from "@domain/capture/actions"
import {
  type Capture,
  type CaptureState,
  type Payload as CardPayload,
  type JournalEntry,
  type RecordCard,
  seed,
} from "@domain/capture/data"
import { captureStore } from "@domain/capture/store"
import { finStore } from "@domain/finance/store"
import { derivedId } from "@domain/lib/ids"
import { configureNotifications, type ToastOptions } from "@domain/lib/platform"
import type { StorageAdapter } from "@domain/lib/store"
import { installLiveCapture, type LiveCaptureDeps } from "../capture"
import { SyncEngine } from "../engine"
import { ApiError, type Http, NetworkError } from "../http"
import type { AnyMapper } from "../mapper"
import {
  captureFromDetail,
  captureFromServer,
  captureMapper,
  captureSyncMappers,
  captureToServer,
  journalFromServer,
  journalToServer,
  type LiveCapture,
  payloadFromServer,
  payloadToServer,
  settingsFromServer,
  settingsToServer,
  streamingCaptures,
} from "../mappers/capture"
import { categoryIds } from "../mappers/finance"
import {
  base64ToBytes,
  dataUriToBytes,
  MediaRejected,
  uploadMedia,
} from "../media"
import { createOutbox, type SyncOp } from "../outbox"
import { writeWireFixture } from "./wire-format"

// The user the recorded fixture was normalised to: seeded categories in it
// carry the ids the device derives for this user.
const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"
const cats = categoryIds(USER)

// live/capture.ts imports runtime.ts (syncNow) and auth.ts; their network
// side is stubbed. The SSE parser stays real.
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
  frames?: Frame[]
  body?: Row
  detail?: Row
}
/** Real frames and rows from the FastAPI server (see the backend's
 * test_record_mobile_frames.py), ids and instants normalised. */
const REC = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "capture-recorded.json"), "utf8"),
) as Record<string, Recorded> & {
  answer: Row
  undo: Row
  redo: Row
  edit: Row
  confirm_all: Row[]
  push: { request: { ops: SyncOp[] }; response: { results: Row[] } }
  pull: { entity: string; id: string; deleted: boolean; row: Row }[]
}

/** Replace ids in recorded data (a JSON round trip; ids are unique). */
function swap<T>(value: T, ids: Record<string, string>): T {
  let text = JSON.stringify(value)
  for (const [from, to] of Object.entries(ids)) text = text.split(from).join(to)
  return JSON.parse(text) as T
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** An SSE response that hands out one chunk per read, the second frame
 * split in two so the parser's buffering is exercised. ``onRead`` runs
 * before each read (to observe the store between frames). */
function sseResponse(frames: Frame[], onRead?: (i: number) => void): Response {
  const text = frames.map(
    ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  )
  const chunks: string[] = []
  text.forEach((t, i) => {
    if (i === 1) chunks.push(t.slice(0, 20), t.slice(20))
    else chunks.push(t)
  })
  const enc = new TextEncoder()
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          onRead?.(i)
          return i < chunks.length
            ? { value: enc.encode(chunks[i++]), done: false }
            : { value: undefined, done: true }
        },
      }),
    },
    text: async () => text.join(""),
  } as unknown as Response
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    body: null,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

/** Recorded capture frames, re-addressed to the capture the device sent. */
function replayCapture(rec: Recorded, body: Row): Frame[] {
  return swap(rec.frames as Frame[], {
    [String(rec.request.id)]: String(body.id),
    [String(rec.request.client_uuid)]: String(body.client_uuid),
  })
}

type Route = Row | Row[] | ((body: unknown) => unknown)

function fakeDeps(opts: {
  online?: () => boolean
  routes?: Record<string, Route>
  post?: (path: string, body: Row) => Promise<Response>
  fetch?: LiveCaptureDeps["fetch"]
  act?: LiveCaptureDeps["act"]
}) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const kick = jest.fn()
  const http: Http = {
    request: async <T>(method: string, path: string, body?: unknown) => {
      const route = opts.routes?.[`${method} ${path}`]
      // The spend meter is read at start and after each send; tests that
      // don't route it see an empty meter, and it never counts as a call.
      if (method === "GET" && path === "/capture/settings")
        return (
          typeof route === "function"
            ? route(body)
            : (route ?? { spend_minor: 0, calls: 0 })
        ) as T
      calls.push({ method, path, body })
      if (route === undefined) throw new Error(`unexpected ${method} ${path}`)
      return (typeof route === "function" ? route(body) : route) as T
    },
    raw: async () => {
      throw new Error("unused")
    },
  }
  const post = jest.fn(
    opts.post ??
      (async () => {
        throw new Error("no stream expected")
      }),
  )
  const deps: LiveCaptureDeps = {
    http,
    post: post as LiveCaptureDeps["post"],
    fetch:
      opts.fetch ??
      (async () => {
        throw new Error("no fetch expected")
      }),
    online: opts.online ?? (() => true),
    kick,
    cats,
    ...(opts.act ? { act: opts.act } : {}),
  }
  installLiveCapture(deps)
  return { calls, kick, post, deps }
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
}

const toasts: { message: string; options?: ToastOptions }[] = []
configureNotifications((message, options) => {
  toasts.push({ message, options })
})

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

/** A sync server that answers with recorded push results and pull pages. */
class RecordedServer implements Http {
  down = true
  pushes: SyncOp[][] = []
  constructor(
    private onPush: (ops: SyncOp[]) => Row[],
    private pages: () => Row[],
  ) {}
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (this.down) throw new NetworkError("offline")
    if (method === "POST" && path === "/sync/push") {
      const ops = (body as { ops: SyncOp[] }).ops
      this.pushes.push(ops)
      return { results: this.onPush(ops) } as T
    }
    if (method === "GET" && path.startsWith("/sync/pull")) {
      const changes = this.pages()
      this.pages = () => []
      return { changes, cursor: 1, truncated: false } as T
    }
    throw new Error(`unexpected ${method} ${path}`)
  }
  async raw(): Promise<Response> {
    throw new Error("unused")
  }
}

function syncEngine(http: Http, mappers: AnyMapper[], online = () => true) {
  const storage = memoryStorage()
  return new SyncEngine({
    http,
    storage,
    outbox: createOutbox(storage),
    mappers,
    online,
  })
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

const blank = (): CaptureState => ({ ...seed(), captures: [], journal: [] })
const cap = (id: string) =>
  captureStore.get().captures.find((c) => c.id === id) as LiveCapture
const cards = (id: string) =>
  (cap(id)?.reply?.items ?? []).filter((i): i is RecordCard => i.t === "record")

beforeEach(() => {
  captureStore.set(blank())
  toasts.length = 0
})

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

const PAYLOADS: CardPayload[] = [
  {
    kind: "expense",
    amount: 165.5,
    categoryId: "coffee",
    accountId: "4c1e5a8e-6a7f-4b0e-9d2c-111111111111",
    payee: "Tim Hortons",
    note: "with Ana",
    currency: "PHP",
    fromReceipt: true,
  },
  {
    kind: "income",
    amount: 35000,
    categoryId: "salary",
    accountId: "4c1e5a8e-6a7f-4b0e-9d2c-111111111111",
    payee: "Acme",
  },
  { kind: "transfer", amount: 1200.25, from: "a-1", to: "a-2" },
  {
    kind: "planned",
    name: "Netflix",
    amount: 549,
    day: 5,
    accountId: "a-1",
    categoryId: "subscriptions",
  },
  {
    kind: "task",
    tasks: [
      {
        title: "Pay rent",
        listId: null,
        dueDate: "2026-10-30",
        dueTime: "09:00",
        remind: true,
      },
    ],
  },
  { kind: "taskComplete", taskId: "t-1", query: "rent" },
  { kind: "habitLog", habitId: "h-1", value: 20, add: true },
  {
    kind: "habitCreate",
    name: "Stretch",
    icon: "🧘",
    type: "duration",
    target: 10,
    unit: "min",
    days: [1, 3, 5],
    time: "07:00",
    logToday: true,
  },
  { kind: "routineStart", routineId: "r-1", query: "morning" },
  {
    kind: "workout",
    name: "Push day",
    exercises: [{ exercise: "Bench", sets: [{ reps: 8, weight: 60 }] }],
    cardio: { km: 5, min: 32, activity: "Run" },
    newExercises: ["Bench"],
  },
  { kind: "weighIn", kg: 72.6, prevKg: 73.1 },
  {
    kind: "meal",
    raw: "chicken inasal with rice",
    label: "lunch",
    items: [
      {
        name: "Rice",
        qty: 1,
        unit: "cup",
        kcal: 205,
        protein: 4,
        carbs: 45,
        fat: 0,
        assumption: "1 cup",
      },
    ],
    confidence: 0.84,
    fromPhoto: false,
  },
  {
    kind: "journal",
    body: "Good day",
    mood: 4,
    area: "career",
    tags: ["win"],
    transcript: "good day",
  },
  { kind: "photo", caption: "receipt" },
  { kind: "command", op: "edit", recordId: "r-9", amount: 200 },
]

test("round trip: every card payload kind survives toServer -> fromServer", () => {
  const seeded = seed().captures.flatMap((c) =>
    (c.reply?.items ?? []).filter((i): i is RecordCard => i.t === "record"),
  )
  for (const p of [...PAYLOADS, ...seeded.map((c) => c.payload)])
    expect(payloadFromServer(payloadToServer(p, cats), cats)).toEqual(p)
  // the server's names and units
  expect(payloadToServer(PAYLOADS[0], cats)).toMatchObject({
    amount_minor: 16550,
    category_id: derivedId("category", USER, "coffee"),
    account_id: "4c1e5a8e-6a7f-4b0e-9d2c-111111111111",
    from_receipt: true,
  })
  expect(payloadToServer(PAYLOADS[4], cats)).toEqual({
    kind: "task",
    tasks: [
      {
        title: "Pay rent",
        list_id: null,
        due_date: "2026-10-30",
        due_time: "09:00",
        remind: true,
      },
    ],
  })
})

test("round trip: recorded server cards read back to the payload the server sent", () => {
  const done = (REC.stream_ai.frames as Frame[]).at(-1)?.[1] as Row
  for (const c of done.cards as Row[]) {
    const local = captureFromDetail(done, cats).reply?.items.find(
      (i) => i.id === c.id,
    ) as RecordCard
    expect(payloadToServer(local.payload, cats)).toEqual(c.payload)
  }
})

test("round trip: captures, journal and settings from the prototype seed", () => {
  const s = seed()
  for (const c of s.captures) {
    const row = {
      ...captureToServer(c),
      id: c.id,
      client_uuid: c.clientUuid,
      status: c.status,
      reply_text: c.reply?.text ?? null,
      error_code: null,
      started_at: null,
    }
    const back = captureFromServer(row, c)
    for (const k of [
      "id",
      "at",
      "source",
      "text",
      "status",
      "durationSec",
      "clientUuid",
      "reply",
    ] as const)
      expect(back[k]).toEqual(c[k])
  }
  for (const j of s.journal) {
    const row = {
      ...journalToServer(j),
      id: j.id,
      created_at: j.createdAt,
      capture_id: j.captureId ?? null,
    }
    expect(journalFromServer(row)).toEqual(j)
  }
  const picked = { ...s.settings, model: "zai-org/GLM-5.3-Flash" }
  expect(settingsFromServer(settingsToServer(picked), picked)).toEqual(picked)
  expect(settingsToServer(s.settings)).toMatchObject({
    money_threshold_minor: 100000,
    spend_cap_minor: 50000,
  })
  // The prototype's demo label never reaches the server (it would refuse the
  // whole row); "" is the server default both ways.
  expect(s.settings.model).toContain(" ")
  expect(settingsToServer(s.settings).model).toBeNull()
  const fallback = { ...s.settings, model: "" }
  expect(settingsToServer(fallback).model).toBeNull()
  expect(settingsFromServer(settingsToServer(fallback), fallback)).toEqual(
    fallback,
  )
})

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

test("a reply streams into the capture frame by frame", async () => {
  const seen: { status?: string; items: number; text: string }[] = []
  let id = ""
  const { post, kick } = fakeDeps({
    post: async (_path, body) =>
      sseResponse(replayCapture(REC.stream_ai, body), () => {
        const c = cap(id)
        seen.push({
          status: c?.status,
          items: c?.reply?.items.length ?? 0,
          text: c?.reply?.text ?? "",
        })
      }),
  })
  id = sendCapture({
    text: "spent 250 on grab, remind me to pay rent on the 30th",
  })
  expect(cap(id).status).toBe("processing")
  expect(streamingCaptures.has(id)).toBe(true)
  await flush()

  const [path, body] = post.mock.calls[0]
  expect(path).toBe("/capture/stream")
  expect(body).toMatchObject({
    id,
    client_uuid: cap(id).clientUuid,
    source: "text",
    text: "spent 250 on grab, remind me to pay rent on the 30th",
  })
  // cards land one by one, then the text grows, then "done" settles it
  expect(Math.max(...seen.map((s) => s.items))).toBe(2)
  const texts = seen.map((s) => s.text).filter(Boolean)
  expect(texts.length).toBeGreaterThan(3)
  expect(texts[0].length).toBeLessThan(texts.at(-1)?.length ?? 0)
  const done = cap(id)
  expect(done.status).toBe("done")
  expect(done.reply?.text).toBe("Logged your ride and the rent reminder.")
  const [expense, task] = cards(id)
  expect(expense.payload).toMatchObject({ kind: "expense", amount: 250 })
  expect(task.payload).toMatchObject({
    kind: "task",
    tasks: [{ title: "Pay rent", dueDate: "2026-10-30", remind: true }],
  })
  expect(task.log.map((l) => l.action)).toEqual(["proposed"])
  expect(kick).toHaveBeenCalled()
})

test("auto-saved cards toast with Undo, which goes to the card endpoint", async () => {
  let ids: Record<string, string> = {}
  const done = (REC.stream_rules.frames as Frame[]).at(-1)?.[1] as Row
  const [exp, weigh] = done.cards as Row[]
  const { calls } = fakeDeps({
    post: async (_p, body) => {
      ids = {
        [String(REC.stream_rules.request.id)]: String(body.id),
        [String(REC.stream_rules.request.client_uuid)]: String(
          body.client_uuid,
        ),
      }
      return sseResponse(replayCapture(REC.stream_rules, body))
    },
    routes: {
      [`POST /capture/cards/${exp.id}/undo`]: () => swap(REC.undo, ids),
      [`POST /capture/cards/${weigh.id}/undo`]: () =>
        swap({ ...weigh, state: "undone" }, ids),
    },
  })
  const id = sendCapture({ text: "coffee 165 at tims, weighed 72.6" })
  await flush()
  expect(cap(id).reply?.text).toBe("Logged 2 things.")
  expect(cards(id).map((c) => [c.kind, c.state])).toEqual([
    ["expense", "saved"],
    ["weighIn", "saved"],
  ])
  expect(cards(id)[0].payload).toMatchObject({
    amount: 165,
    categoryId: "coffee",
    payee: "Tim Hortons",
  })
  const info = cap(id).reply?.items.find((i) => i.t === "info")
  expect(info).toMatchObject({ tone: "fallback" })
  const saved = toasts.find((t) => t.message === "Saved 2 entries")
  expect(saved?.options?.action?.label).toBe("Undo")
  saved?.options?.action?.onClick()
  await flush()
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
    `POST /capture/cards/${exp.id}/undo`,
    `POST /capture/cards/${weigh.id}/undo`,
  ])
  expect(cards(id).map((c) => c.state)).toEqual(["undone", "undone"])
})

test("an ask frame becomes a follow-up; the answer travels as the server's category id", async () => {
  let ids: Record<string, string> = {}
  const askCard = (REC.stream_ask.frames as Frame[]).find(
    ([e, d]) => e === "card" && d.t === "record",
  )?.[1] as Row
  const { calls } = fakeDeps({
    post: async (_p, body) => {
      ids = {
        [String(REC.stream_ask.request.id)]: String(body.id),
        [String(REC.stream_ask.request.client_uuid)]: String(body.client_uuid),
      }
      return sseResponse(replayCapture(REC.stream_ask, body))
    },
    routes: {
      [`POST /capture/cards/${askCard.id}/answer`]: () => swap(REC.answer, ids),
    },
  })
  const id = sendCapture({ text: "paid 1500" })
  await flush()
  const [card] = cards(id)
  expect(cap(id).status).toBe("needs_input")
  expect(card.state).toBe("needs_input")
  expect(card.ask?.field).toBe("categoryId")
  expect(card.ask?.options.map((o) => o.value)).toEqual([
    "coffee",
    "electricity",
    "internet",
    "groceries",
    "gifts",
  ])
  expect(card.payload).toMatchObject({ kind: "expense", amount: 1500 })

  answerCard(card.id, "groceries")
  await flush()
  expect(calls[0]).toEqual({
    method: "POST",
    path: `/capture/cards/${askCard.id}/answer`,
    body: { value: derivedId("category", USER, "groceries") },
  })
  const [after] = cards(id)
  expect(after.state).toBe("proposed")
  expect(after.ask).toBeUndefined()
  expect(after.payload).toMatchObject({ categoryId: "groceries" })
})

test("a refusal before the stream shows the server's failed capture", async () => {
  const rec = REC.refused
  let ids: Record<string, string> = {}
  const routes: Record<string, Route> = {}
  fakeDeps({
    post: async (_p, body) => {
      ids = {
        [String(rec.request.id)]: String(body.id),
        [String(rec.request.client_uuid)]: String(body.client_uuid),
      }
      return jsonResponse(rec.status, rec.body)
    },
    routes,
  })
  const id = sendCapture({ text: "spent 90 on jeep" })
  routes[`GET /capture/${id}`] = () => swap(rec.detail, ids)
  await flush()
  expect(cap(id).status).toBe("failed")
  expect(cap(id).error).toBe("AI is switched off (kill switch in AI settings).")
  expect(cap(id).reply?.items).toEqual([
    expect.objectContaining({ t: "info", tone: "error", title: "AI is off" }),
  ])
})

test("a dropped connection leaves the capture queued for the outbox", async () => {
  fakeDeps({
    post: async () => {
      throw new NetworkError("Network request failed")
    },
  })
  const id = sendCapture({ text: "spent 99 on jeep" })
  await flush()
  expect(cap(id).status).toBe("queued")
  expect(streamingCaptures.has(id)).toBe(false)
  expect(toasts.map((t) => t.message)).toContain(
    "Connection lost — it's queued and will send when you're back",
  )
  expect(
    captureMapper()
      .list(captureStore.get())
      .map((c) => c.id),
  ).toEqual([id])
})

test("online, an upload that can't reach storage fails with a retry, not 'when online'", async () => {
  // Seen on a phone on 2026-10-22: upload links signed for localhost could
  // not be reached, and the photo sat as "queued, will process when online"
  // while the phone was online.
  const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
  fakeDeps({
    online: () => true,
    routes: {
      "POST /media/uploads": (body) => ({
        id: (body as Row).id,
        upload_url: "http://localhost:59000/put/1",
        expires_in: 600,
        headers: {},
      }),
    },
    fetch: async () => {
      throw new NetworkError("Network request failed")
    },
  })
  const id = sendCapture({ source: "photo", photo, hint: "receipt", text: "" })
  await flush()
  expect(cap(id).status).toBe("failed")
  expect(cap(id).reply?.items).toEqual([
    expect.objectContaining({ title: "Couldn't upload the photo" }),
  ])
  expect(toasts.map((t) => t.message)).not.toContain(
    "Connection lost — it's queued and will send when you're back",
  )
})

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

test("an offline capture is queued, then replayed through sync when the connection returns", async () => {
  let online = false
  const { kick } = fakeDeps({ online: () => online })
  const id = sendCapture({ text: "spent 250 on grab" })
  expect(cap(id).status).toBe("queued")
  expect(toasts.map((t) => t.message)).toContain(
    "Queued — will process when you're back online",
  )

  const op = REC.push.request.ops[0]
  const ids = { [String(op.id)]: id }
  const server = new RecordedServer(
    (ops) =>
      ops.map((o) =>
        o.name === "capture"
          ? swap(REC.push.response.results[0], {
              ...ids,
              [String(op.op_id)]: o.op_id,
              [String((op.data as Row).client_uuid)]: String(
                o.data?.client_uuid,
              ),
            })
          : { op_id: o.op_id, status: "applied" },
      ),
    () =>
      swap(REC.pull, {
        ...ids,
        [String((op.data as Row).client_uuid)]: cap(id).clientUuid,
      }),
  )
  const e = syncEngine(server, captureSyncMappers(USER), () => online)
  const ops = e.capture()
  const upserts = ops.filter((o) => o.name === "capture")
  expect(upserts).toEqual([
    expect.objectContaining({
      name: "capture",
      id,
      data: expect.objectContaining({
        client_uuid: cap(id).clientUuid,
        source: "text",
        text: "spent 250 on grab",
      }),
    }),
  ])
  await e.sync() // offline: nothing leaves
  expect(server.pushes).toEqual([])

  online = true
  server.down = false
  expect(processQueue()).toBe(1)
  expect(kick).toHaveBeenCalled()
  await e.sync()
  expect(server.pushes[0].map((o) => o.name)).toContain("capture")
  const replayed = cap(id)
  expect(replayed.status).toBe("done")
  expect(replayed.reply?.text).toBe("Logged it.")
  const [card] = cards(id)
  expect(card).toMatchObject({
    kind: "expense",
    state: "saved",
    payload: { amount: 250, payee: "Grab" },
  })
  expect(card.log.map((l) => l.action)).toEqual(["proposed", "saved"])
  expect(replayed.reply?.items.map((i) => i.t)).toEqual(["record", "info"])
  // nothing echoes back
  expect(e.capture()).toEqual([])
})

test("a queued photo waits for its upload, then goes out with its media id", async () => {
  let online = false
  const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
  const puts: { url: string; init: RequestInit }[] = []
  const routes: Record<string, Route> = {
    "POST /media/uploads": (body) => ({
      id: (body as Row).id,
      upload_url: "https://store.example/put/1",
      expires_in: 600,
      headers: { "Content-Type": "image/jpeg" },
    }),
  }
  const { calls } = fakeDeps({
    online: () => online,
    routes,
    fetch: async (url, init) => {
      puts.push({ url, init })
      return jsonResponse(200, {})
    },
  })
  const id = sendCapture({ source: "photo", photo, hint: "receipt", text: "" })
  // The upload id is derived from the capture: a retry reuses one media row.
  const media = derivedId("capture-media", id, "0")
  routes[`POST /media/${media}/complete`] = {
    id: media,
    kind: "image",
    mime: "image/jpeg",
    state: "ready",
    url: null,
  }
  const e = syncEngine(quiet, captureSyncMappers(USER), () => false)
  expect(e.capture().filter((o) => o.name === "capture")).toEqual([])

  online = true
  expect(processQueue()).toBe(1)
  await flush()
  expect(calls.map((c) => c.path)).toEqual([
    "/media/uploads",
    `/media/${media}/complete`,
  ])
  expect(calls[0].body).toEqual({
    id: media,
    kind: "image",
    mime: "image/jpeg",
    size_bytes: 10,
  })
  expect(puts.map((p) => [p.init.method, p.url])).toEqual([
    ["PUT", "https://store.example/put/1"],
  ])
  expect(cap(id).mediaId).toBe(media)
  const [upsert] = e.capture().filter((o) => o.name === "capture")
  expect(upsert).toMatchObject({
    kind: "upsert",
    id,
    data: { source: "photo", hint: "receipt", media_id: media },
  })
})

// ---------------------------------------------------------------------------
// Card decisions
// ---------------------------------------------------------------------------

function seedRulesCapture(): { id: string; exp: Row; weigh: Row } {
  const done = (REC.stream_rules.frames as Frame[]).at(-1)?.[1] as Row
  captureStore.set((s) => ({
    ...s,
    captures: [captureFromDetail(done, cats)],
  }))
  const [exp, weigh] = done.cards as Row[]
  return { id: String(done.id), exp, weigh }
}

test("card decisions call the card endpoints and apply the server's card", async () => {
  const { id, exp, weigh } = seedRulesCapture()
  const confirmDone = (REC.stream_confirm.frames as Frame[]).at(-1)?.[1] as Row
  const proposed = (confirmDone.cards as Row[])[0]
  captureStore.set((s) => ({
    ...s,
    captures: [...s.captures, captureFromDetail(confirmDone, cats)],
  }))
  const { calls, kick } = fakeDeps({
    routes: {
      [`POST /capture/cards/${exp.id}/undo`]: REC.undo,
      [`POST /capture/cards/${exp.id}/redo`]: REC.redo,
      [`PATCH /capture/cards/${weigh.id}`]: REC.edit,
      [`POST /capture/${confirmDone.id}/confirm-all`]: REC.confirm_all,
    },
  })
  undoCard(String(exp.id))
  await flush()
  expect(cards(id)[0].state).toBe("undone")
  const undone = toasts.find((t) => t.message === "Undone")
  expect(undone?.options?.action?.label).toBe("Redo")
  undone?.options?.action?.onClick()
  await flush()
  expect(cards(id)[0].state).toBe("saved")
  expect(cards(id)[0].log.map((l) => l.action)).toEqual([
    "proposed",
    "saved",
    "undone",
    "redone",
  ])

  editCard(String(weigh.id), { kind: "weighIn", kg: 72.4 })
  await flush()
  expect(cards(id)[1]).toMatchObject({
    state: "edited",
    payload: { kind: "weighIn", kg: 72.4 },
  })

  confirmAll(String(confirmDone.id))
  await flush()
  expect(cards(String(confirmDone.id))[0].state).toBe("saved")

  expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
    ["POST", `/capture/cards/${exp.id}/undo`, undefined],
    ["POST", `/capture/cards/${exp.id}/redo`, undefined],
    [
      "PATCH",
      `/capture/cards/${weigh.id}`,
      { payload: { kind: "weighIn", kg: 72.4 } },
    ],
    ["POST", `/capture/${confirmDone.id}/confirm-all`, undefined],
  ])
  // every decision pulls the module rows it wrote
  expect(kick).toHaveBeenCalledTimes(4)
  expect(proposed.state).toBe("proposed")
})

test("confirm, discard and skip go to their endpoints; guards skip impossible moves", async () => {
  const confirmDone = (REC.stream_confirm.frames as Frame[]).at(-1)?.[1] as Row
  const card = (confirmDone.cards as Row[])[0]
  const { id: rulesId, exp } = seedRulesCapture()
  captureStore.set((s) => ({
    ...s,
    captures: [...s.captures, captureFromDetail(confirmDone, cats)],
  }))
  const capId = String(confirmDone.id)
  const { calls } = fakeDeps({
    routes: {
      [`POST /capture/cards/${card.id}/confirm`]: { ...card, state: "saved" },
      [`POST /capture/cards/${card.id}/discard`]: {
        ...card,
        state: "discarded",
      },
      [`POST /capture/cards/${card.id}/skip`]: {
        ...card,
        warn: "Skipped — waiting in History until you answer.",
      },
    },
  })
  redoCard(String(exp.id)) // saved: nothing to redo
  confirmCard(String(exp.id)) // saved: nothing to confirm
  expect(calls).toEqual([])
  confirmCard(String(card.id))
  await flush()
  expect(cards(capId)[0].state).toBe("saved")
  discardCard(String(card.id))
  await flush()
  expect(cards(capId)[0].state).toBe("discarded")
  skipAsk(String(card.id))
  await flush()
  expect(cards(capId)[0].warn).toBe(
    "Skipped — waiting in History until you answer.",
  )
  expect(calls.map((c) => c.path)).toEqual([
    `/capture/cards/${card.id}/confirm`,
    `/capture/cards/${card.id}/discard`,
    `/capture/cards/${card.id}/skip`,
  ])
  expect(cards(rulesId)[0].state).toBe("saved")
})

test("decisions offline or refused report it and change nothing", async () => {
  const { id, exp } = seedRulesCapture()
  let online = false
  const { calls } = fakeDeps({
    online: () => online,
    routes: {
      [`POST /capture/cards/${exp.id}/undo`]: () => {
        throw new ApiError(409, "card_state", "Changed since")
      },
    },
  })
  undoCard(String(exp.id))
  await flush()
  expect(calls).toEqual([])
  expect(toasts.at(-1)?.message).toBe(
    "You're offline — try again when you're connected",
  )
  online = true
  undoCard(String(exp.id))
  await flush()
  expect(toasts.at(-1)?.message).toBe("Couldn't update that. Try again.")
  expect(cards(id)[0].state).toBe("saved")
})

test("retry, re-run and quick add use their endpoints", async () => {
  const { id } = seedRulesCapture()
  const done = (REC.stream_rules.frames as Frame[]).at(-1)?.[1] as Row
  const quick = { ...done, id: "9d1c4b2a-0000-4000-8000-0000000000aa" }
  const { calls } = fakeDeps({
    routes: {
      [`POST /capture/${id}/retry`]: done,
      [`POST /capture/${id}/rerun`]: { ...done, text: "coffee 170 at tims" },
      "POST /capture/quick-add": quick,
    },
  })
  retryCapture(id)
  rerunCapture(id, "coffee 170 at tims")
  const placeholder = logQuickAdd(
    "Coffee 165",
    {
      kind: "expense",
      amount: 165,
      categoryId: "coffee",
      accountId: "4c1e5a8e-6a7f-4b0e-9d2c-111111111111",
    },
    "finance",
  )
  await flush()
  expect(placeholder.state).toBe("proposed")
  expect(cap(id).text).toBe("coffee 170 at tims")
  expect(calls[1].body).toEqual({ text: "coffee 170 at tims" })
  expect(calls[2].body).toEqual({
    client_uuid: expect.any(String),
    text: "Coffee 165",
    payload: {
      kind: "expense",
      amount_minor: 16500,
      category_id: derivedId("category", USER, "coffee"),
      account_id: "4c1e5a8e-6a7f-4b0e-9d2c-111111111111",
    },
  })
  expect(cap(quick.id)).toBeDefined()
  expect(toasts.map((t) => t.message)).toContain("Saved · Coffee 165")
})

test("offline, every decision shows at once and queues as an outbox action", () => {
  const { id, exp, weigh } = seedRulesCapture()
  const confirmDone = (REC.stream_confirm.frames as Frame[]).at(-1)?.[1] as Row
  const proposed = String((confirmDone.cards as Row[])[0].id)
  captureStore.set((s) => ({
    ...s,
    captures: [...s.captures, captureFromDetail(confirmDone, cats)],
  }))
  const capId = String(confirmDone.id)
  const act = jest.fn((_name: string, _data: Row) => true)
  const { calls } = fakeDeps({ online: () => false, act })
  // No flush: nothing waits on a response.
  confirmCard(proposed)
  expect(cards(capId)[0].state).toBe("saved")
  undoCard(String(exp.id))
  expect(cards(id)[0].state).toBe("undone")
  expect(toasts.at(-1)?.message).toBe("Undone")
  redoCard(String(exp.id))
  expect(cards(id)[0].state).toBe("saved")
  const edited = { ...cards(id)[1].payload } as CardPayload
  editCard(String(weigh.id), edited)
  expect(cards(id)[1].state).toBe("edited")
  discardCard(proposed)
  expect(cards(capId)[0].state).toBe("discarded")
  skipAsk(proposed)
  expect(cards(capId)[0].warn).toMatch(/Skipped/)
  confirmAll(capId)
  expect(act.mock.calls.map(([name, data]) => [name, data])).toEqual([
    ["capture.confirm", { card_id: proposed }],
    ["capture.undo", { card_id: String(exp.id) }],
    ["capture.redo", { card_id: String(exp.id) }],
    [
      "capture.edit",
      { card_id: String(weigh.id), payload: expect.any(Object) },
    ],
    ["capture.discard", { card_id: proposed }],
    ["capture.skip", { card_id: proposed }],
    ["capture.confirm_all", { capture_id: capId }],
  ])
  expect(calls).toEqual([])
  expect(toasts.map((t) => t.message)).not.toContain(
    "You're offline — try again when you're connected",
  )
})

test("without a running sync engine a decision calls its endpoint", async () => {
  const confirmDone = (REC.stream_confirm.frames as Frame[]).at(-1)?.[1] as Row
  const card = (confirmDone.cards as Row[])[0]
  captureStore.set((s) => ({
    ...s,
    captures: [captureFromDetail(confirmDone, cats)],
  }))
  const { calls } = fakeDeps({
    act: () => false,
    routes: {
      [`POST /capture/cards/${card.id}/confirm`]: { ...card, state: "saved" },
    },
  })
  confirmCard(String(card.id))
  await flush()
  expect(calls.map((c) => c.path)).toEqual([
    `/capture/cards/${card.id}/confirm`,
  ])
})

test("offline quick add writes straight to the module store, and undoes there", () => {
  const act = jest.fn(() => true)
  const { calls } = fakeDeps({ online: () => false, act })
  const before = finStore.get().records.length
  const saved = logQuickAdd(
    "Coffee 165",
    {
      kind: "expense",
      amount: 165,
      categoryId: "coffee",
      accountId: finStore.get().accounts[0].id,
    },
    "finance",
  )
  expect(saved.state).toBe("saved")
  const [ref] = saved.refs
  expect(finStore.get().records.map((r) => r.id)).toContain(ref)
  expect(finStore.get().records).toHaveLength(before + 1)
  expect(toasts.map((t) => t.message)).toContain("Saved · Coffee 165")
  undoCard(saved.id, true)
  expect(finStore.get().records.map((r) => r.id)).not.toContain(ref)
  expect(calls).toEqual([])
  expect(act).not.toHaveBeenCalled()
})

test("an online quick add that can't reach the server is saved here instead", async () => {
  const { calls } = fakeDeps({
    routes: {
      "POST /capture/quick-add": () => {
        throw new NetworkError("Network request failed")
      },
    },
  })
  const before = finStore.get().records.length
  logQuickAdd(
    "Lunch 250",
    {
      kind: "expense",
      amount: 250,
      categoryId: "food",
      accountId: finStore.get().accounts[0].id,
    },
    "finance",
  )
  await flush()
  expect(calls.map((c) => c.path)).toEqual(["/capture/quick-add"])
  expect(finStore.get().records).toHaveLength(before + 1)
})

// ---------------------------------------------------------------------------
// Diff behaviour
// ---------------------------------------------------------------------------

const J1 = "5b0a3f7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"
const journal = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: J1,
  day: "2026-10-18",
  createdAt: "2026-10-18T13:10:00.000Z",
  body: "Shipped the deck early.",
  source: "text",
  mood: 4,
  area: "career",
  tags: ["win"],
  private: true,
  ...over,
})

test("diff: journal create, single-field edit and delete; settings send only what changed", () => {
  const e = syncEngine(quiet, captureSyncMappers(USER), () => false)
  e.capture() // the settings singleton's first write
  captureStore.set((s) => ({ ...s, journal: [journal()] }))
  const [create] = e.capture()
  expect(create).toMatchObject({
    kind: "upsert",
    name: "journal_entry",
    id: J1,
    data: {
      day: "2026-10-18",
      body: "Shipped the deck early.",
      source: "text",
      mood: 4,
      tags: ["win"],
      private: true,
    },
  })
  captureStore.set((s) => ({ ...s, journal: [journal({ mood: 5 })] }))
  expect(e.capture().map((o) => [o.name, o.data])).toEqual([
    ["journal_entry", { mood: 5 }],
  ])
  captureStore.set((s) => ({
    ...s,
    settings: { ...s.settings, moneyThreshold: 2500 },
  }))
  expect(e.capture().map((o) => [o.name, o.data])).toEqual([
    ["ai_settings", { money_threshold_minor: 250000 }],
  ])
  captureStore.set((s) => ({ ...s, journal: [] }))
  expect(e.capture().map((o) => [o.kind, o.name, o.id])).toEqual([
    ["delete", "journal_entry", J1],
  ])
})

test("diff: server-made cards are never pushed, and a pull mid-stream never deletes the capture", () => {
  const e = syncEngine(quiet, captureSyncMappers(USER), () => false)
  e.capture()
  const { id } = seedRulesCapture()
  // the seeded capture is not in the snapshot yet: the diff sends its input
  expect(e.capture().map((o) => [o.kind, o.name])).toEqual([
    ["upsert", "capture"],
  ])
  // editing a card locally (the server owns cards) sends nothing
  captureStore.set((s) => ({
    ...s,
    captures: s.captures.map((c) => ({
      ...c,
      reply: c.reply && {
        ...c.reply,
        items: c.reply.items.map((i) => ({ ...i, warn: "x" })),
      },
    })),
  }))
  expect(e.capture()).toEqual([])

  // A capture mid-stream is left out; a pull that brings its row clears
  // the guard without a delete.
  const fresh = "1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b"
  streamingCaptures.add(fresh)
  const local: Capture = {
    id: fresh,
    at: "2026-10-19T04:00:00.000Z",
    source: "text",
    text: "coffee",
    status: "processing",
    clientUuid: "2f3e4d5c-6b7a-4899-8a0b-2c3d4e5f6a7b",
  }
  captureStore.set((s) => ({ ...s, captures: [...s.captures, local] }))
  expect(e.capture()).toEqual([])
  e.apply([
    {
      entity: "capture",
      id: fresh,
      version: 1,
      deleted: false,
      row: { ...captureToServer(local), id: fresh, status: "done" },
    },
  ])
  expect(streamingCaptures.has(fresh)).toBe(false)
  expect(e.capture()).toEqual([])
  expect(cap(fresh).status).toBe("done")
  expect(cap(id)).toBeDefined()
})

test("pulled cards before their capture wait, then fold in when it lands", () => {
  const e = syncEngine(quiet, captureSyncMappers(USER), () => false)
  const capRow = REC.pull.find((c) => c.entity === "capture")
  const early = REC.pull.filter((c) => c.entity !== "capture")
  e.apply(early as never)
  expect(captureStore.get().captures).toEqual([])
  e.apply([capRow] as never)
  const id = String(capRow?.id)
  expect(cards(id).map((c) => [c.kind, c.log.length])).toEqual([["expense", 2]])
})

// ---------------------------------------------------------------------------
// Media upload helper
// ---------------------------------------------------------------------------

test("upload helper: ticket, PUT to the presigned URL, complete", async () => {
  expect(new TextDecoder().decode(base64ToBytes("aGVsbG8gd29ybGQ="))).toBe(
    "hello world",
  )
  expect(dataUriToBytes("data:image/png;base64,iVBORw==")).toEqual({
    mime: "image/png",
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  })
  const steps: string[] = []
  const http: Http = {
    request: async <T>(method: string, path: string, body?: unknown) => {
      steps.push(`${method} ${path} ${JSON.stringify(body ?? null)}`)
      if (path === "/media/uploads")
        return {
          id: "m-1",
          upload_url: "https://store.example/u/m-1?sig=abc",
          expires_in: 600,
          headers: { "Content-Type": "image/png" },
        } as T
      return {
        id: "m-1",
        kind: "image",
        mime: "image/png",
        state: "ready",
        url: "https://store.example/d/m-1",
      } as T
    },
    raw: async () => {
      throw new Error("unused")
    },
  }
  const fetch = jest.fn(async (url: string, init: RequestInit) => {
    steps.push(`${init.method} ${url}`)
    return jsonResponse(200, {})
  })
  const out = await uploadMedia(
    { kind: "image", uri: "data:image/png;base64,iVBORw==", width: 512 },
    { http, fetch },
  )
  expect(out).toEqual({
    id: "m-1",
    kind: "image",
    mime: "image/png",
    state: "ready",
    url: "https://store.example/d/m-1",
  })
  expect(steps).toEqual([
    'POST /media/uploads {"kind":"image","mime":"image/png","size_bytes":4,"width":512}',
    "PUT https://store.example/u/m-1?sig=abc",
    "POST /media/m-1/complete null",
  ])
  const put = fetch.mock.calls[0][1]
  expect(put.headers).toEqual({ "Content-Type": "image/png" })
  expect(put.body).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
})

test("upload helper: a rejected file and a dropped PUT are told apart", async () => {
  const http = (state: string): Http => ({
    request: async <T>(_m: string, path: string) =>
      (path === "/media/uploads"
        ? { id: "m-2", upload_url: "https://s/u", expires_in: 1, headers: {} }
        : { id: "m-2", kind: "file", mime: "text/csv", state }) as T,
    raw: async () => {
      throw new Error("unused")
    },
  })
  const bytes = new TextEncoder().encode("a,b\n1,2\n")
  await expect(
    uploadMedia(
      { kind: "file", bytes, mime: "text/csv" },
      { http: http("rejected"), fetch: async () => jsonResponse(200, {}) },
    ),
  ).rejects.toBeInstanceOf(MediaRejected)
  await expect(
    uploadMedia(
      { kind: "file", bytes, mime: "text/csv" },
      {
        http: http("ready"),
        fetch: async () => {
          throw new TypeError("Network request failed")
        },
      },
    ),
  ).rejects.toBeInstanceOf(NetworkError)
  await expect(
    uploadMedia(
      { kind: "file", bytes, mime: "text/csv" },
      { http: http("ready"), fetch: async () => jsonResponse(403, {}) },
    ),
  ).rejects.toMatchObject({ code: "upload_failed", status: 403 })
})

// ---------------------------------------------------------------------------
// Wire fixture (validated by backend/tests/modules/capture/test_mobile_wire.py)
// ---------------------------------------------------------------------------

test("wire: the ops and request bodies the device sends", () => {
  const T = "2026-10-19T04:00:00.000Z"
  const e = syncEngine(quiet, captureSyncMappers(USER), () => false)
  const ids = (n: number) =>
    `6a7b8c9d-0e1f-4a2b-8c3d-${String(n).padStart(12, "0")}`
  const caps: LiveCapture[] = [
    {
      id: ids(1),
      at: T,
      source: "text",
      text: "coffee 165",
      status: "queued",
      clientUuid: ids(2),
      hint: "expense",
    },
    {
      id: ids(3),
      at: T,
      source: "voice",
      text: "ran 5k",
      transcript: "ran 5k",
      durationSec: 7,
      status: "queued",
      clientUuid: ids(4),
    },
    {
      id: ids(5),
      at: T,
      source: "photo",
      text: "",
      hint: "receipt",
      photo: "data:image/jpeg;base64,AA==",
      mediaId: ids(6),
      status: "queued",
      clientUuid: ids(7),
    },
    {
      id: ids(8),
      at: T,
      source: "file",
      text: "Statement for BPI",
      fileName: "bpi-october.csv",
      hint: ids(9),
      accountId: ids(9),
      mediaId: ids(10),
      status: "queued",
      clientUuid: ids(11),
    },
  ]
  e.capture() // settings singleton create
  captureStore.set((s) => ({ ...s, captures: caps, journal: [journal()] }))
  const ops = e.capture()
  captureStore.set((s) => ({
    ...s,
    journal: [journal({ body: "Shipped it.", tags: [] })],
    settings: { ...s.settings, aiEnabled: false, spendCap: 300 },
  }))
  ops.push(...e.capture())
  const settingsCreate = syncEngine(
    quiet,
    captureSyncMappers(USER),
    () => false,
  )
  ops.push(...settingsCreate.capture())

  const rest = [
    ...caps.map((c) => ({
      model: "CaptureIn",
      data: { id: c.id, ...captureToServer(c) },
    })),
    ...PAYLOADS.map((p) => ({
      model: "PayloadIn",
      data: { payload: payloadToServer(p, cats) },
    })),
    {
      model: "QuickAddIn",
      data: {
        client_uuid: ids(12),
        text: "Coffee 165",
        payload: payloadToServer(PAYLOADS[0], cats),
      },
    },
    {
      model: "AnswerIn",
      data: { value: derivedId("category", USER, "groceries") },
    },
    {
      model: "UploadRequest",
      data: { id: ids(13), kind: "image", mime: "image/jpeg", size_bytes: 1 },
    },
  ]
  const wire = {
    ops: ops.map(({ kind, name, id, data }) => ({ kind, name, id, data })),
    rest,
  }
  expect(wire.ops.map((o) => `${o.kind}:${o.name}`)).toEqual(
    expect.arrayContaining([
      "upsert:capture",
      "upsert:journal_entry",
      "upsert:ai_settings",
    ]),
  )
  writeWireFixture(join(__dirname, "fixtures", "capture-wire.json"), wire)
})

test("the AI spend meter comes from the server, at start and after a capture", async () => {
  // The prototype seeds demo spending; live mode must never show it.
  captureStore.set((s) => ({
    ...s,
    spend: { ...s.spend, amount: 142.6, calls: 388 },
  }))
  let calls = 0
  const { post } = fakeDeps({
    routes: {
      "GET /capture/settings": () => ({
        spend_minor: 1250 + 100 * calls++,
        calls,
      }),
    },
    post: async () => jsonResponse(402, { code: "ai_spend_cap_reached" }),
  })
  await flush()
  expect(captureStore.get().spend).toMatchObject({ amount: 12.5, calls: 1 })
  sendCapture({ text: "spent 250 on grab" })
  await flush()
  expect(post).toHaveBeenCalled()
  expect(captureStore.get().spend).toMatchObject({ amount: 13.5, calls: 2 })
})

test("several photos go up first, then one capture carries them all", async () => {
  const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
  const routes: Record<string, Route> = {
    "POST /media/uploads": (body) => ({
      id: (body as Row).id,
      upload_url: "https://store.example/put/1",
      expires_in: 600,
      headers: { "Content-Type": "image/jpeg" },
    }),
  }
  const { calls, post } = fakeDeps({
    online: () => true,
    routes,
    fetch: async () => jsonResponse(200, {}),
    post: async () => {
      throw new NetworkError("stop after the request is made")
    },
  })
  // Route every derived media id's completion before sending.
  const done = (body: unknown) => ({
    id: (body as Row | undefined)?.id,
    kind: "image",
    mime: "image/jpeg",
    state: "ready",
    url: null,
  })
  const id = sendCapture({
    source: "photo",
    photo,
    photos: [photo, photo],
    hint: "meal",
    text: "lunch",
  })
  for (const n of ["0", "1", "2"]) {
    const m = derivedId("capture-media", id, n)
    routes[`POST /media/${m}/complete`] = () => done({ id: m })
  }
  await flush()
  await flush()
  const uploads = calls.filter((c) => c.path === "/media/uploads")
  expect(uploads).toHaveLength(3)
  const [path, body] = post.mock.calls[0]
  expect(path).toBe("/capture/stream")
  expect(body).toMatchObject({
    source: "photo",
    media_id: derivedId("capture-media", id, "0"),
    extra_media_ids: [
      derivedId("capture-media", id, "1"),
      derivedId("capture-media", id, "2"),
    ],
  })
})
