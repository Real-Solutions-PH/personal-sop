from fastapi import APIRouter

from app.modules.capture.journal_routes import router as journal_router
from app.modules.capture.routes import router as capture_router

router = APIRouter()
router.include_router(capture_router)
router.include_router(journal_router)

__all__ = ["router"]
