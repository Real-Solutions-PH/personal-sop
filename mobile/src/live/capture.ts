// Capture and Sol in live mode: the server reads every capture and answers
// every ask; the phone streams the reply into the same stores the screens
// already render (captureStore's ``reply`` and companionStore's messages).
//
// - Online send: POST /capture/stream (expo/fetch), SSE frames ``capture``,
//   ``text.delta``, ``card``, ``ask``, ``info``, ``done``, ``error`` patch
//   the capture as they arrive. A photo, statement or recording is uploaded
//   first (live/media.ts) and the capture carries its ``media_id``.
// - Offline send: the capture is stored ``queued``. The capture mapper puts
//   it in the sync outbox (its raw input only), and the push on reconnect
//   makes the server read it; the pull brings its cards back. A queued photo
//   or file waits for its upload (``processQueue``) before it is pushed.
// - Card decisions (confirm, discard, undo, redo, edit, answer, skip,
//   confirm all, retry, re-run, quick add) call the card endpoints and
//   apply the server's card; the rows they write in other modules arrive
//   with the next pull, which every decision triggers.
// - Sol: POST /companion/ask/stream. ``message`` is the stored question,
//   ``text.delta`` and ``block`` build the reply, and a log is a capture
//   whose own frames arrive in the middle of the stream (between its
//   ``capture`` frame and a ``done`` carrying ``client_uuid``). The final
//   ``done`` is the whole answer.
//
// The shared capture actions reach this file through ``setCaptureBackend``
// and Sol's ``ask`` through ``setAskBackend``, both installed when live mode
// starts (``captureMappers``). The web build never installs either.

import type {
  Capture,
  Payload as CardPayload,
  RecordCard,
} from "@domain/capture/data"
import {
  type CaptureBackend,
  findCard,
  type SendInput,
  setCaptureBackend,
} from "@domain/capture/engine"
import { captureStore, isOnline } from "@domain/capture/store"
import { toast } from "@domain/capture/toast"
import { derivedId, isUuid, newId } from "@domain/lib/ids"
import { fetch as expoFetch } from "expo/fetch"
import {
  type AskBackend,
  type Block,
  companionStore,
  setAskBackend,
  thinking,
} from "@/prototype/companion/store"
import { http, tokens } from "./auth"
import { API_PREFIX, API_URL } from "./config"
import { createSseParser, type ServerEvent } from "./events"
import { ApiError, type Fetch, type Http, NetworkError } from "./http"
import {
  answerToServer,
  askFromServer,
  type Cats,
  captureFromDetail,
  captureFromServer,
  captureSyncMappers,
  captureToServer,
  cardFromServer,
  errorText,
  type LiveCapture,
  payloadToServer,
  replyFromServer,
  streamingCaptures,
  withItems,
} from "./mappers/capture"
import { messageFromServer, withMessages } from "./mappers/companion"
import { categoryIds } from "./mappers/finance"
import { type UploadInput, uploadMedia } from "./media"
import { syncNow } from "./runtime"

type Row = Record<string, unknown>

export interface LiveCaptureDeps {
  /** JSON REST with the bearer token (card endpoints, media tickets). */
  http: Http
  /** POST a JSON body and return the raw (SSE) response, authenticated. */
  post(path: string, body: unknown): Promise<Response>
  /** Unauthenticated fetch: the presigned PUT and local file reads. */
  fetch: Fetch
  online(): boolean
  /** Push and pull now (the decision wrote rows in other modules). */
  kick(): void
  cats: Cats
}

const OFFLINE = "You're offline — try again when you're connected"
const S = captureStore
const nowIso = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// Store patches
// ---------------------------------------------------------------------------

const find = (id: string) => S.get().captures.find((c) => c.id === id)

function patchCapture(id: string, fn: (c: Capture) => Capture) {
  S.set((s) => ({
    ...s,
    captures: s.captures.map((c) => (c.id === id ? fn(c) : c)),
  }))
}

