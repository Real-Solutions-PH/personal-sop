# Data Model

## ER Diagram

```mermaid
erDiagram
  USER ||--o{ ITEM : owns
  USER {
    uuid id
    string email
    uuid tenant_id FK
    bool is_active
  }
  ITEM {
    uuid id
    uuid owner_id
    string title
    text description
  }
```

## Entities

### User

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | uuid | PK | |
| email | text | unique, not null | synthetic example: user@example.test |
| (no password column) | — | — | auth lives in Supabase (GoTrue); `user.id` = the Supabase auth UID |
| is_active | bool | default true | |
| created_at | timestamptz | default now() | ISO-8601 UTC |

### Item

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | uuid | PK | |
| owner_id | uuid | FK -> user.id | |
| title | text | not null | |

## Indexes

- `user(email)` unique
- `item(owner_id)`

## Tenancy (2026-07-12)

All user-facing tables are tenant-scoped; a `tenant` row (id, name, slug unique, is_active) anchors them:

| Table | tenant_id | ON DELETE | Notes |
|-------|-----------|-----------|-------|
| user | not null, indexed | RESTRICT | a tenant with users cannot be deleted |
| item | not null, indexed | CASCADE | |
| ocr_document | not null, indexed | CASCADE | |
| conversation | not null, indexed | CASCADE | `message` scoped transitively via conversation |

Global (deliberately tenant-free, per ADR-0006): `agent`, `tool`, `mcpserver`, `agenttool`, `role`, `permission`.

Bootstrap: migration `b7d4e12a9f03` and `seed_tenants` both insert a **Default** tenant (slug `default`, fixed UUID `00000000-0000-4000-8000-000000000001`, idempotent on slug) and legacy rows are backfilled to it. New signups are assigned the tenant named by `settings.DEFAULT_TENANT_SLUG`.

Enforcement: the tenant filter lives in repo queries — rows outside the caller's tenant are invisible (404, no existence leak); wrong-owner rows inside the same tenant keep 403. Superusers are platform operators and bypass the filter.

DB-level RLS (2026-07-12): migration `c8f2a1d47e56` adds tenant-isolation policies on `user`, `item`, `ocr_document`, `conversation`, `tenant`, and `message` (transitive through its conversation), keyed on the Supabase-compatible `request.jwt.claims` GUC via `app_tenant_id()`. Owners/superusers bypass RLS, so the policies stay dormant until the app engine is flipped to the non-owner `app_user` role — see the runbook's "Row-Level Security & rate limiting" section for provisioning and verification.

## Migrations

- Tool: Alembic
- Naming: `YYYYMMDD_HHMM_description.py`
- Forward + backward compatible during deploys.

## Retention / Privacy

- PII fields: email
- Soft delete vs hard delete:
- GDPR export/erase:

---

## Mobile API domain (2026-10-18)

Every module the mobile app shows has its own tables (revision `536c41f13b56`). Decisions: [ADR-0011](adr/0011-mobile-api-scope-and-local-first-sync.md) (scope, sync), [ADR-0012](adr/0012-per-user-ai-providers.md) (AI keys), [ADR-0013](adr/0013-transport-per-ux.md) (transports), [ADR-0014](adr/0014-aggregate-statistic.md) (the aggregate statistic).

### Conventions

| Rule | Where |
|---|---|
| Every domain row inherits `OwnedRow`: `id` (minted on the device), `owner_id → user CASCADE`, `tenant_id → tenant CASCADE`, `created_at`, `updated_at`, `version`, `deleted_at`. Children carry `owner_id`/`tenant_id` too, so RLS and the sync pull are the same filter everywhere. | `backend/app/shared/owned.py` |
| `version` is stamped by the `set_sync_version()` trigger from the single sequence `sync_version_seq` on every insert and update. It is the sync cursor. Application code never writes it. | migration `536c41f13b56` |
| `deleted_at` is a tombstone. It is shipped by the sync pull and cleared by undo or restore. A natural-key upsert revives a tombstoned holder instead of tripping the unique constraint. | `app/shared/owned_repo.py` |
| Money is `BIGINT` centavos (`*_minor`), with a CHECK on both bounds (±₱1 trillion). | `app/shared/money.py` |
| Business days are `DATE` in the user's clock (`user_profile.timezone`, `day_start_hour`, default Asia/Manila 04:00). Instants are `timestamptz`. | `app/shared/day.py` |
| Rows the server derives (the next recurring task, the record a settled bill writes, a habit ticked by a workout) get `uuid5(namespace, "kind:parent:key")` ids that the device can mint offline too. | `app/shared/ids.py` |
| Value objects that the client always writes whole (habit and routine schedules, task recurrence, planned-item schedule and end rule, share fields, companion blocks) are JSONB validated by the module schema. | module `schema.py` |
| RLS: every table with `tenant_id` has `<table>_tenant_isolation` (`tenant_id = app_tenant_id()`). `weather_cache` is global and holds no user data. | migration `536c41f13b56` |
| Social rows: `owner_id` is the author or actor. Visibility (follow graph, close friends, chat membership) is decided in the services. Social is served by REST and the event stream, not by the owner-scoped pull. | `app/modules/social/models.py` |

