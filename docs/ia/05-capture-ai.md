# M5 Capture & AI — IA

Date: 2026-09-26 · Status: draft for review · Source: [00-intake.md](00-intake.md) (cited as `I:<line>`).
Existing plumbing reused: AI chat module ([22-ai-module.md](../22-ai-module.md)), AG-UI over SSE ([ADR-0007](../adr/0007-chat-transport-ag-ui.md)), OpenRouter provider.

**Core decisions (summary)**

- One rolling **Capture thread** is the whole interface: type / speak / snap → AI proposes **record cards** → confirm, edit, or undo. Questions and coaching happen in the same thread.
- **Trust model, three tiers:** (A) **auto-save with undo** for simple, complete, low-stakes logs; (B) **confirm** for money-heavy, bulk, destructive, or new-structure changes; (C) **ask a follow-up** only when a *required* field is missing and can't be defaulted. Every write, whatever its tier, can be undone from its card or from history.
- **Journal** entries are owned by M5 (captured mostly by voice/text) and read from Me and Stats. Ambiguity logged (OQ-CAP-4).
- **Built-in AI (OpenRouter) is v1.** The **Claude connector (MCP server)** is designed here but is optional for v1 (OQ-CAP-2).
- The quick-add sheet is the manual fallback. It hosts minimal forms that each module owns.

---

## 1. Jobs to be done

- Log anything by typing or saying loose context, with no forms (I:17-21, I:62).
- Put one message's several facts into the right modules without splitting them myself (I:19, I:62).
- Log on the go by voice or photo: meals with no labels, receipts, gym boards (I:20, I:47-48, I:62).
- Get asked only for what's actually missing, and no more (I:19-20).
- Trust that the AI saved the right thing, and fix mistakes in one tap (C1 low effort + data quality for C2 stats, I:17, I:22-24).
- Drop in a statement screenshot or file and have it go to finance reconciliation (I:53-54).
- Ask questions of my own data and get light coaching. Deep finance advice links out to M4 (I:57-59, I:22-23).
- Journal by voice or text, as a named life area (I:66-67).
- Capture with no signal and have it processed later (I:76).
- Optionally use my own Claude app against my data, since that's the habit I already have (I:19, I:47-48).
- Fall back to a fast manual entry when AI is down or I want precision (I:80-84 "quick-add sheet").

## 2. Entities

| Entity | Key fields | Notes |
|---|---|---|
| **Capture** | id, created_at (device time), source (`text`/`voice`/`photo`/`quick_add`/`connector`), raw_text, transcript, status (`queued`/`processing`/`needs_input`/`proposed`/`done`/`failed`), thread_id, client_uuid | One user input. `client_uuid` makes offline replay idempotent. Kept after processing for audit and re-run. |
| **CaptureAttachment** | id, capture_id, kind (`image`/`audio`/`file`), mime, size, storage_key, photo_hint (`auto`/`meal`/`receipt`/`label`/`statement`/`whiteboard`) | Audio retention is an open question (OQ-CAP-7). |
| **Thread** | id, started_at, title?, last_message_at | Default is one rolling thread with day separators (OQ-CAP-8). Maps to the existing AG-UI conversation. |
| **Message** | id, thread_id, role (`user`/`assistant`), capture_id?, content, cards[] | Assistant messages carry record cards, follow-up cards, or answer cards. |
| **ProposedRecord** | id, capture_id, target_module, target_entity, action (`create`/`update`/`complete`/`delete`), payload (JSON), confidence, tier (`auto`/`confirm`/`ask`), missing_fields[], state (`proposed`/`saved`/`edited`/`discarded`/`undone`), saved_record_ref | This is the "record card". One capture can have N of these. |
| **WriteLog** | id, proposed_record_id?, actor (`ai`/`user`/`connector`), entity_ref, before (JSON), after (JSON), at, undone_at | Makes undo and redo possible for every AI or connector write. Kept for 30 days by default (OQ-CAP-9). |
| **JournalEntry** | id, entry_date, created_at, body, source (`voice`/`text`), capture_id?, mood? (1-5), tags[], area? (e.g. `identity`, `career`), private (bool) | Owned by M5. Stats and Me read it. `mood` and `area` are optional and only set if the AI or the user sets them. |
| **AISettings** | auto_save_rules (per record type: `auto`/`confirm`), money_confirm_threshold (₱), language, voice_transcription_mode, send_photos (bool), data_context_scope, model | Single row (single user). |
| **ConnectorClient** | id, name ("Claude"), token_hash / OAuth grant, scopes (`read`/`write`), created_at, last_used_at, revoked_at | MCP connector. Its writes land in WriteLog with actor=`connector`. |

