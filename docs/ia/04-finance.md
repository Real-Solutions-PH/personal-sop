# M4 Finance — IA

Date: 2026-09-26 · Source: [00-intake.md](00-intake.md) · Status: draft for IA review.
Intake refs are written as `I:<line>` (for example `I:51` is line 51 of the intake).

## 1. Jobs to be done

- **Log money in and out with almost no effort.** Chat ("lunch 180 gcash"), voice, receipt photo or a 2-tap quick-add. AI records it and asks follow-ups only when something is missing. (I:17-21, I:62)
- **Keep one true picture of every account** (cash, banks, GCash/Maya, credit cards) without bank sync. (I:51-52, I:29, I:71)
- **Catch what I forgot.** Upload a bank or e-wallet statement, let AI parse it, then reconcile it against existing records: match, correct, fill missing details, add unrecorded rows. (I:53-54)
- **Control spending with budgets** per category or overall. (I:55)
- **See the future.** Project savings from scheduled monthly income and expenses, and test a planned purchase before committing to it. This is the job he values most. (I:55-56)
- **Look back honestly.** Once a period ends, see where spending and income went wrong and what to improve. (I:57, I:23-24)
- **Get advice.** An AI accountant or advisor gives lessons, feedback and suggestions on purchases, financing and investing. It is not licensed advice. (I:58-59)
- **Brag safely.** Feed finance stats into the Stats player profile and share cards without exposing peso amounts. (I:12-13, I:22-26, I:66)

## 2. Entities

| Entity | Key fields | Notes |
|---|---|---|
| Account | name, type (cash · bank · e-wallet · credit card · savings/investment), opening balance, current balance (derived), credit limit (CC only), colour/icon, include-in-net-worth, include-in-projection, archived | CC balance is a liability (negative toward net worth). Balance = opening + Σ records ± adjustments. |
| Record | type (expense · income · transfer), amount ₱, account, to-account (transfer), category, datetime, payee/merchant, note, source (chat · quick-add · photo · import · planned · manual), receipt image ref, planned-item ref, import-row ref, is-refund, status (cleared · pending-review) | A transfer's fee is a separate linked expense. A refund is an income record in the original expense category, flagged is-refund. |
| Category | name, kind (expense · income), parent (1 level), icon, is-discretionary, archived | Seeded with defaults (Food, Transport, Bills…). is-discretionary drives the no-spend days metric (OQ-FIN-9). |
| Budget | name, scope (all expense or a set of categories), period (monthly default), limit ₱, rollover (off by default), start date, archived | Spent, remaining and pace are derived. |
| PlannedItem | type (expense · income · transfer), amount ₱ (fixed or estimated), account, category, schedule (once · monthly · every N weeks · semi-monthly · custom), next due, end (never · date · N times), auto-log mode (confirm · auto), is-what-if | Drives the projection. A what-if item is a draft purchase that only shows in scenarios. |
| StatementImport | account, file ref, file type (PDF · CSV · image), period from/to, statement closing balance, status (parsing · review · done · failed), counts (matched · new · conflicts · ignored), created at | Retention of the file is OQ-FIN-11. |
| ImportRow | import ref, date, description raw, amount, direction, parsed payee, suggested category, match state (matched · probable · new · duplicate-in-file · ignored), matched record ref, confidence, user decision | Only exists during the review. It is kept after commit for audit. |
| LookBack | period, generated summary (wins, misses, suggestions), metrics snapshot, user notes, created at | A saved copy so past reviews can be reread and compared. |
| AdvisorThread | messages, context scope (which data was shared), created at | Uses the M5 chat. Finance only adds context and the disclaimer. |
| FinanceSettings | default account, month start day, privacy mode, projection horizon, projection basis, AI data scope, disclaimer acknowledged | One row per user. |

## 3. User journeys

**J1 Quick log an expense (2 taps)**. Trigger: he just paid for something.
1. Tap the centre **(+) Capture**, then choose **Quick-add expense** (FIN-05).
2. FIN-05 opens with the amount keypad focused. Account defaults to the last-used account and category to the AI suggestion or the last one. He types 180 and taps a category chip. The record is saved and an undo toast appears.
- Alt a: he changes the account from a chip row (a 3rd tap).
- Alt b: he taps "More" to open the full editor (FIN-04) for a note, a date, or to switch to a transfer.
- Alt c: offline. The record is queued locally and marked "syncing". The balance updates optimistically.

**J2 Log via chat**. Trigger: he types or says "lunch 180 gcash" in Capture (M5).
1. The M5 chat parses: expense ₱180, account GCash, category Food › Lunch, time now.
2. The record is saved immediately and an inline record card appears in the chat, with Edit and Undo.
3. If a required field is missing, for example "180 lunch" with no account and no default set, AI asks one follow-up with chips ("GCash · Cash · BPI").
- Alt a: several items in one message ("grab 250, coffee 160 maya") creates 2 records, shown on one card.
- Alt b: "paid my BPI card 5k from savings" creates a transfer from Savings to the credit card.
- Alt c: receipt photo creates a draft that opens in FIN-06 for one-tap confirm (merchant, total, date, suggested category).

