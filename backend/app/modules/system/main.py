from fastapi import APIRouter

from app.core.config import settings
from app.modules.system.routes import private_router, utils_router

router = APIRouter()
router.include_router(utils_router)

if settings.ENVIRONMENT == "local":
    router.include_router(private_router)

__all__ = ["router"]
