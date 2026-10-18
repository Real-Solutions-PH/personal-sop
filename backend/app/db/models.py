"""Aggregator module so SQLModel.metadata sees every table.

Alembic autogenerate imports ``SQLModel`` from here; any new module-level
``table=True`` SQLModel must be re-exported below so its table is registered.
"""

from sqlmodel import SQLModel  # noqa: F401

from app.modules.ai.agents.models import Agent  # noqa: F401
from app.modules.ai.conversations.models import Conversation, Message  # noqa: F401
from app.modules.ai.mcp.models import MCPServer  # noqa: F401
from app.modules.ai.tools.models import AgentTool, Tool  # noqa: F401
from app.modules.ai_providers.models import (  # noqa: F401
    AIModelAssignment,
    AIProviderCredential,
    AIUsage,
)
from app.modules.audit.models import AuditLog  # noqa: F401
from app.modules.capture.models import (  # noqa: F401
    AISettings,
    Capture,
    CaptureAttachment,
    CardWriteLog,
    JournalEntry,
    RecordCard,
    ReplyItem,
)
from app.modules.companion.models import (  # noqa: F401
    Companion,
    CompanionMessage,
    Memory,
    Tracker,
)
from app.modules.dashboard.models import (  # noqa: F401
    Goal,
    MissNote,
    Notification,
    Review,
    ShareDefault,
    WrapUp,
)
from app.modules.finance.models import (  # noqa: F401
    Account,
    AdvisorMessage,
    AdvisorThread,
    Budget,
    BudgetCategory,
    Category,
    FinanceSettings,
    FinRecord,
    ImportRow,
    LookBack,
    PlannedItem,
    PlannedSkip,
    PlannedSnooze,
    StatementImport,
)
from app.modules.fitness.models import (  # noqa: F401
    Exercise,
    FitnessSettings,
    MacroTarget,
    Meal,
    MealItem,
    RestTimer,
    TemplateItem,
    WeighIn,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
)
from app.modules.habits.models import (  # noqa: F401
    Habit,
    HabitLog,
    HabitPause,
    HabitSettings,
    HabitTimer,
    Routine,
    RoutineRun,
    RoutineStep,
    RoutineStepResult,
)
from app.modules.iam.permissions.models import Permission  # noqa: F401
from app.modules.iam.rbac.models import RolePermission, UserRole  # noqa: F401
from app.modules.iam.roles.models import Role  # noqa: F401
from app.modules.iam.tenants.models import Tenant  # noqa: F401
from app.modules.iam.users.models import User  # noqa: F401
from app.modules.items.models import Item  # noqa: F401

# Mobile API domain modules.
from app.modules.media.models import (  # noqa: F401
    MediaObject,
)
from app.modules.ocr.models import OcrDocument  # noqa: F401
from app.modules.profile.models import (  # noqa: F401
    Identity,
    LiveSession,
    ModulePref,
    PushDevice,
    SetupSkip,
    UserProfile,
)
from app.modules.social.models import (  # noqa: F401
    Activity,
    Chat,
    ChatMember,
    ChatMessage,
    CloseFriend,
    Comment,
    CommentLike,
    Follow,
    MessageReaction,
    Note,
    NoteLike,
    Post,
    PostLike,
    PostMedia,
    PostSave,
    SocialDraft,
    SocialProfile,
    Story,
    StoryLike,
    StorySeen,
)
from app.modules.stats.models import (  # noqa: F401
    DailyModuleStat,
    LifeScoreDaily,
)
from app.modules.sync.models import (  # noqa: F401
    SyncOpReceipt,
)
from app.modules.tasks.models import (  # noqa: F401
    Task,
    TaskEvent,
    TaskList,
    TaskNotifState,
    TaskSettings,
)
from app.modules.weather.models import (  # noqa: F401
    WeatherCache,
    WeatherPref,
)


def _declare_sync_indexes() -> None:
    """Declare the ``(owner_id, version)`` pull index on every syncable table
    so metadata matches the migration (revision 536c41f13b56)."""
    from sqlalchemy import Index

    for table in SQLModel.metadata.tables.values():
        if "version" in table.c and "owner_id" in table.c:
            name = f"ix_{table.name}_owner_version"
            if not any(ix.name == name for ix in table.indexes):
                Index(name, table.c.owner_id, table.c.version)


_declare_sync_indexes()

__all__ = [
    "SQLModel",
    "Agent",
    "AuditLog",
    "Conversation",
    "Message",
    "MCPServer",
    "AgentTool",
    "Tool",
    "Permission",
    "RolePermission",
    "UserRole",
    "Role",
    "Tenant",
    "User",
    "Item",
    "OcrDocument",
    "MediaObject",
    "UserProfile",
    "ModulePref",
    "Identity",
    "SetupSkip",
    "LiveSession",
    "PushDevice",
    "Habit",
    "HabitPause",
    "HabitLog",
    "Routine",
    "RoutineStep",
    "RoutineRun",
    "RoutineStepResult",
    "HabitTimer",
    "HabitSettings",
    "TaskList",
    "Task",
    "TaskEvent",
    "TaskSettings",
    "TaskNotifState",
    "Exercise",
    "WorkoutTemplate",
    "TemplateItem",
    "Workout",
    "WorkoutExercise",
    "WorkoutSet",
    "RestTimer",
    "WeighIn",
    "MacroTarget",
    "Meal",
    "MealItem",
    "FitnessSettings",
    "Account",
    "Category",
    "FinRecord",
    "Budget",
    "BudgetCategory",
    "PlannedItem",
    "PlannedSkip",
    "PlannedSnooze",
    "StatementImport",
    "ImportRow",
    "LookBack",
    "AdvisorThread",
    "AdvisorMessage",
    "FinanceSettings",
    "Capture",
    "CaptureAttachment",
    "RecordCard",
    "CardWriteLog",
    "ReplyItem",
    "JournalEntry",
    "AISettings",
    "AIProviderCredential",
    "AIModelAssignment",
    "AIUsage",
    "DailyModuleStat",
    "LifeScoreDaily",
    "Goal",
    "Review",
    "WrapUp",
    "MissNote",
    "Notification",
    "ShareDefault",
    "Companion",
    "CompanionMessage",
    "Tracker",
    "Memory",
    "SocialProfile",
    "Follow",
    "CloseFriend",
    "Post",
    "PostMedia",
    "PostLike",
    "PostSave",
    "Comment",
    "CommentLike",
    "Story",
    "StoryLike",
    "StorySeen",
    "Note",
    "NoteLike",
    "Chat",
    "ChatMember",
    "ChatMessage",
    "MessageReaction",
    "Activity",
    "SocialDraft",
    "WeatherPref",
    "WeatherCache",
    "SyncOpReceipt",
]