**J3 Import and reconcile a statement**. Trigger: month end, or a nudge from Today ("GCash not reconciled for 32 days").
1. Finance Home (FIN-01), then **Import statement** (FIN-25). Pick an account and upload a PDF, CSV or screenshot.
2. FIN-26 shows parsing progress. If the PDF is password-protected, it asks for the password. On failure it shows the error and a retry.
3. The **Reconcile review** (FIN-27) opens. A summary bar shows N matched · N new · N conflicts · N possible duplicates, plus balance check: statement closing ₱ vs app balance ₱.
4. Tabs are **Needs attention** (conflicts, duplicates, low-confidence) · **New** · **Matched**.
5. **Matched** rows are pre-accepted. The field-level diff shows only what the import would fill (payee, exact time).
6. **New** rows are pre-selected with a suggested category. He can use bulk actions: "Accept all new", "Set category for selected".
7. **Conflicts**: tapping a row opens FIN-28 (side by side). Choose keep mine · take statement · merge, or re-match to another record.
8. **Duplicates**: a row already imported, or a double row inside the file, is shown greyed. The default is to ignore it.
9. Tap **Commit**. Records are created or updated. The account's "last reconciled" date is set. If a balance gap remains, it offers a balance adjustment (FIN-12).
- Alt: he leaves partway. The draft import is saved and resumable from Import history (FIN-29).

**J4 Set a budget**. Trigger: overspent on Food, or AI suggests it in a look-back.
1. FIN-01, then Budgets (FIN-16), then **+** to open FIN-18.
2. Choose categories (FIN-15), a limit ₱ (with the average of the last 3 months as a hint), and the period. Save.
3. FIN-17 shows spent, remaining, and a daily "safe to spend" figure. A pace line compares spend to the elapsed share of the period.
- Alt: create from a look-back suggestion ("Cap Food at ₱6,000?"). This opens FIN-18 prefilled.

**J5 Add a planned or recurring item**. Trigger: new subscription, salary, rent, or card installment.
1. FIN-01, then Planned (FIN-19), then **+** to open FIN-21. Or via chat: "netflix 549 every 5th on BPI card".
2. Set type, amount, account, category and schedule, and choose between auto-log and confirm when due. Save.
3. When the item comes due, Today shows a card. Tap it to open FIN-22 and choose Paid (optionally edit the amount) · Skip · Snooze. Paid creates a Record linked to the planned item.

**J6 View the savings projection and plan a purchase**. Trigger: "can I afford a ₱45k laptop in December?"
1. FIN-01's projection card opens **Projection** (FIN-23): a line of projected liquid balance per month (default 12 months), the monthly surplus, and the lowest point.
2. Tap **What if…** to open FIN-24. Enter the item, ₱, and a date or "N monthly installments" with the account.
3. The chart overlays the new line on the baseline. It shows the new lowest point, the months until back to the current level, and a warning if any month goes negative or below the safety floor.
4. Save it as a planned item, keep it as a draft what-if, or discard it. "Ask advisor about this" opens FIN-33 with the scenario attached.
- Alt: toggle which planned items or accounts are included, and set the variable-spend assumption (OQ-FIN-1).

**J7 Monthly look-back review**. Trigger: 1st of the month. A Today card says "September review ready".
1. The card opens **Look-back** (FIN-32). It shows headline metrics (savings rate, income, spend, change vs last month and vs the 3-month average), budget adherence, and top categories.
2. **Wins** (budgets kept, no-spend days, savings rate up) are shown with a reward badge. **Misses** (budgets blown, spike categories, unplanned big purchases) are shown plainly, without euphemism.
3. **What to improve** lists 1–3 AI suggestions. Each has an action: create a budget, add a planned item, or ask the advisor.
4. He can add a note, save the review, or share a card (percentages only), which goes to M6.
- Alt: an on-demand review for any range from Reports (FIN-30).

**J8 Ask the advisor**. Trigger: "should I finance this phone at 0% for 12 months or pay cash?"
1. From FIN-01, FIN-23, FIN-32 or Capture, open the **Advisor** (FIN-33). On first use, a disclaimer sheet (FIN-34) must be acknowledged.
2. The advisor answers from his data within the allowed scope, shows its working (the numbers used), and gives a lesson and a recommendation. Replies carry a persistent "Not licensed financial advice" footer.
3. Suggested actions are chips such as "Add as what-if" (FIN-24) or "Create budget" (FIN-18). They never move money.

