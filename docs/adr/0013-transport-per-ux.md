# ADR-0013: Transport per user experience

- **Date:** 2026-10-18
- **Status:** accepted
- **Deciders:** owner, tech lead

## Context

The mobile UI has four transport needs:
- AI replies that should stream.
- Long jobs: meal estimates, statement parsing and transcription.
- Social moments that should be live: messages, typing, reactions, activity.
- Reminders that must reach a closed app.

ADR-0007 already streams web chat as AG-UI over SSE.

## Decision

| Need | Transport |
|---|---|
| CRUD and reads | REST/JSON (OpenAPI contract) |
| Offline writes and catch-up | `POST /sync/push`, `GET /sync/pull` (ADR-0011) |
| Capture, companion (Fern) and advisor replies | SSE on the request: `text.delta`, `card`, `ask`, `done`, `error`. The status is resolved before the stream opens. |
| Jobs and live social | **One per-user SSE stream, `GET /events/stream`.** It is backed by Redis Streams (`events:{user}`, capped, with a 5-minute replay via `Last-Event-ID`) and sends a heartbeat every 25 s. Typing is a plain `POST`. |
| App closed | Expo push, sent from jobs through the single `push_sender` seam. Dead tokens are disabled. |
| An external system calls us | Webhook: `POST /webhooks/supabase-auth` (Supabase Auth hook, Standard Webhooks signature). |
| Media bytes | Presigned PUT/GET to object storage, so the API is never in the byte path |

SSE was chosen over WebSockets because every realtime flow runs server to client, and the client-to-server half is an ordinary authenticated POST. That keeps auth, rate limits and the error envelope on one path. Events are nudges, never the record: each one has a durable home that a client can pull, so a Redis outage only delays the update until the next refresh.

## Constitution clause deviated from

None.

## Consequences

**Positive:**
- No socket infrastructure.
- Replay after a reconnect.
- Works through proxies, because responses are unbuffered (`X-Accel-Buffering: no`).

**Negative:**
- One long-lived HTTP connection per foreground device.
- Typing indicators cost one POST each, which the client throttles.

**Follow-ups:**
- The mobile app uses `expo/fetch` streaming bodies for SSE and `expo-notifications` for push.
