// Finance — records: what the transaction screens do lands in the API and in
// Postgres, and account balances follow (server-computed, via the API).
//
// | Screen                  | Action                                    | Test |
// |-------------------------|-------------------------------------------|------|
// | /finance/records        | "Add transaction" → Expense → Save        | expense and income |
// | record editor           | Income tab, category picker, Save         | expense and income |
// | record editor           | Transfer (+ fee)                          | finance-accounts: adjust and transfer |
// | /finance/records/[id]   | Edit → amount, payee → Save               | edit, duplicate, delete, undo |
// | /finance/records/[id]   | Duplicate                                 | edit, duplicate, delete, undo |
// | /finance/records/[id]   | Delete (confirm) → toast Undo             | edit, duplicate, delete, undo |
// | /finance/records/[id]   | "Looks right" (confirm a pending record)  | pending and bulk |
// | /finance/records        | Select → "Category" → pick (recategorise) | pending and bulk |
// | /finance/records        | Select → "Delete" (bulk, confirm)         | pending and bulk |
// | /finance/records        | swipe-to-delete on a row                  | NOT COVERABLE ON WEB: swipe gesture only; same action as bulk Delete |
// | /finance/records        | search, filter & sort sheet               | local view state only (no server effect) |
// | /finance/records/[id]   | "View image" (receipt)                    | NOT COVERABLE: mock toast, no server effect |
import {
  categoryId,
  eventuallyBalances,
  openFinance,
  rowsSoon,
  seedAccount,
} from "./finance.helpers"
import type { LiveUser } from "./support"

const RECORD = `select r.type, r.amount_minor::int as amount_minor, r.payee,
                       c.name as category, r.status, r.edited_at,
                       r.deleted_at
                  from fin_record r left join category c on c.id = r.category_id
                 where r.owner_id = $1 and r.id = $2`

function seedRecord(
  user: LiveUser,
  body: Record<string, unknown>,
): Cypress.Chainable<{ id: string }> {
  return cy
    .liveApi<{ data: { id: string }[] }>(user, "POST", "/finance/records", {
      at: new Date().toISOString(),
      source: "manual",
      ...body,
    })
    .then((b) => b.data[0])
}