## 3. User journeys

**J1 Text multi-intent capture.** Trigger: at the bus stop he types "ran 5k 32 min, spent 250 on grab, remind me to pay rent on the 30th".
1. Taps **(+) Capture** → CAP-01 Capture thread, composer focused.
2. Types the message and sends. A processing shimmer shows.
3. The AI returns 3 cards (CAP-05):
   - Workout 5 km run, 32:00. Tier A, saved.
   - Expense ₱250, Transport › Grab, default account. Tier A, saved.
   - Task "Pay rent", due the 30th at a default time, with reminder. Tier B, confirm.
4. Each saved card shows ✓ Saved · Undo · Edit. He taps **Confirm** on the task card.
- Alt 4a: the account is ambiguous (he has GCash and cash). If a default account is set, it saves with the default and the card highlights "GCash ▾". If none is set, it becomes a follow-up chip row (J5).
- Alt 4b: he taps Edit → CAP-06 Record edit sheet → saves.

**J2 Voice capture on the go.** Trigger: walking out of the gym.
1. Holds the mic in CAP-01 (or long-presses **(+)**, Later) → CAP-02 Voice recorder (waveform, timer, release to send, slide to cancel).
2. The audio uploads and is transcribed. The transcript shows as his message, marked "voice" and editable.
3. It then runs the same flow as J1. Cards appear.
- Alt: transcription fails → CAP-19 error card: Retry, or Edit transcript manually.
- Alt: offline → J9.

**J3 Photo meal.** Trigger: a home-cooked lunch.
1. CAP-01 → camera icon → CAP-03 Photo sheet (Take photo / Library; hint chips Auto · Meal · Receipt · Label · Statement · Whiteboard).
2. Snaps the photo. He can add a caption ("half rice, 2 pcs chicken adobo").
3. The AI returns a **Meal card**: items, estimated kcal / P / C / F, and a meal slot guessed from the time. Tier B: confirm, because estimates are uncertain (OQ-CAP-1).
4. He confirms. Today's macros-left updates (M3). The Undo stays on the card.
- Alt: no caption and the portion can't be judged → one follow-up: "Portion? ½ cup · 1 cup · 1½ cups".
- Alt: a nutrition label photo → food item plus per-serving macros. Asks "How many servings?" if not stated.

**J4 Photo receipt.** Trigger: a grocery receipt.
1. CAP-03 → photo (hint Auto or Receipt).
2. The AI returns an **Expense card**: merchant, total, date from the receipt, category, account. The line items collapse under a "split by category?" toggle (Later).
3. Tier B confirm (photo-sourced money). He confirms. The photo is attached to the finance record.
- Alt: the receipt date differs from today → the card shows the receipt date, flagged "from receipt".
- Alt: a possible duplicate (same amount and merchant within 1 day) → the card warns "Looks like the ₱1,240 you logged at 6:12pm", with Merge / Keep both.

**J5 Ambiguous capture needing follow-up.** Trigger: "paid 1500".
1. Sends from CAP-01.
2. The AI can't infer what it was for. It returns CAP-07 Follow-up card: "What was ₱1,500 for?" with chips (recent categories) and a free-text reply. A second chip row for account appears only if there's no default.
3. He taps "Utilities › Electricity". The card becomes an Expense card, Tier A, saved.
- Alt: he ignores it. The capture stays `needs_input` and shows in CAP-12 History with a badge on the Capture tab. Nothing is saved until he answers (OQ-CAP-10).

