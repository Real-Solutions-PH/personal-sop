// Finance — statement import.
//
// The server pipeline — upload → reconcile → commit → undo → restore — is
// proven through the API with a small CSV fixture. The mobile import screen
// runs that same pipeline in live mode (mobile/src/live/finance-import.ts):
// its sample statements upload as GCash/BPI CSV exports, the server matches
// them against the user's real accounts, and the commit is the server's, so
// the records it writes carry the import's id.
//
// | Screen / surface         | Action                                         | Test |
// |--------------------------|------------------------------------------------|------|
// | API /finance/imports     | start, CSV upload, review rows, match          | server pipeline |
// | API /finance/imports     | accept / set category / ignore rows            | server pipeline |
// | API /finance/imports     | commit, undo, restore, re-commit (same ids)    | server pipeline |
// | API /finance/imports     | discard draft → restore                        | discard and restore |
// | /finance/import          | pick account + sample file, "Upload & read"    | screen flow |
// | /finance/import/[id]     | wrong account → "Use detected account"         | screen flow |
// | /finance/import/[id]     | Fix row → Ignore; Apply; transfer account      | screen flow |
// | /finance/import/[id]     | "Undo import"                                  | screen flow |
// | /finance/imports         | Save draft, history, Discard (+ toast Undo)    | screen flow (history) |
// | /finance/import          | "Browse files" (a real CSV from disk)          | NOT COVERED ON WEB: expo-document-picker opens the OS file dialog from a detached <input>, which Cypress cannot drive; the picked-CSV path is covered by jest (detectCsv + the shared upload) |
import {
  categoryId,
  clickUndo,
  derivedId,
  eventuallyBalances,
  openFinance,
  rowsSoon,
  seedAccount,
} from "./finance.helpers"
import type { LiveUser } from "./support"

const day = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

interface Row {
  id: string
  payee: string
  amount_minor: number
  direction: string
  state: string
}

function csv() {
  return [
    "Date,Description,Amount",
    `${day(5)},JOLLIBEE MAKATI,-250.00`,
    `${day(4)},MERALCO BILL PAYMENT,-1234.56`,
    `${day(3)},PAYROLL CREDIT ACME INC,15000.00`,
    `${day(2)},7-ELEVEN ORTIGAS,-89.75`,
    "",
  ].join("\n")
}

function startCsvImport(user: LiveUser, accountId: string) {
  return cy
    .liveApi<{ id: string }>(user, "POST", "/finance/imports", {
      account_id: accountId,
      file_name: "statement.csv",
      file_type: "csv",
    })
    .then((imp) =>
      cy
        .liveApi<{ status: string }>(
          user,
          "POST",
          `/finance/imports/${imp.id}/csv`,
          {
            text: csv(),
            layout: "generic",
            mapping: {
              date: "Date",
              description: "Description",
              amount: "Amount",
            },
          },
        )
        .then((after) => {
          expect(after.status).to.eq("review")
          return imp.id
        }),
    )
}

