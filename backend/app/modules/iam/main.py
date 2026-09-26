from fastapi import APIRouter

from app.modules.iam.permissions.main import router as permissions_router
from app.modules.iam.rbac.main import router as rbac_router
from app.modules.iam.roles.main import router as roles_router
from app.modules.iam.tenants.main import router as tenants_router
from app.modules.iam.users.main import router as users_router

router = APIRouter()
router.include_router(users_router)
router.include_router(roles_router)
router.include_router(permissions_router)
router.include_router(rbac_router)
router.include_router(tenants_router)

__all__ = ["router"]
