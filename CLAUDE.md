# CLAUDE.md

This repo follows the **Engineering Constitution** in [docs/constitution.md](docs/constitution.md) — the engineering defaults for the stack. Any deviation from a default is recorded as an ADR in [docs/adr/](docs/adr/) (§0.3).

## Repo map

- `backend/` — FastAPI + SQLModel, managed with `uv`.
- `frontend/` — Next.js 16 (App Router), a bun workspace member of the root `package.json`, linted with Biome.
- `mobile/` — Expo SDK 57, a **standalone** bun project **not** part of the root workspace — run bun commands from inside `mobile/`.
- `e2e/` — Cypress E2E suite (ADR-0004), a bun workspace member of the root `package.json`, linted with Biome.
- `docs/` — numbered context pack + pinned constitution + `adr/` + `runbook.md`.
- `scripts/` — repo-level scripts (client generation, test runners).
- `Makefile` — task entry points for the above.

## Commands

| Workspace | Task | Command |
|---|---|---|
| all | watch stack | `make watch` — `docker compose up --build --force-recreate --watch` (foreground, rebuilds + file-watch) |
| all | local auth stack | `make supabase-up` / `make supabase-down` — Supabase (GoTrue) is the auth provider (ADR-0005); backend tests and any auth flow REQUIRE it running |
| backend | install deps | `uv sync` (from `backend/`) |
| backend | lint | `make backend-lint` (mypy + ruff check + ruff format --check) |
| backend | test | `make test-docker` (containerized) — `make backend-test` runs pytest directly against the configured DB |
| backend | migrate | `make backend-migrate` (upgrade head) / `make backend-revision MSG="..."` |
| frontend | install deps | `bun install` (root) |
| frontend | dev server | `bun run dev` |
| frontend | lint | `bun run lint` (Biome — **mutates**, runs `--write`) |
| e2e | test | `make e2e-test` / `bun run test` (Cypress headless — needs the stack running) |
| e2e | interactive runner | `make e2e-test-ui` / `bun run test:ui` (Cypress open) |
| mobile | install deps | `cd mobile && bun install` |
| mobile | typecheck | `bun run typecheck` (from `mobile/`) |
| mobile | lint | `bun run lint` (from `mobile/`, Biome) |
| mobile | test | `bun run test` (from `mobile/`, jest-expo — always `bun run test`, never `bun test`, which invokes bun's own runner) |

## Codegen rule

**Never hand-edit `frontend/src/client/`.** Regenerate it via `bash scripts/generate-client.sh` after any backend API change — a pre-commit hook enforces this. The mobile client is generated separately via `mobile/openapi-ts.config.ts`.

## Migrations (Alembic)

- **Every schema change goes through Alembic** — no dashboard edits, no manual DDL.
- **Generate:** `make backend-revision MSG="short description"` (autogenerates against the models). Always **read the generated script** — autogenerate misses server defaults, type/enum changes, renames, and any data migration.
- **Apply / roll back:** `make backend-migrate` (upgrade head) · `make backend-downgrade` (one step). Every revision must run cleanly **up and down**.
- **One linear head:** rebase your revision onto the current head rather than branching; don't ship divergent heads.
- **Backfills go in the same revision as the constraint they satisfy** — e.g. add column nullable → backfill → set `NOT NULL` — so the migration is self-contained.
- Commit the revision together with the code that depends on it.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, …).
- Biome is the linter/formatter for TS — not ESLint, not Prettier.
- Backend type-checking is mypy **strict**.
- Docs use `YYYY-MM-DD` dates; update `docs/README.md`'s index when adding a doc.
- Backend tests **wipe `User`/`Item` rows** in whatever DB they point at. `make backend-test` / `bash backend/scripts/test.sh` run pytest directly against the configured (local) DB; use `make test-docker` (root `scripts/test.sh` — builds, runs tests in the compose stack, tears down volumes) when you care about the local DB's contents.

## Pointers

- [development.md](development.md) — local dev setup.
- [docs/13-deployment.md](docs/13-deployment.md) — deployment story.
- [docs/runbook.md](docs/runbook.md) — operational runbook.
- [docs/adr/](docs/adr/) — architecture decision records.
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution workflow.
