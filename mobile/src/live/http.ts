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

export interface TokenSource {
  current(): Promise<string | null>
  refresh(): Promise<string | null>
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface Http {
  request<T>(method: string, path: string, body?: unknown): Promise<T>
  raw(path: string, init?: RequestInit): Promise<Response>
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

  async function raw(path: string, init: RequestInit = {}) {
    let res = await send(path, init, await tokens.current())
    if (res.status === 401) {
      const fresh = await tokens.refresh()
      if (fresh) res = await send(path, init, fresh)
    }
    return res
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await raw(path, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
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
