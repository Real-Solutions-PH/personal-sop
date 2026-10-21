# ADR-0015 — Fern: one streamed, multi-step chat agent

- **Date:** 2026-10-22
- **Status:** accepted
- **Deciders:** maintainers

## Context

Fern, the in-app companion, is meant to be the one place a person tells the
app what happened or what they want done. In use on 2026-10-21 it fell short
in four ways:

1. **Recording through chat was unreliable.** Fern had no domain tools of its
   own. A task request had to reach a second agent, capture, through a single
   `log_to_capture(text)` tool whose description named only things the person
   "did, spent, ate or weighed". A request to add a task often never reached a
   task tool. When it did, it cost a second model run with its own budget
   check.
2. **Nothing showed while Fern worked.** The loop allowed three model calls.
   The stream carried custom frames (`text.delta`, `block`, nested capture
   frames), so the app could show only "thinking…" and then the answer, never
   the steps or tools in between.
3. **The microphone was not dictation.** It recorded a voice capture and sent
   it to the capture pipeline, bypassing Fern. No text ever reached the chat
   box.
4. **Manual entry looked like AI capture.** "Add task" opened a free-text
   capture screen, and the composer's quick-add sheet saved through capture
   cards. A person filling in a form expects a form.

## Decision

**One agent owns the turn.** Fern is a single LangGraph agent, run in-process
by the existing `capture.agent.run_loop` graph (constitution §4.2), with the
whole tool catalogue bound directly:

- **Read tools:** `lookup`, `stats_overview`, plus the day's facts in the
  system prompt.
- **Card tools:** `show_chart`, `show_insights`, `coach`, `plan_day`, `track`,
  memories, `suggest`.
- **Write tools:** the capture catalogue (`create_tasks`, `complete_task`,
  `log_expense`, `log_habit`, `log_workout`, …), exposed to Fern directly.
  `log_to_capture` is removed.

Every write still goes through the capture card layer. Each turn owns one
capture row (source `chat`), so a write is a card with its tier (auto or
confirm) and Undo. The `confirm` tier applies to deletes and edits, which
meets §AppSec "destructive tools require human confirmation". Tools keep
typed schemas.

**Several steps per turn.** Up to 6 model calls and 20 tool calls per turn.
Tool calls run one at a time, because they share the request's database
session.

**AG-UI events over SSE.** `POST /companion/ask/stream` streams AG-UI events
(§4.2 chat transport, ADR-0007), encoded with `ag_ui.encoder.EventEncoder`:

| Event | Carries |
|---|---|
| `RUN_STARTED` / `RUN_FINISHED` | Thread and run ids; the finish carries the stored messages |
| `STEP_STARTED` / `STEP_FINISHED` | One per model call (`think`) and per tool (`tool:<name>`) |
| `TEXT_MESSAGE_START` / `_CONTENT` / `_END` | The reply as it streams |
| `TOOL_CALL_START` / `_ARGS` / `_END` | Each tool call and its arguments |
| `TOOL_CALL_RESULT` | A one-line, human-readable outcome ("Added task: Buy milk, tomorrow 17:00") |
| `CUSTOM` `block` / `card` | A card to render (chart, plan, a saved record with Undo) |
| `RUN_ERROR` | A failure after the stream opened |

The model, AI switch and spend cap are resolved **before** the stream opens:
a refusal is an HTTP error, never an empty stream (G-C-012). The reply
message stores its steps (a `steps` block), so reopening the chat shows what
Fern did.

**Dictation through server speech-to-text.** The microphone records, uploads
to `POST /ai/transcribe`, and puts the transcript in the chat box for the
person to review and send (§4.2 voice flow: record, then server STT). The STT
seam uses **Deepgram** (§4.2 STT default) when `DEEPGRAM_API_KEY` is set,
otherwise the person's own OpenAI-compatible transcription credential.
Without either, it refuses with `speech_unavailable`. Usage is metered in
`ai_usage`.

**Manual entry is manual.** "Add task" opens a task form (title, notes, list,
due date and time, reminder, repeat) that creates the task directly. The
free-text task capture screen is removed: free text belongs to Fern. The
composer keeps its "+" quick-add sheet, the typed forms for recording each
kind of record (amended 2026-10-22 at the owner's request).

**What this excludes:**
- Parallel tool execution.
- Model "reasoning" streams. AG-UI `REASONING_*` is not emitted, because the
  served models do not expose it.
- On-device speech recognition.
- Changes to photo and statement capture, which keep `/capture/stream`.

## Constitution clause deviated from

None. This implements §4.2 (LangGraph in-process, AG-UI over SSE, record then
server STT with Deepgram as the default) and §AppSec (typed, allowlisted tools;
confirmation for destructive writes).

## Consequences

**Positive:**
- A task request reaches `create_tasks` in one model run, and the person sees
  each step as it happens.
- One budget check and one metered run per turn, instead of two.
- Dictation fills the chat box, so Fern always answers what was said.

**Negative:**
- The stream format changes. The app and server must ship together, and older
  app builds lose streaming (the final `RUN_FINISHED` still carries the
  answer).
- Dictation needs an STT key (`DEEPGRAM_API_KEY`) in the server environment.

**Follow-ups:**
- Move the web chat (ADR-0007's CopilotKit routes) onto the same Fern agent.
