// ┌──────────────────────────────────────────────────────────────────────┐
// │ STUB: interview answers have no backend yet.                           │
// │ Set INTERVIEW_ENDPOINT to a URL that accepts the JSON payload below    │
// │ (POST, Content-Type: application/json) and this starts sending.        │
// │ Until then it returns { sent: false } and the form says so, offering   │
// │ to copy or email the answers. It never reports a send that didn't      │
// │ happen.                                                                 │
// └──────────────────────────────────────────────────────────────────────┘

export const INTERVIEW_ENDPOINT: string | null = null

export type InterviewPayload = {
  // Kit version the ids refer to.
  kit: "2026-11-08"
  submittedAt: string
  persona: "A" | "B" | "C" | "D" | "E"
  tag?: string
  // Coded as relation "website" in the interview log: these visitors have
  // already seen the pitch, so weigh their answers accordingly.
  relation: "website"
  screener: Record<string, string | string[] | undefined>
  answers: Record<string, string>
  close: { Z1?: string; email?: string; followUpCall: boolean }
}

export async function submitInterview(
  payload: InterviewPayload,
): Promise<{ sent: boolean }> {
  if (!INTERVIEW_ENDPOINT) return { sent: false }
  const res = await fetch(INTERVIEW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Interview submit failed: ${res.status}`)
  return { sent: true }
}