**J6 Undo a wrong record.** Trigger: the AI logged ₱250 to Food instead of Transport.
1. On the card in CAP-01, **Undo** (or the CAP-08 toast within 5s) → the record is reverted via WriteLog. The card shows "Undone · Redo".
2. Or **Edit** → CAP-06 → change the category → save. The WriteLog entry is updated.
- Alt: found later → CAP-12 History → CAP-13 Capture detail → the same Undo / Edit per record.
- Alt: the record was already changed in its module → Undo is blocked with "Edited in Finance since, open record" (§8).

**J7 Ask a question about my data.** Trigger: "how much did I spend on food this month?"
1. Sends from CAP-01. The AI detects a *question*, not a log, so no record cards.
2. It returns CAP-11 **Answer card**: "₱6,420 on Food (Sep 1-26), 78% of budget", a mini bar chart, and a **Open in Finance** link (M4 report).
3. He follows up: "what's my bench PR?" → Answer card "80 kg × 5 (Sep 12)" → **Open exercise** (M3).
- Alt: advice-shaped question ("should I buy this phone on installment?") → a short answer plus **Ask Finance advisor** → M4 advisor surface.

**J8 Journal entry by voice.** Trigger: winding down at night.
1. CAP-01 → mic → a long, reflective voice note.
2. The AI classifies it as a journal entry, not a log. It returns a **Journal card**: a cleaned-up body (the original transcript is kept), date, and suggested mood and tags. Tier A, saved.
3. Any loggable facts inside it ("slept at 1am again") come back as separate cards below. These are always Tier B confirm, so journaling never silently creates records.
- Alt: he starts with "journal:" or picks **Journal** in the quick-add sheet → the AI skips classification.
- Alt: he wants to write it long → CAP-15 Journal list → **New** → CAP-16 Journal editor (with a dictate button).

**J9 Capture while offline.** Trigger: no signal at the gym.
1. He sends text, voice, or a photo in CAP-01. The input is stored on the device with its `client_uuid` and device timestamp.
2. The message shows "Queued · will process when online". A counter appears on the offline banner (CAP-14).
3. When back online, the queue replays in order. Cards appear in the thread, and a notification is sent if the app is backgrounded (installed PWA only).
4. Records use the **capture time**, not the processing time.
- Alt: he taps the banner → CAP-14 Pending sheet → Retry now, or Delete a queued item.

**J10 Use Claude (external) via connector.** Trigger: he's already chatting in the Claude app.
1. One-time setup: Me → CAP-17 AI settings → CAP-18 Claude connector → **Connect**. This shows the MCP server URL and a connect/OAuth step, with scopes Read / Read+Write.
2. In Claude: "log 2 eggs and toast for breakfast". Claude calls the app's MCP tools (`log_meal` …). The app writes the records with actor=`connector`.
3. The records appear in the app. They're listed in CAP-12 History with source "Claude", and each has Undo.
4. Claude can also read data (`get_spending`, `get_prs`) to answer questions.
- Alt: token revoked or expired → Claude gets an auth error, and CAP-18 shows "Disconnected".

**J11 Quick-add fallback.** Trigger: AI unavailable, or he wants precision.
1. In CAP-01, **+ Quick add**, or the sheet shown when AI is down (CAP-19) → CAP-09 Quick-add sheet (grid: Expense, Income, Transfer, Task, Habit check, Weigh-in, Meal, Set/Workout, Journal).
2. He picks a type → CAP-10 Quick-add form (the minimal form that module owns) → Save. The toast has Undo.

## 4. Screen inventory

Closed list. "Inline" means a component rendered inside CAP-01, not a separate route.

