# Contributing

Internal contribution guide for this repository.

## Workflow

1. Branch from `master`.
2. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.
3. Before pushing, run:
   - `uvx prek run --all-files` (or `make pre-commit`)
   - `make backend-lint`
   - The relevant test suites (backend and/or frontend).
4. Open a PR against `master`. PRs require CI to be green before merge.

For development environment setup, see the [Development Guide](development.md).

## Dependency update PRs

Dependabot opens weekly grouped PRs per ecosystem: bun (root + `mobile/`), uv, docker (`backend/` + `frontend/`), docker-compose, and github-actions. Maintainers may self-merge these once CI is green — no second review is required (§3.7).

Exceptions that need a human look before merge:

- Any PR failing CI.
- Major-version bumps of core frameworks (`fastapi`, `next`, `react`, `expo`, `react-native`), especially `expo-*` / `react-native-*` bumps — these are version-coupled, and while mobile CI now runs lint, type-check, and jest-expo unit tests, the unit suite is a floor, not full coverage of native-module behavior.

## License gate

CI (the "License Gate" workflow) fails any PR that adds a shipped dependency with an SUL/BUSL/AGPL-family license (also SSPL) in any workspace — backend, frontend, or mobile. Matching is a case-insensitive substring check against the full license string, so dual-license expressions are caught too. A knowingly-accepted exception requires an ADR in `docs/adr/` and an `allow_packages` entry in `scripts/license-denylist.json` referencing it (§3.7).
