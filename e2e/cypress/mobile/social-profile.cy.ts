// Social — profile, follows, close friends, scorecard (live mode).
//
// User A is driven through the UI; user B acts through the API. Every action
// is proven through the API and in Postgres.
//
// | Screen               | Action                                   | Test |
// |----------------------|------------------------------------------|------|
// | /social/u/[me]       | Edit profile → /me/profile name + handle | "edits the profile …" |
// | /social/u/[me]       | Scores tab: show scores to followers     | "edits the profile …" (social_profile.show_scores) |
// | /social/u/[me]       | Bio / accent                             | NOT COVERABLE ON WEB: no screen edits them (API-only PATCH /social/me fields) |
// | /social/u/[me]       | Share profile (copies a link)            | NOT COVERABLE ON WEB: clipboard only, no server effect |
// | /social/u/[id]       | Follow / unfollow                        | "follows, unfollows …" |
// | /social/u/[id]       | Add / remove close friend                | "follows, unfollows …" |
// | /social/follows/[id] | Followers / following tabs               | "follows, unfollows …" |
// | /social/u/[id]       | Scores tab: followers-only scorecard     | "the scorecard is followers-only …" |
// | /social/activity     | B follows A → row appears without reload | "B following A reaches A's open Activity screen …" |
// | /social/activity     | Leaving it marks activity read           | "B following A reaches A's open Activity screen …" |
import { namedUser, rows, signIn } from "./social-helpers"