| ID | Screen | Reached from | Purpose | Key content | Actions available |
|---|---|---|---|---|---|
| CAP-01 | Capture thread | (+) tab; Today cards "log…" (pre-filled prompt); deep links from notifications | The single capture, ask and coach surface | Day-separated messages, record cards, answer cards, pending chips; composer (text, mic, camera, quick-add, attach file); suggested prompts when empty | Send, record, snap, quick-add, scroll history, open card, jump to History |
| CAP-01E | Capture thread: empty state | First use / cleared thread | Teach the pattern | 3-4 tappable example prompts ("spent 120 on lunch", "weighed 72.4", photo a meal); privacy one-liner | Tap example → pre-fill composer |
| CAP-02 | Voice recorder overlay | Mic in CAP-01 / CAP-16 | Record audio | Waveform, timer, max length hint, live transcript if available | Release/tap to send, slide to cancel, pause |
| CAP-03 | Photo sheet | Camera icon in CAP-01 | Pick the image source and an optional hint | Take photo, Library, hint chips, caption field | Capture, choose, set hint, add caption, send |
| CAP-04 | File attach sheet | Paperclip in CAP-01 | Statement files (PDF/CSV/image) | File picker, "This is a statement for: [account ▾]" | Attach → hands off to M4 import |
| CAP-05 | Record card (inline) | AI reply in CAP-01; CAP-13 | Show what will be / was saved, and where | Module icon + target ("Finance › Expense"), key fields, confidence cue, state badge (Proposed / Saved / Undone / Failed), source photo thumb | Confirm, Edit, Undo/Redo, Discard, Open record |
| CAP-06 | Record edit sheet | Edit on CAP-05 | Fix fields, or change the target type | Fields for that record type (module-owned schema), target-type switcher | Save, Cancel, Delete (for saved) |
| CAP-07 | Follow-up card (inline) | AI reply when a required field is missing | Get the missing info with minimum effort | Question, 2-6 chips from his recent values, free reply | Tap chip, type reply, Skip (keeps as `needs_input`) |
| CAP-08 | Undo toast | After any Tier A save or quick-add | Last-chance reversal without scrolling | "Saved 3 records" · Undo | Undo, dismiss |
| CAP-09 | Quick-add sheet | Composer "+"; CAP-19; long-press (+) (Later) | Manual fallback picker | Type grid (see J11), recent types first | Pick type |
| CAP-10 | Quick-add form | CAP-09 | Minimal manual entry | Module-owned minimal form (e.g. Expense: amount, category, account, note) | Save, Save & add another, Cancel |
| CAP-11 | Answer card (inline) | AI reply to a question | Answer from his data | One-line answer, number, mini chart/list, time range, "based on N records" | Open in module, change range, Ask advisor (→ M4) |
| CAP-12 | Capture history | CAP-01 header; Me › AI; badge on (+) | Audit all captures and AI/connector writes | List grouped by day; filters: source, module, status (needs input, failed, undone) | Open capture, filter, search |
| CAP-13 | Capture detail | CAP-12; long-press message in CAP-01 | See input → output | Original text/transcript, audio player, photo, resulting records with states, WriteLog | Undo/Edit each record, Re-run AI, Delete capture |
| CAP-14 | Pending/offline sheet | Offline banner in CAP-01 | Manage the queue | Queued items with time and type, sync status | Retry now, delete item |
| CAP-15 | Journal list | Me › Journal; Stats › Journal; Journal card | Read past entries | Reverse-chron entries, streak, search, filter by tag/area/mood | Open, New entry, search |
| CAP-16 | Journal editor / detail | CAP-15; Journal card | Write or read one entry | Date, body, dictate button, mood, tags, area, private toggle, original transcript (collapsed) | Save, dictate, delete, share excerpt (Later) |
| CAP-17 | AI settings | Me › AI & Capture | Control trust, cost and privacy | Auto-save per record type (auto/confirm), ₱ confirm threshold, language, photo sending on/off, data scope for Q&A, model/provider, monthly AI spend | Toggle, set values, clear thread |
| CAP-18 | Claude connector | CAP-17 | Link and manage the external Claude client | Status, MCP URL, scopes, last used, recent connector writes (link to CAP-12 filtered) | Connect, change scope, revoke |
| CAP-19 | AI error / unavailable state (inline + banner) | Provider down, rate or spend cap hit, transcription failed, photo unreadable | Never lose input; offer a fallback | Error reason, the input kept | Retry, Edit transcript, Quick add, Save as note |
| CAP-20 | Permission prompt sheet | First mic/camera use; denied state | Explain and recover from permission denial | Why we need it, how to re-enable (iOS/Android PWA) | Allow, Use text instead |

