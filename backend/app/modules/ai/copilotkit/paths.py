from app.core.config import settings

# Mount prefix for the AG-UI chat transport. Lives in a leaf module so both
# the auth guard and the route builder can import it without a cycle.
COPILOTKIT_PATH = f"{settings.API_V1_STR}/copilotkit"
