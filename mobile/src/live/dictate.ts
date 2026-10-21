// Dictation for Fern's chat box (ADR-0015): a recording goes to
// POST /capture/dictate and its words come back to review and send. Nothing
// is stored on the server but the usage row.

import { tokens } from "./auth"
import { API_PREFIX, API_URL } from "./config"

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
      return "That was too long. Keep it under two minutes."
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

/** The recording at ``uri`` as text. Retries once after a token refresh;
 * any failure is a :class:`DictationError` carrying the server's code. */
export async function dictate(
  uri: string,
  durationSec: number,
): Promise<string> {
  const send = (token: string | null) => {
    // A fresh body per attempt: a sent FormData is not reusable.
    const form = new FormData()
    form.append("file", {
      uri,
      name: "dictation.m4a",
      type: "audio/mp4",
    } as unknown as Blob)
    form.append("duration_sec", String(Math.max(0, Math.round(durationSec))))
    return fetch(`${API_URL}${API_PREFIX}/capture/dictate`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
  }
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
  const body = (await res.json().catch(() => ({}))) as {
    text?: unknown
    code?: unknown
  }
  if (!res.ok || typeof body.text !== "string")
    throw new DictationError(
      typeof body.code === "string" ? body.code : "failed",
    )
  return body.text
}