### Module map

```mermaid
erDiagram
  user ||--|| user_profile : has
  user ||--o{ module_pref : weights
  user ||--o{ habit : tracks
  habit ||--o{ habit_log : logs
  routine ||--o{ routine_step : steps
  routine ||--o{ routine_run : plays
  user ||--o{ task_list : owns
  task_list |o--o{ task : holds
  task ||--o{ task_event : history
  user ||--o{ workout : trains
  workout ||--o{ workout_exercise : contains
  workout_exercise ||--o{ workout_set : sets
  user ||--o{ meal : eats
  user ||--o{ weigh_in : weighs
  user ||--o{ account : banks
  account ||--o{ fin_record : records
  planned_item |o--o{ fin_record : settles
  statement_import ||--o{ import_row : parses
  user ||--o{ capture : says
  capture ||--o{ record_card : proposes
  record_card ||--o{ card_write_log : audits
  user ||--o{ journal_entry : writes
  user ||--o{ ai_provider_credential : brings
  ai_provider_credential ||--o{ ai_model_assignment : serves
  user ||--o{ daily_module_stat : rolls_up
  user ||--o{ life_score_daily : scores
  user ||--o{ goal : aims
  user ||--o{ notification : inbox
  user ||--o{ post : publishes
  post ||--o{ comment : threads
  user ||--o{ follow : follows
  chat ||--o{ chat_member : members
  chat ||--o{ chat_message : messages
  user ||--o{ media_object : uploads
```

### Tables per module

The diagrams below are generated from the SQLModel metadata by `backend/scripts/erd.py`. The base columns are omitted from each box. Regenerate after any model change:

```sh
cd backend && uv run python scripts/erd.py
```


### `profile`

```mermaid
erDiagram
  identity {
    uuid id PK
    string text
    uuid goal_id FK
    integer sort_order
  }
  live_session {
    uuid id PK
    string kind
    string label
    string href
    uuid ref_id
    timestamptz started_at
    timestamptz paused_at
    integer paused_sec
  }
  module_pref {
    uuid id PK
    string module
    boolean enabled
    integer weight
  }
  push_device {
    uuid id PK
    string token
    string platform
    timestamptz last_seen_at
    timestamptz disabled_at
  }
  setup_skip {
    uuid id PK
    string module
  }
  user_profile {
    uuid id PK
    string name
    string handle
    uuid photo_media_id FK
    date since
    string timezone
    integer day_start_hour
    string evening_start
    float target_threshold
    string appearance
    boolean privacy_hidden
    boolean onboarded
    boolean setup_hidden
    boolean install_dismissed
    string push_permission
    string push_morning
    string push_evening
    boolean push_review
    jsonb seen_trophies
  }
  goal |o--o{ identity : "goal_id"
  media_object |o--o{ user_profile : "photo_media_id"
```

### `media`

```mermaid
erDiagram
  media_object {
    uuid id PK
    string kind
    string storage_key
    string mime
    bigint size_bytes
    integer width
    integer height
    float duration_sec
    string state
    timestamptz ready_at
  }
```

### `habits`

