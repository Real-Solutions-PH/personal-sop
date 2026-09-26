# AI Module

An optional, feature-flagged module that adds an in-process LLM agent (chat)
to the stack. It is **off by default** — nothing about the AI code path runs,
and no provider key is required, until it is explicitly enabled.

## Enabling it

Two flags gate the module, one per surface. Both default to `false` in
[`.env.example`](../.env.example):

| Variable | Surface | Effect when `true` |
|----------|---------|--------------------|
| `AI_ENABLED` | Backend | Mounts the AI routes (`/api/v1/ai/...`), the AG-UI chat transport, and seeds the default agents/tools on startup. |
| `NEXT_PUBLIC_AI_ENABLED` | Frontend | Shows the chat page (`/chat`) and its sidebar entry. Inlined into the Next.js bundle at **build** time, so it is a Docker build arg — changing it needs a rebuild, not just a restart. |

Enable both to use the feature end to end. Enabling only the backend leaves a
working API with no UI; enabling only the frontend shows a chat page with no
backend to answer it.

## LLM providers and keys

Model access goes through a small provider factory
([`backend/app/modules/ai/llm.py`](../backend/app/modules/ai/llm.py)). Two
providers ship, both of which expose an **OpenAI-compatible** API, so a single
`ChatOpenAI` client drives either one by swapping base URL, key, and model:

| Provider | Key | Base URL | Model |
|----------|-----|----------|-------|
| Nebius | `NEBIUS_API_KEY` | `NEBIUS_BASE_URL` | `NEBIUS_MODEL` |
| OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` | `OPENROUTER_MODEL` |

`DEFAULT_LLM_PROVIDER` (`nebius` or `openrouter`) picks which one is used when
a caller does not specify. **At least one provider's key must be set when
`AI_ENABLED=true`** — the default provider's key is the one you need first. Any
other OpenAI-compatible provider can be added by extending the factory.

`BRAVE_API_KEY` is separate: setting it enables a Brave web-search **tool** the
agent can call. Leave it empty to run the agent without web search.

## Chat transport

The chat uses the **AG-UI protocol over SSE**, served directly from FastAPI —
no separate runtime service and no webhook hop. The backend registers one
run route per agent under `/api/v1/copilotkit/agents/{name}` plus an info
route at `/api/v1/copilotkit`, all behind the Supabase bearer-token
middleware. The frontend drives these with CopilotKit v2. See
[ADR-0007](adr/0007-chat-transport-ag-ui.md) for the full rationale and the
protocol-mismatch history behind this choice.

## Spend-cap posture

The Engineering Constitution requires **per-tenant rate limits and per-tenant
spend caps with a kill switch** for any LLM endpoint (§3), because abuse of an
LLM endpoint is direct money loss.

What ships in this template today is the **seam, not the enforcement**. Every
write route calls a single rate-limit choke point
([`backend/app/shared/rate_limit.py`](../backend/app/shared/rate_limit.py)),
but the default backend is a `NullBackend` that always allows — so **no caps
are enforced out of the box**. The documented upgrade path is a Redis token
bucket keyed on `(tenant_id, key)` (the Compose stack already ships a `redis`
service for it), which is also where per-tenant AI spend metering plugs in:
meter cost per call, deny when the bucket or the tenant's spend budget is
exhausted.

**Before running the AI module against a paid provider in any environment real
users can reach, wire a real rate-limit/spend backend.** Until then, protect
the keys and keep the module disabled on any exposed environment.

## Credential-storage note

The constitution's target posture (§3) is that provider credentials live in
the database with **envelope encryption** (per-tenant data key, master key in a
KMS), never as bare keys in code or `.env`. This template currently reads
provider keys from the **environment** (`NEBIUS_API_KEY`, `OPENROUTER_API_KEY`)
for simplicity. Treat those env values as secrets — never commit real keys —
and move to the encrypted-in-DB store when the deployment needs multi-tenant
credential isolation or an operator-managed provider config.