Handoffs, not owned by M5: M4 Statement import / reconcile, M4 Finance advisor, M3 meal / exercise / weigh-in screens, M2 task detail, M1 habit detail.

## 5. Function inventory

| ID | Function | Screen(s) | Notes |
|---|---|---|---|
| F-CAP-01 | Send text capture | CAP-01 | Streams the AI reply over AG-UI SSE (ADR-0007) |
| F-CAP-02 | Record and transcribe voice | CAP-02, CAP-16 | Transcription method is OQ-CAP-5; the transcript is editable |
| F-CAP-03 | Capture photo with hint and caption | CAP-03 | Hint is optional; Auto is the default |
| F-CAP-04 | Attach statement file → M4 import | CAP-04 | M5 only routes; parsing and reconcile belong to M4 |
| F-CAP-05 | Intent detection and multi-intent split | CAP-01 | Output types: log(s), question, journal, command (edit/delete), chit-chat |
| F-CAP-06 | Build ProposedRecords with tier | CAP-05 | Tier by rules in §6 plus AISettings |
| F-CAP-07 | Auto-save Tier A with undo | CAP-05, CAP-08 | Writes WriteLog |
| F-CAP-08 | Confirm / discard proposed record | CAP-05 | Also "Confirm all" when there are 2 or more cards |
| F-CAP-09 | Edit proposed/saved record, change target | CAP-06 | Uses the module's schema |
| F-CAP-10 | Undo / redo a write | CAP-05, CAP-08, CAP-13 | Blocked if the record was edited since (§8) |
| F-CAP-11 | Ask a follow-up for missing required fields | CAP-07 | At most 1 question per record, with chips from recent values |
| F-CAP-12 | Answer data questions | CAP-11 | Read-only tools over module data; cites range and count |
| F-CAP-13 | Light coaching nudges in replies | CAP-01, CAP-11 | Only when asked, or 1-line after a log (e.g. "₱400 left in Food budget") |
| F-CAP-14 | Advisor handoff | CAP-11 | Deep link to M4 advisor with context |
| F-CAP-15 | Offline queue and replay | CAP-01, CAP-14 | IndexedDB; idempotent by `client_uuid`; uses capture time |
| F-CAP-16 | Duplicate detection | CAP-05 | Money and weigh-ins: same value within a window → warn |
| F-CAP-17 | Quick-add manual entry | CAP-09, CAP-10 | Works offline (direct write, queued sync) |
| F-CAP-18 | Journal create (voice/text) and classify | CAP-01, CAP-16 | Keeps the raw transcript alongside the cleaned body |
| F-CAP-19 | Journal browse / search / edit | CAP-15, CAP-16 | |
| F-CAP-20 | Capture history and filter | CAP-12, CAP-13 | |
| F-CAP-21 | Re-run AI on a capture | CAP-13 | For failed or wrong parses; old records are only replaced after confirm |
| F-CAP-22 | AI settings (tiers, threshold, privacy, model) | CAP-17 | |
| F-CAP-23 | Spend/rate cap and kill switch | CAP-17, CAP-19 | Required by the constitution §3; see 22-ai-module.md |
| F-CAP-24 | Claude connector (MCP server) connect/revoke/scopes | CAP-18 | Same domain tools as the in-app agent; OQ-CAP-2 |
| F-CAP-25 | Permission handling (mic/camera) | CAP-20 | |
| F-CAP-26 | Today → Capture prefill | CAP-01 | Today cards open CAP-01 with a prompt, e.g. "Weigh-in: " |

