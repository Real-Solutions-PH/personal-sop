# Onboarding (Devs + AI Agents)

## Day 0 — Access

- [ ] GitHub repo
- [ ] Cloud accounts (read-only first)
- [ ] Sentry, Stripe, etc.
- [ ] Secrets via 1Password / vault
- [ ] On-call rotation (later)

## Day 1 — Local Setup

```bash
# clone
git clone <repo> && cd full-stack-fastapi-template

# env
cp .env.example .env

# spin up
docker compose up -d

# backend
cd backend && uv sync && uv run pytest

# frontend
cd frontend && bun install && bun run dev
```

URLs:
- Frontend: http://localhost:3000
- API: http://localhost:8000
- Docs: http://localhost:8000/docs
- MinIO: http://localhost:9001

## Day 2 — Repo Tour

| Path | What |
|------|------|
| `backend/` | FastAPI app |
| `frontend/` | Next.js app |
| `compose.yml` | service definitions |
| `docs/` | this folder |
| `scripts/` | one-off ops |
| `hooks/` | git/claude hooks |

## Workflow

1. Branch from `master`.
2. TDD — see the testing conventions in [constitution.md](constitution.md).
3. PR with description, screenshots, test plan.
4. Reviewer + CI green -> squash merge.
5. No auto-deploy — promotion is manual, per [13-deployment.md](13-deployment.md).

## AI Agent Context

When starting session, agents should read in order:
1. [../CLAUDE.md](../CLAUDE.md) — repo map, commands, conventions
2. [constitution.md](constitution.md) — engineering defaults
3. [adr/](adr/) — decisions that override the defaults
4. [runbook.md](runbook.md) — operational reality (auth, RLS, tenancy)
5. [10-implementation-plan.md](10-implementation-plan.md)

## Common Commands

| Task | Command |
|------|---------|
| Run tests | `uv run pytest` |
| Lint | `uv run ruff check .` |
| Format | `uv run ruff format .` |
| Migrate | `uv run alembic upgrade head` |
| New migration | `uv run alembic revision --autogenerate -m "msg"` |

## Troubleshooting

- DB connection refused -> `docker compose up -d db`
- Port in use -> `lsof -i :PORT`
- Stale deps -> `uv sync --reinstall` / `bun install --force`