**J9 Pay a credit card or transfer between accounts**. Trigger: CC due date (a planned transfer) or a cash-in to GCash.
1. FIN-22 (from the due planned item), or FIN-04 set to Transfer: choose from and to accounts, the amount, and an optional fee.
2. Two balances update. Income and expense totals do not change. The fee is logged as an expense under Fees.

## 4. Screen inventory

| ID | Screen | Reached from | Purpose | Key content | Actions available |
|---|---|---|---|---|---|
| FIN-01 | Finance Home | Today finance card, Stats › Finance, Me › Modules, deep links | Module hub | Net worth (privacy-aware), account balance strip, spent this month vs budget, upcoming planned (7 days), projection mini-chart, reconcile nudges, look-back card; **empty**: "Add your accounts" CTA leading to FIN-37; **error**: cached data plus a stale banner | Quick-add, Import, open Records, Accounts, Budgets, Planned, Projection, Reports, Advisor, toggle privacy |
| FIN-02 | Records list | FIN-01, FIN-10, FIN-14, FIN-17, report drill-down | Browse and search records | Grouped by day with a daily net; each row shows icon, payee/note, category, account, ₱, source badge, pending-review badge; **empty**: "No records yet, try saying 'lunch 180 gcash'"; **error**: retry, offline queue count | Search (payee, note, amount), filter/sort (FIN-08), tap to open FIN-03, swipe to delete (with undo), multi-select to bulk recategorise or delete |
| FIN-03 | Record detail | FIN-02, chat record card, FIN-27 | View one record | All fields, receipt image, linked planned item or import row, created-via source, edit history (last change) | Edit (FIN-04), duplicate, mark as refund, delete (FIN-07), view receipt |
| FIN-04 | Record editor (sheet) | FIN-05 "More", FIN-03, FIN-02 +, FIN-28 | Full create/edit | Type tabs Expense · Income · Transfer; amount, account(s), category (FIN-15), date/time, payee, note, receipt attach, fee (transfer), is-refund; validation errors inline | Save, save & add another, delete, cancel |
| FIN-05 | Quick-add sheet | Capture (+), FIN-01, Today card, PWA shortcut | 2-tap logging | Amount keypad, type toggle, recent/AI-suggested category chips, account chip row (default preselected) | Tap a category to save, "More" for FIN-04, undo toast |
| FIN-06 | Receipt review (sheet) | Capture photo, FIN-04 attach | Photo to record | Image thumbnail; parsed merchant, total, date, suggested category and account, with a confidence marker; **error**: "Couldn't read receipt", retake or enter manually | Confirm, edit field, retake, discard |
| FIN-07 | Confirm delete / archive (sheet) | Any delete or archive action | Guard irreversible changes | Impact text (for example "Account has 214 records, archive instead?") | Delete, archive, cancel; undo toast after |
| FIN-08 | Filter & sort (sheet) | FIN-02, FIN-29 | Narrow lists | Date range, type, accounts, categories, amount range, source, pending-review only; sort by date, amount or payee | Apply, reset, save as default view |
| FIN-09 | Accounts list | FIN-01, Me › Finance | Manage accounts | Grouped: Cash · Banks · E-wallets · Credit cards · Savings/Investments; balance, last reconciled date; CC shows used vs limit; **empty**: CTA to FIN-11 | Add, reorder, tap to open FIN-10, show archived |
| FIN-10 | Account detail | FIN-09, FIN-01 strip | One account | Balance trend chart, records (embedded FIN-02 filtered), last reconciled, import history for this account; CC: statement balance, due planned payment | Edit, adjust balance (FIN-12), import statement (FIN-25), transfer, archive |
| FIN-11 | Account editor (sheet) | FIN-09, FIN-10, FIN-37 | Create/edit account | Name, type, opening balance and date, CC limit, icon/colour, include in net worth or projection toggles | Save, archive, delete (only when there are 0 records) |
| FIN-12 | Balance adjust (sheet) | FIN-10, FIN-27 commit | Fix drift | Current app balance, actual balance input, difference | Log as adjustment record (category "Balance adjustment", excluded from spend) or cancel |
| FIN-13 | Categories list | Me › Finance, FIN-35 | Manage categories | Expense and income tabs, parent and child tree, usage count, discretionary flag | Add, edit, reorder, merge into another, archive, show archived |
| FIN-14 | Category editor (sheet) | FIN-13, FIN-15 "New" | Create/edit category | Name, kind, parent, icon, is-discretionary | Save, merge, archive |
| FIN-15 | Category picker (sheet) | FIN-04, FIN-18, FIN-21, FIN-27/28 | Pick categories | Search, recents, AI suggestion first, tree | Select (single or multi), create new (FIN-14) |
| FIN-16 | Budgets list | FIN-01, Stats › Finance | See all budgets | Per budget: progress bar, spent/limit, pace marker, days left; over-budget rows in red; **empty**: "Set your first budget" plus an AI-suggested starter set | Add, tap to open FIN-17, show archived |
| FIN-17 | Budget detail | FIN-16, Today alert | One budget | Progress, safe-per-day, pace chart, past periods (kept/blown), contributing records | Edit, archive, view records (FIN-02 filtered) |
| FIN-18 | Budget editor (sheet) | FIN-16, FIN-17, FIN-32 suggestion, FIN-33 chip | Create/edit budget | Name, scope (all or categories), limit with a 3-month-average hint, period, rollover | Save, archive, delete |
| FIN-19 | Planned list | FIN-01, FIN-23 | Scheduled income and expenses | Upcoming timeline; monthly totals in and out; tabs Recurring · One-off · What-if drafts; **empty**: "Add salary and bills to unlock your projection" | Add, tap to open FIN-20, show ended/archived |
| FIN-20 | Planned item detail | FIN-19, Today card | One schedule | Next dates, history of paid/skipped occurrences, actual vs planned variance | Edit, pay now (FIN-22), skip next, end, archive |
| FIN-21 | Planned item editor (sheet) | FIN-19, FIN-20, FIN-24 save, chat | Create/edit schedule | Type, amount (fixed or estimated), account(s), category, schedule builder, end rule, auto-log vs confirm | Save, delete, archive |
| FIN-22 | Due item confirm (sheet) | Today card, push notification, FIN-20 | Settle an occurrence | Planned amount, editable actual amount, account, date | Paid, skip, snooze |
| FIN-23 | Projection | FIN-01, Stats › Finance, FIN-19 | Savings forecast | Chart of projected liquid balance over the horizon; monthly surplus table (in, out, net); lowest point; assumptions panel (included accounts and items, variable-spend basis); **empty**: needs ≥1 income planned item; **error**: insufficient data banner | What-if (FIN-24), change horizon, toggle inclusions, edit assumptions, ask advisor |
| FIN-24 | What-if purchase (sheet) | FIN-23, FIN-33 chip | Test a planned purchase | Item, ₱, date or N installments, account; baseline vs scenario overlay, new low point, recovery months, warnings | Save as planned, save as draft, discard, ask advisor |
| FIN-25 | Import start | FIN-01, FIN-10, Today nudge, Capture (file) | Upload a statement | Account picker, file picker or camera (PDF, CSV, image, multiple screenshots), last reconciled date, format tips | Upload, cancel |
| FIN-26 | Import parsing | FIN-25 | Progress and failure | Steps (read, parse, match), password prompt for locked PDFs; **error**: unreadable, wrong account detected, or 0 rows, with retry, choose another file, or report | Enter password, retry, cancel |
| FIN-27 | Reconcile review | FIN-26, FIN-29 resume | Resolve statement against records | Summary bar (matched, new, conflicts, duplicates, ignored), balance check, tabs Needs attention · New · Matched; rows show statement vs app values with a diff highlight and confidence | Bulk accept, bulk set category, per-row open FIN-28, ignore row, mark duplicate, commit, save draft |
| FIN-28 | Row fix (sheet) | FIN-27 row | Fix one row | Statement row vs candidate record side by side; other candidate matches | Keep mine, take statement, merge fields, re-match, create new (FIN-04 prefilled), ignore |
| FIN-29 | Import history | FIN-01 overflow, FIN-10 | Past imports | Per import: account, period, status, counts; drafts first | Resume draft, view summary, undo import (reverts records it created or changed), delete file |
| FIN-30 | Reports hub | FIN-01, Stats › Finance | Analytics | Period picker; cards: spend by category (donut), income vs expense, cash flow trend, net worth trend, top payees, budget history, day-of-week spend | Open FIN-31, custom range look-back (FIN-32), share card (M6) |
| FIN-31 | Report detail | FIN-30 | Drill into one report | Full chart, comparison to prior period, table, tap segment to open FIN-02 filtered | Change period or grouping, share |
| FIN-32 | Look-back review | Today card (1st of month), FIN-30, notification | Evaluate a period | Headline metrics with deltas, wins (rewards), misses (plain), top 3 suggestions with action chips, past reviews switcher, user note; **empty**: "<2 weeks of data — review available on …" | Act on a suggestion, add note, save, share card, ask advisor |
| FIN-33 | Advisor chat | FIN-01, FIN-23, FIN-24, FIN-32, Capture | AI accountant or advisor | M5 chat with finance context header (data scope chip), lesson or feedback replies with the numbers used, persistent disclaimer footer, action chips | Ask, change data scope, action chips (what-if, budget, planned), past threads |
| FIN-34 | Advisor disclaimer (sheet) | First FIN-33 open, FIN-35 | Framing and consent | "Not licensed financial advice" text, what data is sent to the AI provider, scope choice | Acknowledge, choose scope, cancel |
| FIN-35 | Finance settings | Me › Finance, FIN-01 overflow | Module configuration | Default account, month start day, privacy mode (hide amounts), projection horizon and basis, AI data scope, reconcile nudge interval, manage categories, archived items, export CSV | Edit each setting, open FIN-13, FIN-36, FIN-34 |
| FIN-36 | Archived items | FIN-35, "show archived" links | Restore or purge | Archived accounts, categories, budgets, planned items | Restore, delete permanently (FIN-07; blocked when records reference it) |
| FIN-37 | Finance setup (first run) | First FIN-01 visit | Onboarding with low effort | Suggested accounts (Cash, GCash, Maya, bank, CC) with balance inputs; optional "add salary and big bills" for the projection; optional import of old Wallet history (OQ-FIN-4) | Add selected, skip, import history |