## 6. Routing table

Tier legend: **A** = auto-save with undo, **B** = show card and confirm, **Q** = read-only answer. Defaults can be changed per record type in CAP-17.

| Input example | Detected intent | Target module/entity | Auto-save or confirm | Follow-up asked if missing |
|---|---|---|---|---|
| "did my meditation" / "meditated 10 min" | Habit check-in (+duration) | M1 HabitLog | A | Which habit, only if there's no fuzzy match |
| "started morning routine" | Start routine | M1 Routine run → opens the routine player | B (opens the player) | Which routine, if several |
| "new habit: read 20 min every weekday 9pm" | Create habit | M1 Habit | B (new structure) | None; the schedule is parsed |
| "remind me to pay rent on the 30th" | Task + reminder | M2 Task | B (reminders fire later) | Time, if no default reminder time (OQ-CAP-11) |
| "buy eggs, milk, rice" | Tasks (grocery list) | M2 Task ×3 in the Groceries list | A | None |
| "done with the report" | Complete task | M2 Task.complete | A if exactly 1 match, else B with picker | Which task, if several match |
| "ran 5k in 32 min" | Cardio workout | M3 Workout (cardio) | A | None |
| "bench 80x5x3" / gym whiteboard photo | Strength sets | M3 Workout sets | A for text; B for photo | Exercise mapping if the name is unknown |
| "weighed 72.4" | Weigh-in | M3 WeighIn | A (B if it differs more than 3% from the last, as a likely typo) | None (kg is the default unit) |
| Meal photo / "2 eggs and toast" | Meal + macros estimate | M3 MealLog | B for photo or vague text; A for a known saved food | Portion, if it can't be estimated |
| Nutrition label photo | Food item | M3 Food (+ MealLog) | B | Servings eaten |
| "spent 250 on grab" | Expense | M4 Record (expense) | A if ≤ threshold and category is clear, else B | Account, only if there's no default |
| Receipt photo | Expense (+ items) | M4 Record + attachment | B | Category, if the merchant is unknown |
| "got paid 35k" | Income | M4 Record (income) | B (above threshold) | Account |
| "moved 2k from GCash to BPI" | Transfer | M4 Transfer | B | Missing account |
| Statement screenshot / PDF | Statement import | M4 Import session → reconcile | Hand off (M4 owns review) | Which account, if not detectable |
| "paid 1500" | Expense, purpose unknown | M4 Record | Q→A after follow-up | What for (+ account if no default) |
| Long reflective voice note / "journal: …" | Journal | M5 JournalEntry | A (private by default) | None |
| "change that to 300" / "delete the last one" | Edit/delete prior record | Referenced record | B always | Which record, if unclear |
| "how much did I spend on food this month?" | Data question | Read M4 | Q | Period, only if it can't be defaulted (default: this month) |
| "what's my bench PR?" | Data question | Read M3 | Q | None |
| "should I buy this on 0% installment?" | Advice | Short answer → M4 advisor | Q + handoff | None |
| Unclear or chit-chat ("ugh long day") | None / possible journal | None, or a Journal suggestion | Nothing saved; offers "Save as journal?" | None |

Multi-intent: split into N cards. Each card gets its own tier. Nothing saves until all cards have resolved their follow-ups, **except** Tier A cards whose data is complete.

## 7. Metrics for Stats

