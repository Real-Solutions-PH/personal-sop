.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-24s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------
.PHONY: up watch down build logs ps

up: ## Start all services (dev mode with hot-reload)
	docker compose up -d

watch: ## Rebuild, recreate, and watch all services (foreground)
	docker compose up --build --force-recreate --watch

down: ## Stop all services
	docker compose down

build: ## Build all Docker images
	docker compose build

logs: ## Tail logs for all services
	docker compose logs -f

ps: ## List running containers
	docker compose ps

# ---------------------------------------------------------------------------
# Supabase (local auth stack — GoTrue + JWKS; app tables stay in compose db)
# ---------------------------------------------------------------------------
.PHONY: supabase-up supabase-down

supabase-up: ## Start the local Supabase auth stack (required for backend tests)
	supabase start

supabase-down: ## Stop the local Supabase auth stack (drops its data)
	supabase stop --no-backup

# ---------------------------------------------------------------------------
# Backend
# ---------------------------------------------------------------------------
.PHONY: backend-shell backend-lint backend-format backend-test backend-migrate backend-downgrade backend-revision backend-prestart

backend-shell: ## Open a bash shell in the backend container
	docker compose exec backend bash

backend-lint: ## Run backend linters (mypy, ruff)
	cd backend && uv run mypy app && uv run ruff check app && uv run ruff format app --check

backend-format: ## Auto-format backend code (ruff)
	cd backend && bash scripts/format.sh

backend-test: ## Run backend tests with coverage
	cd backend && bash scripts/test.sh

backend-migrate: ## Run Alembic migrations (upgrade head)
	cd backend && uv run alembic upgrade head

backend-downgrade: ## Downgrade one Alembic migration
	cd backend && uv run alembic downgrade -1

backend-revision: ## Create a new Alembic migration (usage: make backend-revision MSG="add users table")
	cd backend && uv run alembic revision --autogenerate -m "$(MSG)"

backend-prestart: ## Run prestart script (healthcheck + migrations + initial data)
	cd backend && bash scripts/prestart.sh

# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------
.PHONY: frontend-dev frontend-build frontend-lint frontend-preview frontend-generate-client

frontend-dev: ## Start Vite dev server
	cd frontend && bun run dev

frontend-build: ## Build frontend for production
	cd frontend && bun run build

frontend-lint: ## Lint & auto-fix frontend code (Biome)
	cd frontend && bun run lint

frontend-preview: ## Preview production build locally
	cd frontend && bun run preview

frontend-generate-client: ## Generate TypeScript API client from OpenAPI spec
	bash scripts/generate-client.sh

# ---------------------------------------------------------------------------
# E2E (Cypress, e2e/ workspace — needs the stack running)
# ---------------------------------------------------------------------------
.PHONY: e2e-test e2e-test-ui

e2e-test: ## Run Cypress E2E tests headlessly
	cd e2e && bun run test

e2e-test-ui: ## Open the interactive Cypress runner
	cd e2e && bun run test:ui

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
.PHONY: install install-backend install-frontend

install: install-backend install-frontend ## Install all dependencies

install-backend: ## Install backend Python dependencies (uv)
	cd backend && uv sync

install-frontend: ## Install frontend Node dependencies (bun)
	cd frontend && bun install

# ---------------------------------------------------------------------------
# Code Quality
# ---------------------------------------------------------------------------
.PHONY: lint format pre-commit

lint: backend-lint frontend-lint ## Run all linters

format: backend-format frontend-lint ## Run all formatters

pre-commit: ## Run prek (pre-commit) hooks on all files
	uvx prek run --all-files

# ---------------------------------------------------------------------------
# Testing (Docker-based)
# ---------------------------------------------------------------------------
.PHONY: test-docker

test-docker: ## Run backend tests inside Docker (build, up, test, down)
	bash scripts/test.sh

# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------
.PHONY: generate-client clean

generate-client: frontend-generate-client ## Alias for frontend-generate-client

clean: ## Remove Python caches and build artifacts
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .mypy_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name htmlcov -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
	rm -rf frontend/.next
