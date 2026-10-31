/**
 * Every setting in `backend/app/core/config.py` that production does NOT
 * set, and why. The stack sets the rest as plain environment variables or
 * Secrets Manager references (lib/prod-stack.ts). A test reads config.py and
 * fails when a new setting is in neither place, so a variable added to the
 * backend is a decision here, never a silent default.
 */
export const BACKEND_DEFAULTED: Record<string, string> = {
  API_V1_STR:
    "Constant `/api/v1`; the tunnel routes the API host's non-auth paths to the API.",
  BACKEND_CORS_ORIGINS:
    "No browser client in production yet; FRONTEND_HOST is always allowed.",
  EMAIL_TEST_USER: "Test-only.",
  DEFAULT_TENANT_SLUG: "Default `default`, the seeded tenant.",
  MAX_REQUEST_BODY_SIZE_MB: "Default 25.",
  DB_POOL_SIZE:
    "Default 10 (app engine, per process); config.ts's connectionBudget counts every pool at its maximum against the database's max_connections.",
  DB_MAX_OVERFLOW: "Default 10; counted in connectionBudget.",
  DB_OWNER_POOL_SIZE: "Default 3 (owner engine, per process); counted in connectionBudget.",
  DB_OWNER_MAX_OVERFLOW: "Default 5; counted in connectionBudget.",
  DB_POOL_TIMEOUT: "Default 30 s.",
  JOBS_DB_POOL_MAX: "Default 4 (job queue, per process); counted in connectionBudget.",
  MAX_IN_FLIGHT_REQUESTS:
    "Default 20, below the API's 40 threadpool threads, so a request holding a database connection always gets a thread to finish on.",
  RATE_LIMIT_PER_MINUTE:
    "Left at 0 (off): the bucket is per tenant and every user is in the one default tenant, so any budget would be global. RATE_LIMIT_AI_PER_MINUTE and RATE_LIMIT_ACCOUNT_PER_MINUTE limit per user and per address instead.",
  MINIO_ROOT_USER: "Unused: OBJECT_STORAGE_IAM_AUTH signs with the task role.",
  MINIO_ROOT_PASSWORD:
    "Unused: OBJECT_STORAGE_IAM_AUTH signs with the task role.",
  MEDIA_PUBLIC_ENDPOINT:
    "Unset: phones reach S3's public regional endpoint, the same one the API signs for.",
  DEEPGRAM_MODEL: "Code default (nova-3).",
  DEEPGRAM_BASE_URL: "Code default.",
  DEEPGRAM_TTS_MODEL: "Code default.",
  AI_USD_TO_PHP: "Code default.",
  NEBIUS_BASE_URL: "Code default.",
  NEBIUS_MODEL: "Code default.",
  NEBIUS_VISION_MODEL: "Code default.",
  NEBIUS_VISION_READERS: "Code default.",
  VISION_READ_DEADLINE_SECONDS: "Code default.",
  NEBIUS_EMBEDDING_MODEL: "Code default.",
  OPENROUTER_BASE_URL: "Code default.",
  OPENROUTER_MODEL: "Code default.",
  OCR_DEFAULT_PROVIDER: "OCR is off (OCR_ENABLED=false).",
  OCR_MAX_FILE_SIZE_MB: "OCR is off.",
  OCR_ALLOWED_MIME_TYPES: "OCR is off.",
  AI_CREDENTIALS_KEK_VERSION: "1 until the first key rotation.",
  AI_REQUEST_TIMEOUT_SECONDS: "Code default.",
  MEDIA_MAX_IMAGE_MB: "Code default.",
  MEDIA_MAX_VIDEO_MB: "Code default.",
  MEDIA_MAX_AUDIO_MB: "Code default.",
  MEDIA_MAX_FILE_MB: "Code default.",
  MEDIA_URL_TTL_SECONDS: "Code default.",
  EVENTS_REPLAY_SECONDS: "Code default.",
  EVENTS_HEARTBEAT_SECONDS:
    "Code default 25 s, inside Cloudflare's 100 s limit on a silent proxied response.",
  EXPO_PUSH_URL: "Code default.",
  EXPO_PUSH_RECEIPTS_URL: "Code default.",
  SUPABASE_AUTH_HOOK_SECRET:
    "NOT FILLABLE YET: it signs a Supabase Database Webhook on auth.users, a Supabase-platform feature that self-hosted GoTrue on RDS does not have. Deletions still work (the backend deletes its own row on account deletion); a user deleted directly in GoTrue leaves a local row until a replacement is built.",
  WEATHER_FORECAST_URL: "Code default.",
  WEATHER_GEOCODE_URL: "Code default.",
  WEATHER_CACHE_SECONDS: "Code default.",
}
