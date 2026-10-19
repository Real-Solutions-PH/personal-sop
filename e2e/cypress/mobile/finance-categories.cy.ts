// Finance — categories and budgets: what the screens do lands in the API and
// in Postgres.
//
// | Screen                 | Action                                          | Test |
// |------------------------|-------------------------------------------------|------|
// | /finance/categories    | "Add category" → name, icon → Save              | create, sub-category, edit |
// | /finance/categories    | "Add sub-category to X" → Want off → Save       | create, sub-category, edit |
// | category editor        | rename → Save                                   | create, sub-category, edit |
// | /finance/categories    | want/need chip                                  | create, sub-category, edit |
// | category editor        | Delete (unused, confirm)                        | delete unused |
// | category editor        | Delete (used) → pick target → "Move & delete"   | delete and move |
// | /finance/categories    | reorder sub-category (DragHandle)               | NOT COVERABLE ON WEB: drag gesture only; no button alternative |
// | /finance/budgets       | "Add budget" → categories, limit → Save         | budget create, edit, pace |
// | budget editor          | limit → Save (edit)                             | budget create, edit, pace |
// | /finance/budgets/[id]  | spent / pace                                    | budget create, edit, pace (API) |
// | budget editor          | Archive → toast Undo; Delete                    | budget archive and delete |
import {
  apiSoon,
  categoryId,
  clickUndo,
  dayKey,
  openFinance,
  outboxDrained,
  rowsSoon,
  seedAccount,
} from "./finance.helpers"

const CAT = `select id, name, kind, icon, parent_id, discretionary
               from category where owner_id = $1 and deleted_at is null`

