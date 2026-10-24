from fastapi import APIRouter

from app.core.config import settings
from app.modules.ai_providers.main import router as ai_providers_router
from app.modules.audit.main import router as audit_router
from app.modules.capture.main import router as capture_router
from app.modules.companion.main import router as companion_router
from app.modules.dashboard.main import router as dashboard_router
from app.modules.finance.main import router as finance_router
from app.modules.fitness.main import router as fitness_router
from app.modules.focus.main import router as focus_router
from app.modules.habits.main import router as habits_router
from app.modules.iam.main import router as iam_router
from app.modules.items.main import router as items_router
from app.modules.media.main import router as media_router
from app.modules.nutrition.main import router as nutrition_router

# Mobile API domain modules.
from app.modules.profile.main import router as profile_router
from app.modules.realtime.main import router as realtime_router
from app.modules.social.main import router as social_router
from app.modules.stats.main import router as stats_router
from app.modules.sync.main import router as sync_router
from app.modules.system.main import router as system_router
from app.modules.tasks.main import router as tasks_router
from app.modules.weather.main import router as weather_router
from app.modules.webhooks.main import router as webhooks_router

v1_router = APIRouter()
v1_router.include_router(iam_router)
v1_router.include_router(items_router)
v1_router.include_router(system_router)
v1_router.include_router(audit_router)
v1_router.include_router(profile_router)
v1_router.include_router(habits_router)
v1_router.include_router(tasks_router)
v1_router.include_router(fitness_router)
v1_router.include_router(nutrition_router)
v1_router.include_router(focus_router)
v1_router.include_router(finance_router)
v1_router.include_router(capture_router)
v1_router.include_router(ai_providers_router)
v1_router.include_router(stats_router)
v1_router.include_router(dashboard_router)
v1_router.include_router(companion_router)
v1_router.include_router(social_router)
v1_router.include_router(weather_router)
v1_router.include_router(media_router)
v1_router.include_router(sync_router)
v1_router.include_router(realtime_router)
v1_router.include_router(webhooks_router)

if settings.AI_ENABLED:
    from app.modules.ai.main import router as ai_router

    v1_router.include_router(ai_router)
if settings.OCR_ENABLED:
    from app.modules.ocr.main import router as ocr_router

    v1_router.include_router(ocr_router)
if settings.JOBS_ENABLED:
    from app.modules.jobs.main import router as jobs_router

    v1_router.include_router(jobs_router)