**CRUD coverage check** (✓ = screen ID, — = not applicable):

| Entity | Create | List | Detail | Edit | Delete/archive | Empty | Error | Search/filter/sort | Settings |
|---|---|---|---|---|---|---|---|---|---|
| Account | 11, 37 | 09 | 10 | 11 | 07, 36 | 09, 01 | 01 | — (short list) | 35 |
| Record | 05, 04, 06, chat | 02 | 03 | 04 | 07 | 02 | 02, 06 | 02, 08 | 35 |
| Category | 14, 15 | 13 | — (13 inline) | 14 | 07, 36 | seeded | — | 15 search | 35 |
| Budget | 18 | 16 | 17 | 18 | 07, 36 | 16 | — | — | 35 |
| PlannedItem | 21, 24, chat | 19 | 20 | 21 | 07, 36 | 19 | — | 19 tabs | 35 |
| StatementImport / ImportRow | 25 | 29 / 27 | 27, 28 | 28 | 29 (undo, delete file) | 29 | 26 | 27 tabs, 08 | 35 |
| LookBack | auto, 32 | 32 switcher | 32 | 32 note | — | 32 | 32 | — | — |
| AdvisorThread | 33 | 33 | 33 | — | 33 | 33 | 33 | — | 34, 35 |

## 5. Function inventory