```mermaid
erDiagram
  habit {
    uuid id PK
    string name
    string icon
    string type
    float target
    string unit
    float step
    jsonb schedule
    boolean reminder
    string status
    boolean link_workout
    timestamptz archived_at
    integer sort_order
  }
  habit_log {
    uuid id PK
    uuid habit_id FK
    date day
    string status
    float value
    timestamptz logged_at
    string source
    string note
  }
  habit_pause {
    uuid id PK
    uuid habit_id FK
    date from_day
    date to_day
    string reason
  }
  habit_settings {
    uuid id PK
    integer week_start
    boolean default_reminder
    boolean streak_nudge
  }
  habit_timer {
    uuid id PK
    uuid habit_id FK
    date day
    integer target_sec
    timestamptz started_at
    timestamptz paused_at
    integer paused_sec
    integer bonus_sec
  }
  routine {
    uuid id PK
    string name
    string icon
    jsonb schedule
    boolean reminder
    string status
  }
  routine_run {
    uuid id PK
    uuid routine_id FK
    date day
    timestamptz started_at
    timestamptz ended_at
    jsonb steps
    integer current
    timestamptz step_started_at
    integer step_paused_sec
    integer step_bonus_sec
    timestamptz paused_at
    string state
  }
  routine_step {
    uuid id PK
    uuid routine_id FK
    uuid habit_id FK
    integer position
    integer minutes
  }
  routine_step_result {
    uuid id PK
    uuid run_id FK
    integer position
    uuid habit_id FK
    string status
    integer actual_sec
  }
  habit ||--o{ habit_log : "habit_id"
  habit ||--o{ habit_pause : "habit_id"
  habit ||--o{ habit_timer : "habit_id"
  routine ||--o{ routine_run : "routine_id"
  routine ||--o{ routine_step : "routine_id"
  habit ||--o{ routine_step : "habit_id"
  routine_run ||--o{ routine_step_result : "run_id"
  habit ||--o{ routine_step_result : "habit_id"
```

### `tasks`

```mermaid
erDiagram
  task {
    uuid id PK
    string title
    uuid list_id FK
    date due_date
    string due_time
    timestamptz remind_at
    jsonb recurrence
    string notes
    boolean starred
    string status
    timestamptz completed_at
    timestamptz cleared_at
    string source
    string parse_state
    date original_due
    integer reschedule_count
    integer sort_order
    uuid series_parent_id FK
  }
  task_event {
    uuid id PK
    uuid task_id FK
    string type
    date from_due
    date to_due
    timestamptz at
  }
  task_list {
    uuid id PK
    string name
    string kind
    string color
    string icon
    integer sort_order
    timestamptz archived_at
    boolean is_default
  }
  task_notif_state {
    uuid id PK
    string platform
    boolean installed
    string permission
    timestamptz remind_later_at
    timestamptz test_sent_at
  }
  task_settings {
    uuid id PK
    string default_remind_time
    boolean digest_on
    string digest_time
    string quiet_start
    string quiet_end
    boolean count_groceries
    integer week_start
  }
  task_list |o--o{ task : "list_id"
  task |o--o{ task : "series_parent_id"
  task ||--o{ task_event : "task_id"
```

### `fitness`

```mermaid
erDiagram
  exercise {
    uuid id PK
    string name
    string equipment
    string muscle
    string load_type
    integer rep_min
    integer rep_max
    float increment
    boolean archived
  }
  fitness_settings {
    uuid id PK
    string units
    integer rest_sec
    integer weekly_target
    boolean weigh_in_reminder
    string progression
    string ai_source
    string goal_direction
    float goal_weight
    boolean setup_done
  }
  macro_target {
    uuid id PK
    date effective_from
    float kcal
    float protein
    float carbs
    float fat
  }
  meal {
    uuid id PK
    timestamptz eaten_at
    string label
    string source
    uuid photo_media_id FK
    string raw_input
    string status
    float confidence
    jsonb follow_up
  }
  meal_item {
    uuid id PK
    uuid meal_id FK
    integer position
    string name
    float qty
    string unit
    float kcal
    float protein
    float carbs
    float fat
    string assumption
  }
  rest_timer {
    uuid id PK
    timestamptz ends_at
    integer duration_sec
  }
  template_item {
    uuid id PK
    uuid template_id FK
    uuid exercise_id FK
    integer position
    integer sets
  }
  weigh_in {
    uuid id PK
    timestamptz measured_at
    float weight_kg
    float body_fat_pct
    string note
  }
  workout {
    uuid id PK
    string name
    uuid template_id FK
    timestamptz started_at
    timestamptz ended_at
    string status
    string notes
    string source
  }
  workout_exercise {
    uuid id PK
    uuid workout_id FK
    uuid exercise_id FK
    integer position
    string note
  }
  workout_set {
    uuid id PK
    uuid workout_exercise_id FK
    integer position
    integer reps
    float weight
    string kind
    timestamptz completed_at
  }
  workout_template {
    uuid id PK
    string name
    integer sort_order
  }
  media_object |o--o{ meal : "photo_media_id"
  meal ||--o{ meal_item : "meal_id"
  workout_template ||--o{ template_item : "template_id"
  exercise ||--o{ template_item : "exercise_id"
  workout_template |o--o{ workout : "template_id"
  workout ||--o{ workout_exercise : "workout_id"
  exercise ||--o{ workout_exercise : "exercise_id"
  workout_exercise ||--o{ workout_set : "workout_exercise_id"
```

