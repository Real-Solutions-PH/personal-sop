from fastapi import APIRouter

from app.modules.ai.agents.main import router as agents_router
from app.modules.ai.conversations.main import router as conversations_router
from app.modules.ai.mcp.main import router as mcp_router
from app.modules.ai.tools.main import router as tools_router

router = APIRouter(prefix="/ai", tags=["ai"])
router.include_router(agents_router)
router.include_router(tools_router)
router.include_router(mcp_router)
router.include_router(conversations_router)

__all__ = ["router"]
