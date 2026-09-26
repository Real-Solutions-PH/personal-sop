# ADR-0007 — Chat transport: AG-UI over SSE, direct from FastAPI

- **Date:** 2026-07-12
- **Status:** accepted
- **Deciders:** maintainers

## Context

The chat stack shipped with a protocol mismatch: the backend mounted
`copilotkit.CopilotKitRemoteEndpoint` (whose agent routes call
`agent.execute()`, which `LangGraphAGUIAgent` — an AG-UI agent exposing
`run()` — does not implement), while the frontend pointed
`@copilotkit/react-core`'s legacy GraphQL-runtime client directly at that
Python endpoint. No chat turn could complete; every agent run 500'd.

Two viable fixes:

1. **CopilotKit runtime route** — add `@copilotkit/runtime` as a Next.js API
   route (GraphQL in the browser, JSON to Python). Adds a dependency, a
   protocol hop, and a second place where auth must be forwarded.
2. **Direct AG-UI** — CopilotKit v2 (`@copilotkit/react-core/v2`,
   `selfManagedAgents`) drives an `@ag-ui/client` `HttpAgent` straight at a
   FastAPI AG-UI endpoint: `RunAgentInput` in, SSE events out.

## Decision

Direct AG-UI (option 2). The backend registers one AG-UI run route per
LangGraph agent under `/api/v1/copilotkit/agents/{name}` plus an info route
at `/api/v1/copilotkit`, all behind the Supabase bearer-token middleware
(routes are excluded from OpenAPI — the AG-UI protocol is not part of the
REST surface). The frontend uses CopilotKit v2 with an `HttpAgent` subclass
that reads a fresh Supabase access token per run (no stale-token snapshot).
`@copilotkit/react-core` is pinned to ^1.62 and `@ag-ui/client` to the exact
version CopilotKit bundles; `@copilotkit/react-ui` (v1 UI) was dropped.

The `copilotkit` Python package remains solely for `LangGraphAGUIAgent`; its
`CopilotKitRemoteEndpoint`/`add_fastapi_endpoint` protocol is unused.

## Constitution alignment (§4.2)

None — this *implements* the §4.2 default: chat transport is AG-UI over SSE,
LangGraph runs in-process in the FastAPI service, and there is no webhook hop
and no extra service (the CopilotKit GraphQL runtime is not deployed at all).