### `finance`

```mermaid
erDiagram
  account {
    uuid id PK
    string name
    string type
    bigint opening_minor
    date opening_date
    bigint limit_minor
    string color
    boolean in_net_worth
    boolean in_projection
    boolean archived
    date last_reconciled
    boolean manual
    integer sort_order
  }
  advisor_message {
    uuid id PK
    uuid thread_id FK
    string role
    string text
    timestamptz at
    jsonb answer
    string scope
  }
  advisor_thread {
    uuid id PK
    string title
  }
  budget {
    uuid id PK
    string name
    string period
    bigint limit_minor
    boolean rollover
    date start_date
    boolean archived
  }
  budget_category {
    uuid id PK
    uuid budget_id FK
    uuid category_id FK
  }
  category {
    uuid id PK
    string name
    string kind
    uuid parent_id FK
    string icon
    boolean discretionary
    boolean archived
    boolean system
    string slug
  }
  fin_record {
    uuid id PK
    string type
    bigint amount_minor
    uuid account_id FK
    uuid to_account_id FK
    uuid category_id FK
    timestamptz at
    string payee
    string note
    string source
    uuid receipt_media_id FK
    uuid planned_id FK
    date planned_on
    uuid import_id FK
    boolean is_refund
    boolean is_adjustment
    uuid fee_of FK
    string status
    timestamptz edited_at
  }
  finance_settings {
    uuid id PK
    uuid default_account_id FK
    uuid last_account_id FK
    uuid last_category_id FK
    integer month_start_day
    integer horizon
    boolean include_unplanned
    bigint safety_floor_minor
    string ai_scope
    boolean disclaimer_ack
    integer nudge_days
    jsonb proj_excluded_planned
    boolean setup_done
  }
  import_row {
    uuid id PK
    uuid import_id FK
    integer position
    string ref
    date on_date
    string time
    string raw
    bigint amount_minor
    string direction
    boolean pending
    string payee
    uuid suggested_category_id FK
    string state
    string reason
    uuid match_id FK
    float confidence
    string decision
    uuid category_id FK
    boolean is_transfer
  }
  look_back {
    uuid id PK
    string period
    string note
    timestamptz saved_at
    jsonb snapshot
  }
  planned_item {
    uuid id PK
    string name
    string type
    bigint amount_minor
    boolean estimated
    uuid account_id FK
    uuid to_account_id FK
    uuid category_id FK
    jsonb schedule
    date start
    jsonb end_rule
    boolean auto_log
    boolean is_what_if
    boolean is_installment
    boolean in_projection
    boolean archived
  }
  planned_skip {
    uuid id PK
    uuid planned_id FK
    date on_day
  }
  planned_snooze {
    uuid id PK
    uuid planned_id FK
    date on_day
    date until_day
  }
  statement_import {
    uuid id PK
    uuid account_id FK
    string file_name
    string file_type
    uuid file_media_id FK
    date period_from
    date period_to
    bigint closing_minor
    string status
    jsonb counts
    jsonb created_ids
    jsonb changed
    boolean file_kept
    string error_code
  }
  advisor_thread ||--o{ advisor_message : "thread_id"
  budget ||--o{ budget_category : "budget_id"
  category ||--o{ budget_category : "category_id"
  category |o--o{ category : "parent_id"
  account ||--o{ fin_record : "account_id"
  account |o--o{ fin_record : "to_account_id"
  category |o--o{ fin_record : "category_id"
  media_object |o--o{ fin_record : "receipt_media_id"
  planned_item |o--o{ fin_record : "planned_id"
  statement_import |o--o{ fin_record : "import_id"
  fin_record |o--o{ fin_record : "fee_of"
  account |o--o{ finance_settings : "default_account_id"
  account |o--o{ finance_settings : "last_account_id"
  category |o--o{ finance_settings : "last_category_id"
  statement_import ||--o{ import_row : "import_id"
  category |o--o{ import_row : "suggested_category_id"
  fin_record |o--o{ import_row : "match_id"
  category |o--o{ import_row : "category_id"
  account ||--o{ planned_item : "account_id"
  account |o--o{ planned_item : "to_account_id"
  category |o--o{ planned_item : "category_id"
  planned_item ||--o{ planned_skip : "planned_id"
  planned_item ||--o{ planned_snooze : "planned_id"
  account ||--o{ statement_import : "account_id"
  media_object |o--o{ statement_import : "file_media_id"
```

