// The one HTTP seam for live mode. Every call carries the Supabase access
// token; a 401 refreshes the session once and retries, so a request never
// fails just because the hour-long token expired while the app slept.

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
    try {
      return await fetchImpl(`${API_URL}${API_PREFIX}${path}`, {
        ...init,
        headers,
      })
    } catch (error) {
      throw new NetworkError(String(error))
    }
  }

  async function open(path: string, init: RequestInit) {
    let res = await send(path, init, await tokens.current())
    if (res.status === 401) {
      const fresh = await tokens.refresh()
      if (fresh) res = await send(path, init, fresh)
    }
    return res
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