// Retries: each attempt creates a fresh user; the shared stack is loaded.
describe("finance categories and budgets (live)", {
  retries: { runMode: 2, openMode: 0 },
}, () => {
  it("creates a category, a sub-category, renames and flips want/need", () => {
    cy.newLiveUser("fin").then((user) => {
      openFinance(user, "/finance/categories", "Dining out")
      cy.findByRole("button", { name: "Add category" }).click()
      cy.findByLabelText("Name").type("Pets")
      cy.findByRole("button", { name: "Icon 🐶" }).click()
      cy.findByRole("button", { name: "Save" }).click()
      rowsSoon(`${CAT} and name = 'Pets'`, [user.id]).then(([pets]) => {
        expect(pets).to.deep.include({
          kind: "expense",
          icon: "🐶",
          parent_id: null,
          discretionary: true,
        })

        cy.findByRole("button", { name: "Add sub-category to Pets" }).click()
        cy.findByLabelText("Name").type("Vet")
        cy.findByRole("switch", { name: "Want" }).click()
        cy.findByRole("button", { name: "Save" }).click()
        rowsSoon(`${CAT} and name = 'Vet'`, [user.id]).then(([vet]) => {
          expect(vet).to.deep.include({
            parent_id: pets.id,
            discretionary: false,
          })
        })

        // Rename.
        cy.contains("Pets").click()
        cy.findByLabelText("Name").clear().type("Pet care")
        cy.findByRole("button", { name: "Save" }).click()
        rowsSoon(`${CAT} and id = $2 and name = 'Pet care'`, [user.id, pets.id])

        // want → need from the list chip.
        cy.contains("Pet care")
          .closest("[role=button]")
          .parent()
          .within(() => cy.contains("want").click())
        rowsSoon(`${CAT} and id = $2 and not discretionary`, [user.id, pets.id])
        apiSoon<{
          data: { id: string; name: string; discretionary: boolean }[]
        }>(user, "/finance/categories", (b) =>
          b.data.some(
            (c) =>
              c.id === pets.id && c.name === "Pet care" && !c.discretionary,
          ),
        )
      })
    })
  })

  it("deletes an unused category", () => {
    cy.newLiveUser("fin").then((user) => {
      cy.liveApi<{ id: string }>(user, "POST", "/finance/categories", {
        name: "Hobbies",
        kind: "expense",
        icon: "🏷️",
      }).then((hobbies) => {
        openFinance(user, "/finance/categories", "Hobbies")
        cy.contains("Hobbies").click()
        cy.findByRole("button", { name: "Delete" }).click()
        rowsSoon(
          "select id from category where id = $1 and deleted_at is not null",
          [hobbies.id],
        )
      })
    })
  })

  it("deletes a used category, moving its records to another", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 100000,
      }).then((wallet) => {
        cy.liveApi<{ id: string }>(user, "POST", "/finance/categories", {
          name: "Hobbies",
          kind: "expense",
          icon: "🏷️",
        }).then((hobbies) => {
          cy.liveApi<{ data: { id: string }[] }>(
            user,
            "POST",
            "/finance/records",
            {
              type: "expense",
              amount_minor: 75025,
              account_id: wallet.id,
              category_id: hobbies.id,
              payee: "Craft shop",
              at: new Date().toISOString(),
              source: "manual",
            },
          ).then(({ data: [rec] }) => {
            openFinance(user, "/finance/categories", "Hobbies")
            cy.contains("Hobbies").click()
            cy.findByRole("button", { name: "Delete" }).click()
            cy.findByRole("button", { name: "🛍️ Shopping" }).click()
            cy.findByRole("button", { name: "Move & delete" }).click()
            categoryId(user, "Shopping").then((shopping) => {
              rowsSoon(
                `select amount_minor::int as amount_minor from fin_record
                  where id = $1 and category_id = $2 and deleted_at is null`,
                [rec.id, shopping],
              ).then(([r]) => expect(r.amount_minor).to.eq(75025))
            })
            rowsSoon(
              "select id from category where id = $1 and deleted_at is not null",
              [hobbies.id],
            )
          })
        })
      })
    })
  })

  it("creates a budget over two categories, edits it, and reports pace", () => {
    cy.newLiveUser("fin").then((user) => {
      seedAccount(user, {
        name: "Wallet",
        type: "cash",
        opening_minor: 1000000,
      }).then((wallet) => {
        openFinance(user, "/finance/budgets", "Make my own")
        cy.findByRole("button", { name: "Add budget" }).click()
        cy.findByLabelText("Name").type("Eating")
        cy.findByRole("tab", { name: "Categories" }).click()
        cy.contains("Choose categories…").click()
        cy.contains("Dining out").click()
        cy.contains("Coffee").click()
        cy.findByRole("button", { name: "Done" }).click()
        cy.findByLabelText("Monthly limit ₱").clear().type("5000.50")
        cy.findByRole("button", { name: "Save" }).click()

        rowsSoon(
          `select id, limit_minor::int as limit_minor, archived from budget
            where owner_id = $1 and name = 'Eating' and deleted_at is null`,
          [user.id],
        ).then(([b]) => {
          expect(b).to.include({ limit_minor: 500050, archived: false })
          rowsSoon(
            `select c.name from budget_category bc join category c on c.id = bc.category_id
              where bc.budget_id = $1 and bc.deleted_at is null order by c.name`,
            [b.id],
            2,
          ).then((rows) =>
            expect(rows.map((r) => r.name)).to.deep.eq([
              "Coffee",
              "Dining out",
            ]),
          )

          // Edit the limit.
          cy.visit(`/finance/budgets/${b.id}`)
          cy.findByRole("button", { name: "Edit budget" }).click()
          cy.findByLabelText("Monthly limit ₱").clear().type("6000")
          cy.findByRole("button", { name: "Save" }).click()
          rowsSoon(
            "select id from budget where id = $1 and limit_minor = 600000",
            [b.id],
          )

          // Pace: ₱1,234.56 spent at a coffee shop this month.
          categoryId(user, "Coffee").then((coffee) => {
            cy.liveApi(user, "POST", "/finance/records", {
              type: "expense",
              amount_minor: 123456,
              account_id: wallet.id,
              category_id: coffee,
              payee: "Starbucks",
              at: `${dayKey()}T01:00:00Z`,
              source: "manual",
            })
          })
          apiSoon<{
            data: {
              budget: { id: string }
              spent_minor: number
              limit_minor: number
              pace: number
              days_left: number
            }[]
          }>(user, "/finance/budgets", (r) =>
            r.data.some(
              (v) => v.budget.id === b.id && v.spent_minor === 123456,
            ),
          ).then((r) => {
            const v = r.data.find((x) => x.budget.id === b.id)
            expect(v?.limit_minor).to.eq(600000)
            expect(v?.pace).to.be.a("number")
            expect(v?.days_left).to.be.at.least(0)
          })
          // The screen shows what the server computed.
          cy.reload()
          cy.findAllByText(/₱1,234\.56/, { timeout: 30000 }).should("exist")
        })
      })
    })
  })

  it("archives a budget (undo), then deletes it", () => {
    cy.newLiveUser("fin").then((user) => {
      cy.liveApi<{ id: string }>(user, "POST", "/finance/budgets", {
        name: "Fun",
        limit_minor: 300000,
        category_ids: [],
      }).then((b) => {
        openFinance(user, `/finance/budgets/${b.id}`, "Fun")
        cy.findByRole("button", { name: "Edit budget" }).click()
        // Archive + Undo while the toast shows: still active on the server.
        cy.findByRole("button", { name: "Archive" }).click()
        clickUndo()
        outboxDrained()
        rowsSoon("select id from budget where id = $1 and not archived", [b.id])
        // Archive for real, then restore it from the archive screen.
        cy.findByRole("button", { name: "Edit budget" }).click()
        cy.findByRole("button", { name: "Archive" }).click()
        rowsSoon("select id from budget where id = $1 and archived", [b.id])
        cy.visit("/finance/archived")
        cy.findByRole("button", { name: "Restore", timeout: 60000 }).click()
        rowsSoon("select id from budget where id = $1 and not archived", [b.id])
        cy.visit(`/finance/budgets/${b.id}`)
        cy.findByRole("button", { name: "Edit budget", timeout: 60000 }).click()
        cy.findByRole("button", { name: "Delete" }).click()
        rowsSoon(
          "select id from budget where id = $1 and deleted_at is not null",
          [b.id],
        )
        apiSoon<{ data: { budget: { id: string } }[] }>(
          user,
          "/finance/budgets?include_archived=true",
          (r) => !r.data.some((v) => v.budget.id === b.id),
        )
      })
    })
  })
})