### `capture`

```mermaid
erDiagram
  ai_settings {
    uuid id PK
    jsonb rules
    integer money_threshold_minor
    string language
    string transcription
    boolean send_photos
    boolean journal_in_qa
    string finance_scope
    integer spend_cap_minor
    boolean ai_enabled
    integer retention_days
  }
  capture {
    uuid id PK
    uuid client_uuid
    timestamptz at
    string source
    string text
    string transcript
    integer duration_sec
    string hint
    string file_name
    string status
    string reply_text
    string error_code
    timestamptz started_at
    string engine
  }
  capture_attachment {
    uuid id PK
    uuid capture_id FK
    uuid media_id FK
    string kind
  }
  card_write_log {
    uuid id PK
    uuid card_id FK
    timestamptz at
    string action
    string actor
    jsonb before
    jsonb after
  }
  journal_entry {
    uuid id PK
    date day
    string body
    string source
    uuid capture_id FK
    integer mood
    jsonb tags
    string area
    boolean private
    string transcript
  }
  record_card {
    uuid id PK
    uuid capture_id FK
    integer position
    string kind
    string target
    string tier
    string state
    jsonb payload
    jsonb refs
    jsonb ask
    string note
    string warn
    float confidence
    integer day_offset
    jsonb prior
  }
  reply_item {
    uuid id PK
    uuid capture_id FK
    integer position
    string kind
    jsonb body
  }
  capture ||--o{ capture_attachment : "capture_id"
  media_object ||--o{ capture_attachment : "media_id"
  record_card ||--o{ card_write_log : "card_id"
  capture |o--o{ journal_entry : "capture_id"
  capture ||--o{ record_card : "capture_id"
  capture ||--o{ reply_item : "capture_id"
```

### `ai_providers`

```mermaid
erDiagram
  ai_model_assignment {
    uuid id PK
    string purpose
    uuid credential_id FK
    string model
    boolean supports_vision
  }
  ai_provider_credential {
    uuid id PK
    string provider
    string label
    string base_url
    bytes key_ciphertext
    bytes key_nonce
    integer key_version
    string key_last4
    timestamptz verified_at
    string last_error_code
  }
  ai_usage {
    uuid id PK
    timestamptz at
    string purpose
    uuid credential_id FK
    string model
    integer input_tokens
    integer output_tokens
    integer cost_minor
    boolean ok
  }
  ai_provider_credential ||--o{ ai_model_assignment : "credential_id"
  ai_provider_credential |o--o{ ai_usage : "credential_id"
```

### `stats`

```mermaid
erDiagram
  daily_module_stat {
    uuid id PK
    string module
    date day
    integer due
    integer done
    float rate
    jsonb metrics
  }
  life_score_daily {
    uuid id PK
    date day
    integer score
    string level
    jsonb rates
    jsonb weights
    integer due
    integer done
    boolean on_target
    boolean sealed
  }
```

### `dashboard`

```mermaid
erDiagram
  goal {
    uuid id PK
    string metric
    string label
    float target
    string unit
    string comparator
    string period
    string status
    string via
  }
  miss_note {
    uuid id PK
    string miss_key
    string note
  }
  notification {
    uuid id PK
    timestamptz at
    string kind
    string title
    string body
    string href
    boolean read
    string dedupe_key
    timestamptz pushed_at
  }
  review {
    uuid id PK
    string key
    boolean done
    timestamptz done_at
    string reflection
    string focus
  }
  share_default {
    uuid id PK
    string template
    jsonb fields
  }
  wrap_up {
    uuid id PK
    date day
    timestamptz at
    boolean on_target
    integer done
    integer due
    string reflection
    uuid journal_entry_id FK
  }
  journal_entry |o--o{ wrap_up : "journal_entry_id"
```

