import warnings
from typing import Annotated, Any, Literal

from pydantic import (
    AnyUrl,
    BeforeValidator,
    EmailStr,
    Field,
    HttpUrl,
    PostgresDsn,
    SecretStr,
    computed_field,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing_extensions import Self


def parse_cors(v: Any) -> list[str] | str:
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",") if i.strip()]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


# The Supabase CLI local stack's well-known demo service-role key (JWT
# payload: iss="supabase-demo"). Public knowledge — shipping it to a hosted
# environment would hand full GoTrue admin access to anyone.
_DEMO_SUPABASE_SERVICE_ROLE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0."
    "EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Use top level .env file (one level above ./backend/)
        env_file="../.env",
        env_ignore_empty=True,
        extra="ignore",
    )
    API_V1_STR: str = "/api/v1"
    FRONTEND_HOST: str = "http://localhost:3000"
    ENVIRONMENT: Literal["local", "staging", "production"] = "local"

    BACKEND_CORS_ORIGINS: Annotated[
        list[AnyUrl] | str, BeforeValidator(parse_cors)
    ] = []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def all_cors_origins(self) -> list[str]:
        return [str(origin).rstrip("/") for origin in self.BACKEND_CORS_ORIGINS] + [
            self.FRONTEND_HOST
        ]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def docs_enabled(self) -> bool:
        """Serve /docs, /redoc and openapi.json in local only.

        Outside a local environment the interactive docs and the schema
        expose the full API surface, so they are disabled entirely.
        """
        return self.ENVIRONMENT == "local"

    PROJECT_NAME: str
    SENTRY_DSN: HttpUrl | None = None
    POSTGRES_SERVER: str
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = ""
    # Non-owner role the app engine connects as so RLS policies are enforced.
    # Provisioned out-of-band (LOGIN + password from the password manager, see
    # the runbook). Empty = fall back to the owner role (RLS stays dormant).
    POSTGRES_APP_USER: str = ""
    POSTGRES_APP_PASSWORD: str = ""

    @computed_field  # type: ignore[prop-decorator]
    @property
    def app_user_configured(self) -> bool:
        return bool(self.POSTGRES_APP_USER)

    def _database_uri(self, username: str, password: str) -> str:
        return str(
            PostgresDsn.build(
                scheme="postgresql+psycopg",
                username=username,
                password=password,
                host=self.POSTGRES_SERVER,
                port=self.POSTGRES_PORT,
                path=self.POSTGRES_DB,
            )
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        """Owner connection: migrations, seeds, platform-operator paths."""
        return self._database_uri(self.POSTGRES_USER, self.POSTGRES_PASSWORD)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLALCHEMY_APP_DATABASE_URI(self) -> str:
        """App connection: the non-owner role RLS is enforced against.

        Falls back to the owner credentials when ``POSTGRES_APP_USER`` is
        unset, leaving RLS dormant (local/dev default).
        """
        # When app_user is set, use ITS password (never silently fall back to
        # the owner's password — that would dial app_user with owner creds and
        # fail auth at connect time). Fall back to owner creds only wholesale.
        if self.POSTGRES_APP_USER:
            return self._database_uri(
                self.POSTGRES_APP_USER, self.POSTGRES_APP_PASSWORD
            )
        return self._database_uri(self.POSTGRES_USER, self.POSTGRES_PASSWORD)

    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: str | None = None
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    EMAILS_FROM_EMAIL: EmailStr | None = None
    EMAILS_FROM_NAME: str | None = None

    @model_validator(mode="after")
    def _set_default_emails_from(self) -> Self:
        if not self.EMAILS_FROM_NAME:
            self.EMAILS_FROM_NAME = self.PROJECT_NAME
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def emails_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.EMAILS_FROM_EMAIL)

    EMAIL_TEST_USER: EmailStr = "test@example.com"
    # Email of the bootstrap superuser; created in GoTrue (with
    # FIRST_SUPERUSER_PASSWORD, for local/CI convenience and test fixtures)
    # and mirrored as a local row with is_superuser=True.
    FIRST_SUPERUSER: EmailStr
    FIRST_SUPERUSER_PASSWORD: str

    # Supabase Auth. Defaults target the local CLI stack
    # (`make supabase-up`); hosted projects override all of these.
    SUPABASE_URL: str = "http://127.0.0.1:54321"
    SUPABASE_ANON_KEY: str = ""
    # Secret, backend-only: full GoTrue admin access.
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    # Override when SUPABASE_URL differs from the issuer baked into tokens
    # (e.g. a containerized backend reaching the stack via host.docker.internal).
    SUPABASE_JWT_ISSUER: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def supabase_issuer(self) -> str:
        return self.SUPABASE_JWT_ISSUER or f"{self.SUPABASE_URL}/auth/v1"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.SUPABASE_URL}/auth/v1/.well-known/jwks.json"

    # Tenancy: slug of the tenant new signups are assigned to.
    DEFAULT_TENANT_SLUG: str = "default"

    # Coarse outer guard on request body size (a per-worker memory-DoS
    # backstop). Must exceed the largest legitimate upload, e.g. OCR files.
    MAX_REQUEST_BODY_SIZE_MB: int = 25

    # Requests admitted at once per worker, counted until their response
    # starts. Must stay below the threadpool's 40 threads so a request that
    # holds a database connection can always get the thread it needs to
    # finish; see ``InFlightLimitMiddleware``. 0 = no limit.
    MAX_IN_FLIGHT_REQUESTS: int = Field(default=20, ge=0, lt=40)

    # Rate limiting: per-tenant token bucket backed by Redis (already in
    # compose). Disabled by default; set a positive per-minute budget to turn
    # it on. The bucket capacity (burst) equals one minute's budget.
    REDIS_URL: str = "redis://redis:6379/0"
    RATE_LIMIT_PER_MINUTE: int = 0
    # Per-user AND per-client-address budgets (requests per minute, also the
    # burst) for the routes that call a model provider (Fern, capture,
    # dictation, speech, OCR, provider tests) and for the account routes that
    # call GoTrue (profile and email change, account deletion). 0 = off.
    RATE_LIMIT_AI_PER_MINUTE: int = 0
    RATE_LIMIT_ACCOUNT_PER_MINUTE: int = 0
    # Header holding the caller's real address when a trusted proxy sits in
    # front (``CF-Connecting-IP`` behind Cloudflare). Unset: the peer address.
    CLIENT_IP_HEADER: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def max_request_body_size_bytes(self) -> int:
        return self.MAX_REQUEST_BODY_SIZE_MB * 1024 * 1024

    MINIO_ENDPOINT: str = "http://minio:9000"
    MINIO_ROOT_USER: str = "minioadmin"
    MINIO_ROOT_PASSWORD: str = "minioadmin"
    MINIO_REGION: str = "us-east-1"
    MINIO_DEFAULT_BUCKET: str = "app-uploads"
    # Production on AWS (infra/): S3 itself, with credentials from the ECS
    # task role through boto3's default chain instead of static keys. When
    # set, MINIO_ROOT_USER/MINIO_ROOT_PASSWORD are ignored.
    OBJECT_STORAGE_IAM_AUTH: bool = False

    def object_storage_credentials(self) -> dict[str, str]:
        """Keyword arguments for ``boto3.client`` credentials: empty under
        IAM auth, so boto3 resolves the task role itself. A method, not a
        computed field, so the keys never appear in a settings dump."""
        if self.OBJECT_STORAGE_IAM_AUTH:
            return {}
        return {
            "aws_access_key_id": self.MINIO_ROOT_USER,
            "aws_secret_access_key": self.MINIO_ROOT_PASSWORD,
        }

    # AI Module
    AI_ENABLED: bool = False

    # Speech to text (constitution §4.2: Deepgram is the default STT). When
    # set, it is the server's transcription default: dictation and voice
    # captures of users without their own transcription credential use it.
    DEEPGRAM_API_KEY: str | None = None
    DEEPGRAM_MODEL: str = "nova-3"
    DEEPGRAM_BASE_URL: str = "https://api.deepgram.com/v1"
    # Text to speech for Fern's replies (Aura-2).
    DEEPGRAM_TTS_MODEL: str = "aura-2-thalia-en"
    # AI spend is metered in pesos (the service's own cost, for every user):
    # provider prices are USD, converted at this rate.
    AI_USD_TO_PHP: float = 57.0

    # LLM Providers
    NEBIUS_API_KEY: str | None = None
    NEBIUS_BASE_URL: str = "https://api.tokenfactory.nebius.com/v1/"
    # Server defaults on the Nebius key (app.modules.ai_providers.catalog lists
    # what a user may pick instead): text for chat/capture, vision for photos.
    NEBIUS_MODEL: str = "deepseek-ai/DeepSeek-V4-Flash-0731"
    NEBIUS_VISION_MODEL: str = "Qwen/Qwen3.8-27B"
    # Photos on the server key are read by several vision models at once and
    # each label number is decided by majority, so one misread digit never
    # becomes a logged value (measured on real labels: 96% agreed and right,
    # the rest flagged unclear, none agreed and wrong). The first listed is
    # also the one whose plate and text description is used.
    NEBIUS_VISION_READERS: str = (
        "Qwen/Qwen3.8-27B,moonshotai/Kimi-K3,openbmb/MiniCPM-V-4_5"
    )
    # How long a photo read waits for its readers; a slow one is left out.
    VISION_READ_DEADLINE_SECONDS: float = 30.0
    # Fern's memory embeddings (multilingual, so Taglish matches English);
    # asked for at EMBEDDING_DIMENSIONS, the width the memory column holds.
    NEBIUS_EMBEDDING_MODEL: str = "Qwen/Qwen3-Embedding-8B"

    OPENROUTER_API_KEY: str | None = None
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_MODEL: str = "meta-llama/llama-3.1-70b-instruct"

    DEFAULT_LLM_PROVIDER: str = "nebius"

    # Tools
    BRAVE_API_KEY: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def brave_search_enabled(self) -> bool:
        return bool(self.BRAVE_API_KEY)

    # OCR Module
    OCR_ENABLED: bool = False
    OCR_DEFAULT_PROVIDER: str = "rapidocr"  # rapidocr | easyocr | granite
    OCR_MAX_FILE_SIZE_MB: int = 10
    OCR_ALLOWED_MIME_TYPES: str = "image/png,image/jpeg,image/tiff,application/pdf"
    OCR_BUCKET: str = "ocr-documents"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def ocr_allowed_mime_list(self) -> list[str]:
        return [m.strip() for m in self.OCR_ALLOWED_MIME_TYPES.split(",") if m.strip()]

    # Jobs Module (background task queue, backed by the Procrastinate worker)
    JOBS_ENABLED: bool = False

    # Mobile API — per-user AI providers. The KEK seals user API keys at rest
    # (app.shared.crypto); 32 bytes, base64. Lives in the secret manager.
    AI_CREDENTIALS_KEK: SecretStr | None = None
    AI_CREDENTIALS_KEK_VERSION: int = 1
    # When a user has no provider of their own, fall back to the server's
    # DEFAULT_LLM_PROVIDER keys. Off: such users get the deterministic engine.
    AI_SERVER_FALLBACK: bool = False
    AI_REQUEST_TIMEOUT_SECONDS: float = 60.0

    # Mobile API — media uploads (presigned MinIO URLs).
    MEDIA_BUCKET: str = "media"
    MEDIA_MAX_IMAGE_MB: int = 15
    MEDIA_MAX_VIDEO_MB: int = 100
    MEDIA_MAX_AUDIO_MB: int = 25
    MEDIA_MAX_FILE_MB: int = 20
    MEDIA_URL_TTL_SECONDS: int = 900
    # Endpoint presigned URLs are signed for, as phones reach object storage
    # (e.g. https://media.example.com). Unset: MINIO_ENDPOINT.
    MEDIA_PUBLIC_ENDPOINT: str | None = None

    # Mobile API — realtime + push.
    EVENTS_REPLAY_SECONDS: int = 300
    EVENTS_HEARTBEAT_SECONDS: int = 25
    EXPO_PUSH_URL: str = "https://exp.host/--/api/v2/push/send"
    EXPO_PUSH_RECEIPTS_URL: str = "https://exp.host/--/api/v2/push/getReceipts"
    EXPO_ACCESS_TOKEN: SecretStr | None = None
    PUSH_ENABLED: bool = False

    # Supabase Auth hook (Standard Webhooks signature, "v1,whsec_<base64>").
    SUPABASE_AUTH_HOOK_SECRET: SecretStr | None = None

    # Weather proxy (Open-Meteo, keyless).
    WEATHER_FORECAST_URL: str = "https://api.open-meteo.com/v1/forecast"
    WEATHER_GEOCODE_URL: str = "https://geocoding-api.open-meteo.com/v1/search"
    WEATHER_CACHE_SECONDS: int = 900

    def _check_default_secret(
        self,
        var_name: str,
        value: str | None,
        insecure_value: str | tuple[str, ...] = "changethis",
    ) -> None:
        insecure_values = (
            (insecure_value,) if isinstance(insecure_value, str) else insecure_value
        )
        if value in insecure_values:
            message = (
                f"The value of {var_name} is a well-known insecure default, "
                "for security, please change it, at least for deployments."
            )
            if self.ENVIRONMENT == "local":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    @model_validator(mode="after")
    def _enforce_non_default_secrets(self) -> Self:
        self._check_default_secret("POSTGRES_PASSWORD", self.POSTGRES_PASSWORD)
        self._check_default_secret(
            "FIRST_SUPERUSER_PASSWORD", self.FIRST_SUPERUSER_PASSWORD
        )
        # Object-store root creds: minioadmin is MinIO's shipped default and
        # changethis is this template's placeholder — both are public knowledge.
        # Under IAM auth the static keys are never sent, so they are not checked.
        if not self.OBJECT_STORAGE_IAM_AUTH:
            self._check_default_secret(
                "MINIO_ROOT_USER", self.MINIO_ROOT_USER, insecure_value="minioadmin"
            )
            self._check_default_secret(
                "MINIO_ROOT_PASSWORD",
                self.MINIO_ROOT_PASSWORD,
                insecure_value=("minioadmin", "changethis"),
            )
        # The CLI stack's demo service-role key is public knowledge; outside
        # a local environment it must never be the configured key.
        self._check_default_secret(
            "SUPABASE_SERVICE_ROLE_KEY",
            self.SUPABASE_SERVICE_ROLE_KEY,
            insecure_value=_DEMO_SUPABASE_SERVICE_ROLE_KEY,
        )
        # An empty service-role key silently breaks JIT provisioning (every
        # GoTrue admin call 500s); outside local it must be set explicitly.
        if self.ENVIRONMENT != "local" and not self.SUPABASE_SERVICE_ROLE_KEY:
            raise ValueError(
                "SUPABASE_SERVICE_ROLE_KEY must be set outside a local environment; "
                "an empty key breaks user provisioning against GoTrue."
            )

        return self


settings = Settings()  # type: ignore
