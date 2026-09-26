# Engineering Constitution

> Pinned copy per §0.1. A version is pinned into each project at kickoff; the pinned copy is treated as read-only and updated by re-pinning a new version, not by editing in place.

A decision-and-reasoning charter that captures the technical engineering defaults — and the thinking behind them — so the same reasoning can be reproduced across **any project**. It is the default source of truth. Deviate only when a specific project requirement justifies it, and record the deviation (see §0.3).

---

# 0. Governance of this document

## 0.1 Scope and placement

- This is a **single universal constitution** for all project types. It contains universal principles plus higher-level guidance for every product category; the AI/RAG stack defaults (§4) apply when the project is an AI/RAG product.
- Every project monorepo receives a **copy pinned to a version** at `docs/constitution.md` at kickoff. Pinned copies are treated as read-only; changes flow in by re-pinning a newer version, not by editing the pinned copy in place.

## 0.2 Versioning and amendment

- The version increments **in the filename and the header line only**. The body never contains version-comparison commentary; deltas belong in `CHANGELOG.md` and in the report accompanying the change.
- **Perishable-fact re-validation:** periodically re-check the perishable facts in this document (licenses, pricing, model landscape, legal thresholds) against current sources.

## 0.3 Deviations

- Any project decision that departs from a default in this document requires a **one-page ADR** at `docs/adr/NNN-title.md`: context → decision → the constitution clause deviated from → rationale. No deviation without an ADR.

---

# 1. How to think (the principles)

- **Simplicity now, foundations for later — know the difference.** Defer application features that are cheap and reversible to add later. Build **foundational/architectural seams early** even if the feature they support ships later, because retrofitting them is a costly rewrite.
- **Right tool for the job, per layer.** Don't overload one tool across concerns. Separate the real-time agent, the data pipeline, and integrations into the tools each is best at.
- **Cost-effective without trading performance or scalability.** Use free tiers only where their terms permit the use; grow into paid/heavier platforms as the project demands. Always name the dominant cost driver and its levers.
- **Lean, AI-augmented team.** Prefer managed / serverless / OSS-you-control over anything you must operate yourself. Always state the ongoing operational burden of a choice.
- **Avoid Kubernetes and self-managed clusters.** Default to managed/serverless. Take on K8s only when a hard requirement forces it — and then scope it as a separate, deliberately-chosen engagement, never a default.
- **OSS and no vendor lock — scoped, not sloganed.** The hard preference applies to **stateful, hard-to-migrate layers**: orchestration code, data pipelines, memory, schemas, and data formats must be OSS or fully owned. Managed SaaS is acceptable for **swappable, stateless services** *if* it sits behind an adapter or has a named exit path. Reject tools whose OSS builds are deliberately crippled to force a cloud upsell, that carry single-vendor relicensing risk, or whose licenses restrict shipping them inside products (see §2.7 license gate).
- **Workflow-automation platforms (n8n, Zapier, Make, etc.) are banned from products.** They are vendor lock with an expensive migration attached. Permitted for PoC/prototype validation only; not recommended even at MVP; allowed at MVP only after the trade-off is understood (record the ADR). Standard integrations are built directly in the backend.
- **Multi-tenant from day one.** The first user is the first tenant. Build once, re-deploy many.
- **Production-grade RAG discipline.** An evaluation pipeline and a golden-dataset flywheel are essential, not optional polish.
- **Front-load visible progress.** Sequence work so demoable momentum lands early.
- **Research-first.** Validate current facts (pricing, versions, licenses, best practices) on the web and cite with dates. Reason from fundamentals only for well-established patterns.
- **Surface major cost/architecture trade-offs as explicit choices** — never decide silently.
- **No absolutes without escape hatches.** Every "always/never" in this document carries a threshold or a deviation condition. If it doesn't, treat §0.3's ADR rule as the escape hatch.

---

# 2. Engineering practice

## 2.1 Repositories

