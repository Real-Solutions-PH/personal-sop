# E2E tests

End-to-end tests for the full stack, driven through a real browser with
[Cypress](https://www.cypress.io/) ([ADR-0004](../docs/adr/0004-cypress-for-e2e.md)).
They exercise the app the way a user does — signup, login, password reset,
items, and user/admin settings — against a running stack.

This package is a [bun](https://bun.sh) workspace member of the root
`package.json` and is linted with [Biome](https://biomejs.dev).

## Prerequisites

The suite talks to a **running stack** — it does not start one for you. Bring
the whole stack up first (from the repo root):

```bash
make supabase-up      # GoTrue auth + Mailpit (auth emails land here)
docker compose watch  # backend, frontend, db, and supporting services
```

Auth emails (password reset, confirmation) are delivered to **Mailpit**, which
ships with the local Supabase stack; the recovery-flow specs poll it for the
reset link.

## Running

From the repo root:

```bash
make e2e-test      # headless run (CI mode)
make e2e-test-ui   # interactive Cypress runner
```

Or from inside `e2e/`:

```bash
bun run test       # cypress run (headless)
bun run test:ui    # cypress open (interactive)
```

CI runs the headless suite in a container built from [`Dockerfile`](./Dockerfile),
a thin wrapper over `cypress/included` whose tag is pinned in lockstep with the
`cypress` version in [`package.json`](./package.json).

## Configuration

[`cypress.config.ts`](./cypress.config.ts) loads the repo-root `.env` and reads:

| Setting | Source | Default |
|---------|--------|---------|
| `baseUrl` | `FRONTEND_HOST` | `http://localhost:3000` |
| `API_URL` | `API_URL` | `http://localhost:8000` |
| `MAILPIT_HOST` | `MAILPIT_HOST` | `http://127.0.0.1:54324` |
| `FIRST_SUPERUSER` / `FIRST_SUPERUSER_PASSWORD` | `.env` | — |

Any OS-level `CYPRESS_*` variable (`CYPRESS_BASE_URL`, `CYPRESS_API_URL`,
`CYPRESS_MAILPIT_HOST`, …) overrides the values above — useful for pointing the
suite at a non-default host in CI.

Specs run with `testIsolation: true` (fresh browser state per test) and retry
failed tests twice in run mode. Screenshots are captured on failure; video is
off.

## Layout

```
cypress/
  e2e/            # specs: login, sign-up, reset-password, items, user-settings, admin
  support/
    commands.ts   # shared custom commands (login, signup, Mailpit helpers)
    e2e.ts        # global setup and the one allowed uncaught-exception ignore
    random.ts     # unique test-data helpers
```

## Custom commands

Defined in [`cypress/support/commands.ts`](./cypress/support/commands.ts):

- `getByTestId(id)` — shorthand for `[data-testid=…]`.
- `loginAs(email, password)` / `loginAsSuperuser()` — UI login cached across
  specs with `cy.session`. UI login is the reliable path for Supabase auth,
  since `@supabase/ssr` manages chunked auth cookies that are fragile to forge.
- `logInUser` / `logOutUser` / `signUpNewUser` — uncached auth flows through
  the real forms.
- `createUserViaApi(email, password)` — creates a verified user through the
  backend's `private` API, which is only mounted in local environments.
- `findRecoveryLink(email)` / `visitRecoveryLink(url)` — poll Mailpit for a
  Supabase recovery link and open it while keeping the PKCE verifier cookie
  intact.