| Metric | Formula | Shown where |
|---|---|---|
| Journaling streak | Consecutive days with ≥1 JournalEntry (entry_date) | Stats › Journal; CAP-15 header; player profile |
| Journal entries / week | count(JournalEntry) per ISO week | Stats › Journal |
| Mood trend | avg(mood) per week, entries with mood only | Stats › Journal (hidden if under 5 entries) |
| Captures logged | count(Capture where status=done) per day/week | Stats › Capture; player profile ("logs this week") |
| Records created via AI | count(ProposedRecord where state∈{saved,edited}) | Stats › Capture |
| Logging streak | Consecutive days with ≥1 record in any module | Today; player profile |
| Correction rate | (edited + undone) ÷ saved AI records, 30d | CAP-17 (trust tuning) |
| Input mix | share of text / voice / photo / quick-add / connector | Stats › Capture |
| Median time-to-record | median(record saved_at − capture created_at), excluding offline | CAP-17 (diagnostic, Later) |
| AI spend this month | sum(metered cost) | CAP-17 |

## 8. Edge cases

| Case | Expected behaviour |
|---|---|
| Message has both a log and a question | Cards for the logs and an answer card, in the same reply |
| Relative dates ("yesterday", "last Friday", "on the 30th" when today is the 30th) | Resolve against capture time in PH time (Asia/Manila); the card shows the resolved absolute date; "the 30th" in a month with no 30th → last day, flagged |
| Offline capture replayed a day later | Record date = capture time; relative dates resolve against capture time, not replay time |
| Same offline capture replayed twice | Idempotent by `client_uuid`; no duplicate records |
| Undo after the record was edited in its module | Undo blocked; card says "Changed since, open record" |
| Undo of a record that other data depends on (e.g. expense in a reconciled statement) | Warn and require confirm; M4 reconcile status reverts |
| Amount without a currency, or "$20" | PHP by default; a foreign currency → Tier B with the currency field shown (FX is OQ in M4) |
| Taglish / Filipino input ("gastos 150 sa jeep") | Parsed normally (OQ-CAP-6) |
| Photo with nothing loggable (screenshot of a meme) | "Couldn't find anything to log", with Save as note / Discard |
| Photo intent is ambiguous (restaurant receipt vs meal) | Ask one chip question: "Log as expense · meal · both" |
| Low-confidence macro estimate | Always Tier B, with an estimate range; he can type exact values |
| Unknown entity name ("did my stretch", no such habit) | Card offers the closest match or "Create habit 'Stretch'" (Tier B) |
| He answers a follow-up much later | The pending capture stays in History as `needs_input`; answering it completes it; no expiry |
| AI provider down / spend cap hit | Input kept; CAP-19 with Retry / Quick add; queued like offline if he chooses |
| Voice recording over the max length (e.g. 5 min) | Auto-stop at the limit, then process; a journal long-form gets a higher cap (OQ-CAP-7) |
| Mic/camera permission denied | CAP-20; text still works |
| Very large statement / many transactions | Hand off to the M4 import flow; no card flood in the thread |
| Connector (Claude) writes something wrong | Visible in CAP-12 with source "Claude"; undo the same way |
| Sensitive journal content | Journal is excluded from Q&A context unless he enables it (OQ-CAP-3) |
| Thread grows very long | Context sent to the LLM is limited to recent turns plus tool lookups; the UI paginates |

## 9. Open questions