- **Monorepo per project.** Subsystems (data pipeline, second backend for microservices) live inside the same monorepo. A new monorepo requires a genuinely independent project.
- Standard skeleton: `apps/` (web, api) · `packages/` (shared types/clients) · `pipelines/` (ingestion/Dagster) · `infra/` (deploy config, IaC) · `docs/` (pinned constitution, `adr/`, runbook) · `e2e/` (Cypress). Tooling: pnpm workspaces (TS) + uv (Python).

## 2.2 Branching & merging

- **Trunk-based.** Short-lived feature branches off `main`; PR required; **self-merge allowed with CI green**; squash merge; conventional commits (`feat:` `fix:` `chore:` …). `main` is protected against direct pushes and is always releasable.
- **No per-environment branches and no auto-deploy from `main`.** There is a single deployment at any time (§2.5), promoted deliberately.

## 2.3 CI/CD

- **GitHub Actions** on every repo: pre-commit checks, lint, type-check, unit, integration, e2e, license gate (§2.7).
- Deployment is a deliberate, manual promotion — not a pipeline side effect.

## 2.4 Testing floor & Definition of Done

- Floor on every project: **pre-commit hooks + unit tests + integration tests + Cypress e2e per user flow including edge cases** (component tests ride with e2e) + a **final manual test by the developer per change**.
- A change is **Done** when: acceptance criteria met · CI green · **proof-of-test posted** — a video recording or screenshots following the manual step-by-step test instructions · docs/runbook updated if behavior changed.
- A phase is **Done** when all its work is Done and the phase is demoed.

## 2.5 Environments — single-environment lifecycle

- **Only one deployed environment exists at any time.** Most development happens locally.
- **Pre-MVP / pre-production phases:** deploy a **testing environment** to the cloud — free where the platform's terms allow — strictly for internal testing. It never serves real users. Workloads that cannot deploy free (Windows-VM services, long-running processes, heavy pipelines) are out of free-deploy scope → escalate as an explicit decision.
- **Production-targeting phase:** building the **AWS cloud infrastructure is in that phase's scope**. On cutover the environment becomes production and the old testing environment is torn down.
- **Hosting rule: testing environment = Vercel free tier (FE + BE as serverless functions); production = always AWS.** Hetzner is the only alternative, and exclusively for EU data residency (§4.1). No third PaaS.
  - Vercel free BE constraints: 60s max function duration (300s with Fluid compute), limited active CPU/month — fine for CRUD APIs and record-and-respond agent turns; **not viable** for Dagster, WebSockets, or long-running jobs (those escalate per above; pipelines may run locally/on-demand pre-production).
  - **Never rotate accounts or emails to extend any platform's trial.** ToS breach and ban risk mid-engagement.
- **Account ownership (testing env):** the third-party accounts (deploy, tracing, monitoring) are easily replaced — **except the database**: the client creates their own org (e.g. Supabase) and invites the team, or shares credentials if the free tier can't invite.

## 2.6 Coding standards

- Python: **uv + ruff (lint & format) + mypy** on new code. TypeScript: **strict mode + eslint + prettier**.
- Frontend↔backend data layer: **TanStack Query on every project** — normalizes fetching and provides built-in caching.
- API: FastAPI with auto-generated **OpenAPI as the contract**; single JSON error envelope `{code, message, details}`.
- DB migrations: committed to the repo via the migration CLI (e.g. Supabase CLI). Dashboard-only schema changes are prohibited.

## 2.7 Dependencies & license gate

- Renovate (or Dependabot) on every repo, weekly batched PRs, self-merged on CI green.
- **License gate in CI:** builds fail if shipped product code embeds SUL-, BUSL-, or AGPL-licensed components. This automates the workflow-platform ban and prevents the next licensing surprise.

## 2.8 Secrets

- Runtime mechanism: `.env`, git-ignored; credentials provided per environment.
- **Source of truth: a team password manager** (e.g. Bitwarden or Infisical). All credentials live there; `.env` is generated from it; credentials never travel through chat or email; rotate everything at handover and whenever anyone's access ends.

## 2.9 AI-augmented development

