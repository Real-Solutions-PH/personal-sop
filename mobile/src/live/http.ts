// The one HTTP seam for live mode. Every call carries the Supabase access
// token; a 401 refreshes the session once and retries, so a request never
// fails just because the hour-long token expired while the app slept.

import { noteServerContact } from "@/prototype/connectivity"
import { API_PREFIX, API_URL } from "./config"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export class NetworkError extends Error {}

/** A request that has not answered in this long is treated as offline. */
export const REQUEST_TIMEOUT_MS = 15_000
/** One token-refresh attempt. GoTrue retries a refresh that fails on the
 * network within a 30 s budget, then caches the failure for 60 s; at 15 s
 * an attempt that hangs (a dead socket after the app slept) used the whole
 * budget in two tries and left every request unauthorised for 90 s. */
export const AUTH_TIMEOUT_MS = 6_000

/** Run ``run`` with an abort signal that fires after ``ms``. A request that
 * times out rejects with a NetworkError ("timeout") even if the fetch
 * ignores the signal, so a captive portal or a dead route can never leave
 * a caller waiting forever. */
export function timed<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
  outer?: AbortSignal | null,
): Promise<T> {
  const ctrl = new AbortController()
  const abort = () => ctrl.abort()
  if (outer?.aborted) ctrl.abort()
  else outer?.addEventListener?.("abort", abort)
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort()
      reject(new NetworkError("timeout"))
    }, ms)
  })
  return Promise.race([run(ctrl.signal), expired]).finally(() => {
    clearTimeout(timer)
    outer?.removeEventListener?.("abort", abort)
  })
}

/** ``fetchImpl`` with a timeout (for clients that bring their own fetch). */
export function fetchWithTimeout(
  fetchImpl: typeof fetch,
  ms = REQUEST_TIMEOUT_MS,
): typeof fetch {
  return (input, init) =>
    timed(ms, (signal) => fetchImpl(input, { ...init, signal }), init?.signal)
}

export interface TokenSource {
  current(): Promise<string | null>
  refresh(): Promise<string | null>
}

const renewed = new Set<() => void>()
/** Runs ``then`` each time the session is renewed (a token refresh). */
export function onSessionRenewed(then: () => void): () => void {
  renewed.add(then)
  return () => void renewed.delete(then)
}
/** The session was renewed: whatever waited for it can go. */
export function sessionRenewed() {
  for (const then of [...renewed]) then()
}

const inFlight = new WeakMap<TokenSource, Promise<string | null>>()
/** Refresh once for everyone: the requests that all came back 401 together
 * (a burst on resume) share one refresh and replay with its token. */
export function refreshOnce(tokens: TokenSource): Promise<string | null> {
  const running = inFlight.get(tokens)
  if (running) return running
  const next = tokens.refresh().finally(() => inFlight.delete(tokens))
  inFlight.set(tokens, next)
  return next
}

/** Send with the current token; on a 401, refresh (shared) and send once
 * more with the new token. A 401 that a refresh could not fix comes back
 * as it is. */
export async function withFreshToken(
  tokens: TokenSource,
  send: (token: string | null) => Promise<Response>,
): Promise<Response> {
  const res = await send(await tokens.current())
  if (res.status !== 401) return res
  const fresh = await refreshOnce(tokens)
  return fresh ? send(fresh) : res
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface RequestOptions {
  /** Overrides REQUEST_TIMEOUT_MS (a slow server-side step, a big body). */
  timeoutMs?: number
}

export interface Http {
  request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T>
  /** Times out waiting for the response headers; the caller reads the body. */
  raw(
    path: string,
    init?: RequestInit,
    opts?: RequestOptions,
  ): Promise<Response>
}

export function createHttp(
  tokens: TokenSource,
  fetchImpl: Fetch = fetch,
): Http {
  async function send(path: string, init: RequestInit, token: string | null) {
    const headers = new Headers(init.headers)
    if (token) headers.set("Authorization", `Bearer ${token}`)
    let res: Response
    try {
      res = await fetchImpl(`${API_URL}${API_PREFIX}${path}`, {
        ...init,
        headers,
      })
    } catch (error) {
      throw new NetworkError(String(error))
    }
    noteServerContact()
    return res
  }

  function open(path: string, init: RequestInit) {
    return withFreshToken(tokens, (token) => send(path, init, token))
  }

  function raw(path: string, init: RequestInit = {}, opts?: RequestOptions) {
    return timed(
      opts?.timeoutMs ?? REQUEST_TIMEOUT_MS,
      (signal) => open(path, { ...init, signal }),
      init.signal,
    )
  }

  function request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> {
    // The timeout covers reading the body too: a response that stalls
    // halfway is as offline as one that never starts.
    return timed(opts?.timeoutMs ?? REQUEST_TIMEOUT_MS, (signal) =>
      parse<T>(
        open(path, {
          method,
          signal,
          headers:
            body === undefined
              ? undefined
              : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      ),
    )
  }

  async function parse<T>(pending: Promise<Response>): Promise<T> {
    const res = await pending
    let text: string
    try {
      text = await res.text()
    } catch (error) {
      throw new NetworkError(String(error))
    }
    const data = text ? (JSON.parse(text) as unknown) : null
    if (!res.ok) {
      const env = (data ?? {}) as {
        code?: string
        message?: string
        details?: unknown
      }
      throw new ApiError(
        res.status,
        env.code ?? `http_${res.status}`,
        env.message ?? "Request failed",
        env.details,
      )
    }
    return data as T
  }

  return { request, raw }
}
