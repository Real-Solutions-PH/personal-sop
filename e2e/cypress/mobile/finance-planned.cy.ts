// Finance — planned items (scheduled payments): create, edit, then settle,
// skip and snooze an occurrence. Settling writes ONE record per occurrence
// with the id the server derives: uuid5(ns, "planned-record:<planned>:<day>").
//
// | Screen                 | Action                                        | Test |
// |------------------------|-----------------------------------------------|------|
// | /finance/planned       | "Add scheduled payment" → editor → Save       | create and edit |
// | planned editor         | type, name, amount, account, category, repeats| create and edit |
// | /finance/planned/[id]  | Edit → amount → Save                          | create and edit |
// | /finance/planned/[id]  | "Pay now" → due sheet → "Paid" (settle)       | settle |
// | /finance/planned/[id]  | "Skip next" → toast Undo (unskip)             | skip and snooze |
// | due sheet              | "Snooze"                                      | skip and snooze |
// | /finance/planned/[id]  | Archive → toast Undo                          | archive |
// | /finance/planned/[id]  | "End it", "Make it real"                      | archive (End it) |
import {
  apiSoon,
  categoryId,
  clickUndo,
  dayKey,
  derivedId,
  eventuallyBalances,
  openFinance,
  outboxDrained,
  rowsSoon,
  seedAccount,
} from "./finance.helpers"
import type { LiveUser } from "./support"

function seedPlanned(user: LiveUser, body: Record<string, unknown>) {
  return cy.liveApi<{ id: string; name: string }>(
    user,
    "POST",
    "/finance/planned",
    {
      type: "expense",
      estimated: false,
      end_rule: { kind: "never" },
      auto_log: false,
      is_what_if: false,
      in_projection: true,
      start: dayKey(),
      ...body,
    },
  )
}

const PLANNED = `select name, type, amount_minor::int as amount_minor, schedule,
                        archived, end_rule
                   from planned_item where owner_id = $1 and deleted_at is null`