- Every repo ships a **`CLAUDE.md`** that references the pinned constitution and project conventions, so every AI session inherits the rules.
- AI-generated code passes the same CI and the same per-change manual test as human code. **No AI-generated diff merges without the developer having read it** — CI green alone is not review.

---

# 3. Security & data protection practice

- **AppSec checklist, run twice per project (design + pre-UAT):** OWASP Top 10 + **OWASP LLM Top 10**. Hard rules: parameterized queries only; LLM output is never executed and never interpolated into SQL/HTML unsanitized; agent tools are allowlisted with typed schemas; destructive tools require human confirmation; Cloudflare WAF on by default.
- **Per-tenant rate limits and per-tenant spend caps with a kill switch.** Abuse of a voice/LLM endpoint is direct money loss; TTS is typically ~90% of voice cost.
- **Trace privacy (default stance):** production traces have **PII redaction/data-masking enabled** (e.g. LangSmith masking) with minimal retention; testing env may keep full traces. Always list subprocessors (LangSmith, OpenRouter, Deepgram, ElevenLabs, …). Disable provider prompt-logging where required.
- **LLM credential store:** provider creds saved in the database with **envelope encryption** — per-tenant data key encrypts creds; master key in the platform KMS (e.g. Supabase Vault); never a bare key in code or `.env`.
- **Backups & DR (documented default, not an SLA):** RPO 24h, RTO best-effort 24h. Daily DB backups (PITR only on a paid tier); weekly automated export of the Markdown source-of-truth + DB dump to an owned bucket. The vector DB is treated as **rebuildable from the Markdown source of truth** — the rebuild procedure is a mandatory runbook page.
- **Incident response:** SEV1 = prod down / data breach · SEV2 = major feature degraded · SEV3 = minor. First move is **rollback, not forward-fix**. SEV1 gets a written postmortem within 5 business days.
- **Personal-data breach:** assess within 24h; notify the relevant regulator and affected data subjects within **72 hours** where the applicable law requires it.

---

# 4. Standard architecture defaults

## 4.1 Universal defaults (every project type)

| Layer | Default | Notes |
|---|---|---|
| Frontend | **React / Next.js (TS)** • **TanStack Query** | Branded web app on every project. |
| Backend | **FastAPI** (Python) | OpenAPI contract; standard error envelope. |
| Data / Auth / Storage | **Supabase** (Postgres · Auth · Storage) | RLS by tenant; client-owned org from day one (§2.5). |
| Hosting | **Vercel free (testing env, FE+BE) → AWS (production, always)** | Cloudflare DNS/WAF. Hetzner only for EU data residency. **No third PaaS.** No K8s (§1). |
| CI/CD | GitHub Actions | §2.3. |
| Error monitoring | **GlitchTip** (Sentry-SDK compatible) | Hosted or self-host; FE+BE SDKs from phase 1. Ultralight alternative: Bugsink. |
| Uptime | **Better Stack free** (10 monitors, 3-min, status page) | UptimeRobot excluded — free plan is non-commercial. |
| Integrations | **Direct API integrations in the backend** | Workflow platforms (n8n/Zapier/Make) banned from products; PoC only (§1). |
| Non-AI products | Apply this table + §2–§3 | The AI/RAG table below simply doesn't attach. Higher-level guidance: same principles. |

## 4.2 AI/RAG product defaults