| ID | Function | Screen(s) | Notes |
|---|---|---|---|
| F-FIN-01 | Parse a natural-language money message into records | M5 chat, FIN-02 | Multiple items per message, relative dates ("yesterday"), "5k" means 5,000 |
| F-FIN-02 | Ask a single follow-up only for missing required fields | M5 chat | Required: amount and account (unless a default exists). Category may stay AI-guessed |
| F-FIN-03 | Save a record instantly with an undo toast | FIN-05, chat | No confirmation step (C1) |
| F-FIN-04 | Suggest a category from payee, note, history or time of day | FIN-05, 04, 06, 27 | Learns from his corrections |
| F-FIN-05 | Default account plus last-used memory | FIN-05, 04 | Set in FIN-35 |
| F-FIN-06 | Receipt OCR to a record draft | FIN-06 | Total, merchant, date |
| F-FIN-07 | Create, edit and delete a record (expense, income, transfer) | FIN-04, 03, 07 | |
| F-FIN-08 | Transfer with an optional fee | FIN-04, 22 | The fee is a linked expense |
| F-FIN-09 | Mark a record as a refund | FIN-03, 04 | Nets against its category |
| F-FIN-10 | Offline queue for capture | FIN-05, chat | Timestamp kept, syncs later (I:76) |
| F-FIN-11 | Search, filter and sort records | FIN-02, 08 | |
| F-FIN-12 | Bulk recategorise or delete | FIN-02 | |
| F-FIN-13 | Account CRUD, archive and reorder | FIN-09, 10, 11 | |
| F-FIN-14 | Derive balances and net worth | FIN-01, 09, 10 | CC counts as a liability |
| F-FIN-15 | Balance adjustment record | FIN-12 | Excluded from spend and income metrics |
| F-FIN-16 | Category CRUD, archive, merge and reorder | FIN-13, 14 | Merge moves records |
| F-FIN-17 | Budget CRUD and archive | FIN-16, 17, 18 | |
| F-FIN-18 | Budget progress, pace and safe-per-day | FIN-16, 17, Today | |
| F-FIN-19 | Budget threshold alerts (80%, 100%) | Today, push | Push works only on an installed PWA (I:74) |
| F-FIN-20 | Planned item CRUD with a schedule builder | FIN-19, 20, 21 | Semi-monthly for PH 15th/30th paydays (OQ-FIN-6) |
| F-FIN-21 | Due-item reminder and settle (paid, skip, snooze) | FIN-22, Today, push | |
| F-FIN-22 | Auto-log planned items marked "auto" | background on app open | No background execution. Occurrences are materialised on next open (I:74-75) |
| F-FIN-23 | Compute the savings projection | FIN-23, FIN-01 | Basis per OQ-FIN-1 |
| F-FIN-24 | What-if scenario overlay | FIN-24 | Lump sum or N installments |
| F-FIN-25 | Toggle projection inclusions and assumptions | FIN-23 | |
| F-FIN-26 | Upload a statement (PDF, CSV, image, multiple) | FIN-25 | |
| F-FIN-27 | AI parse a statement into rows | FIN-26 | Handles password-protected PDFs |
| F-FIN-28 | Match rows to records | FIN-26, 27 | Amount ± tolerance, date ± 3 days, payee similarity |
| F-FIN-29 | Detect duplicates (in file, across imports) | FIN-27 | By date, amount and description hash |
| F-FIN-30 | Bulk accept and bulk set category | FIN-27 | |
| F-FIN-31 | Per-row resolve (keep, take, merge, re-match, new, ignore) | FIN-28 | |
| F-FIN-32 | Balance check against the statement closing balance | FIN-27 | Offers FIN-12 |
| F-FIN-33 | Save a draft import and resume it | FIN-27, 29 | |
| F-FIN-34 | Undo a committed import | FIN-29 | Reverts only its own creates and edits |
| F-FIN-35 | Reconcile nudge ("GCash not reconciled N days") | Today, FIN-01 | Interval set in FIN-35 |
| F-FIN-36 | Reports (category, cash flow, net worth, payees, budgets, weekday) | FIN-30, 31 | |
| F-FIN-37 | Drill down from a chart to filtered records | FIN-31 | |
| F-FIN-38 | Generate a look-back (wins, misses, suggestions) | FIN-32 | Monthly auto, plus on-demand for a custom range |
| F-FIN-39 | Turn a suggestion into an action (budget, planned, advisor) | FIN-32, 33 | Prefills the target editor |
| F-FIN-40 | Advisor chat with finance context | FIN-33 | Uses the M5 chat |
| F-FIN-41 | Disclaimer acknowledgement and AI data scope | FIN-34, 35 | Stored in FinanceSettings |
| F-FIN-42 | Privacy mode (hide amounts app-wide) | FIN-01, 35, all | Shows ₱•••• and keeps percentages. Quick toggle via an eye icon |
| F-FIN-43 | Share card generation (percentages only by default) | FIN-30, 32, M6 | Amounts never appear on cards unless explicitly opted in per card |
| F-FIN-44 | Emit finance metrics to Stats and the player profile | M6 | |
| F-FIN-45 | Export records to CSV | FIN-35 | Data ownership. Cheap |
| F-FIN-46 | Guided first-run account setup | FIN-37 | |
| F-FIN-47 | Archive, restore and purge | FIN-36, 07 | Purge is blocked when referenced |