// Retries: each attempt creates a fresh user; the shared stack is loaded.
describe("finance planned items (live)", {
  retries: { runMode: 2, openMode: 0 },
}, () => {
  it("creates and edits a scheduled payment from the editor", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 1000000,
      }).then((wallet) => {
        openFinance(user, "/finance/planned", "Projection")
        cy.findByRole("button", { name: "Add scheduled payment" }).click()
        cy.findByLabelText("Name").type("Converge fiber")
        cy.findByLabelText("Amount ₱").clear().type("1699.50")
        cy.findByRole("button", { name: "Wallet" }).click()
        cy.findByRole("button", { name: "Choose category" }).click()
        cy.contains("📶 Internet").click()
        cy.findByRole("button", { name: "Monthly" }).click()
        cy.findByLabelText("Day of month").clear().type("12")
        cy.findByRole("button", { name: "Save" }).click()
        rowsSoon(`${PLANNED} and name = 'Converge fiber'`, [user.id]).then(
          ([p]) => {
            expect(p).to.deep.include({
              type: "expense",
              amount_minor: 169950,
              archived: false,
            })
            expect(p.schedule).to.deep.eq({ kind: "monthly", day: 12 })
          },
        )
        rowsSoon(
          `select p.id from planned_item p join category c on c.id = p.category_id
            where p.owner_id = $1 and c.name = 'Internet' and p.account_id = $2`,
          [user.id, wallet.id],
        ).then(([p]) => {
          cy.visit(`/finance/planned/${p.id}`)
          cy.findByRole("button", { name: "Edit" }).click()
          cy.findByLabelText("Amount ₱").clear().type("1800")
          cy.findByRole("button", { name: "Save" }).click()
          rowsSoon(`${PLANNED} and id = $2 and amount_minor = 180000`, [
            user.id,
            p.id,
          ])
          apiSoon<{ amount_minor: number }>(
            user,
            `/finance/planned/${p.id}`,
            (b) => b.amount_minor === 180000,
          )
        })
      })
    })
  })

  it("settles an occurrence: one record, with the derived id", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 1000000,
      }).then((wallet) => {
        categoryId(user, "Electricity").then((elec) => {
          seedPlanned(user, {
            name: "Meralco",
            amount_minor: 200000,
            account_id: wallet.id,
            category_id: elec,
            schedule: { kind: "weekly", every: 1, anchor: dayKey() },
            start: dayKey(),
          }).then((p) => {
            openFinance(user, `/finance/planned/${p.id}`, "Meralco")
            cy.findByRole("button", { name: "Pay now" }).click()
            cy.findByLabelText("Actual amount ₱").clear().type("1234.56")
            cy.findByRole("button", { name: "Paid" }).click()
            cy.findByText("Paid Meralco").should("exist")

            derivedId("planned-record", p.id, dayKey()).then((rid) => {
              rowsSoon(
                `select id, type, amount_minor::int as amount_minor,
                        planned_on::text as planned_on, source, category_id
                   from fin_record
                  where owner_id = $1 and planned_id = $2 and deleted_at is null`,
                [user.id, p.id],
              ).then((rows) => {
                expect(rows).to.have.length(1)
                expect(rows[0]).to.deep.eq({
                  id: rid,
                  type: "expense",
                  amount_minor: 123456,
                  planned_on: dayKey(),
                  source: "planned",
                  category_id: elec,
                })
              })
              cy.liveApi<{
                id: string
                amount_minor: number
                planned_id: string
              }>(user, "GET", `/finance/records/${rid}`).then((r) => {
                expect(r).to.include({
                  id: rid,
                  amount_minor: 123456,
                  planned_id: p.id,
                })
              })
            })
            eventuallyBalances(user, { Wallet: 1000000 - 123456 })
          })
        })
      })
    })
  })

  it("skips (and un-skips) and snoozes an occurrence", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 1000000,
      }).then((wallet) => {
        categoryId(user, "Subscriptions").then((subs) => {
          const tomorrow = dayKey(1)
          seedPlanned(user, {
            name: "Netflix",
            amount_minor: 54900,
            account_id: wallet.id,
            category_id: subs,
            schedule: { kind: "once", date: tomorrow },
            start: tomorrow,
          }).then((skip) => {
            seedPlanned(user, {
              name: "Spotify",
              amount_minor: 19400,
              account_id: wallet.id,
              category_id: subs,
              schedule: { kind: "once", date: tomorrow },
              start: tomorrow,
            }).then((snooze) => {
              openFinance(user, `/finance/planned/${skip.id}`, "Netflix")
              derivedId("planned-skip", skip.id, tomorrow).then((sid) => {
                // Skip, then Undo while the toast shows: no live skip row.
                cy.findByRole("button", { name: "Skip next" }).click()
                clickUndo()
                outboxDrained()
                rowsSoon(
                  `select 1 where not exists (select 1 from planned_skip
                     where id = $1 and deleted_at is null)`,
                  [sid],
                )
                // Skip for real: the skip row, under the server's derived id.
                cy.findByRole("button", { name: "Skip next" }).click()
                rowsSoon(
                  `select id from planned_skip where owner_id = $1 and id = $2
                     and planned_id = $3 and on_day = $4 and deleted_at is null`,
                  [user.id, sid, skip.id, tomorrow],
                )
              })

              cy.visit(`/finance/planned/${snooze.id}`)
              cy.findByRole("button", { name: "Pay now" }).click()
              cy.findByRole("button", { name: "Snooze" }).click()
              derivedId("planned-snooze", snooze.id, tomorrow).then((zid) => {
                rowsSoon(
                  `select until_day::text as until_day from planned_snooze
                    where owner_id = $1 and id = $2 and planned_id = $3
                      and on_day = $4 and deleted_at is null`,
                  [user.id, zid, snooze.id, tomorrow],
                ).then(([z]) => expect(z.until_day).to.eq(dayKey(2)))
              })
              // Neither skip nor snooze writes a record.
              rowsSoon(
                `select count(*)::int as n from fin_record
                  where owner_id = $1 and planned_id is not null`,
                [user.id],
              ).then(([c]) => expect(c.n).to.eq(0))
            })
          })
        })
      })
    })
  })

  it("ends and archives a planned item, and undoes the archive", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 100000,
      }).then((wallet) => {
        categoryId(user, "Rent").then((rent) => {
          seedPlanned(user, {
            name: "Condo rent",
            amount_minor: 1500000,
            account_id: wallet.id,
            category_id: rent,
            schedule: { kind: "monthly", day: 5 },
          }).then((p) => {
            openFinance(user, `/finance/planned/${p.id}`, "Condo rent")
            cy.findByRole("button", { name: "End it" }).click()
            rowsSoon(`${PLANNED} and id = $2 and end_rule->>'kind' = 'date'`, [
              user.id,
              p.id,
            ]).then(([row]) =>
              expect(row.end_rule).to.deep.eq({ kind: "date", date: dayKey() }),
            )
            // Archive + Undo while the toast shows, then archive for real.
            cy.findByRole("button", { name: "Archive" }).click()
            clickUndo()
            outboxDrained()
            rowsSoon(`${PLANNED} and id = $2 and not archived`, [user.id, p.id])
            cy.findByRole("button", { name: "Archive" }).click()
            rowsSoon(`${PLANNED} and id = $2 and archived`, [user.id, p.id])
          })
        })
      })
    })
  })
})