| Layer | Default | Notes |
|---|---|---|
| Agent orchestration | **LangGraph** (in-process) | Real-time agent as a stateful graph; no webhook hop. |
| Retrieval | **LangGraph subgraph, Strategy pattern** | Two swappable strategies: (1) hybrid (BM25 sparse + dense, Milvus-native); (2) hybrid + re-ranking (SLM/cross-encoder). Same output shape; swap per query/tenant. New strategies = new class, not a refactor. |
| Ingestion / data pipeline | **Dagster** (self-host OSS), two jobs | Job 1: source-specific extractors → normalized Markdown → object storage (citation source of truth). Job 2: chunk + embed → vector DB. Pre-production: run locally/on-demand (won't fit Vercel serverless); managed deploy arrives with the AWS production phase. |
| Source parsing | **Docling** · source APIs · transcript → Whisper fallback | Each source handled its own way; everything normalized to Markdown. Docling = PDF/files → Markdown. |
| Vector DB | **Milvus (Zilliz Cloud)** — always for real builds | HNSW; tenant partitions; content + memory collections; native hybrid (BM25 + dense). **pgvector is permitted for testing/PoC only** — using it further just buys a redundant migration to Milvus later. |
| Model access | **LLM factory: provider-agnostic adapter** | Default OpenRouter; **Nebius as fallback**; any provider connectable. Creds stored encrypted in DB (§3); provider/model/creds config surfaced in the **operator / super-admin UI** so the deployment self-serves and maintenance approaches zero. |
| Model tiering | **SLM + Claude** | SLMs for intermediate single-responsibility tasks (rewrite, re-rank, guardrails, unknown-query detection, memory extraction); Claude for the user-facing agent (Haiku default, Sonnet for hard turns). |
| Embeddings | **No fixed model name — per-project choice** | Choose the cheapest current-gen model that passes retrieval evals for the project's situation. Must stay consistent within a project; **changing the model requires re-embedding all existing vectors.** |
| Memory | **LangGraph store + LangMem** — default placeholder, evaluated per project | Works for PoC/MVP stage. Caveat: LangMem is pre-1.0 with a slow release cadence; fallback is plain LangGraph BaseStore + custom extraction prompts. No Mem0 (crippled OSS + relicensing risk). |
| Tracing | **LangSmith** | Prod: PII masking on (§3). |
| STT | **Deepgram** | Python SDK, streaming, low latency. Whisper/gpt-4o-transcribe = ingestion fallback only. |
| TTS | **ElevenLabs Flash + Professional Voice Cloning** | Voice cloning is the deciding factor. Cartesia (Sonic) = cost-lever alternative (~1/5 the per-minute price). Ruled out: preset-voice-only engines. |
| Chat transport | **AG-UI protocol over SSE only** | Client→server via HTTP POST; server→client via SSE; no WebSocket in MVP. Two input flows: text posts direct to the agent; voice = record → server-side STT (STT optional, not a hard dependency). WebSocket/WebRTC only for continuous live-call/barge-in — which also forces the hosting exception in §2.5. |

**Tool-selection criterion (STT/TTS/etc.):** must run in Python with an SDK/library, or interact via a fully-featured, non-limited API.

## 4.3 RAG design patterns

- **Retrieval behind a Strategy interface** — ship the two strategies above; further strategies (graph, multi-query) slot in as new classes.
- **Ingestion in two jobs** with normalized Markdown in object storage as the citation source of truth (and the DR rebuild source, §3).
- **Citations:** metadata (section, timestamp, char offsets) + raw Markdown retained in Storage → exact-span, auditable citations.
- **Knowledge-gap loop (HITL flywheel):** unknown queries → stored in DB → operator answers in the UI → answer embedded into the KB (+ memory).
- **Guardrails/escalation** via an SLM; log out-of-KB queries as "missing information."
- **Latency target:** voice **p95 < 3 s end-to-end** measured user-stops-speaking → first audio; text **p95 first token < 1.5 s**. Stream everything; prompt caching; cap context to 5–10 chunks; cache TTS audio for FAQs.

## 4.4 AI evaluation — adaptive framework (post-MVP)

Any AI system that produces user-facing generative output and requires evaluation follows a data-flywheel eval discipline, **sized to the system and its risk**. A **RAG or large-agent product → the full framework**. A **smaller / leaner AI system (e.g. a deterministic-backed narrator with no retrieval) → the lean tier**. Guiding principle: *where a deterministic source of truth exists, make the correctness check deterministic and reserve LLM-as-judge / golden-sets for the softer qualities.*

**Full framework (RAG / large AI systems).**

- **Trigger: non-optional once a RAG product has been in production 30 days, and before any prompt/model change ships to prod** (regression gate).
- Monthly evaluation pipeline (Ragas / DeepEval + LangSmith): faithfulness/groundedness, context precision & recall, answer relevancy/correctness, persona adherence, escalation correctness, latency; Dagster-scheduled.
- On-demand SDG pipeline: synthetic Q&A from the KB → pending goldens → **required human review** → final goldens.
- Conversation → dataset curation; feedback capture (thumbs); retrieval-V2 A/B measured by evals; SLM distillation from curated data; analytics + regression/latency alerting.

**Lean framework (small / non-RAG AI systems — e.g. a deterministic-backed narrator).**

- **Deterministic faithfulness first.** Where a deterministic engine / source of truth exists, enforce output↔truth agreement as a **deterministic assertion** (parse the output, compare every number / fact / rule-state to the source, fail on mismatch) — no judge model needed for the core correctness guarantee.
- **Synthetic-silver → operator-gold flywheel.** Seed a small golden set via DeepEval SDG; capture user thumbs in the DB; flagged-bad outputs enter a **pending dataset**; an **operator supplies the expected answer**; on save it promotes to the **golden dataset** (tagged with source + version). Route a small **random production sample** (not only flagged items) for operator review to avoid blind spots.
- **Two cadences:** run the golden set as a **pre-deploy regression gate** (before any prompt / workflow change ships) **and** on a **monthly** trend cadence. Soft qualities (tone, clarity, action sensibility) use LLM-as-judge; hard correctness stays deterministic.
- **Improve via prompt / workflow optimization, not model fine-tuning** (Prompt → RAG → Fine-tune → Distill). Model fine-tuning is reserved for a *measured* gap prompting cannot close.

---

# 5. Decision log (concrete calls that recur, each with its revisit condition)

| Decision | Revisit when |
|---|---|
| Milvus over pgvector for anything real; pgvector = testing/PoC only | Milvus/Zilliz pricing or license changes materially |
| LLM factory: provider-agnostic adapter; OpenRouter default, Nebius fallback; creds encrypted in DB; config in operator UI | A project requires direct-provider contracts or data residency the adapters can't route |
| No fixed embedding model; per-project choice; change ⇒ full re-embed | Never — this is a policy, not a pick |
| SLM + Claude model tiering | Claude pricing/tiering changes; SLM quality closes the gap on the user-facing turn |
| LangGraph for agent + retrieval subgraph; Dagster for ingestion (two jobs) | Either project's governance/license shifts; team size changes the ops calculus |
| Workflow platforms (n8n/Zapier/Make) banned from products; PoC only; MVP only after the trade-off is understood | A platform ships a genuinely OSS, embeddable license |
| LangGraph store + LangMem as memory placeholder, evaluated per project; Mem0 rejected | LangMem hits 1.0 / goes unmaintained |
| Raw Markdown in object storage = citation source of truth + DR rebuild source | Never — load-bearing pattern |
| Deepgram STT / ElevenLabs Flash + PVC; Cartesia as cost lever | Voice cloning stops being the deciding factor; price moves >2× |
| AG-UI over SSE, no WebSocket in MVP; two input flows (text-direct / voice-via-STT) | Continuous live-call/barge-in enters MVP scope |
| Docling + source-specific extractors, everything normalized to Markdown | A source type Docling can't handle becomes common |
| TanStack Query as the FE↔BE data layer | Never within React ecosystem; revisit only on framework change |
| Testing env on Vercel free (FE+BE); production always AWS; no other PaaS (Hetzner only for EU residency); single environment; no account rotation | Vercel enforces Hobby commercial terms against a testing deploy; project needs un-serverless-able workloads earlier |
| GlitchTip (Sentry-SDK) + Better Stack free monitoring | A monitoring stack is already paid for; GlitchTip hosted pricing changes |
| Team password manager as secrets source of truth | The team's tooling changes |
| Evals mandatory after 30 days in prod for RAG products | Never — production-grade discipline |
| No K8s / self-managed clusters; managed/serverless by default; K8s only as separate engagement | A hard requirement forces it (then: separate engagement) |