// Retries: each attempt creates a fresh user; the shared stack is loaded.
describe("finance statement import (live)", {
  retries: { runMode: 2, openMode: 0 },
}, () => {
  it("server pipeline: CSV upload → reconcile → commit → undo → restore", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "BDO",
        type: "bank",
        opening_minor: 100000,
      }).then((acct) => {
        categoryId(user, "Dining out").then((dining) => {
          // An existing record the statement's Jollibee line should match.
          cy.liveApi<{ data: { id: string }[] }>(
            user,
            "POST",
            "/finance/records",
            {
              type: "expense",
              amount_minor: 25000,
              account_id: acct.id,
              category_id: dining,
              payee: "Jollibee",
              at: `${day(5)}T04:00:00Z`,
              source: "manual",
            },
          ).then(({ data: [existing] }) => {
            startCsvImport(user, acct.id).then((importId) => {
              rowsSoon(
                `select status, file_type, period_from::text as period_from,
                        period_to::text as period_to
                   from statement_import where owner_id = $1 and id = $2`,
                [user.id, importId],
              ).then(([imp]) => {
                expect(imp).to.deep.eq({
                  status: "review",
                  file_type: "csv",
                  period_from: day(5),
                  period_to: day(2),
                })
              })
              rowsSoon(
                `select payee, amount_minor::int as amount_minor, direction, state
                   from import_row where owner_id = $1 and import_id = $2
                  order by position`,
                [user.id, importId],
                4,
              ).then((rows) => {
                expect(
                  rows.map((r) => [r.amount_minor, r.direction]),
                ).to.deep.eq([
                  [25000, "out"],
                  [123456, "out"],
                  [1500000, "in"],
                  [8975, "out"],
                ])
                // Reconcile: the Jollibee line matched the existing record.
                expect(rows[0].state).to.not.eq("new")
              })

              cy.liveApi<{ rows: (Row & { match_id?: string })[] }>(
                user,
                "GET",
                `/finance/imports/${importId}`,
              ).then(({ rows }) => {
                const [jollibee, meralco, payroll, seven] = rows
                expect(jollibee.state).to.eq("matched")
                categoryId(user, "Electricity").then((elec) => {
                  categoryId(user, "Salary").then((salary) => {
                    const patch = (body: Record<string, unknown>) =>
                      cy.liveApi(
                        user,
                        "PATCH",
                        `/finance/imports/${importId}/rows`,
                        body,
                      )
                    patch({
                      row_ids: [meralco.id],
                      decision: "accept",
                      category_id: elec,
                    })
                    patch({
                      row_ids: [payroll.id],
                      decision: "accept",
                      category_id: salary,
                    })
                    patch({ row_ids: [seven.id], decision: "ignore" })
                    rowsSoon(
                      `select decision from import_row where id = $1 and decision = 'ignore'`,
                      [seven.id],
                    )

                    cy.liveApi<{
                      created: number
                      ignored: number
                      matched: number
                    }>(
                      user,
                      "POST",
                      `/finance/imports/${importId}/commit`,
                      {},
                    ).then((out) => {
                      expect(out).to.include({ created: 2, ignored: 1 })
                    })
                    const CREATED = `select r.id, r.type, r.amount_minor::int as amount_minor,
                                            c.name as category, r.source
                                       from fin_record r join category c on c.id = r.category_id
                                      where r.owner_id = $1 and r.import_id = $2 and r.id <> $3
                                        and r.deleted_at is null
                                      order by r.amount_minor`
                    rowsSoon(CREATED, [user.id, importId, existing.id], 2).then(
                      (created) => {
                        expect(
                          created.map((r) => [
                            r.type,
                            r.amount_minor,
                            r.category,
                          ]),
                        ).to.deep.eq([
                          ["expense", 123456, "Electricity"],
                          ["income", 1500000, "Salary"],
                        ])
                        const ids = created.map((r) => r.id)
                        rowsSoon(
                          "select status from statement_import where id = $1 and status = 'done'",
                          [importId],
                        )
                        // 100,000 - 25,000 (existing) - 123,456 + 1,500,000.
                        eventuallyBalances(user, { BDO: 1451544 })
                        // The matched record is untouched, not duplicated.
                        rowsSoon(
                          `select id from fin_record where owner_id = $1
                           and amount_minor = 25000 and deleted_at is null`,
                          [user.id],
                        ).then((m) => {
                          expect(m.map((r) => r.id)).to.deep.eq([existing.id])
                        })

                        // Undo: only what the import added goes.
                        cy.liveApi(
                          user,
                          "POST",
                          `/finance/imports/${importId}/undo`,
                        )
                        rowsSoon(
                          "select status from statement_import where id = $1 and status = 'undone'",
                          [importId],
                        )
                        rowsSoon(
                          `select id from fin_record where id = any($1::uuid[])
                           and deleted_at is not null`,
                          [ids],
                          2,
                        )
                        eventuallyBalances(user, { BDO: 75000 })

                        // Restore: back to review with its rows; re-commit revives
                        // the same derived record ids (no duplicates).
                        cy.liveApi(
                          user,
                          "POST",
                          `/finance/imports/${importId}/restore`,
                        )
                        rowsSoon(
                          "select status from statement_import where id = $1 and status = 'review'",
                          [importId],
                        )
                        rowsSoon(
                          "select id from import_row where import_id = $1",
                          [importId],
                          4,
                        )
                        cy.liveApi(
                          user,
                          "POST",
                          `/finance/imports/${importId}/commit`,
                          {},
                        )
                        rowsSoon(
                          CREATED,
                          [user.id, importId, existing.id],
                          2,
                        ).then((again) => {
                          expect(again.map((r) => r.id)).to.deep.eq(ids)
                        })
                        rowsSoon(
                          `select count(*)::int as n from fin_record
                          where owner_id = $1 and import_id = $2 and id <> $3`,
                          [user.id, importId, existing.id],
                        ).then(([c]) => expect(c.n).to.eq(2))
                        eventuallyBalances(user, { BDO: 1451544 })
                      },
                    )
                  })
                })
              })
            })
          })
        })
      })
    })
  })

  it("server pipeline: a discarded draft can be restored", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "BDO",
        type: "bank",
        opening_minor: 100000,
      }).then((acct) => {
        startCsvImport(user, acct.id).then((importId) => {
          cy.liveApi(user, "DELETE", `/finance/imports/${importId}`)
          rowsSoon(
            "select id from statement_import where id = $1 and deleted_at is not null",
            [importId],
          )
          cy.liveApi(user, "POST", `/finance/imports/${importId}/restore`)
          rowsSoon(
            `select status from statement_import
              where id = $1 and deleted_at is null and status = 'review'`,
            [importId],
          )
          cy.liveApi<{ data: { id: string }[] }>(
            user,
            "GET",
            "/finance/imports",
          ).then((b) => expect(b.data.map((i) => i.id)).to.include(importId))
        })
      })
    })
  })

  it("screen flow: a sample statement is read, reviewed and committed on the server", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "GCash",
        type: "ewallet",
        opening_minor: 500000,
      }).then((gcash) => {
        seedAccount(user, {
          name: "BPI",
          type: "bank",
          opening_minor: 1000000,
        }).then((bpi) => {
          // Start on the bank account with the GCash export: the server's
          // layout check refuses it, and the prompt offers the user's own
          // GCash account (not a demo id).
          openFinance(user, `/finance/import?account=${bpi.id}`, "GCash")
          cy.contains("GCash_Transaction_History.csv").click()
          cy.findByRole("button", { name: "Upload & read" }).click()
          cy.location("pathname").should("match", /^\/finance\/import\/.+/)
          cy.findByText("This looks like a different account", {
            timeout: 120000,
          }).should("exist")
          cy.contains("the file looks like GCash.").should("exist")
          cy.findByRole("button", { name: "Use detected account" }).click()
          cy.findByText("Match with statement", { timeout: 120000 }).should(
            "exist",
          )

          rowsSoon(
            `select id, account_id::text as account_id, status, file_type, file_name
               from statement_import where owner_id = $1`,
            [user.id],
          ).then(([imp]) => {
            expect(imp).to.deep.include({
              account_id: gcash.id,
              status: "review",
              file_type: "csv",
              file_name: "GCash_Transaction_History.csv",
            })
            const importId = imp.id as string
            // The screen shows the server's rows: its row count is the
            // number of import_row rows in Postgres.
            cy.contains(/· \d+ rows$/)
              .invoke("text")
              .then((text) => {
                const n = Number(/(\d+) rows$/.exec(text)?.[1])
                expect(n).to.be.greaterThan(0)
                rowsSoon(
                  "select id from import_row where import_id = $1 and deleted_at is null",
                  [importId],
                  n,
                ).then((rows) => expect(rows).to.have.length(n))
              })
            // The sample has cash-in lines, which the server reads as
            // transfers (they need the account on the other side).
            rowsSoon(
              "select id from import_row where import_id = $1 and is_transfer",
              [importId],
            )

            // Fix row → Ignore on the first new row: a server row patch.
            cy.findByRole("tab", { name: /^New \d+$/ }).click()
            // A row's "new" pill sits inside its tappable row (the first
            // "new" on the page is the counts label, so take the last).
            cy.findAllByText("new").last().click()
            cy.findByText("Fix row").should("exist")
            cy.findByRole("button", { name: "Ignore" }).click()
            rowsSoon(
              `select position from import_row
                where import_id = $1 and decision = 'ignore'`,
              [importId],
            ).then(([ignored]) => {
              // Apply: the transfer rows ask for their other account.
              cy.findByRole("button", { name: /^Apply \d+ changes$/ }).click()
              cy.findByText("Transfers came from", { timeout: 30000 }).should(
                "exist",
              )
              // The sheet renders above the review (react-native-web
              // keeps a copy of the modal's content behind it).
              cy.findAllByText("BPI").last().click()
              cy.findByText(/^Imported — \d+ added/, {
                timeout: 120000,
              }).should("exist")

              rowsSoon(
                `select created_ids, counts from statement_import
                  where id = $1 and status = 'done'`,
                [importId],
              ).then(([done]) => {
                const created = done.created_ids as string[]
                expect(created.length).to.be.greaterThan(0)
                // Every record the commit wrote carries the import's id.
                rowsSoon(
                  `select id, type, account_id::text as account_id,
                          to_account_id::text as to_account_id
                     from fin_record
                    where owner_id = $1 and import_id = $2 and deleted_at is null`,
                  [user.id, importId],
                  created.length,
                ).then((recs) => {
                  expect(recs.map((r) => r.id).sort()).to.deep.eq(
                    [...created].sort(),
                  )
                  // Cash-in: from BPI into GCash (no demo "bpi" id).
                  const transfers = recs.filter((r) => r.type === "transfer")
                  expect(transfers.length).to.be.greaterThan(0)
                  for (const t of transfers)
                    expect([t.account_id, t.to_account_id]).to.have.members([
                      bpi.id,
                      gcash.id,
                    ])
                })
                // Record ids are the server's derived ids (computed here
                // independently); the ignored row wrote nothing.
                derivedId(
                  "import-record",
                  importId,
                  String(ignored.position),
                ).then((skipped) => {
                  expect(created).to.not.include(skipped)
                })
                rowsSoon(
                  `select position from import_row
                    where import_id = $1 and state = 'new' and decision = 'accept'
                    order by position limit 1`,
                  [importId],
                ).then(([first]) =>
                  derivedId(
                    "import-record",
                    importId,
                    String(first.position),
                  ).then((id) => expect(created).to.include(id)),
                )
                // Nothing the screen imported arrived unlinked.
                cy.task<Record<string, unknown>[]>("sql", {
                  text: `select id from fin_record where owner_id = $1
                          and source = 'import' and import_id is null`,
                  values: [user.id],
                }).then((orphans) => expect(orphans).to.have.length(0))

                // Undo on the summary screen reverts it on the server.
                cy.findByText("GCash matched with statement", {
                  timeout: 120000,
                }).should("exist")
                cy.findByRole("button", { name: "Undo import" }).click()
                cy.findByText("Import undone", { timeout: 120000 }).should(
                  "exist",
                )
                rowsSoon(
                  "select id from statement_import where id = $1 and status = 'undone'",
                  [importId],
                )
                rowsSoon(
                  `select id from fin_record where id = any($1::uuid[])
                    and deleted_at is not null`,
                  [created],
                  created.length,
                )
              })
            })
          })
        })
      })
    })
  })

  it("screen flow (history): a saved draft is discarded and restored on the server", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "GCash",
        type: "ewallet",
        opening_minor: 500000,
      }).then((gcash) => {
        openFinance(user, `/finance/import?account=${gcash.id}`, "GCash")
        cy.contains("GCash_Transaction_History.csv").click()
        cy.findByRole("button", { name: "Upload & read" }).click()
        cy.findByText("Match with statement", { timeout: 120000 }).should(
          "exist",
        )
        rowsSoon(
          "select id from statement_import where owner_id = $1 and status = 'review'",
          [user.id],
        ).then(([imp]) => {
          cy.findByRole("button", { name: "Save draft" }).click()
          cy.location("pathname").should("eq", "/finance/imports")
          cy.findByRole("button", { name: "Discard import" }).click()
          rowsSoon(
            "select id from statement_import where id = $1 and deleted_at is not null",
            [imp.id],
          )
          clickUndo()
          rowsSoon(
            `select id from statement_import
              where id = $1 and deleted_at is null and status = 'review'`,
            [imp.id],
          )
          cy.findByRole("button", { name: "Resume" }).should("exist")
        })
      })
    })
  })
})