## 6. Today-card & Capture hooks

**Today cards** (each hidden when there is nothing to show; amounts obey privacy mode):
- **Spend today**: ₱ spent today, remaining safe-to-spend this month, and a tap target for quick-add (FIN-05).
- **Due today/tomorrow**: planned items with Paid and Skip inline (FIN-22).
- **Budget alert**: shown once a budget crosses 80% or 100%.
- **Review ready**: on the 1st, the look-back (FIN-32).
- **Reconcile nudge**: when an account has not been reconciled for more than N days, links to FIN-25.
- **Pending review**: records drafted by AI with low confidence, confirmed with one tap.

**Capture examples → result:**

| Input | Result |
|---|---|
| "lunch 180 gcash" | Expense ₱180 · GCash · Food › Dining · now |
| "grab 250 and coffee 160 maya" | 2 expenses on Maya (Transport, Food › Coffee) |
| "salary 35k bpi" | Income ₱35,000 · BPI · Salary. If a matching planned item is due, it is settled instead of duplicated |
| "cashed in 2000 to gcash from bpi, 15 fee" | Transfer BPI → GCash ₱2,000 plus expense ₱15 Fees |
| "paid metrobank card 12,400 from bpi" | Transfer BPI → Metrobank CC (liability reduced) |
| "refund 899 lazada to gcash" | Income ₱899 · GCash · is-refund · category of the original purchase (asked if ambiguous) |
| "180" | Follow-up: "What for, and which account?" with chips |
| "spotify 149 monthly on the 3rd, bpi card" | PlannedItem, recurring |
| "can I afford a 45k laptop in december?" | Opens the advisor or what-if (FIN-24) prefilled |
| Photo of a receipt | FIN-06 draft (merchant, total, date, category) |
| Screenshot of a GCash transaction history, or a bank PDF | Routed to import (FIN-25) with the account guessed |

## 7. Metrics for Stats & share cards

All metrics exclude transfers and balance adjustments. Refunds net against expense.

