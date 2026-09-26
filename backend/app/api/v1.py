from fastapi import APIRouter

from app.core.config import settings
from app.modules.audit.main import router as audit_router
from app.modules.iam.main import router as iam_router
from app.modules.items.main import router as items_router
from app.modules.system.main import router as system_router

v1_router = APIRouter()
v1_router.include_router(iam_router)
v1_router.include_router(items_router)
v1_router.include_router(system_router)
v1_router.include_router(audit_router)

if settings.AI_ENABLED:
    from app.modules.ai.main import router as ai_router

    v1_router.include_router(ai_router)
if settings.OCR_ENABLED:
    from app.modules.ocr.main import router as ocr_router

    v1_router.include_router(ocr_router)
if settings.JOBS_ENABLED:
    from app.modules.jobs.main import router as jobs_router

    v1_router.include_router(jobs_router)