### `companion`

```mermaid
erDiagram
  companion {
    uuid id PK
    string name
  }
  companion_message {
    uuid id PK
    string role
    string text
    jsonb blocks
  }
  memory {
    uuid id PK
    string text
  }
  tracker {
    uuid id PK
    string metric
    string label
    float goal
    string direction
  }
```

### `social`

```mermaid
erDiagram
  activity {
    uuid id PK
    uuid actor_id FK
    string kind
    timestamptz at
    uuid post_id FK
    string text
  }
  chat {
    uuid id PK
    string name
    boolean is_group
    string direct_key
    timestamptz last_message_at
  }
  chat_member {
    uuid id PK
    uuid chat_id FK
    boolean muted
    boolean pinned
    timestamptz read_at
    timestamptz left_at
  }
  chat_message {
    uuid id PK
    uuid chat_id FK
    timestamptz at
    string text
    uuid media_id FK
    uuid post_id FK
    uuid story_id FK
    uuid reply_to_id FK
    boolean system
  }
  close_friend {
    uuid id PK
    uuid friend_id FK
  }
  comment {
    uuid id PK
    uuid post_id FK
    string text
    uuid reply_to_id FK
  }
  comment_like {
    uuid id PK
    uuid comment_id FK
  }
  follow {
    uuid id PK
    uuid followee_id FK
  }
  message_reaction {
    uuid id PK
    uuid message_id FK
    string emoji
  }
  note {
    uuid id PK
    string text
    timestamptz expires_at
  }
  note_like {
    uuid id PK
    uuid note_id FK
  }
  post {
    uuid id PK
    string caption
    jsonb progress
    string location
    jsonb tags
  }
  post_like {
    uuid id PK
    uuid post_id FK
  }
  post_media {
    uuid id PK
    uuid post_id FK
    integer position
    uuid media_id FK
    string kind
    float ratio
  }
  post_save {
    uuid id PK
    uuid post_id FK
  }
  social_draft {
    uuid id PK
    string kind
    jsonb body
  }
  social_profile {
    uuid id PK
    string bio
    string accent
    boolean show_scores
    boolean verified
    timestamptz activity_read_at
  }
  story {
    uuid id PK
    string kind
    uuid media_id FK
    string text
    jsonb bg
    jsonb progress
    string audience
    timestamptz expires_at
  }
  story_like {
    uuid id PK
    uuid story_id FK
  }
  story_seen {
    uuid id PK
    uuid story_id FK
  }
  user ||--o{ activity : "actor_id"
  post |o--o{ activity : "post_id"
  chat ||--o{ chat_member : "chat_id"
  chat ||--o{ chat_message : "chat_id"
  media_object |o--o{ chat_message : "media_id"
  post |o--o{ chat_message : "post_id"
  story |o--o{ chat_message : "story_id"
  chat_message |o--o{ chat_message : "reply_to_id"
  user ||--o{ close_friend : "friend_id"
  post ||--o{ comment : "post_id"
  comment |o--o{ comment : "reply_to_id"
  comment ||--o{ comment_like : "comment_id"
  user ||--o{ follow : "followee_id"
  chat_message ||--o{ message_reaction : "message_id"
  note ||--o{ note_like : "note_id"
  post ||--o{ post_like : "post_id"
  post ||--o{ post_media : "post_id"
  media_object ||--o{ post_media : "media_id"
  post ||--o{ post_save : "post_id"
  media_object |o--o{ story : "media_id"
  story ||--o{ story_like : "story_id"
  story ||--o{ story_seen : "story_id"
```

### `weather`

```mermaid
erDiagram
  weather_cache {
    uuid id PK
    string cell
    timestamptz fetched_at
    jsonb payload
  }
  weather_pref {
    uuid id PK
    string source
    string city_name
    string city_detail
    float city_lat
    float city_lon
    string unit
    boolean asked
  }
```

### `sync`

```mermaid
erDiagram
  sync_op_receipt {
    uuid op_id PK
    string entity
    string status
    jsonb result
    timestamptz applied_at
  }
```

