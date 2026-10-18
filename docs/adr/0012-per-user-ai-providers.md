# ADR-0012: Per-user AI providers and keys

- **Date:** 2026-10-18
- **Status:** accepted
- **Deciders:** owner, tech lead

## Context

The capture engine, the photo flows (meal, receipt, label, statement, whiteboard), voice notes, Sol and the finance advisor are simulated on the device. The owner wants them real, built on the existing `app/modules/ai` (LangChain/LangGraph). They also want each user to choose their own provider, model and API key. The existing factory (`app/modules/ai/llm.py`) only knows server-wide Nebius/OpenRouter keys. IA ruling X-10 fixed OpenRouter as the v1 built-in provider.

## Decision

1. **Providers are OpenAI-compatible only.** One `ChatOpenAI` code path serves the presets: OpenRouter, OpenAI, Anthropic (its OpenAI-compatible endpoint), Gemini (OpenAI-compatible), Groq, Nebius and Together. A "custom" preset takes any base URL, which covers Ollama, LM Studio and vLLM.

2. **Credentials.**
   - **Encryption.** API keys are sealed with AES-256-GCM under a server key-encryption key, `AI_CREDENTIALS_KEK`, held in the secret manager. The owner's user id is bound as associated data.
   - **Key rotation.** The `key_version` column supports rotating the encryption key.
   - **Write-only.** The key never appears in a response schema, a log line, an error message or an audit before/after image. The API exposes only `last4`, `verified_at` and `last_error_code`.

3. **Assignments.** Each user maps each purpose (`chat`, `capture`, `vision`, `transcription`, `advisor`) to a credential and a model id, with a `supports_vision` flag.

4. **One resolution seam.** `ai_providers.public.resolve_model(ctx, purpose)` resolves in this order:
   1. the user's assignment;
   2. the server default, only when `AI_SERVER_FALLBACK` is on;
   3. `None`. Callers then use the ported deterministic rules engine, and the UI shows the existing "fallback" info card.

   `model_factory` is the single substitution point that tests replace with a scripted fake model.

5. **Metering.** Every call writes an `ai_usage` row (tokens and estimated cost). `ai_settings.ai_enabled` and the monthly `spend_cap` are enforced on the server before a call.

6. **Photo handling.** A vision-capable assignment receives the image. Otherwise, and always for statements, the image goes through the OCR module first and the text model interprets the result.

## Constitution clause deviated from

None. §3 (per-tenant spend caps) is satisfied per user, which is stricter.

## Consequences

**Positive:**
- Users control the cost and the vendor.
- The product works with no key at all (the rules engine).
- Testing has one seam.

**Negative:**
- Vendor-specific features outside the OpenAI-compatible surface are unavailable, such as prompt caching and native PDF input.
- Losing the KEK makes every stored key unrecoverable. Users would need to re-enter them, and the runbook says so.

**Follow-ups:**
- Runbook entry for KEK rotation (re-seal under the new version, then retire the old one).