| Metric | Formula | Shown where | Good/bad framing | Shareable? |
|---|---|---|---|---|
| Savings rate | (income − expense) ÷ income, per period | Player profile, FIN-32, FIN-30 | Higher is better. Negative is shown red as "spent more than earned" | Yes (%) |
| Net worth trend | Σ asset balances − Σ CC balances; % change over the period | FIN-01, FIN-30, profile | Up is a win. Down is shown plainly with the top cause | % change only. ₱ is never shared by default |
| Budget adherence | budgets ended ≤ limit ÷ budgets ended, per period | FIN-16, FIN-32, profile | "Kept 5/6". A blown budget is named | Yes (ratio) |
| No-spend days | days in the period with 0 discretionary expense records | FIN-32, profile, streak | Count plus current streak. Rewarded | Yes |
| Spend vs baseline | this period's expense ÷ trailing 3-period avg − 1 | FIN-32, FIN-30 | Below baseline is good. A spike is called out with its category | Yes (%) |
| Projected month-end surplus | projected income − projected expense for the current month | FIN-01, FIN-23 | Positive is green. Negative is a warning | No (₱). Yes as "on track / off track" |
| Emergency runway | liquid balance ÷ avg monthly expense (3 months) | FIN-23, profile | ≥ 3 months good, < 1 month red | Yes (months) |
| Plan accuracy | 1 − |actual − planned| ÷ planned, over settled planned items | FIN-20, FIN-32 | Higher means the plans are realistic | Yes (%) |
| Logging completeness | records already matched ÷ statement rows at import | FIN-27, FIN-32, profile | Measures C1 health: "you caught 92% yourself" | Yes (%) |
| CC paid-in-full streak | consecutive statement cycles where the CC balance was paid in full by the due date | FIN-10, profile | Streak is rewarded. A miss is shown with the interest risk | Yes (count) |
| Top category share | largest expense category ÷ total expense | FIN-30, FIN-32 | Neutral fact. The advisor comments on it | Yes (% plus name) |
| Daily average spend | expense ÷ days in the period | FIN-30 | Compared to budget-per-day | No by default (₱) |

**Share rule:** cards default to %, ratios, counts and streaks. Any ₱ amount on a card requires an explicit per-card toggle, and privacy mode forces it off.

## 8. Edge cases

| Case | Expected behaviour |
|---|---|
| Transfer between own accounts | One transfer record, 2 balances change, and neither income nor expense changes |
| Cash-in or transfer fee | The transfer carries a linked Fees expense |
| ATM withdrawal | Transfer from Bank to Cash, with any fee handled as above |
| Credit card purchase | Expense on the CC account. CC liability rises and net worth falls |
| Credit card payment | Transfer Bank → CC. It is not an expense, so there is no double counting |
| CC 0% installment purchase | See OQ-FIN-5. Default: full expense on purchase date, plus a planned transfer ×N for the projection |
| Refund | Income flagged is-refund in the original category. It reduces that category's spend and the budget use |
| Split transaction (one receipt, several categories) | OQ-FIN-3. Default: not supported. Log two records via chat ("groceries 1200, toiletries 300") |
| Foreign currency purchase | OQ-FIN-7. Default: PHP only. Record the charged PHP amount and put the original in the note |
| Salary from two jobs | Two income planned items, each on its own schedule |
| Planned item logged manually too (duplicate) | On save, if a due planned item has a close amount and date, offer "Is this your Netflix? Link it" |
| Statement row already recorded with a slightly different amount or date | Probable match. Shown in Needs attention with a diff. The default action is take statement amount, keep my category |
| Same statement imported twice, or overlapping periods | Rows already linked are flagged as duplicates and ignored by default. A banner shows the overlap |
| Statement contains pending or authorisation rows | Parsed as pending and ignored by default |
| Statement for the wrong account | FIN-26 warns "Looks like Maya, not GCash" and offers to switch |
| Password-protected PDF | Prompt for the password once. It is never stored |
| Screenshot statement across several images | Multi-upload with de-duplication across images |
| Balance still off after import | Offer a balance adjustment (FIN-12). It is visible in records and excluded from metrics |
| Backdated record | Balances and past budgets recompute. A saved look-back is not rewritten, but shows "data changed since review" |
| Deleting an account or category that has records | Blocked. Offer archive, or merge (category) |
| Negative balance on cash or e-wallet | Allowed with a warning badge (it is usually a missed income) |
| Projection with no income planned | Empty state that asks for salary. No fake forecast |
| AI parse low confidence (chat, receipt, import) | The record is saved as pending-review, shown on Today, and confirmed with one tap |
| Offline capture | Queued with its original timestamp and synced later. Balances are optimistic |
| Privacy mode on | All ₱ are masked and percentages stay visible. Share cards cannot include ₱ |
| Month start day ≠ 1 | Budgets, look-back and metrics use the custom cycle |

