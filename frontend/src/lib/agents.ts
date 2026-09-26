// Chat agent catalog exposed by the backend's AG-UI mount (ADR-0007).
// Kept in lockstep with backend/app/modules/ai/copilotkit_setup.py's
// build_agents(); the backend smoke test pins the same three names.
export const AGENT_IDS = ["fast", "react", "plan_and_execute"] as const