function putCapture(next: Capture) {
  S.set((s) => {
    const has = s.captures.some((c) => c.id === next.id)
    return {
      ...s,
      captures: has
        ? s.captures.map((c) => (c.id === next.id ? next : c))
        : [...s.captures, next],
    }
  })
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

async function readSse(res: Response, onEvent: (e: ServerEvent) => void) {
  const feed = createSseParser(onEvent)
  const body = res.body as ReadableStream<Uint8Array> | null
  if (!body?.getReader) {
    feed(await res.text())
    feed("\n\n")
    return
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    feed(decoder.decode(value, { stream: true }))
  }
  feed(`${decoder.decode()}\n\n`)
}

/** Error envelope of a refused request (``{code, message}``), if any. */
async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const env = JSON.parse(await res.text()) as { code?: string }
    return env.code
  } catch {
    return undefined
  }
}

export function createLiveCapture(deps: LiveCaptureDeps) {
  const { cats } = deps

  const detail = (d: Row) => {
    const id = String(d.id)
    putCapture(captureFromDetail(d, cats, find(id)))
  }

  const putCard = (row: Row) => {
    const capId = String(row.capture_id)
    const cur = find(capId)
    if (!cur) return
    const old = cur.reply?.items.find((i) => i.id === String(row.id))
    const card = cardFromServer(row, cats, old as RecordCard | undefined)
    patchCapture(capId, (c) => ({
      ...c,
      reply: {
        text: c.reply?.text ?? "",
        items: withItems(c.reply?.items ?? [], [card]),
      },
    }))
  }

  const putReply = (row: Row) => {
    const capId = String(row.capture_id)
    patchCapture(capId, (c) => ({
      ...c,
      reply: {
        text: c.reply?.text ?? "",
        items: withItems(c.reply?.items ?? [], [replyFromServer(row)]),
      },
    }))
  }

  /** One frame of the capture pipeline (also nested inside Sol's stream). */
  function captureFrame(type: string, data: Row, capId: string | undefined) {
    switch (type) {
      case "capture": {
        if (Array.isArray(data.cards)) return detail(data)
        const id = String(data.id)
        streamingCaptures.add(id)
        putCapture(captureFromServer(data, find(id)))
        return
      }
      case "text.delta":
        if (!capId) return
        patchCapture(capId, (c) => ({
          ...c,
          reply: {
            text: `${c.reply?.text ?? ""}${String(data.text ?? "")}`,
            items: c.reply?.items ?? [],
          },
        }))
        return
      case "card":
        return data.t === "record" ? putCard(data) : putReply(data)
      case "info":
        return putReply(data)
      case "ask": {
        const hit = findCard(String(data.card_id))
        if (!hit) return
        const ask = askFromServer(data.ask, cats)
        patchCapture(hit.cap.id, (c) => ({
          ...c,
          reply: {
            text: c.reply?.text ?? "",
            items: (c.reply?.items ?? []).map((i) =>
              i.t === "record" && i.id === hit.card.id
                ? { ...i, state: "needs_input" as const, ask }
                : i,
            ),
          },
        }))
        return
      }
      case "done":
        if ("client_uuid" in data) detail(data)
        return
      case "error":
        if (capId)
          patchCapture(capId, (c) => ({
            ...c,
            error: errorText(data.code) ?? c.error,
          }))
        return
    }
  }

  function toastSaved(capId: string) {
    const saved = (find(capId)?.reply?.items ?? []).filter(
      (i): i is RecordCard => i.t === "record" && i.state === "saved",
    )
    if (!saved.length) return
    toast.success(
      `Saved ${saved.length} entr${saved.length === 1 ? "y" : "ies"}`,
      {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            for (const r of saved) backend.undo(r.id, true)
            toast("Undone")
          },
        },
      },
    )
  }

  // -------------------------------------------------------------------------
  // Media
  // -------------------------------------------------------------------------

  /** What a capture must upload before the server can read it. */
  function mediaInput(cap: LiveCapture): UploadInput | null {
    const extra = cap as LiveCapture & {
      fileUri?: string
      fileMime?: string
      audioUri?: string
    }
    const id = derivedId("capture-media", cap.id, "0")
    if (cap.source === "photo" && cap.photo)
      return { kind: "image", uri: cap.photo, id }
    if (cap.source === "file" && extra.fileUri)
      return { kind: "file", uri: extra.fileUri, mime: extra.fileMime, id }
    if (cap.source === "voice" && extra.audioUri)
      return {
        kind: "audio",
        uri: extra.audioUri,
        id,
        durationSec: cap.durationSec,
      }
    return null
  }

  const failLocal = (id: string, title: string, body: string) =>
    patchCapture(id, (c) => ({
      ...c,
      status: "failed",
      error: title,
      reply: {
        text: "I kept your message.",
        items: [
          {
            t: "info",
            id: derivedId("capture-local-error", c.id, "0"),
            tone: "error",
            title,
            body,
            actions: [
              { label: "Quick add", do: "quickadd" },
              { label: "Save as journal", do: "journal", prompt: c.text },
            ],
          },
        ],
      },
    }))

  /** Upload the capture's media once; true when it can be sent. */
  async function ensureMedia(id: string): Promise<boolean> {
    const cap = find(id) as LiveCapture | undefined
    if (!cap) return false
    if (cap.mediaId) return true
    const input = mediaInput(cap)
    if (!input) {
      if (cap.source === "photo" || cap.source === "file") {
        failLocal(
          id,
          "Couldn't attach that file",
          "Pick the photo or file again and resend it.",
        )
        return false
      }
      return true
    }
    try {
      const m = await uploadMedia(input, deps)
      patchCapture(id, (c) => ({ ...c, mediaId: m.id }) as LiveCapture)
      return true
    } catch (error) {
      if (error instanceof NetworkError) throw error
      // A recording is optional: the transcript alone can be read.
      if (cap.source === "voice") return true
      failLocal(
        id,
        "Couldn't attach that file",
        "The server didn't accept it. Try another photo or file.",
      )
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------------

  async function refresh(id: string, code?: string) {
    try {
      detail(await deps.http.request<Row>("GET", `/capture/${id}`))
    } catch {
      failLocal(
        id,
        errorText(code) ?? "Couldn't process that",
        "Your input is kept. Retry, or log it by hand.",
      )
    }
  }

  async function streamCapture(id: string) {
    const cap = find(id)
    if (!cap) return
    let res: Response
    try {
      res = await deps.post("/capture/stream", {
        id,
        ...captureToServer(cap),
      })
    } catch (error) {
      throw error instanceof NetworkError
        ? error
        : new NetworkError(String(error))
    }
    if (!res.ok) {
      // A refusal (AI off, spend cap, no transcript) is decided before the
      // stream opens and keeps the capture "failed" with its error card.
      await refresh(id, await errorCode(res))
      return
    }
    try {
      await readSse(res, (e) => captureFrame(e.type, e.data as Row, id))
    } catch (error) {
      throw new NetworkError(String(error))
    }
    if (find(id)?.status === "processing") await refresh(id)
    toastSaved(id)
  }

  async function runSend(id: string) {
    try {
      if (await ensureMedia(id)) await streamCapture(id)
      else streamingCaptures.delete(id)
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error
      // Dropped before the server answered: keep it queued; the outbox (or
      // processQueue's upload) sends it when the connection is back.
      streamingCaptures.delete(id)
      patchCapture(id, (c) => ({ ...c, status: "queued" }))
      toast("Connection lost — it's queued and will send when you're back")
    } finally {
      deps.kick()
    }
  }

  function send(input: SendInput): string {
    const id = newId()
    const online = deps.online()
    const text = input.text.trim()
    const cap: LiveCapture & {
      fileUri?: string
      fileMime?: string
      audioUri?: string
    } = {
      id,
      at: nowIso(),
      source: input.source ?? "text",
      text,
      status: online ? "processing" : "queued",
      clientUuid: newId(),
    }
    if (input.hint) cap.hint = input.hint
    if (input.photo) cap.photo = input.photo
    if (input.durationSec !== undefined) cap.durationSec = input.durationSec
    if (input.fileName) cap.fileName = input.fileName
    if (input.fileUri) cap.fileUri = input.fileUri
    if (input.fileMime) cap.fileMime = input.fileMime
    if (input.audio) cap.audioUri = input.audio
    if (cap.source === "voice") cap.transcript = text
    if (cap.source === "file" && input.hint && isUuid(input.hint))
      cap.accountId = input.hint
    if (online) {
      cap.startedAt = cap.at
      streamingCaptures.add(id)
    }
    S.set((s) => ({ ...s, captures: [...s.captures, cap] }))
    if (online) void runSend(id)
    else toast("Queued — will process when you're back online")
    return id
  }

  // -------------------------------------------------------------------------
  // Card decisions
  // -------------------------------------------------------------------------

  async function call<T>(
    method: string,
    path: string,
    body: unknown,
    apply: (res: T) => void,
    failure = "Couldn't update that. Try again.",
  ): Promise<T | undefined> {
    if (!deps.online()) {
      toast(OFFLINE)
      return undefined
    }
    try {
      const res = await deps.http.request<T>(method, path, body)
      apply(res)
      deps.kick()
      return res
    } catch (error) {
      toast(error instanceof NetworkError ? OFFLINE : failure)
      return undefined
    }
  }

  const cardPath = (cardId: string, op?: string) =>
    `/capture/cards/${cardId}${op ? `/${op}` : ""}`

  const backend: CaptureBackend = {
    send,
    confirm(cardId) {
      if (findCard(cardId)?.card.state !== "proposed") return
      void call<Row>("POST", cardPath(cardId, "confirm"), undefined, putCard)
    },
    confirmAll(captureId) {
      void call<Row[]>(
        "POST",
        `/capture/${captureId}/confirm-all`,
        undefined,
        (rows) => {
          for (const r of rows) putCard(r)
        },
      )
    },
    discard(cardId) {
      void call<Row>("POST", cardPath(cardId, "discard"), undefined, putCard)
    },
    undo(cardId, quiet) {
      const state = findCard(cardId)?.card.state
      if (state !== "saved" && state !== "edited") return
      void call<Row>("POST", cardPath(cardId, "undo"), undefined, (row) => {
        putCard(row)
        if (!quiet && row.state === "undone")
          toast("Undone", {
            action: { label: "Redo", onClick: () => backend.redo(cardId) },
          })
      })
    },
    redo(cardId) {
      if (findCard(cardId)?.card.state !== "undone") return
      void call<Row>("POST", cardPath(cardId, "redo"), undefined, putCard)
    },
    edit(cardId, payload: CardPayload) {
      void call<Row>(
        "PATCH",
        cardPath(cardId),
        { payload: payloadToServer(payload, cats) },
        putCard,
      )
    },
    answer(cardId, value) {
      const hit = findCard(cardId)
      if (!hit?.card.ask) return
      void call<Row>(
        "POST",
        cardPath(cardId, "answer"),
        { value: answerToServer(hit.card, value, cats).slice(0, 200) },
        detail,
      )
    },
    skip(cardId) {
      void call<Row>("POST", cardPath(cardId, "skip"), undefined, putCard)
    },
    retry(id) {
      if (!deps.online()) {
        toast("Still offline — it stays queued")
        return
      }
      if (find(id)?.status === "queued") {
        backend.processQueue()
        return
      }
      void call<Row>("POST", `/capture/${id}/retry`, undefined, detail)
    },
    rerun(id, text) {
      if (text !== undefined) patchCapture(id, (c) => ({ ...c, text }))
      void call<Row>(
        "POST",
        `/capture/${id}/rerun`,
        text === undefined ? {} : { text },
        detail,
      )
    },
    processQueue() {
      const queued = S.get().captures.filter((c) => c.status === "queued")
      if (!queued.length || !deps.online()) return 0
      for (const c of queued) {
        if (!mediaInput(c as LiveCapture) || (c as LiveCapture).mediaId)
          continue
        void ensureMedia(c.id)
          .catch(() => undefined)
          .finally(() => deps.kick())
      }
      deps.kick()
      return queued.length
    },
    resumeStuck() {
      // The server re-reads stuck captures itself; a pull shows the result.
      const stale = S.get().captures.some(
        (c) =>
          c.status === "processing" &&
          !streamingCaptures.has(c.id) &&
          Date.now() - new Date(c.startedAt ?? c.at).getTime() > 60_000,
      )
      if (stale && deps.online()) deps.kick()
    },
    quickAdd(text, payload, target) {
      const card: RecordCard = {
        t: "record",
        id: newId(),
        kind: payload.kind,
        target,
        tier: "confirm",
        state: "proposed",
        payload,
        refs: [],
        log: [{ at: nowIso(), action: "proposed", actor: "user" }],
      }
      void call<Row>(
        "POST",
        "/capture/quick-add",
        {
          client_uuid: newId(),
          text: text.slice(0, 280),
          payload: payloadToServer(payload, cats),
        },
        (d) => {
          detail(d)
          const saved = ((d.cards ?? []) as Row[])[0]
          toast.success(`Saved · ${text}`, {
            duration: 5000,
            action: saved
              ? {
                  label: "Undo",
                  onClick: () => backend.undo(String(saved.id), true),
                }
              : undefined,
          })
        },
        "Couldn't save that. Try again.",
      )
      return card
    },
  }

  // -------------------------------------------------------------------------
  // Sol
  // -------------------------------------------------------------------------

  const putMessages = (ms: ReturnType<typeof messageFromServer>[]) =>
    companionStore.set((s) => ({
      ...s,
      messages: withMessages(s.messages, ms),
    }))

  async function runAsk(text: string, hint: string | undefined) {
    const meId = newId()
    const solId = derivedId("companion-reply", meId, "sol")
    let solAt = 0
    let solText = ""
    let blocks: Block[] = []
    let open: string | undefined
    const opened: string[] = []
    const sol = () => {
      thinking.setState({ on: false })
      solAt ||= Date.now()
      putMessages([
        {
          id: solId,
          role: "sol",
          at: solAt,
          ...(solText ? { text: solText } : {}),
          ...(blocks.length ? { blocks } : {}),
        },
      ])
    }
    thinking.setState({ on: true })
    try {
      const res = await deps.post("/companion/ask/stream", {
        text: text.slice(0, 4000),
        id: meId,
        ...(hint ? { hint: hint.slice(0, 20) } : {}),
      })
      if (!res.ok) {
        toast("Sol couldn't answer that. Try again.")
        return
      }
      await readSse(res, (e) => {
        const d = (e.data ?? {}) as Row
        switch (e.type) {
          case "message":
            putMessages([messageFromServer(d)])
            return
          case "text.delta":
            if (open) return captureFrame(e.type, d, open)
            solText += String(d.text ?? "")
            return sol()
          case "block":
            blocks = [...blocks, d as unknown as Block]
            return sol()
          case "capture":
            thinking.setState({ on: false })
            if (!Array.isArray(d.cards)) {
              open = String(d.id)
              opened.push(open)
            }
            return captureFrame(e.type, d, open)
          case "done":
            if ("client_uuid" in d) {
              captureFrame(e.type, d, open)
              toastSaved(String(d.id))
              open = undefined
              return
            }
            putMessages(((d.messages ?? []) as Row[]).map(messageFromServer))
            if (d.capture && typeof d.capture === "object")
              detail(d.capture as Row)
            return
          case "error":
            toast("Sol couldn't finish that reply.")
            return
          default:
            return captureFrame(e.type, d, open)
        }
      })
    } catch (error) {
      toast(
        error instanceof NetworkError || error instanceof ApiError
          ? OFFLINE
          : "Sol couldn't finish that reply.",
      )
    } finally {
      thinking.setState({ on: false })
      deps.kick()
    }
  }

  const ask: AskBackend = (text, hint, routedToCapture) => {
    if (!deps.online()) {
      if (routedToCapture) send({ text, source: "text", hint })
      else
        toast("Sol needs a connection to answer. Try again when you're online.")
      return
    }
    void runAsk(text, hint)
  }

  return { backend, ask }
}

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------

async function postStream(path: string, body: unknown): Promise<Response> {
  const send = async (token: string | null) => {
    try {
      return (await expoFetch(`${API_URL}${API_PREFIX}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })) as unknown as Response
    } catch (error) {
      throw new NetworkError(String(error))
    }
  }
  let res = await send(await tokens.current())
  if (res.status === 401) {
    const fresh = await tokens.refresh()
    if (fresh) res = await send(fresh)
  }
  return res
}

const anyFetch: Fetch = (url, init) =>
  url.startsWith("http")
    ? (expoFetch(url, init as never) as unknown as Promise<Response>)
    : fetch(url, init)

/** Install the live capture path and Sol's streaming ask. */
export function installLiveCapture(deps: LiveCaptureDeps) {
  const live = createLiveCapture(deps)
  setCaptureBackend(live.backend)
  setAskBackend(live.ask)
  return live
}

/** The capture module's mapper factory (runtime.ts). Starting live mode for
 * a user also routes the capture actions and Sol through the server. */
export function captureMappers(userId: string) {
  installLiveCapture({
    http,
    post: postStream,
    fetch: anyFetch,
    online: isOnline,
    kick: syncNow,
    cats: categoryIds(userId),
  })
  return captureSyncMappers(userId)
}