describe("social profile & follows (live)", () => {
  it("edits the profile and the show-scores switch; both reach the server", () => {
    namedUser("Ann").then((a) => {
      signIn(a)
      cy.visit("/social/u/me")
      cy.findByRole("button", { name: "Edit profile" }).click()
      cy.location("pathname").should("eq", "/me/profile")
      const handle = `ed${Date.now().toString(36)}`
      cy.findByRole("textbox", { name: "Name" }).clear().type("Ann Edited")
      cy.findByRole("textbox", { name: "Handle" }).clear().type(handle)
      cy.findByRole("button", { name: "Save" }).click()
      cy.findByText("Profile saved").should("exist")

      cy.eventuallyApi<{ name: string; username: string }>(
        a,
        `/social/people/${a.id}`,
        (p) => p.name === "Ann Edited",
      )
      cy.eventuallyRows(
        "select name, handle from user_profile where owner_id = $1 and name = 'Ann Edited' and handle = $2",
        [a.id, handle],
      )

      // The social profile's own switch: who sees my scores.
      cy.visit("/social/u/me")
      cy.findByRole("tab", { name: "Scores" }).click()
      cy.findByRole("switch", { name: "Show scores to followers" }).click()
      cy.eventuallyRows(
        "select show_scores from social_profile where owner_id = $1 and show_scores = false",
        [a.id],
      )
    })
  })

  it("follows, unfollows and close-friends another user from their profile", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        signIn(a)
        cy.visit(`/social/u/${b.id}`)
        // The header button (the scores tab's lock has a second one).
        cy.findAllByRole("button", { name: `Follow ${b.name}` })
          .first()
          .click()
        cy.findByRole("button", {
          name: `Following ${b.name}. Tap to unfollow`,
        }).should("exist")
        cy.eventuallyApi<{ followers: number; is_following: boolean }>(
          a,
          `/social/people/${b.id}`,
          (p) => p.is_following && p.followers === 1,
        )
        cy.eventuallyRows(
          "select id from follow where owner_id = $1 and followee_id = $2 and deleted_at is null",
          [a.id, b.id],
        )

        // Close friends.
        cy.findByRole("button", { name: "Add to close friends" }).click()
        cy.findByRole("button", { name: "Remove from close friends" }).should(
          "exist",
        )
        cy.eventuallyRows(
          "select id from close_friend where owner_id = $1 and friend_id = $2 and deleted_at is null",
          [a.id, b.id],
        )
        cy.eventuallyApi<{ data: { id: string }[] }>(
          a,
          "/social/close-friends",
          (l) => l.data.some((p) => p.id === b.id),
        )

        // The follows screen lists A among B's followers.
        cy.visit(`/social/follows/${b.id}?tab=followers`)
        cy.findByText(a.handle).should("exist")
        cy.visit("/social/follows/me?tab=following")
        cy.findByText(b.handle).should("exist")

        // Remove the close friend, then unfollow.
        cy.visit(`/social/u/${b.id}`)
        cy.findByRole("button", { name: "Remove from close friends" }).click()
        cy.findByRole("button", { name: "Add to close friends" }).should(
          "exist",
        )
        cy.eventuallyApi<{ close_friend: boolean }>(
          a,
          `/social/people/${b.id}`,
          (p) => !p.close_friend,
        )
        cy.findByRole("button", {
          name: `Following ${b.name}. Tap to unfollow`,
        }).click()
        cy.findAllByRole("button", { name: `Follow ${b.name}` }).should("exist")
        cy.eventuallyApi<{ is_following: boolean; followers: number }>(
          a,
          `/social/people/${b.id}`,
          (p) => !p.is_following && p.followers === 0,
        )
        rows(
          "select id from follow where owner_id = $1 and followee_id = $2 and deleted_at is null",
          [a.id, b.id],
        ).should("have.length", 0)
        rows(
          "select id from close_friend where owner_id = $1 and friend_id = $2 and deleted_at is null",
          [a.id, b.id],
        ).should("have.length", 0)
      })
    })
  })

  it("the scorecard is followers-only, in the UI and on the API", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        // B cannot read A's scorecard until B follows A.
        cy.task("liveToken", { email: b.email, password: b.password }).then(
          (t) =>
            cy
              .request({
                url: `${Cypress.env("API_URL")}/api/v1/social/people/${a.id}/scorecard`,
                headers: { Authorization: `Bearer ${t}` },
                failOnStatusCode: false,
              })
              .its("status")
              .should("eq", 404),
        )
        cy.liveApi(b, "PUT", `/social/people/${a.id}/follow`)
        cy.liveApi<{ person_id: string }>(
          b,
          "GET",
          `/social/people/${a.id}/scorecard`,
        )
          .its("person_id")
          .should("eq", a.id)

        // A, not following B, sees the lock on B's scores tab; after
        // following, the scorecard itself.
        signIn(a)
        cy.visit(`/social/u/${b.id}`)
        cy.findByRole("tab", { name: "Scores" }).click()
        cy.findByText("Scores are for followers").should("exist")
        cy.findAllByRole("button", { name: `Follow ${b.name}` })
          .first()
          .click()
        cy.findByText("Scores are for followers").should("not.exist")
        // Following loads the card; the server computes it from stats (slow).
        cy.findByText(/LIFE SCORE · 30 DAYS/, { timeout: 60000 }).should(
          "exist",
        )
        cy.eventuallyRows(
          "select id from follow where owner_id = $1 and followee_id = $2 and deleted_at is null",
          [a.id, b.id],
        )
      })
    })
  })

  it("B following A reaches A's open Activity screen without a reload", () => {
    namedUser("Bea").then((b) => {
      namedUser("Ann").then((a) => {
        signIn(a)
        cy.visit("/social/activity")
        cy.findByText("No activity yet").should("exist")
        cy.window().then((win) => {
          // Marks the page: a reload would drop it.
          ;(win as unknown as { __noReload: boolean }).__noReload = true
        })
        cy.liveApi(b, "PUT", `/social/people/${a.id}/follow`)
        cy.findByText(/started following you/, { timeout: 15000 }).should(
          "exist",
        )
        cy.findByText(b.handle, { exact: false }).should("exist")
        cy.window().its("__noReload").should("eq", true)
        cy.eventuallyRows(
          "select id from activity where owner_id = $1 and actor_id = $2 and kind = 'follow' and deleted_at is null",
          [a.id, b.id],
        )
        cy.eventuallyRows(
          "select id from follow where owner_id = $1 and followee_id = $2 and deleted_at is null",
          [b.id, a.id],
        )
        // Leaving the Activity screen (in-app, not a reload) marks it read.
        cy.findByRole("button", { name: "Back" }).click()
        cy.eventuallyApi<{ activity_unread: number }>(
          a,
          "/social/badges",
          (x) => x.activity_unread === 0,
        )
        cy.eventuallyRows(
          "select activity_read_at from social_profile where owner_id = $1 and activity_read_at is not null",
          [a.id],
        )
      })
    })
  })
})
