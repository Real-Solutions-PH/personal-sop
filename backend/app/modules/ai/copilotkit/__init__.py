"""AG-UI chat transport (constitution §5.2, ADR-0007).

The three LangGraph agents are exposed as AG-UI endpoints served straight
from this FastAPI app — LangGraph runs in-process, events stream to the
browser as SSE, and there is no webhook hop or sidecar runtime service.

Routes (all guarded by the bearer-token middleware in ``auth``):

- ``GET  {COPILOTKIT_PATH}``                    — info: lists the agents.
- ``POST {COPILOTKIT_PATH}/agents/{name}``      — run: AG-UI ``RunAgentInput``
  in, SSE event stream out.

The frontend talks to the run routes directly with ``@ag-ui/client``'s
``HttpAgent`` (CopilotKit v2 ``selfManagedAgents``) — there is no CopilotKit
GraphQL runtime anywhere. ``copilotkit.CopilotKitRemoteEndpoint`` /
``add_fastapi_endpoint`` are deliberately NOT used: their agent routes call
``agent.execute()``, which ``LangGraphAGUIAgent`` (an AG-UI agent with
``run()``) does not implement — that protocol is dead code for this path.

Module layout (single concern per file): ``paths`` (mount prefix), ``auth``
(bearer guard middleware), ``routes`` (agent catalog + run routes). No
models/repo/schema — this is a stateless transport; chat persistence lives
in ``app.modules.ai.conversations``.
"""

from fastapi import FastAPI

from .auth import install_copilotkit_auth
from .paths import COPILOTKIT_PATH
from .routes import build_agents, build_agui_router

__all__ = [
    "COPILOTKIT_PATH",
    "build_agents",
    "build_agui_router",
    "install_copilotkit_auth",
    "setup_copilotkit",
]


def setup_copilotkit(app: FastAPI) -> None:
    """Mount the AG-UI chat transport with bearer-token auth."""
    install_copilotkit_auth(app)
    app.include_router(build_agui_router(build_agents()))