| OQ-CAP-n | Question | Proposed default | Why it matters |
|---|---|---|---|
| OQ-CAP-1 | Which captures auto-save vs need confirm? | Auto: habit check, task create/complete (single match), text workout, weigh-in within ±3%, expense ≤ ₱1,000 with a clear category, journal. Confirm: anything from a photo, income, transfers, above threshold, new structure (habit/category/account), edits/deletes, reminders. Configurable in CAP-17. | The core trust vs effort trade-off (C1). Too much confirming makes it Wallet again; too much auto-saving produces dirty stats (C2) |
| OQ-CAP-2 | Claude connector (MCP) in v1, or built-in only? Two readings of I:48: "either/or" (pick one), or "both are acceptable". | v1 = built-in via OpenRouter (the plumbing exists). MCP connector = fast follow reusing the same tool layer. | Scope (C5), plus an auth surface open to an external client |
| OQ-CAP-3 | Privacy and cost: what data goes to the LLM provider? Finance and journal are sensitive. | Send only the data a turn needs, via tool lookups (no bulk dumps). Journal is excluded from Q&A unless opted in. Photos are sent only when attached. Monthly spend cap (e.g. ₱500) with a kill switch. A model with a no-training policy. | Personal finance and journal data leaving the device; runaway cost (constitution §3) |
| OQ-CAP-4 | Where does the journal live, and what is "identity"? Reading A: journal is a writing feature (entries). Reading B: "journal" and "identity" are just dashboard areas in M6. | Journal = entries owned by M5 (CAP-15/16), linked from Me and Stats. "Identity" = an optional `area` tag on entries for now; a real Identity area (values, "who I'm becoming") goes to M6 as an OQ. | Decides whether journal is a first-class screen stack or a tag |
| OQ-CAP-5 | Voice transcription: browser speech API, or server-side (audio-capable model or Whisper-type)? | Server-side. It works offline-queued, handles Taglish better, and is consistent on iOS PWA. Browser live transcript only as a preview (Later). | Accuracy, cost, iOS support |
| OQ-CAP-6 | Input language(s)? | English + Filipino/Taglish mixed; replies in English | Parsing accuracy; the intake is silent (PH location, I:71) |
| OQ-CAP-7 | Keep the raw audio and photos? | Keep photos attached to their records (receipts); delete audio after transcription (30 days); journal audio optional | Storage cost and privacy |
| OQ-CAP-8 | One rolling thread, or multiple conversations? | One rolling thread with day separators and a "new topic" soft break; no thread list | Simplicity (C5) vs organisation |
| OQ-CAP-9 | How long can undo reach back? | Card undo is available as long as the record hasn't been changed since; WriteLog kept for 30 days | Storage vs safety |
| OQ-CAP-10 | Does an unanswered follow-up block the other cards in the same message? | No. Complete cards save; only the incomplete one waits | Avoids losing the good data |
| OQ-CAP-11 | Default reminder time when only a date is given? | 9:00 AM Asia/Manila (M2 may override) | Reminder reliability |
| OQ-CAP-12 | Should the AI proactively coach (push nudges), or only respond? | Respond-only plus a 1-line post-log context ("₱400 left in Food"). Proactive nudges → Later / M6 | Avoid nagging; scope |
| OQ-CAP-13 | Default account for expenses? | The user sets one in M4 (e.g. GCash). Cash is the fallback for small amounts | Removes the most common follow-up |

## 10. Later / out of scope

- Long-press (+) to start voice instantly; home-screen shortcut / share-target ("share photo to Personal SOP").
- Receipt line-item splits across categories.
- Live on-device transcript preview.
- Proactive AI coaching pushes, weekly AI review digests (→ M6).
- Journal share excerpts / share cards (→ M6 sharing).
- Journal prompts ("what went well today?") on a schedule.
- Multiple conversation threads, conversation search across AI replies.
- Connector clients other than Claude; a public API.
- Time-to-record diagnostics.
- Out of scope: bank/e-wallet API sync (C6); deep finance advisor (M4); statement reconcile UI (M4); social features (M6).

## 11. Frame feedback

- **(+) should open Capture as a full-screen layer over the current tab, not as a tab destination.** Closing it returns you to where you were, and a Today card's "log weigh-in" prefills it. It keeps its center slot and look.
- **Capture is also "Ask".** Q&A and coaching live in the same thread, so the label could read "Capture" with a helper line "log or ask anything". Stats screens can offer an "Ask about this" chip that opens CAP-01 prefilled.
- **The journal needs a read home.** Proposal: Me › Journal plus a Stats › Journal tile. Writing happens through Capture, and Today shows a small "journal tonight?" card only once a streak exists.
- **AI settings and the Claude connector sit under Me** (Me › AI & Capture), consistent with Me holding module config.
