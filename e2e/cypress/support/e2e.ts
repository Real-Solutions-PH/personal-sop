import "@testing-library/cypress/add-commands"
import "./commands"

// Known app quirk (pre-dates the Cypress migration): Next.js server
// components fetch the backend API during SSR without the browser's
// Supabase auth context, throw ApiError: Unauthorized, and Next falls back
// to client rendering — which succeeds. The page works; only the recovery
// notice surfaces as an "uncaught exception". Ignore exactly that error;
// anything else still fails the test.
Cypress.on("uncaught:exception", (error) => {
  if (
    error.message.includes(
      "Switched to client rendering because the server rendering errored",
    )
  ) {
    return false
  }
  return true
})
