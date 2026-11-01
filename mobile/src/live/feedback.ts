// Thumbs on Fern's replies (PUT /companion/messages/{id}/feedback). The
// server learns from a thumbs-down after Fern's next reply: the person's
// own preference is kept as a memory, and a de-identified rule may be
// proposed for every Fern (backend companion/feedback.py).

export type Rating = "up" | "down"
export type Reason = "wrong" | "too_long" | "missed" | "slow" | "other"

export type FeedbackBody = {
  rating: Rating | null
  reason?: Reason | null
  note?: string | null
}

type Http = {
  request<T>(method: string, path: string, body?: unknown): Promise<T>
}

export async function sendFeedback(
  http: Http,
  replyId: string,
  body: FeedbackBody,
): Promise<void> {
  await http.request("PUT", `/companion/messages/${replyId}/feedback`, body)
}