describe("finance records (live)", () => {
  it("logs an expense and an income from the editor", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 1000000,
      }).then((wallet) => {
        openFinance(user, "/finance/records", "No transactions yet")

        // Expense ₱1,234.56 at Jollibee, Dining out.
        cy.findByRole("button", { name: "Add transaction" }).click()
        cy.findByLabelText("Amount ₱").type("1234.56")
        cy.findByRole("button", { name: "Wallet" }).click()
        cy.findByLabelText("Payee").type("Jollibee")
        cy.findByRole("button", { name: "Choose category" }).click()
        cy.findByText("Dining out").click()
        cy.findByRole("button", { name: "Save" }).click()

        // Income ₱500.25, Salary.
        cy.findByRole("button", { name: "Add transaction" }).click()
        cy.findByRole("tab", { name: "Income" }).click()
        cy.findByLabelText("Amount ₱").type("500.25")
        cy.findByRole("button", { name: "Wallet" }).click()
        cy.findByRole("button", { name: "Choose category" }).click()
        cy.findByText("Salary").click()
        cy.findByRole("button", { name: "Save" }).click()

        rowsSoon(
          `select r.type, r.amount_minor::int as amount_minor, r.payee,
                  c.name as category, r.account_id, r.source
             from fin_record r join category c on c.id = r.category_id
            where r.owner_id = $1 and r.deleted_at is null
            order by r.type`,
          [user.id],
          2,
        ).then((rows) => {
          expect(rows).to.deep.eq([
            {
              type: "expense",
              amount_minor: 123456,
              payee: "Jollibee",
              category: "Dining out",
              account_id: wallet.id,
              source: "manual",
            },
            {
              type: "income",
              amount_minor: 50025,
              payee: null,
              category: "Salary",
              account_id: wallet.id,
              source: "manual",
            },
          ])
        })
        // 1,000,000 - 123,456 + 50,025.
        eventuallyBalances(user, { Wallet: 926569 })
      })
    })
  })

  it("edits, duplicates, deletes and undoes a record", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 500000,
      }).then((wallet) => {
        categoryId(user, "Groceries").then((groceries) => {
          seedRecord(user, {
            type: "expense",
            amount_minor: 10000,
            account_id: wallet.id,
            category_id: groceries,
            payee: "SM Market",
          }).then((rec) => {
            openFinance(user, `/finance/records/${rec.id}`, "SM Market")

            // Edit: ₱100.00 → ₱99.99, new payee.
            cy.findAllByRole("button", { name: "Edit" }).first().click()
            cy.findByLabelText("Amount ₱").clear().type("99.99")
            cy.findByLabelText("Payee").clear().type("Puregold")
            cy.findByRole("button", { name: "Save" }).click()
            rowsSoon(
              `${RECORD} and r.amount_minor = 9999 and r.edited_at is not null`,
              [user.id, rec.id],
            ).then(([row]) => {
              expect(row).to.include({
                type: "expense",
                payee: "Puregold",
                category: "Groceries",
              })
            })
            eventuallyBalances(user, { Wallet: 490001 })

            // Duplicate: a second record with the same amount.
            cy.findByRole("button", { name: "Duplicate" }).click()
            cy.location("pathname").should("not.contain", rec.id)
            rowsSoon(
              `select id from fin_record where owner_id = $1
                 and amount_minor = 9999 and payee = 'Puregold'
                 and deleted_at is null and id <> $2`,
              [user.id, rec.id],
            )
            eventuallyBalances(user, { Wallet: 480002 })

            // Delete the original, then undo from the toast.
            cy.visit(`/finance/records/${rec.id}`)
            cy.findAllByText("Puregold").should("have.length.at.least", 1)
            cy.findAllByRole("button", { name: "Delete" }).last().click()
            rowsSoon(`${RECORD} and r.deleted_at is not null`, [
              user.id,
              rec.id,
            ])
            eventuallyBalances(user, { Wallet: 490001 })
            cy.findByText("Undo").click()
            rowsSoon(`${RECORD} and r.deleted_at is null`, [user.id, rec.id])
            eventuallyBalances(user, { Wallet: 480002 })
          })
        })
      })
    })
  })

  it("confirms a pending record, recategorises and bulk-deletes", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 300000,
      }).then((wallet) => {
        categoryId(user, "Shopping").then((shopping) => {
          seedRecord(user, {
            type: "expense",
            amount_minor: 4550,
            account_id: wallet.id,
            category_id: shopping,
            payee: "Lazada",
            status: "pending",
          }).then((pending) => {
            seedRecord(user, {
              type: "expense",
              amount_minor: 12000,
              account_id: wallet.id,
              category_id: shopping,
              payee: "Shopee",
            }).then((other) => {
              openFinance(user, `/finance/records/${pending.id}`, "Lazada")
              cy.findByRole("button", { name: "Looks right" }).click()
              rowsSoon(`${RECORD} and r.status = 'cleared'`, [
                user.id,
                pending.id,
              ])

              // Select both, recategorise to Gifts.
              cy.visit("/finance/records")
              cy.findByText("Shopee").should("exist")
              cy.findByRole("button", { name: "Select" }).click()
              cy.contains("Lazada").click()
              cy.contains("Shopee").click()
              cy.findByText("2 selected").should("exist")
              cy.findByRole("button", { name: "Category" }).click()
              cy.findByText("🎁 Gifts").click()
              rowsSoon(
                `select r.id from fin_record r join category c on c.id = r.category_id
                  where r.owner_id = $1 and c.name = 'Gifts' and r.deleted_at is null`,
                [user.id],
                2,
              )

              // Bulk delete both (confirm accepted).
              cy.findByText("Shopee").should("exist")
              cy.get("body").then(($b) => {
                if (!$b.text().includes("2 selected")) {
                  cy.findByRole("button", { name: "Select" }).click()
                  cy.contains("Lazada").click()
                  cy.contains("Shopee").click()
                }
              })
              cy.findByRole("button", { name: "Delete" }).click()
              rowsSoon(
                `select id from fin_record where owner_id = $1
                   and id in ($2, $3) and deleted_at is not null`,
                [user.id, pending.id, other.id],
                2,
              )
              eventuallyBalances(user, { Wallet: 300000 })
            })
          })
        })
      })
    })
  })
})