## 9. Open questions

| OQ-FIN-n | Question | Proposed default | Why it matters |
|---|---|---|---|
| OQ-FIN-1 | Projection basis. Reading A: planned items only. Reading B: planned items plus the average unplanned variable spend | B: planned items + trailing 3-month average of unplanned expense, as a toggle, over a 12-month horizon | A alone overstates savings. This is the feature he values most |
| OQ-FIN-2 | What "estimated savings" means. Reading A: projected total liquid balance over time. Reading B: monthly surplus (in − out) | Show both: the balance line chart plus a monthly surplus table | Decides the hero chart of FIN-23 |
| OQ-FIN-3 | Split transactions? | Later. Chat logs multiple records instead | Adds editor complexity. Rare for a single user |
| OQ-FIN-4 | Import his old Wallet (BudgetBaker) history via CSV export? | Yes, a one-time import through the same pipeline as FIN-25, run from FIN-37 | Instant history gives the projection baseline and look-back from day 1 |
| OQ-FIN-5 | How to model CC installment plans (0% for N months) | Full expense on day 1, plus a planned transfer ×N that feeds the projection | Common in PH. Otherwise the projection or the budgets are wrong |
| OQ-FIN-6 | Budget period: calendar month vs payday cycle (15th/30th) | Calendar month with a configurable start day. Semi-monthly schedules exist for planned items | Changes every period-based metric |
| OQ-FIN-7 | Foreign currency accounts or purchases? | PHP only. Original amount goes in the note | Multi-currency adds FX rates and conversions (C5) |
| OQ-FIN-8 | Which banks and e-wallets exactly (intake: "GCash, Maya; banks TBD") | Seed the suggestions Cash, GCash, Maya, a generic Bank and a generic Credit card. Parser tuned later per actual banks | Statement parsing quality depends on real formats |
| OQ-FIN-9 | What counts toward a "no-spend day" | Only categories flagged is-discretionary. Bills and planned items don't break it | A strict definition makes the streak unachievable and demotivating |
| OQ-FIN-10 | AI data scope for the advisor and parsing. Reading A: send full records. Reading B: send aggregates only | Aggregates by default. Record-level only when a question needs it, with a visible scope chip | Finance data goes to a third-party LLM (OpenRouter) |
| OQ-FIN-11 | Keep uploaded statement files? | Delete the file once the import is committed. Keep the parsed rows | Statements carry account numbers and personal data |
| OQ-FIN-12 | Auto-commit high-confidence import matches without review? | No. Pre-select them, but always require a single Commit tap | Silent writes erode trust in balances |
| OQ-FIN-13 | Labels/tags (Wallet has them) besides categories? | No. Categories plus a note, searchable | Extra taxonomy is logging friction (C1, C5) |
| OQ-FIN-14 | Should net worth include non-cash assets (investments, property, receivables)? | Investments only, as a manual-balance account type. Others Later | Affects the net worth metric and the advisor's investing advice |
| OQ-FIN-15 | Advisor AI: built-in (OpenRouter) or a Claude connector (same question as M3) | Built-in, via the existing AI module | Decides where the advisor and parser live (a shared M5 decision) |
| OQ-FIN-16 | Look-back cadence: monthly only, or also weekly? | Monthly auto, weekly as a lightweight Today card, any range on demand | Too-frequent reviews become noise |
| OQ-FIN-17 | Money owed or lent (utang), such as friends paying back? | Later. Log as income or expense with a note for now | Common real case, but a debts module is new scope |

## 10. Later / out of scope

- **Out (C6):** bank or e-wallet API sync, and any money movement or payments from the app.
- **Later:** split transactions, multi-currency, labels/tags, debts/loans ledger (utang), shared or household finances, savings goals as separate "envelopes" (the what-if and projection cover the need for now), investment portfolio tracking with prices, bill OCR from email, social comparison of finance stats, home-screen widget for quick-add.

## 11. Frame feedback

- **Finance does not need its own tab.** Logging lives in Capture, the daily glance in Today, analytics in Stats, and config in Me. FIN-01 is reached from the Today card and Stats › Finance. A Finance tab would duplicate them and break the 5-slot frame.
- **But the projection needs a fast path.** It is the owner's most-valued feature, so pin a projection mini-card on Today (collapsible) and make FIN-23 one tap from Stats › Finance.
- **Plan tab:** planned or recurring finance items are also "plans". Consider showing due bills and paydays on the Plan calendar (read-only, tapping through to FIN-20) so money and tasks live on one timeline.
- **Capture must accept files** (PDF/CSV) as well as chat, voice and photo, so statement import can start from (+).
- **Global privacy toggle:** the privacy-mode eye should live in the app header or Me, not only in Finance, because finance numbers also surface on Today and Stats.
