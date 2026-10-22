// Dictation for Fern's chat box (ADR-0015): a recording goes to
// POST /capture/dictate and its words come back to review and send. Nothing
// is stored on the server but the usage row.

import { tokens } from "./auth"
import { API_PREFIX, API_URL } from "./config"
import { timed } from "./http"

/** Up to ten minutes of audio is uploaded and transcribed in one request. */
export const DICTATE_TIMEOUT_MS = 120_000

export class DictationError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

/** What the person reads when dictation fails, by the server's code. */
export function dictationMessage(code: string): string {
  switch (code) {
    case "speech_unavailable":
      return "Voice input isn't set up yet. Type your message instead."
    case "transcript_empty":
      return "I couldn't hear anything. Try again, a little closer."
    case "audio_too_long":
    case "audio_too_large":
      return "That was too long. Keep it under five minutes."
    case "ai_disabled":
      return "AI is off in your settings, so voice input is too."
    case "spend_cap_reached":
      return "You've reached this month's AI limit."
    case "network":
      return "Couldn't reach the server. Check your connection and try again."
    default:
      return "Couldn't turn that into text. Try again."
  }
}

/** The recording at ``uri`` as text. Its bytes go up as the raw body (as
 * media uploads do; a React Native file object in a FormData does not
 * survive Expo's fetch). Retries once after a token refresh; any failure
 * is a :class:`DictationError` carrying the server's code. */
export async function dictate(
  uri: string,
  durationSec: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let audio: ArrayBuffer
  try {
    audio = await (await fetchImpl(uri)).arrayBuffer()
  } catch {
    throw new DictationError("unreadable")
  }
  const url = `${API_URL}${API_PREFIX}/capture/dictate?duration_sec=${Math.max(0, Math.round(durationSec))}`
  const send = (token: string | null) =>
    timed(DICTATE_TIMEOUT_MS, (signal) =>
      fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: new Uint8Array(audio) as unknown as BodyInit,
        signal,
      }),
    )
  let res: Response
  try {
    res = await send(await tokens.current())
    if (res.status === 401) {
      const fresh = await tokens.refresh()
      if (fresh) res = await send(fresh)
    }
  } catch {
    throw new DictationError("network")
  }
  const body = (await timed(DICTATE_TIMEOUT_MS, () => res.json()).catch(
    () => ({}),
  )) as {
    text?: unknown
    code?: unknown
  }
  if (!res.ok || typeof body.text !== "string")
    throw new DictationError(
      typeof body.code === "string" ? body.code : "failed",
    )
  return body.text
}
